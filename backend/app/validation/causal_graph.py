from __future__ import annotations

from typing import Any

import networkx as nx


ID_FIELD_NAMES = {"pid", "id", "participant_id", "subject_id", "user_id"}
TIMESTAMP_FIELD_NAMES = {"time_stamp", "timestamp", "date", "datetime", "time"}
UNKNOWN_TIMING_TERMS = {"unknown", "unclear", "not specified", "uncertain"}
POST_OUTCOME_TERMS = {"post-outcome", "after outcome", "future outcome"}
WEAK_CONFIDENCE = {"low", "uncertain", "weak"}


def _lower(value: Any) -> str:
    return str(value or "").lower()


def _make_issue(
    *,
    issue_type_key: str,
    issue_type: str,
    message: str,
    severity: str,
    suggested_fix: str,
    source: str | None = None,
    target: str | None = None,
) -> dict[str, Any]:
    return {
        issue_type_key: issue_type,
        "source": source,
        "target": target,
        "message": message,
        "severity": severity,
        "suggested_fix": suggested_fix,
    }


def _node_name(node: dict[str, Any]) -> str:
    return str(node.get("node_id") or node.get("variable_name") or "")


def _node_role_text(node: dict[str, Any], role_by_variable: dict[str, dict[str, Any]]) -> str:
    variable_name = str(node.get("variable_name") or node.get("node_id") or "")
    role = role_by_variable.get(variable_name.lower(), {})
    return " ".join(
        [
            _lower(node.get("role")),
            _lower(node.get("temporal_role")),
            _lower(role.get("primary_role")),
            _lower(role.get("temporal_role")),
            _lower(role.get("measurement_role")),
            " ".join(_lower(item) for item in role.get("recommended_roles", [])),
            _lower(role.get("rationale")),
            _lower(role.get("uncertainty_notes")),
        ]
    )


def validate_causal_graph(
    *,
    graph_draft: dict[str, Any],
    selected_variables: list[dict[str, Any]],
    role_recommendations: list[dict[str, Any]],
    schema: dict[str, Any],
    estimand_type: str,
) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    suggested_edits: list[str] = []

    nodes = graph_draft.get("nodes", [])
    edges = graph_draft.get("edges", [])
    graph_type = str(graph_draft.get("graph_type") or "DAG").upper()

    if not isinstance(nodes, list) or not nodes:
        errors.append(
            _make_issue(
                issue_type_key="error_type",
                issue_type="graph_has_no_nodes",
                message="The graph draft must include at least one node.",
                severity="blocking",
                suggested_fix="Add nodes for selected variables before graph validation.",
            )
        )
        nodes = []

    if not isinstance(edges, list) or not edges:
        warnings.append(
            _make_issue(
                issue_type_key="warning_type",
                issue_type="graph_has_no_edges",
                message="The graph draft has no edges.",
                severity="warning",
                suggested_fix="Add candidate directed edges or explicitly document why no edges are proposed.",
            )
        )
        edges = []

    node_ids = {_node_name(node) for node in nodes if _node_name(node)}
    node_by_id = {_node_name(node): node for node in nodes if _node_name(node)}
    role_by_variable = {
        str(role.get("variable_name") or role.get("source_field") or "").lower(): role
        for role in role_recommendations
    }
    selected_by_variable = {
        str(variable.get("variable_name") or variable.get("source_field") or "").lower(): variable
        for variable in selected_variables
    }
    missingness = schema.get("missing_value_percentage_per_column", {})

    warnings.append(
        _make_issue(
            issue_type_key="warning_type",
            issue_type="draft_graph_requires_review",
            message="This first-pass graph is a draft and requires user review before identification.",
            severity="info",
            suggested_fix="Review node inclusion, edge direction, timing assumptions, and omitted variables before proceeding.",
        )
    )

    for selected_variable in selected_variables:
        variable_name = str(
            selected_variable.get("variable_name")
            or selected_variable.get("source_field")
            or ""
        )
        source_field = str(selected_variable.get("source_field") or variable_name)
        role = role_by_variable.get(variable_name.lower(), {})
        role_text = " ".join(
            [
                _lower(role.get("primary_role")),
                " ".join(_lower(item) for item in role.get("recommended_roles", [])),
                _lower(role.get("temporal_role")),
                _lower(selected_variable.get("measurement_timing")),
                _lower(selected_variable.get("user_notes")),
            ]
        )
        variable_lower = variable_name.lower()
        source_lower = source_field.lower()

        if (
            variable_lower in ID_FIELD_NAMES
            or source_lower in ID_FIELD_NAMES
            or "id_or_grouping_variable" in role_text
        ):
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="id_grouping_variable_not_causal_node",
                    source=variable_name,
                    message="ID/grouping variables should not be used as causal nodes unless explicitly treated as grouping or clustering structure.",
                    severity="info",
                    suggested_fix="Keep this variable available for grouping/cluster structure, not causal interpretation.",
                )
            )

        if (
            variable_lower in TIMESTAMP_FIELD_NAMES
            or source_lower in TIMESTAMP_FIELD_NAMES
            or "time_of_day" in variable_lower
            or "day_of_week" in variable_lower
            or "temporal_context_variable" in role_text
            or "time index" in role_text
        ):
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="temporal_context_requires_interpretation",
                    source=variable_name,
                    message="Timestamp and temporal/context variables need careful interpretation before causal graph use.",
                    severity="info",
                    suggested_fix="Use these fields to define ordering, windows, lags, or context; avoid treating calendar structure as a direct causal exposure without justification.",
                )
            )

    graph = nx.DiGraph()
    graph.add_nodes_from(node_ids)

    for edge in edges:
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        confidence = _lower(edge.get("confidence"))
        evidence_text = " ".join(
            [
                _lower(edge.get("rationale")),
                _lower(edge.get("supporting_evidence")),
                _lower(edge.get("temporal_assumption")),
            ]
        )

        if source not in node_ids:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="edge_source_missing_node",
                    source=source,
                    target=target,
                    message="Every edge source must exist as a graph node.",
                    severity="blocking",
                    suggested_fix="Add the source node or remove this edge.",
                )
            )
        if target not in node_ids:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="edge_target_missing_node",
                    source=source,
                    target=target,
                    message="Every edge target must exist as a graph node.",
                    severity="blocking",
                    suggested_fix="Add the target node or remove this edge.",
                )
            )
        if source == target and source:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="self_loop",
                    source=source,
                    target=target,
                    message="Self-loops are not valid in a DAG draft.",
                    severity="blocking",
                    suggested_fix="Remove the self-loop edge.",
                )
            )

        if source in node_ids and target in node_ids and source != target:
            graph.add_edge(source, target)

        source_node = node_by_id.get(source, {})
        target_node = node_by_id.get(target, {})
        source_roles = _node_role_text(source_node, role_by_variable)
        target_roles = _node_role_text(target_node, role_by_variable)

        if "outcome" in source_roles and "exposure" in target_roles:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="outcome_causes_exposure",
                    source=source,
                    target=target,
                    message="The outcome should not be treated as a cause of the exposure.",
                    severity="blocking",
                    suggested_fix="Reverse or remove this edge unless the question is redefined.",
                )
            )

        if "exposure" in source_roles and "outcome" in target_roles:
            pass

        if "id_or_grouping_variable" in source_roles or _lower(source) in ID_FIELD_NAMES:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="id_variable_used_as_cause",
                    source=source,
                    target=target,
                    message="ID/grouping variables should not be used as causal causes.",
                    severity="blocking",
                    suggested_fix="Use ID fields only for grouping/repeated-measures structure.",
                )
            )

        if "id_or_grouping_variable" in target_roles or _lower(target) in ID_FIELD_NAMES:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="id_variable_used_as_outcome",
                    source=source,
                    target=target,
                    message="ID/grouping variables should not be used as causal outcomes.",
                    severity="blocking",
                    suggested_fix="Remove ID fields from causal edges.",
                )
            )

        if _lower(source) in TIMESTAMP_FIELD_NAMES and "explicit" not in evidence_text:
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="timestamp_used_as_causal_source",
                    source=source,
                    target=target,
                    message="Timestamp variables should define ordering/windows, not causal exposure, unless explicitly justified.",
                    severity="high",
                    suggested_fix="Use timestamp fields for temporal indexing or explain the calendar-time causal contrast.",
                )
            )

        if any(term in source_roles for term in POST_OUTCOME_TERMS):
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="post_outcome_source",
                    source=source,
                    target=target,
                    message="Post-outcome variables cannot be used as causes.",
                    severity="blocking",
                    suggested_fix="Remove the edge or redefine the time window.",
                )
            )

        if confidence in WEAK_CONFIDENCE or "weak" in evidence_text or "uncertain" in evidence_text:
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="weak_or_uncertain_edge",
                    source=source,
                    target=target,
                    message="This edge is weakly supported or directionally uncertain.",
                    severity="warning",
                    suggested_fix="Mark this edge for user review or move it to uncertain_edges.",
                )
            )

    if graph_type == "DAG" and graph.number_of_edges() > 0:
        try:
            cycle = nx.find_cycle(graph)
        except nx.NetworkXNoCycle:
            cycle = []
        if cycle:
            errors.append(
                _make_issue(
                    issue_type_key="error_type",
                    issue_type="directed_cycle",
                    message="The graph contains a directed cycle and is not a valid DAG.",
                    severity="blocking",
                    suggested_fix="Remove or reorient at least one edge in the cycle.",
                )
            )

    for node_id, node in node_by_id.items():
        variable_name = str(node.get("variable_name") or node_id)
        role = role_by_variable.get(variable_name.lower(), {})
        selected = selected_by_variable.get(variable_name.lower(), {})
        role_text = _node_role_text(node, role)
        field = str(selected.get("source_field") or role.get("source_field") or variable_name)
        missing_value = missingness.get(field)

        if isinstance(missing_value, (int, float)) and missing_value >= 30:
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="high_missingness_node",
                    source=node_id,
                    message=f"{variable_name} has {missing_value:.2f}% missingness in the uploaded dataset.",
                    severity="warning" if missing_value < 50 else "high",
                    suggested_fix="Review missing-data handling before using this node in identification.",
                )
            )

        if any(term in role_text for term in UNKNOWN_TIMING_TERMS):
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="unknown_timing_node",
                    source=node_id,
                    message="Node timing is unclear.",
                    severity="warning",
                    suggested_fix="Specify whether this variable is pre-exposure, exposure-window, post-exposure, or outcome-window.",
                )
            )

        if estimand_type == "total_effect" and "mediator" in role_text:
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="mediator_in_total_effect_graph",
                    source=node_id,
                    message="Mediator candidates should not be automatically included in total-effect adjustment sets.",
                    severity="high",
                    suggested_fix="Keep mediator nodes visible but do not include them in total-effect adjustment without review.",
                )
            )

        if "collider" in role_text:
            warnings.append(
                _make_issue(
                    issue_type_key="warning_type",
                    issue_type="collider_in_graph",
                    source=node_id,
                    message="Collider candidates should not be included in adjustment sets.",
                    severity="high",
                    suggested_fix="Keep collider candidates marked do_not_adjust unless a reviewed graph says otherwise.",
                )
            )

    blocking_errors = [error for error in errors if error["severity"] == "blocking"]
    high_warnings = [warning for warning in warnings if warning["severity"] == "high"]
    graph_validation_status = "passed"
    if blocking_errors:
        graph_validation_status = "failed"
    elif warnings or errors:
        graph_validation_status = "passed_with_warnings"

    safe_to_continue = not blocking_errors and not high_warnings
    if blocking_errors:
        suggested_edits.append("Resolve blocking graph errors before identification.")
    if high_warnings:
        suggested_edits.append("Review high-severity timing, mediator, collider, or timestamp warnings.")
    if not edges:
        suggested_edits.append("Add or explicitly reject candidate edges before identification.")
    if not suggested_edits:
        suggested_edits.append("Confirm graph assumptions with the user before identification.")

    return {
        "graph_validation_status": graph_validation_status,
        "warnings": warnings,
        "errors": errors,
        "suggested_graph_edits": suggested_edits,
        "safe_to_continue_to_identification": safe_to_continue,
    }
