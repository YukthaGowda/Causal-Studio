from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAIError

from app.core.langsmith_tracing import record_trace_event, summarize_sources
from app.rag.search import RagSearchError, search_rag_chunks
from app.services.analysis_strategy import make_issue
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


ASSUMPTION_CATEGORIES = [
    "temporal_ordering",
    "exchangeability_no_unmeasured_confounding",
    "positivity_overlap",
    "consistency",
    "sutva_interference",
    "measurement_validity",
    "missingness_assumptions",
    "no_inappropriate_collider_adjustment",
    "no_inappropriate_post_treatment_adjustment",
    "correct_exposure_window",
    "correct_outcome_window",
    "sufficient_repeated_measurement_structure",
    "selection_bias_risk",
    "proxy_variable_validity",
]

ID_FIELD_NAMES = {"pid", "id", "participant_id", "subject_id", "user_id"}
TIME_CONTEXT_MARKERS = ("time", "day", "week", "date", "timestamp")
PROXY_MARKERS = ("acc_", "latitude", "longitude", "gps", "screen", "sensing")


class AssumptionReviewError(RuntimeError):
    pass


def is_high_missing_value(value: Any) -> bool:
    return isinstance(value, (int, float)) and value >= 30


def has_pid(schema: dict[str, Any]) -> bool:
    columns = {column.lower() for column in schema.get("column_names", [])}
    return bool(columns.intersection(ID_FIELD_NAMES))


def variable_looks_like_proxy(variable_name: str) -> bool:
    lowered_name = variable_name.lower()
    return any(marker in lowered_name for marker in PROXY_MARKERS)


def variable_looks_temporal(variable_name: str) -> bool:
    lowered_name = variable_name.lower()
    return any(marker in lowered_name for marker in TIME_CONTEXT_MARKERS)


def deterministic_assumption_checks(
    *,
    identification_result: dict[str, Any],
    analysis_strategy: dict[str, Any],
    exposure: str | None,
    outcome: str | None,
    adjustment_set: list[str],
    schema: dict[str, Any],
    graph: dict[str, Any],
    role_recommendations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    missingness = schema.get("missing_value_percentage_per_column", {})

    if not exposure:
        warnings.append(
            make_issue(
                issue_type="missing_exposure",
                message="Exposure is missing, so assumptions cannot be reviewed as ready.",
                severity="blocking",
                suggested_fix="Confirm an exposure before reviewing assumptions.",
            )
        )

    if not outcome:
        warnings.append(
            make_issue(
                issue_type="missing_outcome",
                message="Outcome is missing, so assumptions cannot be reviewed as ready.",
                severity="blocking",
                suggested_fix="Confirm an outcome before reviewing assumptions.",
            )
        )

    if identification_result.get("identification_status") == "not_identifiable_with_current_design":
        warnings.append(
            make_issue(
                issue_type="not_identifiable",
                message="Identification result says the current design is not identifiable.",
                severity="blocking",
                suggested_fix="Revise graph, roles, variables, or adjustment set before assumptions review.",
            )
        )

    strategy_status = analysis_strategy.get("strategy_status") or analysis_strategy.get(
        "strategy_plan",
        {},
    ).get("strategy_status")
    if strategy_status in {"not_ready_for_analysis", "requires_design_revision"}:
        warnings.append(
            make_issue(
                issue_type="analysis_strategy_not_ready",
                message=f"Analysis strategy status is {strategy_status}.",
                severity="blocking" if strategy_status == "not_ready_for_analysis" else "high",
                suggested_fix="Resolve analysis strategy issues before report-ready assumption review.",
            )
        )

    for variable, missing_value in missingness.items():
        if is_high_missing_value(missing_value) and (
            variable in adjustment_set or variable in {exposure, outcome}
        ):
            warnings.append(
                make_issue(
                    issue_type="high_missingness_variable",
                    variable_name=variable,
                    message=f"{variable} has {missing_value:.2f}% missingness.",
                    severity="high" if missing_value >= 50 else "warning",
                    suggested_fix="Add a missing-data sensitivity plan and avoid unsupported complete-case claims.",
                )
            )

    if has_pid(schema):
        warnings.append(
            make_issue(
                issue_type="repeated_participant_observations",
                variable_name="pid",
                message="pid exists, so repeated participant observations must be handled.",
                severity="warning",
                suggested_fix="Use participant clustering, mixed effects, GEE, or a reviewed within-person design.",
            )
        )

    for variable in adjustment_set:
        if variable_looks_temporal(variable):
            warnings.append(
                make_issue(
                    issue_type="temporal_context_adjustment",
                    variable_name=variable,
                    message=f"{variable} is a timestamp/context variable used for adjustment.",
                    severity="warning",
                    suggested_fix="Justify its temporal role and confirm it is not post-treatment or collider adjustment.",
                )
            )

    proxy_variables = sorted(
        {
            variable
            for variable in [exposure, outcome, *adjustment_set]
            if variable and variable_looks_like_proxy(variable)
        }
    )
    for variable in proxy_variables:
        warnings.append(
            make_issue(
                issue_type="proxy_measurement_validity",
                variable_name=variable,
                message=f"{variable} appears to be a proxy or passive-sensing variable.",
                severity="warning",
                suggested_fix="Document what construct it represents and test alternative definitions if possible.",
            )
        )

    graph_text = json.dumps(graph).lower()
    roles_text = json.dumps(role_recommendations).lower()
    strategy_text = json.dumps(analysis_strategy).lower()
    if "unknown" in graph_text or "unknown" in roles_text or "unknown" in strategy_text:
        warnings.append(
            make_issue(
                issue_type="unknown_timing",
                message="Unknown timing appears in graph, roles, or strategy inputs.",
                severity="high",
                suggested_fix="Confirm exposure, adjustment, and outcome windows before analysis.",
            )
        )

    return warnings


def determine_review_status(
    *,
    identification_result: dict[str, Any],
    analysis_strategy: dict[str, Any],
    deterministic_warnings: list[dict[str, Any]],
) -> str:
    if any(warning["severity"] == "blocking" for warning in deterministic_warnings):
        return "not_ready"

    strategy_status = analysis_strategy.get("strategy_status") or analysis_strategy.get(
        "strategy_plan",
        {},
    ).get("strategy_status")
    if strategy_status in {"not_ready_for_analysis", "requires_design_revision"}:
        return "requires_design_revision"

    if identification_result.get("identification_status") == "not_identifiable_with_current_design":
        return "not_ready"

    if identification_result.get("identification_status") == "identifiable_only_under_additional_assumptions":
        return "needs_additional_user_review"

    if deterministic_warnings:
        return "needs_additional_user_review"

    return "ready_for_report_review"


def make_assumption(
    *,
    name: str,
    status: str,
    rationale: str,
    evidence_summary: str,
    dataset_support: str,
    risk_if_violated: str,
    recommended_check: str,
    recommended_revision_if_needed: str,
    severity: str,
) -> dict[str, str]:
    return {
        "assumption_name": name,
        "status": status,
        "rationale": rationale,
        "evidence_summary": evidence_summary,
        "dataset_support": dataset_support,
        "risk_if_violated": risk_if_violated,
        "recommended_check": recommended_check,
        "recommended_revision_if_needed": recommended_revision_if_needed,
        "severity": severity,
    }


def fallback_assumption_review(
    *,
    review_status: str,
    exposure: str | None,
    outcome: str | None,
    adjustment_set: list[str],
    deterministic_warnings: list[dict[str, Any]],
    schema_summary: dict[str, Any],
) -> dict[str, Any]:
    missing_warning_text = "; ".join(
        warning["message"]
        for warning in deterministic_warnings
        if "missing" in warning["issue_type"]
    )
    proxy_text = ", ".join(
        warning["variable_name"]
        for warning in deterministic_warnings
        if warning["issue_type"] == "proxy_measurement_validity" and warning.get("variable_name")
    )

    assumptions = [
        make_assumption(
            name="temporal_ordering",
            status="uncertain",
            rationale="The design references window t and next-window outcome, but timing still needs user confirmation.",
            evidence_summary="Temporal order is a design requirement, not something proven by the backend.",
            dataset_support="Timestamp/context columns are available but require reviewed lag definitions.",
            risk_if_violated="Reverse timing could make the proposed exposure-outcome contrast invalid.",
            recommended_check="Verify exposure, adjustment, and outcome windows for every row.",
            recommended_revision_if_needed="Revise lag/window definitions before analysis.",
            severity="high",
        ),
        make_assumption(
            name="exchangeability_no_unmeasured_confounding",
            status="uncertain",
            rationale="The graph and adjustment set cannot rule out unmeasured confounding.",
            evidence_summary="Causal identification remains assumption-dependent.",
            dataset_support=f"Current adjustment set: {', '.join(adjustment_set) or 'none'}.",
            risk_if_violated="Estimated contrasts could mix exposure effects with confounding.",
            recommended_check="Review omitted causes of both exposure and outcome.",
            recommended_revision_if_needed="Add measured confounders or revise the claim to association/design exploration.",
            severity="high",
        ),
        make_assumption(
            name="positivity_overlap",
            status="uncertain",
            rationale="Overlap has not been checked because no estimation or distributional diagnostics were run.",
            evidence_summary="This step only plans checks.",
            dataset_support="Requires exposure distribution review across adjustment strata.",
            risk_if_violated="Effects may rely on extrapolation outside observed data support.",
            recommended_check="Inspect exposure support by time context and participant coverage.",
            recommended_revision_if_needed="Coarsen exposure or restrict to supported strata.",
            severity="warning",
        ),
        make_assumption(
            name="consistency",
            status="uncertain",
            rationale="The exposure must have a clear intervention-like interpretation.",
            evidence_summary="Passive-sensing summaries may not map cleanly to a single intervention.",
            dataset_support=exposure or "Exposure not confirmed.",
            risk_if_violated="The estimand may be ambiguous.",
            recommended_check="Define the exposure contrast and its practical meaning.",
            recommended_revision_if_needed="Use descriptive language or refine exposure definition.",
            severity="warning",
        ),
        make_assumption(
            name="sutva_interference",
            status="uncertain",
            rationale="Participant interference was not evaluated.",
            evidence_summary="Usually plausible for individual EMA/passive sensing, but not proven.",
            dataset_support="Participant IDs support individual grouping.",
            risk_if_violated="One participant's exposure process could affect another's outcome.",
            recommended_check="Confirm study setting has no meaningful spillover paths.",
            recommended_revision_if_needed="Add interference limitations or revise unit definition.",
            severity="info",
        ),
        make_assumption(
            name="measurement_validity",
            status="uncertain",
            rationale="Passive-sensing variables may be proxies rather than direct clinical constructs.",
            evidence_summary=proxy_text or "Proxy-variable validity requires user review.",
            dataset_support="Available columns include sensing/context variables.",
            risk_if_violated="The analysis may target a proxy rather than the intended construct.",
            recommended_check="Compare proxy definitions and document construct mapping.",
            recommended_revision_if_needed="Rename claims around the measured proxy.",
            severity="warning",
        ),
        make_assumption(
            name="missingness_assumptions",
            status="uncertain",
            rationale=missing_warning_text or "Missingness must be evaluated before analysis.",
            evidence_summary="High missingness can bias complete-case or adjustment analyses.",
            dataset_support=str(schema_summary.get("high_missingness_columns", [])),
            risk_if_violated="Selection or missing-data bias may distort results.",
            recommended_check="Assess missingness by participant, time, exposure, and outcome history.",
            recommended_revision_if_needed="Use missing-data sensitivity analysis or remove fragile adjustment variables.",
            severity="high" if missing_warning_text else "warning",
        ),
        make_assumption(
            name="no_inappropriate_collider_adjustment",
            status="uncertain",
            rationale="The adjustment set needs graph review for collider paths.",
            evidence_summary="Backend does not certify collider-free adjustment.",
            dataset_support=f"Adjustment set: {', '.join(adjustment_set) or 'none'}.",
            risk_if_violated="Collider adjustment can introduce bias.",
            recommended_check="Review every adjustment node's causal role.",
            recommended_revision_if_needed="Remove colliders or descendants of colliders.",
            severity="high",
        ),
        make_assumption(
            name="no_inappropriate_post_treatment_adjustment",
            status="uncertain",
            rationale="Timing of adjustment variables must precede exposure or be valid baseline/context.",
            evidence_summary="Temporal context variables need justification.",
            dataset_support=f"Adjustment set: {', '.join(adjustment_set) or 'none'}.",
            risk_if_violated="Post-treatment adjustment can block mediated paths or induce bias.",
            recommended_check="Confirm each adjustment variable is not affected by the exposure.",
            recommended_revision_if_needed="Remove post-treatment variables from the adjustment set.",
            severity="high",
        ),
        make_assumption(
            name="correct_exposure_window",
            status="uncertain",
            rationale="Exposure window needs explicit lag/window confirmation.",
            evidence_summary="Question says window t, but exact operationalization needs review.",
            dataset_support=exposure or "Exposure not confirmed.",
            risk_if_violated="Exposure may be misaligned with outcome timing.",
            recommended_check="Compare alternative lag and window definitions.",
            recommended_revision_if_needed="Revise exposure feature construction.",
            severity="warning",
        ),
        make_assumption(
            name="correct_outcome_window",
            status="uncertain",
            rationale="Outcome must occur after exposure and adjustment timing.",
            evidence_summary="Question says next observation window.",
            dataset_support=outcome or "Outcome not confirmed.",
            risk_if_violated="Outcome timing ambiguity can invalidate causal ordering.",
            recommended_check="Verify outcome labels are next-window labels for each row.",
            recommended_revision_if_needed="Rebuild labels using reviewed lag definitions.",
            severity="warning",
        ),
        make_assumption(
            name="sufficient_repeated_measurement_structure",
            status="supported" if "pid" in str(schema_summary).lower() else "uncertain",
            rationale="pid indicates repeated participant observations, but coverage still needs checking.",
            evidence_summary="Repeated-measures handling is required.",
            dataset_support="Participant ID column appears available.",
            risk_if_violated="Unmodeled dependence can understate uncertainty or distort estimates.",
            recommended_check="Check observations per participant and within-person variation.",
            recommended_revision_if_needed="Restrict to participants with adequate data or use simpler descriptive framing.",
            severity="warning",
        ),
        make_assumption(
            name="selection_bias_risk",
            status="uncertain",
            rationale="Selection and observation processes were not evaluated.",
            evidence_summary="EMA/passive sensing can have coverage and response biases.",
            dataset_support="Requires data coverage diagnostics.",
            risk_if_violated="Observed windows may not represent target windows or participants.",
            recommended_check="Evaluate missing windows and participant coverage.",
            recommended_revision_if_needed="Add selection sensitivity checks or narrow population claims.",
            severity="warning",
        ),
        make_assumption(
            name="proxy_variable_validity",
            status="uncertain",
            rationale="Sensing variables should be treated as proxies unless validated against target constructs.",
            evidence_summary=proxy_text or "No proxy variable certainty claimed.",
            dataset_support=proxy_text or "Review selected variables.",
            risk_if_violated="Claims may overstate what the measured variables represent.",
            recommended_check="Document proxy-to-construct rationale and test alternative proxy definitions.",
            recommended_revision_if_needed="Use proxy-specific language in the report.",
            severity="warning",
        ),
    ]

    return {
        "review_status": review_status,
        "assumptions": assumptions,
        "sensitivity_checks": [
            "repeat the plan excluding high-missingness variables such as avg_latitude",
            "compare alternative lag windows and exposure summaries",
            "compare adjustment sets with and without temporal context variables",
            "run missing-data sensitivity analysis before interpreting estimates",
            "compare within-person and between-person specifications",
            "review alternative graph specifications before estimation",
        ],
        "robustness_checks": [
            "compare GEE, mixed-effects, and regression-standardization families",
            "use participant-level clustering or repeated-measures handling",
            "compare complete-case and imputed analysis plans",
            "exclude participants with low data coverage in a sensitivity check",
            "compare weekday/weekend or time-of-day specifications",
        ],
        "data_quality_concerns": [
            warning["message"]
            for warning in deterministic_warnings
            if "missing" in warning["issue_type"] or "participant" in warning["issue_type"]
        ],
        "measurement_concerns": [
            warning["message"]
            for warning in deterministic_warnings
            if "proxy" in warning["issue_type"]
        ],
        "causal_interpretation_limits": [
            "Assumptions are design requirements and are not proven by this checklist.",
            "No causal effect has been estimated.",
            "No p-values, treatment recommendations, or diagnostic conclusions are produced.",
        ],
        "recommended_next_action": "Review high-severity assumptions and sensitivity checks before report drafting.",
        "plain_language_summary": "The design can move forward only as assumption-dependent planning; key timing, missingness, repeated-measures, and proxy-measurement assumptions still need review.",
        "confidence": "medium" if review_status != "not_ready" else "low",
    }


def build_assumption_messages(
    *,
    confirmed_question: str,
    schema_summary: dict[str, Any],
    graph: dict[str, Any],
    role_recommendations: list[dict[str, Any]],
    identification_result: dict[str, Any],
    analysis_strategy: dict[str, Any],
    exposure: str | None,
    outcome: str | None,
    adjustment_set: list[str],
    evidence_chunks: list[dict[str, Any]],
    deterministic_warnings: list[dict[str, Any]],
) -> list[dict[str, str]]:
    system_message = """
You are the assumptions and sensitivity planning assistant for Causal Design Agent.

Causal Design Agent is a causal-design support tool, not a diagnostic tool or
treatment-decision system. The LLM recommends, explains, and drafts.
Deterministic Python backend validation checks causal roles, timing, graph
structure, assumptions, and claims. Use the pattern: LLM recommendation -> user
review -> backend validation.

Do not run causal estimation. Do not calculate effects. Do not output p-values.
Do not claim assumptions are proven. Do not say causal validity is guaranteed.
Do not generate diagnostic or treatment recommendations.

Return valid JSON only. Do not wrap the JSON in Markdown.
""".strip()

    user_message = {
        "confirmed_question": confirmed_question,
        "dataset_schema_summary": schema_summary,
        "graph": graph,
        "role_recommendations": role_recommendations,
        "identification_result": identification_result,
        "analysis_strategy": analysis_strategy,
        "exposure": exposure,
        "outcome": outcome,
        "adjustment_set": adjustment_set,
        "retrieved_evidence_chunks": evidence_chunks,
        "deterministic_warnings": deterministic_warnings,
        "required_assumption_categories": ASSUMPTION_CATEGORIES,
        "required_output": {
            "review_status": "ready_for_report_review | requires_design_revision | needs_additional_user_review | not_ready",
            "assumptions": [
                {
                    "assumption_name": "one required category",
                    "status": "supported | uncertain | not_supported | not_applicable",
                    "rationale": "why this status is assigned",
                    "evidence_summary": "evidence summary without overclaiming",
                    "dataset_support": "what the dataset supports or does not support",
                    "risk_if_violated": "risk",
                    "recommended_check": "check",
                    "recommended_revision_if_needed": "revision",
                    "severity": "info | warning | high | blocking",
                }
            ],
            "sensitivity_checks": ["checks"],
            "robustness_checks": ["checks"],
            "data_quality_concerns": ["concerns"],
            "measurement_concerns": ["concerns"],
            "causal_interpretation_limits": ["limits"],
            "recommended_next_action": "next action",
            "plain_language_summary": "summary",
            "confidence": "low | medium | high",
        },
    }

    return [
        {"role": "system", "content": system_message},
        {"role": "user", "content": json.dumps(user_message)},
    ]


def parse_review_json(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise AssumptionReviewError(
            "LLM response was not valid JSON. Try again or use deterministic fallback."
        ) from error

    if not isinstance(parsed, dict) or "assumptions" not in parsed:
        raise AssumptionReviewError("LLM response did not include assumptions.")
    return parsed


def ensure_required_assumptions(review: dict[str, Any]) -> dict[str, Any]:
    existing = {
        assumption.get("assumption_name")
        for assumption in review.get("assumptions", [])
        if isinstance(assumption, dict)
    }
    for category in ASSUMPTION_CATEGORIES:
        if category not in existing:
            review.setdefault("assumptions", []).append(
                make_assumption(
                    name=category,
                    status="uncertain",
                    rationale="This assumption requires user review.",
                    evidence_summary="No specific LLM item was returned for this category.",
                    dataset_support="Not confirmed.",
                    risk_if_violated="The causal interpretation may be invalid.",
                    recommended_check="Review this assumption before analysis or report drafting.",
                    recommended_revision_if_needed="Revise design inputs if the assumption is not defensible.",
                    severity="warning",
                )
            )
    return review


def review_assumptions(
    *,
    confirmed_question: str,
    dataset_filename: str,
    graph: dict[str, Any],
    role_recommendations: list[dict[str, Any]],
    identification_result: dict[str, Any],
    analysis_strategy: dict[str, Any],
    exposure: str | None = None,
    outcome: str | None = None,
    adjustment_set: list[str] | None = None,
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise AssumptionReviewError("confirmed_question cannot be empty.")
    if not graph:
        raise AssumptionReviewError("graph is required.")
    if not role_recommendations:
        raise AssumptionReviewError("role_recommendations cannot be empty.")
    if not identification_result:
        raise AssumptionReviewError("identification_result is required.")
    if not analysis_strategy:
        raise AssumptionReviewError("analysis_strategy is required.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise AssumptionReviewError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise AssumptionReviewError(str(error)) from error

    resolved_exposure = exposure or identification_result.get("exposure")
    resolved_outcome = outcome or identification_result.get("outcome")
    resolved_adjustment_set = adjustment_set or identification_result.get(
        "proposed_adjustment_set",
        [],
    )

    deterministic_warnings = deterministic_assumption_checks(
        identification_result=identification_result,
        analysis_strategy=analysis_strategy,
        exposure=resolved_exposure,
        outcome=resolved_outcome,
        adjustment_set=resolved_adjustment_set,
        schema=schema,
        graph=graph,
        role_recommendations=role_recommendations,
    )
    review_status = determine_review_status(
        identification_result=identification_result,
        analysis_strategy=analysis_strategy,
        deterministic_warnings=deterministic_warnings,
    )

    evidence_chunks = []
    evidence_search: dict[str, Any] = {"results": []}
    try:
        evidence_query = (
            f"{normalized_question} assumptions sensitivity robustness missingness "
            f"measurement validity repeated measures wearable passive sensing EMA "
            f"causal inference {resolved_exposure} {resolved_outcome}"
        )
        evidence_search = search_rag_chunks(
            query=evidence_query,
            top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
        )
        evidence_chunks = summarize_evidence(evidence_search)
    except RagSearchError:
        deterministic_warnings.append(
            make_issue(
                issue_type="rag_evidence_unavailable",
                message="RAG evidence could not be retrieved for assumptions review.",
                severity="warning",
                suggested_fix="Confirm documents are ingested before relying on evidence-supported guidance.",
            )
        )

    schema_summary = summarize_schema(schema)
    try:
        client = get_openai_client()
        model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
        request_kwargs = {
            "model": model,
            "messages": build_assumption_messages(
                confirmed_question=normalized_question,
                schema_summary=schema_summary,
                graph=graph,
                role_recommendations=role_recommendations,
                identification_result=identification_result,
                analysis_strategy=analysis_strategy,
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
        response = client.chat.completions.create(**request_kwargs)
        review = parse_review_json(response.choices[0].message.content or "{}")
    except (OpenAIError, AssumptionReviewError) as error:
        deterministic_warnings.append(
            make_issue(
                issue_type="llm_assumption_review_unavailable",
                message=(
                    "LLM assumption drafting was unavailable, so the backend "
                    "returned deterministic fallback guidance."
                ),
                severity="warning",
                suggested_fix=(
                    "Check OPENAI_API_KEY, OPENAI_MODEL, and account model "
                    f"access. Original error: {error}"
                ),
            )
        )
        review = fallback_assumption_review(
            review_status=review_status,
            exposure=resolved_exposure,
            outcome=resolved_outcome,
            adjustment_set=resolved_adjustment_set,
            deterministic_warnings=deterministic_warnings,
            schema_summary=schema_summary,
        )

    review = ensure_required_assumptions(review)
    review["review_status"] = review_status

    record_trace_event(
        "assumptions_and_sensitivity_review",
        {
            "workflow_step": 7,
            "dataset_filename": dataset_filename,
            "confirmed_question_length": len(normalized_question),
            "exposure": resolved_exposure,
            "outcome": resolved_outcome,
            "adjustment_set_count": len(resolved_adjustment_set),
            "number_of_retrieved_evidence_chunks": len(evidence_chunks),
            "source_filenames_used": summarize_sources(evidence_search.get("results", [])),
            "review_status": review_status,
            "warning_count": len(deterministic_warnings),
            "error_count": 0,
        },
    )

    return {
        "status": "completed",
        "confirmed_question": normalized_question,
        "dataset_filename": dataset_filename,
        "exposure": resolved_exposure,
        "outcome": resolved_outcome,
        "adjustment_set": resolved_adjustment_set,
        "review": review,
        "deterministic_warnings": deterministic_warnings,
        "evidence_chunks_used": len(evidence_chunks),
        "schema_summary": schema_summary,
    }
