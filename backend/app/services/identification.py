from __future__ import annotations

from typing import Any

import networkx as nx

from app.rag.search import RagSearchError, search_rag_chunks
from app.services.causal_questions import (
    CausalQuestionGenerationError,
    MAX_EVIDENCE_CHUNKS,
    resolve_dataset_path,
    summarize_evidence,
    summarize_schema,
)
from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


ID_FIELD_NAMES = {"pid", "id", "participant_id", "subject_id", "user_id"}
TIMESTAMP_FIELD_NAMES = {"time_stamp", "timestamp", "date", "datetime", "time"}
WEAK_CONFIDENCE = {"low", "uncertain", "weak"}


class IdentificationCheckError(RuntimeError):
    pass


def make_issue(
    *,
    issue_type: str,
    message: str,
    severity: str,
    suggested_fix: str,
    variable_name: str | None = None,
    source: str | None = None,
    target: str | None = None,
) -> dict[str, Any]:
    return {
        "issue_type": issue_type,
        "variable_name": variable_name,
        "source": source,
        "target": target,
        "message": message,
        "severity": severity,
        "suggested_fix": suggested_fix,
    }


def lower_join(*values: Any) -> str:
    return " ".join(str(value or "").lower() for value in values)


def role_text(role: dict[str, Any]) -> str:
    return lower_join(
        role.get("primary_role"),
        role.get("temporal_role"),
        role.get("measurement_role"),
        role.get("adjustment_recommendation"),
        role.get("rationale"),
        " ".join(str(item).lower() for item in role.get("recommended_roles", [])),
    )


def node_id(node: dict[str, Any]) -> str:
    return str(node.get("node_id") or node.get("variable_name") or "")


def find_role_variable(
    role_recommendations: list[dict[str, Any]],
    role_name: str,
) -> str | None:
    for role in role_recommendations:
        roles = {str(item).lower() for item in role.get("recommended_roles", [])}
        if role_name in roles or str(role.get("primary_role", "")).lower() == role_name:
            return str(role.get("variable_name") or role.get("source_field") or "")
    return None


def build_graph(graph_payload: dict[str, Any]) -> tuple[nx.DiGraph, dict[str, dict[str, Any]]]:
    graph = nx.DiGraph()
    nodes = graph_payload.get("nodes", [])
    edges = graph_payload.get("edges", [])
    node_by_id = {node_id(node): node for node in nodes if node_id(node)}
    graph.add_nodes_from(node_by_id)
    for edge in edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source and target:
            graph.add_edge(source, target)
    return graph, node_by_id


def default_adjustment_set(
    role_recommendations: list[dict[str, Any]],
    graph: nx.DiGraph,
    exposure: str | None,
    outcome: str | None,
) -> list[str]:
    adjustment = [
        str(role.get("variable_name") or role.get("source_field") or "")
        for role in role_recommendations
        if role.get("adjustment_recommendation") == "include_in_adjustment_candidate"
    ]
    if adjustment:
        return [variable for variable in adjustment if variable]

    if exposure and outcome and exposure in graph and outcome in graph:
        parent_candidates = set(graph.predecessors(exposure)) | set(graph.predecessors(outcome))
        parent_candidates.discard(exposure)
        parent_candidates.discard(outcome)
        return sorted(parent_candidates)

    return []


def check_identification(
    *,
    confirmed_question: str,
    dataset_filename: str,
    graph_payload: dict[str, Any],
    role_recommendations: list[dict[str, Any]],
    estimand_type: str = "total_effect",
    user_adjustment_set: list[str] | None = None,
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    normalized_question = confirmed_question.strip()
    if not normalized_question:
        raise IdentificationCheckError("confirmed_question cannot be empty.")
    if not role_recommendations:
        raise IdentificationCheckError("role_recommendations cannot be empty.")

    nodes = graph_payload.get("nodes", [])
    edges = graph_payload.get("edges", [])
    if not isinstance(nodes, list) or not nodes:
        raise IdentificationCheckError("graph.nodes cannot be empty.")
    if not isinstance(edges, list) or not edges:
        raise IdentificationCheckError("graph.edges cannot be empty.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise IdentificationCheckError(str(error)) from error

    try:
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise IdentificationCheckError(str(error)) from error

    graph, node_by_id = build_graph(graph_payload)
    role_by_variable = {
        str(role.get("variable_name") or role.get("source_field") or "").lower(): role
        for role in role_recommendations
    }
    missingness = schema.get("missing_value_percentage_per_column", {})
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    open_issues: list[dict[str, Any]] = []
    assumptions_required: list[str] = []
    missing_variables: list[str] = []

    exposure = find_role_variable(role_recommendations, "exposure")
    outcome = find_role_variable(role_recommendations, "outcome")
    if not exposure:
        for edge in edges:
            target = str(edge.get("target") or "")
            target_role = role_by_variable.get(target.lower(), {})
            if "outcome" in role_text(target_role):
                exposure = str(edge.get("source") or "")
                break
    if not outcome:
        for node in nodes:
            variable = str(node.get("variable_name") or node.get("node_id") or "")
            if "outcome" in lower_join(node.get("role"), role_text(role_by_variable.get(variable.lower(), {}))):
                outcome = variable
                break

    if not exposure:
        errors.append(
            make_issue(
                issue_type="exposure_not_identified",
                message="No exposure candidate could be identified from roles or graph edges.",
                severity="blocking",
                suggested_fix="Mark one selected variable as the exposure candidate before analysis planning.",
            )
        )
    if not outcome:
        errors.append(
            make_issue(
                issue_type="outcome_not_identified",
                message="No outcome candidate could be identified from roles or graph nodes.",
                severity="blocking",
                suggested_fix="Mark one selected variable as the outcome candidate before analysis planning.",
            )
        )

    if exposure and exposure not in graph:
        errors.append(
            make_issue(
                issue_type="exposure_missing_from_graph",
                variable_name=exposure,
                message="The exposure candidate is not present as a graph node.",
                severity="blocking",
                suggested_fix="Add the exposure candidate to the graph or revise the role recommendation.",
            )
        )
    if outcome and outcome not in graph:
        errors.append(
            make_issue(
                issue_type="outcome_missing_from_graph",
                variable_name=outcome,
                message="The outcome candidate is not present as a graph node.",
                severity="blocking",
                suggested_fix="Add the outcome candidate to the graph or revise the role recommendation.",
            )
        )

    if exposure and outcome and exposure in graph and outcome in graph:
        if not nx.has_path(graph, exposure, outcome):
            open_issues.append(
                make_issue(
                    issue_type="no_directed_path_exposure_to_outcome",
                    source=exposure,
                    target=outcome,
                    message="There is no directed path from exposure to outcome in the current graph.",
                    severity="high",
                    suggested_fix="Add, reorient, or explicitly reject the hypothesized exposure-to-outcome path.",
                )
            )
        if nx.has_path(graph, outcome, exposure):
            errors.append(
                make_issue(
                    issue_type="outcome_causes_exposure",
                    source=outcome,
                    target=exposure,
                    message="The graph contains a path where the outcome causes the exposure.",
                    severity="blocking",
                    suggested_fix="Remove or reorient outcome-to-exposure paths before analysis planning.",
                )
            )

    if str(graph_payload.get("graph_type") or "DAG").upper() == "DAG":
        try:
            cycle = nx.find_cycle(graph)
        except nx.NetworkXNoCycle:
            cycle = []
        if cycle:
            errors.append(
                make_issue(
                    issue_type="directed_cycle",
                    message="The graph contains a directed cycle and is not a valid DAG.",
                    severity="blocking",
                    suggested_fix="Remove or reorient at least one edge in the cycle.",
                )
            )

    proposed_adjustment_set = user_adjustment_set or default_adjustment_set(
        role_recommendations,
        graph,
        exposure,
        outcome,
    )
    adjustment_errors = 0
    adjustment_warnings = 0
    for variable in proposed_adjustment_set:
        role = role_by_variable.get(variable.lower(), {})
        text = role_text(role)
        variable_lower = variable.lower()
        missing_value = missingness.get(variable)

        if variable_lower in ID_FIELD_NAMES or "id_or_grouping_variable" in text:
            errors.append(
                make_issue(
                    issue_type="id_in_adjustment_set",
                    variable_name=variable,
                    message="ID/grouping variables should not be included in causal adjustment sets.",
                    severity="blocking",
                    suggested_fix="Remove this variable from the adjustment set and use it only for grouping/cluster structure.",
                )
            )
            adjustment_errors += 1
        if variable_lower in TIMESTAMP_FIELD_NAMES or "temporal_context_variable" in text:
            warnings.append(
                make_issue(
                    issue_type="temporal_context_adjustment_requires_review",
                    variable_name=variable,
                    message="Timestamp/context variables in an adjustment set require careful causal interpretation.",
                    severity="warning",
                    suggested_fix="Clarify whether this is calendar context, ordering, seasonality, or a causal covariate.",
                )
            )
            adjustment_warnings += 1
        if "mediator" in text and estimand_type == "total_effect":
            errors.append(
                make_issue(
                    issue_type="mediator_in_total_effect_adjustment",
                    variable_name=variable,
                    message="Mediators should not be adjusted for in total-effect analysis planning.",
                    severity="blocking",
                    suggested_fix="Remove mediator candidates from the total-effect adjustment set.",
                )
            )
            adjustment_errors += 1
        if "collider" in text:
            errors.append(
                make_issue(
                    issue_type="collider_in_adjustment_set",
                    variable_name=variable,
                    message="Colliders should not be included in the adjustment set.",
                    severity="blocking",
                    suggested_fix="Remove collider candidates from adjustment.",
                )
            )
            adjustment_errors += 1
        if "post_treatment_variable" in text or "post-exposure" in text:
            errors.append(
                make_issue(
                    issue_type="post_treatment_adjustment",
                    variable_name=variable,
                    message="Post-treatment/post-exposure variables require review and are usually not baseline confounders.",
                    severity="high",
                    suggested_fix="Remove or reclassify this variable based on timing.",
                )
            )
            adjustment_errors += 1
        if isinstance(missing_value, (int, float)) and missing_value >= 30:
            warnings.append(
                make_issue(
                    issue_type="high_missingness_adjustment_variable",
                    variable_name=variable,
                    message=f"{variable} has {missing_value:.2f}% missingness in the uploaded dataset.",
                    severity="warning" if missing_value < 50 else "high",
                    suggested_fix="Review missing-data handling before using this adjustment variable.",
                )
            )
            adjustment_warnings += 1
        if "unknown" in text or "uncertain" in text:
            open_issues.append(
                make_issue(
                    issue_type="unknown_timing_adjustment_variable",
                    variable_name=variable,
                    message="This adjustment variable has uncertain timing.",
                    severity="warning",
                    suggested_fix="Confirm measurement timing before analysis planning.",
                )
            )
            adjustment_warnings += 1

    for role in role_recommendations:
        text = role_text(role)
        variable = str(role.get("variable_name") or role.get("source_field") or "")
        if "unavailable" in text and ("confounder" in text or "important" in text):
            missing_variables.append(variable or "unavailable important variable")

    for warning in graph_payload.get("latent_confounder_warnings", []) or []:
        open_issues.append(
            make_issue(
                issue_type="latent_confounding_risk",
                message=str(warning),
                severity="high",
                suggested_fix="Document the latent confounding assumption or add available proxy/covariate candidates for review.",
            )
        )

    for edge in edges:
        confidence = str(edge.get("confidence") or "").lower()
        rationale = lower_join(edge.get("rationale"), edge.get("supporting_evidence"))
        if confidence in WEAK_CONFIDENCE or "weak" in rationale or "uncertain" in rationale:
            warnings.append(
                make_issue(
                    issue_type="weak_or_unsupported_edge",
                    source=str(edge.get("source") or ""),
                    target=str(edge.get("target") or ""),
                    message="This graph edge is weakly supported or marked uncertain.",
                    severity="warning",
                    suggested_fix="Confirm, remove, or move this edge to uncertain assumptions before analysis planning.",
                )
            )

    evidence_chunks = []
    try:
        evidence_query = (
            f"{normalized_question} identification adjustment set graph "
            f"{', '.join(str(node) for node in graph.nodes)}"
        )
        evidence_chunks = summarize_evidence(
            search_rag_chunks(
                query=evidence_query,
                top_k=min(top_k_evidence, MAX_EVIDENCE_CHUNKS),
            )
        )
    except RagSearchError:
        warnings.append(
            make_issue(
                issue_type="rag_evidence_unavailable",
                message="RAG evidence could not be retrieved for this identification check.",
                severity="warning",
                suggested_fix="Confirm documents are ingested before relying on evidence-supported planning.",
            )
        )

    assumptions_required.extend(
        [
            "The graph draft is accepted by the user as a planning graph, not as proven causal truth.",
            "All adjustment variables are measured before the outcome window and are not colliders or mediators for the target estimand.",
            "Weak or uncertain edges are reviewed before analysis strategy planning.",
        ]
    )
    if missing_variables:
        assumptions_required.append(
            "Important unavailable variables are absent or adequately addressed by design limitations."
        )

    blocking_errors = [issue for issue in errors if issue["severity"] == "blocking"]
    high_issues = [
        issue
        for issue in [*warnings, *open_issues, *errors]
        if issue["severity"] == "high"
    ]
    if adjustment_errors:
        adjustment_set_status = "invalid"
    elif not proposed_adjustment_set:
        adjustment_set_status = "unavailable"
    elif adjustment_warnings:
        adjustment_set_status = "needs_review"
    else:
        adjustment_set_status = "acceptable"

    if blocking_errors:
        identification_status = "not_identifiable_with_current_design"
        safe_to_continue = False
        recommended_next_action = "Resolve blocking identification errors before analysis strategy planning."
    elif high_issues or missing_variables or adjustment_set_status == "needs_review":
        identification_status = "identifiable_only_under_additional_assumptions"
        safe_to_continue = True
        recommended_next_action = "Review high-priority issues and document assumptions before analysis strategy planning."
    elif open_issues or warnings:
        identification_status = "requires_revision"
        safe_to_continue = False
        recommended_next_action = "Revise or confirm open graph and adjustment-set issues before moving forward."
    else:
        identification_status = "ready_for_analysis_planning"
        safe_to_continue = True
        recommended_next_action = "Proceed to analysis strategy planning under the stated assumptions."

    plain_language_summary = (
        f"The current design uses {exposure or 'an unspecified exposure'} as the exposure "
        f"candidate and {outcome or 'an unspecified outcome'} as the outcome candidate. "
        f"The backend found {len(errors)} errors, {len(warnings)} warnings, and "
        f"{len(open_issues)} open issues. No causal effect has been estimated or proven."
    )

    return {
        "status": "completed",
        "identification_status": identification_status,
        "exposure": exposure,
        "outcome": outcome,
        "proposed_adjustment_set": proposed_adjustment_set,
        "adjustment_set_status": adjustment_set_status,
        "open_issues": open_issues,
        "warnings": warnings,
        "errors": errors,
        "assumptions_required": assumptions_required,
        "missing_variables": missing_variables,
        "recommended_next_action": recommended_next_action,
        "safe_to_continue_to_analysis_strategy": safe_to_continue,
        "plain_language_summary": plain_language_summary,
        "evidence_chunks_used": len(evidence_chunks),
        "schema_summary": summarize_schema(schema),
    }
