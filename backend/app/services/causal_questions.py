from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from app.core.langsmith_tracing import record_trace_event, summarize_sources
from app.rag.search import RagSearchError, search_rag_chunks
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


DATASET_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "datasets"
DEFAULT_MODEL = "gpt-4o-mini"
MAX_EVIDENCE_CHUNKS = 10


class CausalQuestionGenerationError(RuntimeError):
    pass


def format_openai_error(error: OpenAIError) -> str:
    error_text = str(error)
    lowered_error = error_text.lower()

    if "insufficient permissions" in lowered_error or "401" in lowered_error:
        return (
            "OpenAI request failed because the configured API key or project "
            "does not have access to the selected OPENAI_MODEL. Check "
            "OPENAI_API_KEY, OPENAI_MODEL, and project permissions."
        )

    if "model" in lowered_error and (
        "not found" in lowered_error or "does not exist" in lowered_error
    ):
        return (
            "OpenAI request failed because OPENAI_MODEL is unavailable for this "
            "API key. Choose a model available to the configured project."
        )

    if "api key" in lowered_error or "authentication" in lowered_error:
        return (
            "OpenAI request failed because OPENAI_API_KEY is missing, invalid, "
            "or not authorized for this project."
        )

    return (
        "OpenAI request failed. Check OPENAI_API_KEY, OPENAI_MODEL, network "
        "access, and project permissions."
    )


def resolve_dataset_path(filename: str) -> Path:
    requested_path = Path(filename)
    if requested_path.name != filename:
        raise CausalQuestionGenerationError("Dataset filename must not include a path.")

    dataset_path = DATASET_UPLOAD_DIR / filename
    if dataset_path.exists() and dataset_path.is_file():
        if dataset_path.suffix.lower() != ".csv":
            raise CausalQuestionGenerationError("Candidate questions require a CSV dataset.")
        return dataset_path

    if requested_path.suffix.lower() != ".csv":
        raise CausalQuestionGenerationError("Candidate questions require a CSV dataset.")

    matching_uploads = sorted(
        path
        for path in DATASET_UPLOAD_DIR.glob(f"{requested_path.stem}_*.csv")
        if path.is_file()
    )
    if len(matching_uploads) == 1:
        return matching_uploads[0]

    if len(matching_uploads) > 1:
        raise CausalQuestionGenerationError(
            "Multiple saved uploads match that dataset name. Use the exact saved filename from /datasets."
        )

    raise CausalQuestionGenerationError("Dataset file was not found.")


def get_openai_client() -> OpenAI:
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise CausalQuestionGenerationError(
            "OPENAI_API_KEY is not configured. Add it to your environment or backend/.env."
        )
    return OpenAI(api_key=api_key)


def summarize_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "filename": schema["filename"],
        "number_of_rows": schema["number_of_rows"],
        "number_of_columns": schema["number_of_columns"],
        "column_names": schema["column_names"],
        "pandas_data_types": schema["pandas_data_types"],
        "missing_value_percentage_per_column": schema[
            "missing_value_percentage_per_column"
        ],
        "possible_numeric_columns": schema["possible_numeric_columns"],
        "possible_categorical_columns": schema["possible_categorical_columns"],
        "possible_id_columns": schema["possible_id_columns"],
        "possible_timestamp_date_columns": schema[
            "possible_timestamp_date_columns"
        ],
        "warnings": schema["warnings"],
    }


def summarize_evidence(search_response: dict[str, Any]) -> list[dict[str, Any]]:
    evidence = []
    for result in search_response.get("results", []):
        evidence.append(
            {
                "source_filename": result.get("source_filename"),
                "page_number": result.get("page_number"),
                "chunk_index": result.get("chunk_index"),
                "distance": result.get("distance"),
                "chunk_text": result.get("chunk_text"),
            }
        )
    return evidence


def build_messages(
    research_objective: str,
    schema_summary: dict[str, Any],
    evidence_chunks: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system_message = """
You are the candidate causal research question generator for Causal Studio.

Causal Studio is a causal-design support tool, not a diagnostic tool or
treatment-decision system. The LLM recommends, explains, and drafts. Deterministic
Python backend validation checks causal roles, timing, graph structure, and
claims. Do not present causal conclusions as proven.

Use the pattern: LLM recommendation -> user review -> backend validation.
Treat every output as a design candidate requiring user confirmation.
State when evidence is weak, missing, or not specific to the dataset population.
Avoid diagnostic or treatment recommendations.

Return valid JSON only. Do not wrap the JSON in Markdown.
""".strip()

    user_message = {
        "research_objective": research_objective,
        "dataset_schema_summary": schema_summary,
        "retrieved_evidence_chunks": evidence_chunks,
        "required_output": {
            "candidates": [
                {
                    "candidate_id": "CQ1",
                    "question_text": "Candidate causal research question.",
                    "population": "Population implied by objective or dataset.",
                    "exposure": "Exposure variable or construct.",
                    "comparator": "Comparator, contrast, or reference condition.",
                    "outcome": "Outcome variable or construct.",
                    "time_window": "Timing or lag window.",
                    "unit_of_analysis": "Participant-day, person-window, etc.",
                    "within_person_or_between_person_focus": "within-person or between-person",
                    "required_variables": ["variables or constructs needed"],
                    "available_dataset_variables": ["matching columns from schema"],
                    "missing_or_uncertain_variables": ["needed variables not confirmed"],
                    "supporting_evidence": [
                        "Brief evidence note with source filename when possible"
                    ],
                    "limitations": [
                        "Design caveats; do not claim causality is established"
                    ],
                    "confidence": "low | medium | high",
                }
            ]
        },
        "instructions": [
            "Generate 3 to 5 candidates.",
            "Use only available schema columns when naming dataset variables.",
            "Distinguish constructs from observed proxy variables.",
            "Do not claim any causal relationship is valid or proven.",
        ],
    }

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": json.dumps(user_message)},
    ]


def parse_llm_json(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise CausalQuestionGenerationError(
            "LLM response was not valid JSON. Try again or adjust the prompt."
        ) from error

    candidates = parsed.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise CausalQuestionGenerationError(
            "LLM response did not include candidate questions."
        )

    return parsed


def generate_candidate_questions(
    research_objective: str,
    dataset_filename: str,
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_objective = research_objective.strip()
    if not normalized_objective:
        raise CausalQuestionGenerationError("research_objective cannot be empty.")

    dataset_path = resolve_dataset_path(dataset_filename)
    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise CausalQuestionGenerationError(str(error)) from error

    try:
        evidence_search = search_rag_chunks(
            query=normalized_objective,
            top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
        )
    except RagSearchError as error:
        raise CausalQuestionGenerationError(str(error)) from error

    schema_summary = summarize_schema(schema)
    evidence_chunks = summarize_evidence(evidence_search)
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)

    request_kwargs = {
        "model": model,
        "messages": build_messages(
            research_objective=normalized_objective,
            schema_summary=schema_summary,
            evidence_chunks=evidence_chunks,
        ),
        "response_format": {"type": "json_object"},
    }
    if not model.startswith("gpt-5"):
        request_kwargs["temperature"] = 0.2

    try:
        response = client.chat.completions.create(**request_kwargs)
    except OpenAIError as error:
        raise CausalQuestionGenerationError(format_openai_error(error)) from error

    content = response.choices[0].message.content or "{}"
    parsed = parse_llm_json(content)
    candidates = parsed["candidates"][:5]

    record_trace_event(
        "candidate_causal_question_generation",
        {
            "workflow_step": 4,
            "dataset_filename": dataset_filename,
            "research_objective_length": len(normalized_objective),
            "number_of_retrieved_evidence_chunks": len(evidence_chunks),
            "source_filenames_used": summarize_sources(evidence_search.get("results", [])),
            "candidate_count": len(candidates),
            "model": model,
        },
    )

    return {
        "status": "completed",
        "research_objective": normalized_objective,
        "dataset_filename": dataset_filename,
        "model": model,
        "evidence_chunks_used": len(evidence_chunks),
        "schema_summary": schema_summary,
        "candidates": candidates,
    }
