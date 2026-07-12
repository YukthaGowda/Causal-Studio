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


ID_FIELD_NAMES = {"pid", "id", "participant_id", "subject_id", "user_id"}


class AnalysisStrategyError(RuntimeError):
    pass


def make_issue(
    *,
    issue_type: str,
    message: str,
    severity: str,
    suggested_fix: str,
    variable_name: str | None = None,
) -> dict[str, Any]:
    return {
        "issue_type": issue_type,
        "variable_name": variable_name,
        "message": message,
        "severity": severity,
        "suggested_fix": suggested_fix,
    }


def deterministic_strategy_checks(
    *,
    identification_result: dict[str, Any],
    exposure: str | None,
    outcome: str | None,
    adjustment_set: list[str],
    schema: dict[str, Any],
) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    missingness = schema.get("missing_value_percentage_per_column", {})

    identification_status = identification_result.get("identification_status")
    safe_to_continue = bool(
        identification_result.get("safe_to_continue_to_analysis_strategy")
    )

    if identification_status == "not_identifiable_with_current_design":
        errors.append(
            make_issue(
                issue_type="not_identifiable",
                message="Identification result says the design is not identifiable with the current design.",
                severity="blocking",
                suggested_fix="Revise the graph, roles, variables, or adjustment set before strategy planning.",
            )
        )

    if not safe_to_continue:
        errors.append(
            make_issue(
                issue_type="not_safe_to_continue",
                message="Identification result is not safe to continue to analysis strategy.",
                severity="blocking",
                suggested_fix="Resolve identification warnings/errors before generating strategy guidance.",
            )
        )

    if not exposure:
        errors.append(
            make_issue(
                issue_type="missing_exposure",
                message="Exposure is required before strategy guidance can be generated.",
                severity="blocking",
                suggested_fix="Select or confirm an exposure candidate.",
            )
        )

    if not outcome:
        errors.append(
            make_issue(
                issue_type="missing_outcome",
                message="Outcome is required before strategy guidance can be generated.",
                severity="blocking",
                suggested_fix="Select or confirm an outcome candidate.",
            )
        )

    if exposure and outcome and exposure == outcome:
        errors.append(
            make_issue(
                issue_type="same_exposure_and_outcome",
                variable_name=exposure,
                message="Exposure and outcome cannot be the same variable.",
                severity="blocking",
                suggested_fix="Choose distinct exposure and outcome variables.",
            )
        )

    for variable in adjustment_set:
        variable_lower = variable.lower()
        if variable_lower in ID_FIELD_NAMES:
            errors.append(
                make_issue(
                    issue_type="id_in_adjustment_set",
                    variable_name=variable,
                    message="ID/grouping variables are invalid causal adjustment variables.",
                    severity="blocking",
                    suggested_fix="Use ID variables for grouping or clustering structure, not causal adjustment.",
                )
            )

        missing_value = missingness.get(variable)
        if isinstance(missing_value, (int, float)) and missing_value >= 30:
            warnings.append(
                make_issue(
                    issue_type="high_missingness_adjustment_variable",
                    variable_name=variable,
                    message=f"{variable} has {missing_value:.2f}% missingness in the uploaded dataset.",
                    severity="warning" if missing_value < 50 else "high",
                    suggested_fix="Review missing-data handling before including this variable in the strategy.",
                )
            )

    for warning in identification_result.get("warnings", []):
        if warning.get("severity") in {"high", "blocking"}:
            warnings.append(
                make_issue(
                    issue_type=f"identification_{warning.get('issue_type', 'warning')}",
                    variable_name=warning.get("variable_name"),
                    message=warning.get("message", "Identification warning requires review."),
                    severity=warning.get("severity", "warning"),
                    suggested_fix=warning.get("suggested_fix", "Review identification warning."),
                )
            )

    return {"warnings": warnings, "errors": errors}


def fallback_strategy(
    *,
    status: str,
    exposure: str | None,
    outcome: str | None,
    adjustment_set: list[str],
    identification_result: dict[str, Any],
    deterministic_warnings: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "strategy_status": status,
        "target_estimand": "total effect guidance only; no effect estimated",
        "exposure_definition": exposure or "Exposure not confirmed",
        "comparator_definition": "Compare lower versus higher exposure values or user-defined contrast after review.",
        "outcome_definition": outcome or "Outcome not confirmed",
        "time_window": "Window t exposure/proxy preceding next observation outcome, subject to timing review.",
        "unit_of_analysis": "participant-window or participant-observation",
        "adjustment_set": adjustment_set,
        "repeated_measures_handling": "Account for repeated observations within participant, for example clustering by participant, GEE, mixed effects, or within-person specifications.",
        "missing_data_strategy": "Review missingness before analysis; high-missingness variables may require sensitivity checks or exclusion.",
        "recommended_estimator_family": [
            "mixed effects / multilevel modeling",
            "generalized estimating equations",
            "regression adjustment",
            "fixed effects / within-person model",
        ],
        "estimator_rationale": "The dataset appears longitudinal/repeated-measures with participant IDs and time-indexed observations. This is guidance only.",
        "data_requirements": [
            "confirmed exposure/outcome timing",
            "valid adjustment set",
            "participant clustering or repeated-measures structure",
            "documented missing-data approach",
        ],
        "sensitivity_checks": [
            "repeat analysis with and without high-missingness adjustment variables",
            "compare population-average and participant-specific modeling choices",
        ],
        "robustness_checks": [
            "check alternative exposure summaries",
            "check calendar/time context specifications",
        ],
        "limitations": [
            "This strategy does not prove causality.",
            "Graph and adjustment assumptions require user confirmation.",
            *[warning["message"] for warning in deterministic_warnings],
        ],
        "assumptions_needed": identification_result.get("assumptions_required", []),
        "what_can_be_claimed": "A planned analysis may estimate associations or causal contrasts only under stated and reviewed assumptions.",
        "what_cannot_be_claimed": "Do not claim proven causal effects, diagnosis, treatment decisions, or validated causal roles.",
        "recommended_next_action": "Review deterministic warnings and confirm strategy assumptions before any estimation.",
        "confidence": "medium" if status != "not_ready_for_analysis" else "low",
    }


def build_strategy_messages(
    *,
    confirmed_question: str,
    schema_summary: dict[str, Any],
    graph: dict[str, Any],
    role_recommendations: list[dict[str, Any]],
    identification_result: dict[str, Any],
    exposure: str | None,
    outcome: str | None,
    adjustment_set: list[str],
    evidence_chunks: list[dict[str, Any]],
    deterministic_warnings: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system_message = """
You are the analysis strategy guidance assistant for Causal Studio.

Causal Studio is a causal-design support tool, not a diagnostic tool or
treatment-decision system. The LLM recommends, explains, and drafts. Deterministic
Python backend validation checks causal roles, timing, graph structure, and
claims. Do not present causal conclusions as proven.

Do not run estimation. Do not calculate treatment effects. Do not output p-values.
Do not output causal conclusions. Do not say any estimator proves causality.
Return an analysis guidance plan only, under stated assumptions.

Return valid JSON only. Do not wrap the JSON in Markdown.
""".strip()

    user_message = {
        "confirmed_question": confirmed_question,
        "dataset_schema_summary": schema_summary,
        "graph": graph,
        "role_recommendations": role_recommendations,
        "identification_result": identification_result,
        "exposure": exposure,
        "outcome": outcome,
        "adjustment_set": adjustment_set,
        "retrieved_evidence_chunks": evidence_chunks,
        "deterministic_warnings": deterministic_warnings,
        "required_output": {
            "strategy_status": "ready_for_review | requires_design_revision | not_ready_for_analysis | ready_only_under_additional_assumptions",
            "target_estimand": "guidance-level estimand description",
            "exposure_definition": "exposure definition",
            "comparator_definition": "contrast/comparator definition",
            "outcome_definition": "outcome definition",
            "time_window": "timing window",
            "unit_of_analysis": "participant-window, participant-day, etc.",
            "adjustment_set": ["variables"],
            "repeated_measures_handling": "participant clustering / GEE / mixed effects / fixed effects guidance",
            "missing_data_strategy": "missing-data review guidance",
            "recommended_estimator_family": ["broad method families only"],
            "estimator_rationale": "why families may fit structure",
            "data_requirements": ["requirements"],
            "sensitivity_checks": ["checks"],
            "robustness_checks": ["checks"],
            "limitations": ["limitations"],
            "assumptions_needed": ["assumptions"],
            "what_can_be_claimed": "careful claim language",
            "what_cannot_be_claimed": "prohibited overclaims",
            "recommended_next_action": "next review step",
            "confidence": "low | medium | high",
        },
    }

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": json.dumps(user_message)},
    ]


def parse_strategy_json(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise AnalysisStrategyError(
            "LLM response was not valid JSON. Try again or adjust the prompt."
        ) from error

    if not isinstance(parsed, dict) or "strategy_status" not in parsed:
        raise AnalysisStrategyError("LLM response did not include a strategy plan.")
    return parsed


def generate_analysis_strategy(
    *,
    confirmed_question: str,
    dataset_filename: str,
    graph: dict[str, Any],
    role_recommendations: list[dict[str, Any]],
    identification_result: dict[str, Any],
    exposure: str | None = None,
    outcome: str | None = None,
    adjustment_set: list[str] | None = None,
    estimand_type: str = "total_effect",
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise AnalysisStrategyError("confirmed_question cannot be empty.")
    if not graph:
        raise AnalysisStrategyError("graph is required.")
    if not role_recommendations:
        raise AnalysisStrategyError("role_recommendations cannot be empty.")
    if not identification_result:
        raise AnalysisStrategyError("identification_result is required.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise AnalysisStrategyError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise AnalysisStrategyError(str(error)) from error

    resolved_exposure = exposure or identification_result.get("exposure")
    resolved_outcome = outcome or identification_result.get("outcome")
    resolved_adjustment_set = adjustment_set or identification_result.get(
        "proposed_adjustment_set",
        [],
    )
    deterministic = deterministic_strategy_checks(
        identification_result=identification_result,
        exposure=resolved_exposure,
        outcome=resolved_outcome,
        adjustment_set=resolved_adjustment_set,
        schema=schema,
    )
    deterministic_warnings = deterministic["warnings"]
    deterministic_errors = deterministic["errors"]

    if deterministic_errors:
        status = "not_ready_for_analysis"
    elif identification_result.get("identification_status") == "identifiable_only_under_additional_assumptions":
        status = "ready_only_under_additional_assumptions"
    elif deterministic_warnings:
        status = "requires_design_revision"
    else:
        status = "ready_for_review"

    evidence_chunks = []
    try:
        evidence_query = (
            f"{normalized_question} analysis strategy estimator repeated measures "
            f"missing data adjustment {resolved_exposure} {resolved_outcome}"
        )
        evidence_chunks = summarize_evidence(
            search_rag_chunks(
                query=evidence_query,
                top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
            )
        )
    except RagSearchError:
        deterministic_warnings.append(
            make_issue(
                issue_type="rag_evidence_unavailable",
                message="RAG evidence could not be retrieved for strategy guidance.",
                severity="warning",
                suggested_fix="Confirm documents are ingested before relying on evidence-supported guidance.",
            )
        )

    if deterministic_errors:
        strategy_plan = fallback_strategy(
            status=status,
            exposure=resolved_exposure,
            outcome=resolved_outcome,
            adjustment_set=resolved_adjustment_set,
            identification_result=identification_result,
            deterministic_warnings=deterministic_warnings,
        )
    else:
        schema_summary = summarize_schema(schema)
        client = get_openai_client()
        model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
        request_kwargs = {
            "model": model,
            "messages": build_strategy_messages(
                confirmed_question=normalized_question,
                schema_summary=schema_summary,
                graph=graph,
                role_recommendations=role_recommendations,
                identification_result=identification_result,
                exposure=resolved_exposure,
                outcome=resolved_outcome,
                adjustment_set=resolved_adjustment_set,
                evidence_chunks=evidence_chunks,
                deterministic_warnings=deterministic_warnings,
            ),
            "response_format": {"type": "json_object"},
        }
        if not model.startswith("gpt-5"):
            request_kwargs["temperature"] = 0.2
        try:
            response = client.chat.completions.create(**request_kwargs)
            strategy_plan = parse_strategy_json(response.choices[0].message.content or "{}")
        except OpenAIError as error:
            deterministic_warnings.append(
                make_issue(
                    issue_type="llm_strategy_generation_unavailable",
                    message=(
                        "LLM strategy drafting was unavailable, so the backend "
                        "returned deterministic fallback guidance."
                    ),
                    severity="warning",
                    suggested_fix=(
                        "Check OPENAI_API_KEY, OPENAI_MODEL, and account model "
                        f"access. Original error: {error}"
                    ),
                )
            )
            strategy_plan = fallback_strategy(
                status=status,
                exposure=resolved_exposure,
                outcome=resolved_outcome,
                adjustment_set=resolved_adjustment_set,
                identification_result=identification_result,
                deterministic_warnings=deterministic_warnings,
            )

    strategy_plan["strategy_status"] = status

    return {
        "status": "completed",
        "confirmed_question": normalized_question,
        "dataset_filename": dataset_filename,
        "estimand_type": estimand_type,
        "exposure": resolved_exposure,
        "outcome": resolved_outcome,
        "adjustment_set": resolved_adjustment_set,
        "strategy_plan": strategy_plan,
        "deterministic_warnings": deterministic_warnings,
        "deterministic_errors": deterministic_errors,
        "evidence_chunks_used": len(evidence_chunks),
        "schema_summary": summarize_schema(schema),
    }
