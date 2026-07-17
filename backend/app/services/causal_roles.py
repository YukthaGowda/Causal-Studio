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
from app.validation.causal_roles import validate_causal_roles


ALLOWED_ROLES = [
    "exposure",
    "outcome",
    "confounder",
    "mediator",
    "collider",
    "effect_modifier",
    "proxy_variable",
    "post_treatment_variable",
    "baseline_covariate",
    "time_varying_covariate",
    "temporal_context_variable",
    "id_or_grouping_variable",
    "not_for_adjustment",
    "uncertain",
]


class CausalRoleRecommendationError(RuntimeError):
    pass


def build_role_recommendation_messages(
    *,
    confirmed_question: str,
    schema_summary: dict[str, Any],
    selected_variables: list[dict[str, Any]],
    evidence_chunks: list[dict[str, Any]],
    estimand_type: str,
) -> list[dict[str, str]]:
    system_message = """
You are the causal role recommendation assistant for Causal Design Agent.

Causal Design Agent is a causal-design support tool, not a diagnostic tool or
treatment-decision system. The LLM recommends, explains, and drafts. Deterministic
Python backend validation checks causal roles, timing, graph structure, and
claims. Do not present causal conclusions as proven.

Use the pattern: LLM recommendation -> user review -> backend validation.
Roles are not causally proven. Evidence-supported candidates are not validated
causal variables. Do not estimate effects. Do not generate a causal graph. Do not
make diagnosis or treatment recommendations.

A variable can have more than one role label. Do not force a single dropdown-style
role when multiple labels are appropriate.

Return valid JSON only. Do not wrap the JSON in Markdown.
""".strip()

    user_message = {
        "confirmed_causal_research_question": confirmed_question,
        "estimand_type": estimand_type,
        "dataset_schema_summary": schema_summary,
        "selected_variables": selected_variables,
        "retrieved_evidence_chunks": evidence_chunks,
        "allowed_roles": ALLOWED_ROLES,
        "allowed_adjustment_recommendations": [
            "include_in_adjustment_candidate",
            "do_not_adjust",
            "review_required",
            "unavailable_or_not_applicable",
            "uncertain",
        ],
        "required_output": {
            "role_recommendations": [
                {
                    "variable_name": "selected variable name",
                    "source_field": "dataset field or derived feature name",
                    "recommended_roles": [
                        "one or more allowed role labels"
                    ],
                    "primary_role": "single best role label for display, or uncertain",
                    "temporal_role": "pre-exposure | exposure-window | post-exposure | pre-outcome | post-outcome | time index | unknown",
                    "measurement_role": "direct measure | proxy measure | derived feature | id/grouping | time structure | unknown",
                    "adjustment_recommendation": "include_in_adjustment_candidate | do_not_adjust | review_required | unavailable_or_not_applicable | uncertain",
                    "rationale": "brief rationale without causal certainty claims",
                    "supporting_evidence": [
                        "brief evidence note with source filename when possible"
                    ],
                    "uncertainty_notes": "timing, proxy, missingness, or evidence uncertainty",
                    "confidence": "low | medium | high",
                }
            ]
        },
        "instructions": [
            "Recommend labels only for selected variables.",
            "Do not claim a role is causally proven.",
            "Use id_or_grouping_variable for pid-like identifiers.",
            "Use temporal_context_variable or time structure labels for timestamp/time/day fields.",
            "Treat sensing variables as proxy variables when they indirectly represent activity, sleep, stress, or context.",
            "For total_effect, do not automatically recommend mediator/collider adjustment.",
        ],
    }

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": json.dumps(user_message)},
    ]


def parse_role_recommendation_json(content: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise CausalRoleRecommendationError(
            "LLM response was not valid JSON. Try again or adjust the prompt."
        ) from error

    recommendations = parsed.get("role_recommendations")
    if not isinstance(recommendations, list) or not recommendations:
        raise CausalRoleRecommendationError(
            "LLM response did not include role_recommendations."
        )

    normalized = []
    for recommendation in recommendations:
        if not isinstance(recommendation, dict):
            continue
        roles = recommendation.get("recommended_roles", [])
        if not isinstance(roles, list):
            roles = [str(roles)]
        recommendation["recommended_roles"] = [
            str(role).strip()
            for role in roles
            if str(role).strip() in ALLOWED_ROLES
        ] or ["uncertain"]
        normalized.append(recommendation)

    if not normalized:
        raise CausalRoleRecommendationError(
            "LLM response did not include usable role recommendations."
        )

    return normalized


def recommend_and_validate_roles(
    *,
    confirmed_question: str,
    dataset_filename: str,
    selected_variables: list[dict[str, Any]],
    estimand_type: str = "total_effect",
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise CausalRoleRecommendationError("confirmed_question cannot be empty.")

    if not selected_variables:
        raise CausalRoleRecommendationError("selected_variables cannot be empty.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise CausalRoleRecommendationError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise CausalRoleRecommendationError(str(error)) from error

    variable_names = [
        str(variable.get("variable_name") or variable.get("source_field") or "")
        for variable in selected_variables
    ]
    evidence_query = f"{normalized_question} selected variables: {', '.join(variable_names)}"
    try:
        evidence_search = search_rag_chunks(
            query=evidence_query,
            top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
        )
    except RagSearchError as error:
        raise CausalRoleRecommendationError(str(error)) from error

    schema_summary = summarize_schema(schema)
    evidence_chunks = summarize_evidence(evidence_search)
    client = get_openai_client()
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)

    request_kwargs = {
        "model": model,
        "messages": build_role_recommendation_messages(
            confirmed_question=normalized_question,
            schema_summary=schema_summary,
            selected_variables=selected_variables,
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
        raise CausalRoleRecommendationError(format_openai_error(error)) from error

    content = response.choices[0].message.content or "{}"
    role_recommendations = parse_role_recommendation_json(content)
    validation = validate_causal_roles(
        selected_variables=selected_variables,
        role_recommendations=role_recommendations,
        schema=schema,
        estimand_type=estimand_type,
    )

    record_trace_event(
        "causal_role_recommendation_and_validation",
        {
            "workflow_step": 6,
            "dataset_filename": dataset_filename,
            "confirmed_question_length": len(normalized_question),
            "selected_variable_count": len(selected_variables),
            "number_of_retrieved_evidence_chunks": len(evidence_chunks),
            "source_filenames_used": summarize_sources(evidence_search.get("results", [])),
            "deterministic_validation_status": validation.get("validation_status"),
            "warning_count": len(validation.get("warnings", [])),
            "error_count": len(validation.get("errors", [])),
            "model": model,
        },
    )

    return {
        "status": "completed",
        "confirmed_question": normalized_question,
        "dataset_filename": dataset_filename,
        "estimand_type": estimand_type,
        "model": model,
        "evidence_chunks_used": len(evidence_chunks),
        "selected_variables": selected_variables,
        "role_recommendations": role_recommendations,
        "backend_validation": validation,
        "schema_summary": schema_summary,
    }
