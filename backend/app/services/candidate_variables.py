from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAIError

from app.core.langsmith_tracing import record_trace_event, summarize_sources
from app.rag.search import RagSearchError, search_rag_chunks
from app.services.causal_questions import (
    CausalQuestionGenerationError,
    DEFAULT_MODEL,
    MAX_EVIDENCE_CHUNKS,
    format_openai_error,
    get_openai_client,
    resolve_dataset_path,
    summarize_evidence,
    summarize_schema,
)
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


DATA_CATEGORIES = [
    "baseline_demographic",
    "clinical_treatment",
    "ema_self_report",
    "smartphone_sensing",
    "wearable_sensing",
    "temporal_contextual",
    "unknown_or_uncertain",
]


class CandidateVariableRecommendationError(RuntimeError):
    pass


def build_variable_recommendation_messages(
    confirmed_question: str,
    schema_summary: dict[str, Any],
    evidence_chunks: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system_message = """
You are the candidate variable recommendation assistant for Causal Studio.

Causal Studio is a causal-design support tool, not a diagnostic tool or
treatment-decision system. The LLM recommends, explains, and drafts. Deterministic
Python backend validation checks causal roles, timing, graph structure, and
claims. Do not present causal conclusions as proven.

Use the pattern: LLM recommendation -> user review -> backend validation.
Treat every recommendation as a candidate requiring user confirmation and later
deterministic validation. Evidence-supported candidate does not mean causally
validated variable. Do not assign final causal roles. Do not generate a causal
graph. Do not recommend diagnosis or treatment decisions.

Return valid JSON only. Do not wrap the JSON in Markdown.
""".strip()

    user_message = {
        "confirmed_causal_research_question": confirmed_question,
        "dataset_schema_summary": schema_summary,
        "retrieved_evidence_chunks": evidence_chunks,
        "allowed_data_categories": DATA_CATEGORIES,
        "allowed_recommendation_status_values": [
            "recommended",
            "consider",
            "exclude",
            "unavailable_but_important",
            "redundant",
            "not_recommended_for_adjustment",
        ],
        "required_output": {
            "variable_groups": {
                category: [
                    {
                        "variable_name": "human-readable variable or construct",
                        "source_field": "dataset column name, derived feature name, or unavailable",
                        "data_category": category,
                        "direct_or_derived": "direct | derived | unavailable",
                        "relevance_to_question": "why this may matter for the confirmed question",
                        "possible_role_hint": "candidate exposure | candidate outcome | candidate time index | candidate covariate | candidate stratifier | candidate exclusion | uncertain",
                        "measurement_timing": "when measured relative to exposure/outcome window",
                        "data_quality_notes": "proxy, sparsity, measurement caveats, or none",
                        "missingness_warning": "missingness concern, timing uncertainty, or none",
                        "supporting_evidence": [
                            "brief evidence note with source filename when possible"
                        ],
                        "recommendation_status": "recommended | consider | exclude | unavailable_but_important | redundant | not_recommended_for_adjustment",
                        "confidence": "low | medium | high",
                        "user_decision_default": "include_for_review | hold_for_review | exclude_by_default",
                    }
                ]
                for category in DATA_CATEGORIES
            },
            "derived_features": [
                {
                    "derived_feature_name": "lagged sleep exposure",
                    "source_columns_needed": ["schema column names required"],
                    "calculation_window": "window t, previous day, cumulative 24h, etc.",
                    "aggregation_method": "mean, sum, min, max, count, lag, indicator, etc.",
                    "minimum_data_requirement": "minimum observations or days required",
                    "leakage_risk": "low | medium | high with brief reason",
                    "missing_data_handling": "complete case, imputation candidate, missing indicator, etc.",
                    "supporting_evidence": [
                        "brief evidence note with source filename when possible"
                    ],
                    "confidence": "low | medium | high",
                }
            ],
        },
        "instructions": [
            "Recommend available dataset variables where names match schema columns.",
            "Identify evidence-important variables that appear unavailable in the uploaded dataset.",
            "Suggest derived features only when source columns appear available.",
            "Flag proxy variables, weak evidence, uncertain timing, high missingness, and leakage risk.",
            "Do not claim that any variable is truly causally valid.",
            "Do not assign final causal roles; use role hints only.",
        ],
    }

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": json.dumps(user_message)},
    ]


def parse_variable_recommendation_json(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise CandidateVariableRecommendationError(
            "LLM response was not valid JSON. Try again or adjust the prompt."
        ) from error

    variable_groups = parsed.get("variable_groups")
    if not isinstance(variable_groups, dict):
        raise CandidateVariableRecommendationError(
            "LLM response did not include variable_groups."
        )

    normalized_groups = {}
    for category in DATA_CATEGORIES:
        recommendations = variable_groups.get(category, [])
        normalized_groups[category] = recommendations if isinstance(recommendations, list) else []

    derived_features = parsed.get("derived_features", [])
    if not isinstance(derived_features, list):
        derived_features = []

    return {
        "variable_groups": normalized_groups,
        "derived_features": derived_features,
    }


def recommend_candidate_variables(
    confirmed_question: str,
    dataset_filename: str,
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise CandidateVariableRecommendationError("confirmed_question cannot be empty.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise CandidateVariableRecommendationError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise CandidateVariableRecommendationError(str(error)) from error

    try:
        evidence_search = search_rag_chunks(
            query=normalized_question,
            top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
        )
    except RagSearchError as error:
        raise CandidateVariableRecommendationError(str(error)) from error

    schema_summary = summarize_schema(schema)
    evidence_chunks = summarize_evidence(evidence_search)
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)

    request_kwargs = {
        "model": model,
        "messages": build_variable_recommendation_messages(
            confirmed_question=normalized_question,
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
        raise CandidateVariableRecommendationError(format_openai_error(error)) from error

    content = response.choices[0].message.content or "{}"
    parsed = parse_variable_recommendation_json(content)
    variable_count = sum(len(items) for items in parsed["variable_groups"].values())

    record_trace_event(
        "candidate_variable_recommendation",
        {
            "workflow_step": 4,
            "dataset_filename": dataset_filename,
            "confirmed_question_length": len(normalized_question),
            "number_of_retrieved_evidence_chunks": len(evidence_chunks),
            "source_filenames_used": summarize_sources(evidence_search.get("results", [])),
            "candidate_variable_count": variable_count,
            "derived_feature_count": len(parsed["derived_features"]),
            "model": model,
        },
    )

    return {
        "status": "completed",
        "confirmed_question": normalized_question,
        "dataset_filename": dataset_filename,
        "model": model,
        "evidence_chunks_used": len(evidence_chunks),
        "data_categories": DATA_CATEGORIES,
        "schema_summary": schema_summary,
        "variable_groups": parsed["variable_groups"],
        "derived_features": parsed["derived_features"],
    }
