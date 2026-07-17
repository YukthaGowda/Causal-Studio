from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.langsmith_tracing import record_trace_event
from app.services.causal_questions import CausalQuestionGenerationError, resolve_dataset_path
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


REPORT_TYPE = "Causal Design and Analysis Guidance Report"

UNSAFE_LANGUAGE_PATTERNS = [
    ("causes", "Use 'is evaluated for association with' or 'is hypothesized to affect under assumptions'."),
    ("cause ", "Use cautious design language instead of direct causal-result language."),
    ("proves", "Use 'does not prove' or 'may support interpretation only under assumptions'."),
    ("proven", "Use 'not proven' or 'requires assumption review'."),
    ("leads to", "Use 'is temporally related to' or 'is evaluated as a possible antecedent of'."),
    ("prevents relapse", "Do not make relapse-prevention claims."),
    ("reduces alcohol use", "Do not claim reduction without an estimated and reviewed effect."),
    ("treatment recommendation", "State that this is not a treatment recommendation."),
    ("diagnosis", "State that this is not diagnostic guidance."),
    ("clinical decision", "State that this is not for clinical decision-making."),
    ("causal effect is established", "State that the current design does not establish a causal effect."),
    ("assumptions are proven", "State that assumptions require review and are not proven."),
]


class ReportGenerationError(RuntimeError):
    pass


def ensure_non_empty(value: Any, field_name: str) -> None:
    if value is None:
        raise ReportGenerationError(f"{field_name} is required.")
    if isinstance(value, str) and not value.strip():
        raise ReportGenerationError(f"{field_name} cannot be empty.")
    if isinstance(value, (list, dict)) and not value:
        raise ReportGenerationError(f"{field_name} cannot be empty.")


def summarize_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "filename": schema.get("filename"),
        "number_of_rows": schema.get("number_of_rows"),
        "number_of_columns": schema.get("number_of_columns"),
        "possible_id_columns": schema.get("possible_id_columns", []),
        "possible_timestamp_date_columns": schema.get("possible_timestamp_date_columns", []),
        "warnings": schema.get("warnings", []),
    }


def selected_variable_names(selected_variables: list[Any]) -> list[str]:
    names = []
    for item in selected_variables:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict):
            value = item.get("variable_name") or item.get("source_field") or item.get("name")
            if value:
                names.append(str(value))
    return [name for name in names if name]


def build_role_table(role_recommendations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for role in role_recommendations:
        table.append(
            {
                "variable_name": role.get("variable_name") or role.get("source_field"),
                "primary_role": role.get("primary_role"),
                "recommended_roles": role.get("recommended_roles", []),
                "temporal_role": role.get("temporal_role"),
                "adjustment_recommendation": role.get("adjustment_recommendation"),
                "confidence": role.get("confidence"),
                "rationale": role.get("rationale"),
            }
        )
    return table


def graph_edges(graph: dict[str, Any]) -> list[dict[str, Any]]:
    return graph.get("edges", []) if isinstance(graph.get("edges", []), list) else []


def graph_summary(graph: dict[str, Any], graph_validation_result: dict[str, Any] | None) -> dict[str, Any]:
    nodes = graph.get("nodes", [])
    edges = graph_edges(graph)
    return {
        "graph_type": graph.get("graph_type", "draft causal graph"),
        "number_of_nodes": len(nodes) if isinstance(nodes, list) else None,
        "number_of_edges": len(edges),
        "graph_rationale": graph.get("graph_rationale") or graph.get("evidence_summary"),
        "validation_status": (graph_validation_result or {}).get("graph_validation_status"),
        "safe_to_continue_to_identification": (graph_validation_result or {}).get(
            "safe_to_continue_to_identification"
        ),
        "note": "Graph is a reviewed design artifact, not proof of causal structure.",
    }


def audit_claims(report: dict[str, Any]) -> dict[str, Any]:
    text = str(report).lower()
    findings = []
    for pattern, safer_language in UNSAFE_LANGUAGE_PATTERNS:
        if pattern in text:
            findings.append(
                {
                    "unsafe_language": pattern,
                    "severity": "warning",
                    "suggested_safe_alternative": safer_language,
                }
            )

    required_safe_statements = [
        "The current design does not prove a causal effect.",
        "This is not a treatment recommendation.",
        "This report is not diagnostic guidance and is not for clinical decision-making.",
        "Causal interpretation is possible only under documented, reviewed assumptions.",
    ]

    return {
        "status": "passed_with_warnings" if findings else "passed",
        "unsafe_claims_found": findings,
        "required_safe_statements": required_safe_statements,
    }


def list_assumptions_by_status(assumptions_review: dict[str, Any], statuses: set[str]) -> list[dict[str, Any]]:
    assumptions = assumptions_review.get("assumptions") or assumptions_review.get("review", {}).get("assumptions", [])
    return [
        assumption
        for assumption in assumptions
        if assumption.get("status") in statuses or assumption.get("severity") in {"high", "blocking"}
    ]


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", []):
            return value
    return None


def generate_report(
    *,
    project_title: str | None = None,
    research_objective: str | None,
    confirmed_question: str,
    dataset_filename: str,
    schema_summary: dict[str, Any] | None = None,
    broad_exploration_summary: dict[str, Any] | None = None,
    candidate_questions: list[Any] | None = None,
    selected_candidate_question: Any | None = None,
    candidate_variables: list[Any] | None = None,
    targeted_feasibility_result: dict[str, Any] | None = None,
    selected_variables: list[Any],
    role_recommendations: list[dict[str, Any]],
    role_validation_result: dict[str, Any] | None = None,
    graph: dict[str, Any],
    graph_validation_result: dict[str, Any] | None = None,
    identification_result: dict[str, Any],
    analysis_strategy: dict[str, Any],
    assumptions_review: dict[str, Any],
    evidence_summary: list[Any] | None = None,
    user_notes: str | None = None,
) -> dict[str, Any]:
    ensure_non_empty(confirmed_question, "confirmed_question")
    ensure_non_empty(dataset_filename, "dataset_filename")
    ensure_non_empty(selected_variables, "selected_variables")
    ensure_non_empty(role_recommendations, "role_recommendations")
    ensure_non_empty(graph, "graph")
    ensure_non_empty(identification_result, "identification_result")
    ensure_non_empty(analysis_strategy, "analysis_strategy")
    ensure_non_empty(assumptions_review, "assumptions_review")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise ReportGenerationError(str(error)) from error

    if schema_summary is None:
        try:
            schema_summary = summarize_schema(parse_dataset_schema(dataset_path))
        except DatasetSchemaError as error:
            raise ReportGenerationError(str(error)) from error

    strategy_plan = analysis_strategy.get("strategy_plan", analysis_strategy)
    assumptions = assumptions_review.get("review", assumptions_review)
    exposure = first_present(
        identification_result.get("exposure"),
        (targeted_feasibility_result or {}).get("exposure"),
        strategy_plan.get("exposure_definition"),
    )
    outcome = first_present(
        identification_result.get("outcome"),
        (targeted_feasibility_result or {}).get("outcome"),
        strategy_plan.get("outcome_definition"),
    )
    adjustment_set = (
        strategy_plan.get("adjustment_set")
        or identification_result.get("proposed_adjustment_set")
        or []
    )

    report = {
        "report_title": project_title or "Causal Design Agent Analysis Guidance Report",
        "report_type": REPORT_TYPE,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_summary": {
            "project_title": project_title,
            "user_notes": user_notes,
            "safety_note": "This is a design and guidance report, not a causal-results report.",
        },
        "research_objective": research_objective,
        "final_research_question": confirmed_question.strip(),
        "population": "User-defined study population; confirm in project documentation.",
        "data_sources": {
            "dataset_filename": dataset_path.name,
            "documents": "Uploaded RAG documents may support design rationale when cited by the user.",
        },
        "dataset_summary": schema_summary,
        "broad_data_exploration_summary": broad_exploration_summary,
        "data_feasibility_summary": targeted_feasibility_result,
        "unit_of_analysis": strategy_plan.get("unit_of_analysis", "Requires user confirmation."),
        "exposure": exposure,
        "comparator": strategy_plan.get("comparator_definition", "Comparator requires user confirmation."),
        "outcome": outcome,
        "time_window": strategy_plan.get("time_window", "Time window requires user confirmation."),
        "selected_variables": selected_variable_names(selected_variables),
        "candidate_questions": candidate_questions or [],
        "selected_candidate_question": selected_candidate_question,
        "candidate_variables": candidate_variables or [],
        "causal_role_table": build_role_table(role_recommendations),
        "role_validation_result": role_validation_result,
        "final_causal_graph_summary": graph_summary(graph, graph_validation_result),
        "graph_edges": graph_edges(graph),
        "identification_assessment": identification_result,
        "adjustment_set": adjustment_set,
        "analysis_strategy": strategy_plan,
        "assumption_checklist": assumptions.get("assumptions", []),
        "sensitivity_plan": assumptions.get("sensitivity_checks", strategy_plan.get("sensitivity_checks", [])),
        "robustness_plan": assumptions.get("robustness_checks", strategy_plan.get("robustness_checks", [])),
        "supporting_evidence": evidence_summary or [],
        "limitations": [
            "This report does not estimate a causal effect.",
            "This report does not calculate p-values or treatment effects.",
            "Exploratory patterns do not establish causality.",
            "Causal interpretation requires reviewed and justified assumptions.",
            *strategy_plan.get("limitations", []),
            *assumptions.get("causal_interpretation_limits", []),
        ],
        "unsupported_or_uncertain_assumptions": list_assumptions_by_status(
            assumptions,
            {"uncertain", "not_supported"},
        ),
        "what_can_be_claimed": (
            strategy_plan.get("what_can_be_claimed")
            or "The design may support planning a causal analysis under documented assumptions."
        ),
        "what_cannot_be_claimed": (
            strategy_plan.get("what_cannot_be_claimed")
            or "The current design does not prove a causal effect and is not treatment or diagnostic guidance."
        ),
        "recommended_next_steps": [
            "Review all high-severity warnings before analysis.",
            "Confirm exposure, outcome, time window, and adjustment set.",
            "Document assumptions, limitations, and sensitivity checks.",
            "Proceed to estimation only outside this report and only after user review.",
        ],
        "pdf_export_status": "not_implemented",
        "pdf_export_message": "PDF export will be added later. This endpoint returns a structured JSON report.",
    }
    report["claim_audit"] = audit_claims(report)
    record_trace_event(
        "review_export_report_generation",
        {
            "workflow_step": 8,
            "dataset_filename": dataset_path.name,
            "research_objective_present": bool(research_objective),
            "confirmed_question_length": len(confirmed_question),
            "selected_variable_count": len(selected_variables),
            "graph_node_count": len(graph.get("nodes", [])),
            "graph_edge_count": len(graph.get("edges", [])),
            "identification_status": identification_result.get("identification_status"),
            "strategy_status": strategy_plan.get("strategy_status"),
            "assumption_review_status": assumptions.get("review_status"),
            "claim_audit_status": report["claim_audit"].get("status"),
            "unsafe_claim_count": len(report["claim_audit"].get("unsafe_claims_found", [])),
        },
    )
    return report
