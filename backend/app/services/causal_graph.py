from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAIError

from app.rag.search import RagSearchError, search_rag_chunks
from app.services.causal_questions import (
    CausalQuestionGenerationError,
    DEFAULT_MODEL,
    MAX_EVIDENCE_CHUNKS,
    get_openai_client,
    resolve_dataset_path,
    summarize_evidence,
    summarize_schema,
)
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema
from app.validation.causal_graph import validate_causal_graph


class CausalGraphGenerationError(RuntimeError):
    pass


def build_graph_generation_messages(
    *,
    confirmed_question: str,
    schema_summary: dict[str, Any],
    selected_variables: list[dict[str, Any]],
    role_recommendations: list[dict[str, Any]],
    evidence_chunks: list[dict[str, Any]],
    estimand_type: str,
) -> list[dict[str, str]]:
    system_message = """
You are the first-pass causal graph drafting assistant for Causal Studio.

Causal Studio is a causal-design support tool, not a diagnostic tool or
treatment-decision system. The LLM recommends, explains, and drafts. Deterministic
Python backend validation checks causal roles, timing, graph structure, and
claims. Do not present causal conclusions as proven.

Use the pattern: LLM recommendation -> user review -> backend validation. The
graph is a draft, not a validated causal graph. Do not claim any edge is proven
causal. Mark weak evidence and uncertain direction clearly. Do not estimate
effects. Do not make diagnosis or treatment recommendations.

Return valid JSON only. Do not wrap the JSON in Markdown.
""".strip()

    user_message = {
        "confirmed_causal_research_question": confirmed_question,
        "estimand_type": estimand_type,
        "dataset_schema_summary": schema_summary,
        "selected_variables": selected_variables,
        "validated_role_recommendations": role_recommendations,
        "retrieved_evidence_chunks": evidence_chunks,
        "required_output": {
            "graph_type": "DAG",
            "nodes": [
                {
                    "node_id": "stable_node_id_matching_variable_name",
                    "variable_name": "selected variable name",
                    "display_name": "short display name",
                    "role": "role label from recommendations",
                    "temporal_role": "pre-exposure | exposure-window | outcome-window | time index | unknown",
                    "data_category": "source category",
                    "is_observed": True,
                    "confidence": "low | medium | high",
                }
            ],
            "edges": [
                {
                    "source": "source node_id",
                    "target": "target node_id",
                    "edge_type": "directed",
                    "rationale": "brief rationale without causal certainty claims",
                    "supporting_evidence": [
                        "brief evidence note with source filename when possible"
                    ],
                    "confidence": "low | medium | high",
                    "temporal_assumption": "why source precedes target",
                    "user_editable": True,
                }
            ],
            "uncertain_edges": [
                {
                    "source": "source node_id",
                    "target": "target node_id",
                    "possible_direction": "source->target | target->source | unclear",
                    "uncertainty_reason": "why direction is uncertain",
                    "evidence_gap": "what evidence is missing",
                    "recommended_user_review": "what user should confirm",
                }
            ],
            "omitted_variables": [
                {
                    "variable_name": "selected or evidence-important variable",
                    "reason": "why omitted from first-pass graph"
                }
            ],
            "latent_confounder_warnings": [
                "unobserved common cause warning requiring user review"
            ],
            "graph_rationale": "brief draft-level rationale",
            "evidence_summary": "brief evidence summary",
            "limitations": [
                "draft limitations; do not claim graph validity"
            ],
        },
        "instructions": [
            "Include selected variables as nodes unless they are clearly structural IDs; list omitted variables with reasons.",
            "Do not use ID/grouping variables as causal sources or targets.",
            "Do not use the outcome as a cause of exposure or sensing variables.",
            "Use timestamp variables to structure time, not as causal exposures, unless explicitly justified.",
            "Mark weak or unsupported edges as uncertain_edges rather than confident edges.",
            "Do not include graph cycles in a DAG draft.",
        ],
    }

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": json.dumps(user_message)},
    ]


def parse_graph_json(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise CausalGraphGenerationError(
            "LLM response was not valid JSON. Try again or adjust the prompt."
        ) from error

    if not isinstance(parsed.get("nodes"), list):
        raise CausalGraphGenerationError("LLM response did not include graph nodes.")

    if not isinstance(parsed.get("edges"), list):
        parsed["edges"] = []

    return {
        "graph_type": parsed.get("graph_type") or "DAG",
        "nodes": parsed.get("nodes", []),
        "edges": parsed.get("edges", []),
        "uncertain_edges": parsed.get("uncertain_edges", []),
        "omitted_variables": parsed.get("omitted_variables", []),
        "latent_confounder_warnings": parsed.get("latent_confounder_warnings", []),
        "graph_rationale": parsed.get("graph_rationale", ""),
        "evidence_summary": parsed.get("evidence_summary", ""),
        "limitations": parsed.get("limitations", []),
    }


def generate_and_validate_graph(
    *,
    confirmed_question: str,
    dataset_filename: str,
    selected_variables: list[dict[str, Any]],
    role_recommendations: list[dict[str, Any]],
    estimand_type: str = "total_effect",
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise CausalGraphGenerationError("confirmed_question cannot be empty.")
    if not selected_variables:
        raise CausalGraphGenerationError("selected_variables cannot be empty.")
    if not role_recommendations:
        raise CausalGraphGenerationError("role_recommendations cannot be empty.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise CausalGraphGenerationError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise CausalGraphGenerationError(str(error)) from error

    variable_names = [
        str(variable.get("variable_name") or variable.get("source_field") or "")
        for variable in selected_variables
    ]
    role_names = [
        f"{role.get('variable_name')}: {','.join(role.get('recommended_roles', []))}"
        for role in role_recommendations
    ]
    evidence_query = (
        f"{normalized_question} graph assumptions selected variables: "
        f"{', '.join(variable_names)} roles: {', '.join(role_names)}"
    )
    try:
        evidence_search = search_rag_chunks(
            query=evidence_query,
            top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
        )
    except RagSearchError as error:
        raise CausalGraphGenerationError(str(error)) from error

    schema_summary = summarize_schema(schema)
    evidence_chunks = summarize_evidence(evidence_search)
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
    request_kwargs = {
        "model": model,
        "messages": build_graph_generation_messages(
            confirmed_question=normalized_question,
            schema_summary=schema_summary,
            selected_variables=selected_variables,
            role_recommendations=role_recommendations,
            evidence_chunks=evidence_chunks,
            estimand_type=estimand_type,
        ),
        "response_format": {"type": "json_object"},
    }
    if not model.startswith("gpt-5"):
        request_kwargs["temperature"] = 0.2

    try:
        response = client.chat.completions.create(**request_kwargs)
    except OpenAIError as error:
        raise CausalGraphGenerationError(
            f"OpenAI request failed: {error}"
        ) from error

    content = response.choices[0].message.content or "{}"
    graph_draft = parse_graph_json(content)
    validation = validate_causal_graph(
        graph_draft=graph_draft,
        selected_variables=selected_variables,
        role_recommendations=role_recommendations,
        schema=schema,
        estimand_type=estimand_type,
    )

    return {
        "status": "completed",
        "confirmed_question": normalized_question,
        "dataset_filename": dataset_filename,
        "estimand_type": estimand_type,
        "model": model,
        "evidence_chunks_used": len(evidence_chunks),
        "graph_draft": graph_draft,
        "backend_validation": validation,
        "schema_summary": schema_summary,
    }


def validate_edited_graph(
    *,
    confirmed_question: str,
    dataset_filename: str,
    graph_draft: dict[str, Any],
    selected_variables: list[dict[str, Any]],
    role_recommendations: list[dict[str, Any]],
    estimand_type: str = "total_effect",
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise CausalGraphGenerationError("confirmed_question cannot be empty.")
    if not graph_draft:
        raise CausalGraphGenerationError("graph_draft cannot be empty.")
    if not selected_variables:
        raise CausalGraphGenerationError("selected_variables cannot be empty.")
    if not role_recommendations:
        raise CausalGraphGenerationError("role_recommendations cannot be empty.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise CausalGraphGenerationError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise CausalGraphGenerationError(str(error)) from error

    normalized_graph = {
        "graph_type": graph_draft.get("graph_type") or "DAG",
        "nodes": graph_draft.get("nodes", []),
        "edges": graph_draft.get("edges", []),
        "uncertain_edges": graph_draft.get("uncertain_edges", []),
        "omitted_variables": graph_draft.get("omitted_variables", []),
        "latent_confounder_warnings": graph_draft.get("latent_confounder_warnings", []),
        "graph_rationale": graph_draft.get("graph_rationale", ""),
        "evidence_summary": graph_draft.get("evidence_summary", ""),
        "limitations": graph_draft.get("limitations", []),
    }
    validation = validate_causal_graph(
        graph_draft=normalized_graph,
        selected_variables=selected_variables,
        role_recommendations=role_recommendations,
        schema=schema,
        estimand_type=estimand_type,
    )

    return {
        "status": "validated",
        "confirmed_question": normalized_question,
        "dataset_filename": dataset_filename,
        "estimand_type": estimand_type,
        "model": "user_edited_graph",
        "evidence_chunks_used": 0,
        "graph_draft": normalized_graph,
        "backend_validation": validation,
        "schema_summary": summarize_schema(schema),
    }
