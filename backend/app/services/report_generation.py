from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.langsmith_tracing import record_trace_event
from app.services.causal_questions import CausalQuestionGenerationError, resolve_dataset_path
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


REPORT_TYPE = "Causal Design, Estimation, and Evidence Report"

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
    ("confirms the true causal structure", "State that the graph is a design assumption, not the true causal structure."),
    ("will relapse", "Do not make clinical prediction or relapse claims."),
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


def normalize_estimation_run(selected_primary_estimation_run: dict[str, Any] | None) -> dict[str, Any] | None:
    if not selected_primary_estimation_run:
        return None

    raw = selected_primary_estimation_run.get("raw") if isinstance(selected_primary_estimation_run, dict) else None
    source = raw if isinstance(raw, dict) else selected_primary_estimation_run
    estimate = source.get("estimate") or source.get("results") or {}
    diagnostics = source.get("diagnostics") or estimate.get("diagnostics") or {}
    sensitivity = source.get("sensitivity") or estimate.get("sensitivity") or {}
    reproducibility = source.get("reproducibility") or {}
    config = source.get("config") or selected_primary_estimation_run.get("config") or {}

    confidence_interval = estimate.get("confidence_interval")
    if not confidence_interval and {"ciLower", "ciUpper"} <= set(estimate):
        confidence_interval = [estimate.get("ciLower"), estimate.get("ciUpper")]

    return {
        "run_id": source.get("run_id") or source.get("id") or selected_primary_estimation_run.get("id"),
        "status": source.get("status") or selected_primary_estimation_run.get("tag") or "selected_primary",
        "estimate": {
            "estimand": estimate.get("estimand") or estimate.get("estimandLabel") or config.get("estimand"),
            "estimator": estimate.get("estimator") or reproducibility.get("estimator") or config.get("estimator"),
            "exposure": estimate.get("exposure") or config.get("exposure"),
            "outcome": estimate.get("outcome") or config.get("outcome"),
            "point_estimate": first_present(estimate.get("point_estimate"), estimate.get("pointEstimate")),
            "standard_error": first_present(estimate.get("standard_error"), estimate.get("se")),
            "confidence_interval": confidence_interval,
            "p_value": first_present(estimate.get("p_value"), estimate.get("pValue")),
            "sample_size": first_present(estimate.get("sample_size"), estimate.get("n"), config.get("sampleSize")),
            "interpretation_boundary": estimate.get("interpretation_boundary")
            or estimate.get("interpretationBoundary")
            or source.get("safe_interpretation_note"),
        },
        "diagnostics": {
            "rows_before_filtering": diagnostics.get("rows_before_filtering"),
            "rows_after_filtering": diagnostics.get("rows_after_filtering"),
            "excluded_rows": diagnostics.get("excluded_rows"),
            "excluded_percent": diagnostics.get("excluded_percent"),
            "convergence": diagnostics.get("convergence") or estimate.get("convergence"),
            "exposure_variation": diagnostics.get("exposure_variation"),
            "model_warnings": diagnostics.get("model_warnings") or estimate.get("warnings", []),
            "data_warnings": diagnostics.get("data_warnings", []),
        },
        "sensitivity": {
            "checks": sensitivity.get("checks") or [
                item.get("desc") or item.get("label")
                for item in estimate.get("sensitivityResults", [])
                if isinstance(item, dict)
            ],
            "warnings": sensitivity.get("warnings", []),
        },
        "reproducibility": {
            "dataset_filename": reproducibility.get("dataset_filename") or config.get("dataset_filename"),
            "estimator": reproducibility.get("estimator") or config.get("estimator"),
            "random_seed": reproducibility.get("random_seed") or config.get("seed"),
            "variables_used": reproducibility.get("variables_used") or [
                value
                for value in [
                    config.get("exposure"),
                    config.get("outcome"),
                    *(str(config.get("adjustmentSet") or "").split(", ") if config.get("adjustmentSet") else []),
                ]
                if value and value != "(none)"
            ],
            "package_versions": reproducibility.get("package_versions") or config.get("packages", []),
            "timestamp": reproducibility.get("timestamp") or selected_primary_estimation_run.get("timestamp"),
            "complete_case_filtering": config.get("missingDataHandling") or "Complete-case filtering details require review.",
            "warnings": source.get("readiness", {}).get("warnings", []) + diagnostics.get("model_warnings", []) + diagnostics.get("data_warnings", []),
        },
    }


def audit_user_claims(
    *,
    claims: list[Any],
    confirmed_question: str | None = None,
    final_graph: dict[str, Any] | None = None,
    identification_result: dict[str, Any] | None = None,
    analysis_strategy: dict[str, Any] | None = None,
    assumptions_review: dict[str, Any] | None = None,
    selected_primary_estimation_run: dict[str, Any] | None = None,
    rag_evidence: list[Any] | None = None,
) -> dict[str, Any]:
    linked_claims: list[dict[str, Any]] = []
    needs_review_claims: list[dict[str, Any]] = []
    blocked_claims: list[dict[str, Any]] = []
    safe_rewrites: list[dict[str, str]] = []
    warnings: list[str] = []
    estimation_run = normalize_estimation_run(selected_primary_estimation_run)

    if not estimation_run:
        warnings.append("No selected primary estimation run was provided; numerical claims cannot be verified.")
    if not rag_evidence:
        warnings.append("No RAG evidence was linked; evidence limitations should be documented.")
    if not final_graph:
        warnings.append("No final graph was provided; graph-linked causal wording should remain provisional.")

    blocked_terms = {
        "proves": "Graph and estimates do not prove causality.",
        "proven": "Graph and estimates do not prove causality.",
        "will relapse": "Clinical prediction and relapse language are outside project scope.",
        "diagnose": "Diagnostic language is outside project scope.",
        "treatment recommendation": "Treatment recommendation language is outside project scope.",
        "confirms the true causal structure": "The graph is an assumption set, not proof of the true structure.",
    }
    review_terms = {
        "causes": "Direct causal wording needs explicit boundaries tied to graph, identification, assumptions, diagnostics, and estimates.",
        "cause ": "Direct causal wording needs explicit boundaries tied to graph, identification, assumptions, diagnostics, and estimates.",
        "leads to": "Use cautious wording unless the design and estimate are explicitly bounded.",
        "reduces": "Effect direction and magnitude must match the selected backend-computed estimate.",
    }

    for raw_claim in claims or []:
        claim = str(raw_claim).strip()
        if not claim:
            continue
        lowered = claim.lower()
        matched_block = next((reason for term, reason in blocked_terms.items() if term in lowered), None)
        matched_review = next((reason for term, reason in review_terms.items() if term in lowered), None)
        item = {"claim": claim, "confirmed_question": confirmed_question}
        if matched_block:
            blocked_claims.append({**item, "reason": matched_block})
            safe_rewrites.append(
                {
                    "original_claim": claim,
                    "safe_rewrite": "The analysis evaluates the estimated association under the specified causal graph, adjustment set, model, and assumptions.",
                }
            )
        elif matched_review or not estimation_run:
            needs_review_claims.append({**item, "reason": matched_review or "Claim is not linked to a selected primary estimation run."})
        else:
            linked_claims.append({**item, "evidence_link": "Consistent with provided design context and selected estimation run; still requires human review."})

    status_value = "blocked" if blocked_claims else "warnings" if needs_review_claims or warnings else "passed"
    return {
        "status": status_value,
        "linked_claims": linked_claims,
        "needs_review_claims": needs_review_claims,
        "blocked_claims": blocked_claims,
        "safe_rewrites": safe_rewrites,
        "warnings": warnings,
        "safety_note": "LLM wording may be revised, but numerical estimates must come from Phase 8 backend results.",
    }


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
    selected_primary_estimation_run: dict[str, Any] | None = None,
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
    estimation_run = normalize_estimation_run(selected_primary_estimation_run)
    diagnostics = (estimation_run or {}).get("diagnostics", {})
    diagnostic_warnings = [
        *(diagnostics.get("model_warnings") or []),
        *(diagnostics.get("data_warnings") or []),
        *((estimation_run or {}).get("sensitivity", {}).get("warnings") or []),
    ]
    blocked_items = []
    warnings = []
    if not estimation_run:
        warnings.append("Phase 8 estimation has not been completed or selected as primary.")
        blocked_items.append("Select a primary Phase 8 estimation run before final sign-off.")
    if list_assumptions_by_status(assumptions, {"uncertain", "not_supported"}):
        warnings.append("One or more assumptions remain uncertain or unsupported.")
    if diagnostic_warnings:
        warnings.extend(diagnostic_warnings)

    report = {
        "report_id": f"report_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "title": project_title or "Causal Design, Estimation, and Evidence Report",
        "report_title": project_title or "Causal Design, Estimation, and Evidence Report",
        "report_type": REPORT_TYPE,
        "status": "blocked" if blocked_items else "ready_with_warnings" if warnings else "draft",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "warnings": warnings,
        "blocked_items": blocked_items,
        "export_options": {"json": True, "markdown": True, "pdf": False},
        "project_summary": {
            "project_title": project_title,
            "user_notes": user_notes,
            "safety_note": "This is a causal design, estimation, and evidence package, not a causal proof document.",
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
        "selected_primary_estimation_run": estimation_run,
        "estimation_and_calculation": (estimation_run or {}).get("estimate"),
        "diagnostics_and_sensitivity": {
            "diagnostics": diagnostics,
            "sensitivity": (estimation_run or {}).get("sensitivity"),
        },
        "assumption_checklist": assumptions.get("assumptions", []),
        "sensitivity_plan": assumptions.get("sensitivity_checks", strategy_plan.get("sensitivity_checks", [])),
        "robustness_plan": assumptions.get("robustness_checks", strategy_plan.get("robustness_checks", [])),
        "supporting_evidence": evidence_summary or [],
        "limitations": [
            "Computed estimates are conditional on the selected model, graph, adjustment set, and assumptions.",
            "Exploratory patterns do not establish causality.",
            "Causal interpretation requires reviewed and justified assumptions.",
            "This report is not diagnostic guidance or treatment-decision support.",
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
            "Review the selected Phase 8 estimation run, diagnostics, and sensitivity notes before export.",
        ],
        "pdf_export_status": "not_implemented",
        "pdf_export_message": "PDF export will be added later. This endpoint returns a structured JSON report.",
    }
    report["sections"] = {
        "project_summary": report["project_summary"],
        "dataset_and_schema_summary": report["dataset_summary"],
        "broad_exploration_summary": report["broad_data_exploration_summary"],
        "causal_question": {"confirmed_question": report["final_research_question"]},
        "variable_definitions_and_roles": report["causal_role_table"],
        "targeted_feasibility": report["data_feasibility_summary"],
        "causal_graph_summary": report["final_causal_graph_summary"],
        "identification_review": report["identification_assessment"],
        "analysis_strategy": report["analysis_strategy"],
        "estimation_and_calculation": report["estimation_and_calculation"],
        "diagnostics_and_sensitivity": report["diagnostics_and_sensitivity"],
        "evidence_notes": report["supporting_evidence"],
        "claim_safety_audit": {},
        "what_can_and_cannot_be_claimed": {
            "can_claim": report["what_can_be_claimed"],
            "cannot_claim": report["what_cannot_be_claimed"],
        },
        "human_review_checklist": {
            "confirmed_research_question": bool(confirmed_question),
            "confirmed_graph": bool(graph),
            "identification_reviewed": bool(identification_result),
            "assumptions_reviewed": bool(assumptions_review),
            "estimation_run_selected": bool(estimation_run),
            "diagnostics_reviewed": bool(estimation_run and diagnostics),
            "claim_audit_passed": False,
            "evidence_reviewed": bool(evidence_summary),
            "limitations_documented": True,
        },
        "reproducibility_log": (estimation_run or {}).get("reproducibility"),
    }
    report["claim_audit"] = audit_claims(report)
    report["sections"]["claim_safety_audit"] = report["claim_audit"]
    record_trace_event(
        "review_export_report_generation",
        {
            "workflow_step": 9,
            "dataset_filename": dataset_path.name,
            "research_objective_present": bool(research_objective),
            "confirmed_question_length": len(confirmed_question),
            "selected_variable_count": len(selected_variables),
            "graph_node_count": len(graph.get("nodes", [])),
            "graph_edge_count": len(graph.get("edges", [])),
            "identification_status": identification_result.get("identification_status"),
            "strategy_status": strategy_plan.get("strategy_status"),
            "assumption_review_status": assumptions.get("review_status"),
            "selected_estimation_run_present": bool(estimation_run),
            "claim_audit_status": report["claim_audit"].get("status"),
            "unsafe_claim_count": len(report["claim_audit"].get("unsafe_claims_found", [])),
        },
    )
    return report
