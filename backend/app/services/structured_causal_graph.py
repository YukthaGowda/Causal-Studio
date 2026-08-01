from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

import networkx as nx


SUPPORTED_GRAPH_TYPES = {"DAG", "CPDAG", "PAG", "MAG"}
ROLE_MAP = {
    "exposure": "exposure",
    "outcome": "outcome",
    "confounder": "confounder",
    "mediator": "mediator",
    "collider": "collider_candidate",
    "collider_candidate": "collider_candidate",
    "proxy": "proxy",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_id(value: Any) -> str:
    return str(value or "").strip()


def _label_from_id(node_id: str) -> str:
    return node_id.replace("_", " ").strip().title() or node_id


def _variable_name(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        return _as_id(item.get("variable_name") or item.get("name") or item.get("id") or item.get("source_field"))
    return _as_id(item)


def _selected_variable_names(selected_variables: list[Any]) -> list[str]:
    seen: set[str] = set()
    names: list[str] = []
    for item in selected_variables:
        name = _variable_name(item)
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def _role_from_source(name: str, provisional_roles: dict[str, Any] | None = None) -> str:
    raw_role = ""
    if provisional_roles and name in provisional_roles:
        value = provisional_roles[name]
        raw_role = str(value.get("role") if isinstance(value, dict) else value)
    lowered = raw_role.lower()
    if lowered:
        return ROLE_MAP.get(lowered, "unknown")

    name_l = name.lower()
    if name_l in {"label", "outcome", "target"} or "alcohol" in name_l:
        return "outcome"
    if name_l in {"pid", "participant_id", "participant", "subject_id", "id"}:
        return "unknown"
    if "time" in name_l or "date" in name_l or "day" in name_l:
        return "unknown"
    if "sleep" in name_l or name_l == "acc_mean_magnitude":
        return "exposure"
    if "lat" in name_l or "lon" in name_l or "gps" in name_l or "phone" in name_l or "acc_" in name_l:
        return "proxy"
    return "unknown"


def _temporal_role(name: str) -> str:
    name_l = name.lower()
    if "time" in name_l or "date" in name_l or "day" in name_l:
        return "time_varying"
    if name_l in {"pid", "participant_id", "participant", "subject_id", "id"}:
        return "baseline"
    return "unknown"


def _measurement_role(name: str) -> str:
    name_l = name.lower()
    if name_l in {"label", "outcome", "target"}:
        return "direct"
    if "acc_" in name_l or "phone" in name_l or "gps" in name_l or "lat" in name_l or "lon" in name_l:
        return "proxy"
    if "derived" in name_l:
        return "derived"
    return "unknown"


def _selected_metadata(selected_variables: list[Any]) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    for item in selected_variables:
        name = _variable_name(item)
        if not name:
            continue
        metadata[name] = item if isinstance(item, dict) else {}
    return metadata


def _has_high_missingness(name: str, metadata: dict[str, Any], feasibility_result: dict[str, Any] | None = None) -> bool:
    joined = " ".join(str(v) for v in metadata.values() if v is not None).lower()
    if "high missing" in joined or "missingness" in joined:
        return True
    if name.lower() == "avg_latitude":
        return True
    if feasibility_result:
        missing = feasibility_result.get("missingness") or feasibility_result.get("high_missingness") or {}
        if isinstance(missing, dict):
            value = missing.get(name)
            try:
                return float(value) >= 30
            except (TypeError, ValueError):
                return False
        if isinstance(missing, list):
            return any((row.get("column") == name and float(row.get("missing_percent", 0)) >= 30) for row in missing if isinstance(row, dict))
    return False


def _normalize_node(node: Any, selected_metadata: dict[str, dict[str, Any]] | None = None) -> dict[str, Any] | None:
    if isinstance(node, str):
        node_id = node.strip()
        raw = {}
    elif isinstance(node, dict):
        node_id = _as_id(node.get("id") or node.get("node_id") or node.get("variable_name"))
        raw = node
    else:
        return None
    if not node_id:
        return None

    role = ROLE_MAP.get(str(raw.get("role") or "").lower(), str(raw.get("role") or "unknown").lower())
    if role not in set(ROLE_MAP.values()) | {"unknown"}:
        role = _role_from_source(node_id)
    metadata = (selected_metadata or {}).get(node_id, {})
    notes = str(raw.get("notes") or metadata.get("missingness_warning") or "")
    return {
        "id": node_id,
        "label": raw.get("label") or raw.get("display_name") or raw.get("variable_name") or _label_from_id(node_id),
        "role": role,
        "temporal_role": raw.get("temporal_role") or _temporal_role(node_id),
        "measurement_role": raw.get("measurement_role") or _measurement_role(node_id),
        "locked": bool(raw.get("locked", False)),
        "notes": notes,
    }


def _normalize_edge(edge: Any) -> dict[str, Any] | None:
    if not isinstance(edge, dict):
        return None
    source = _as_id(edge.get("source") or edge.get("from"))
    target = _as_id(edge.get("target") or edge.get("to"))
    if not source or not target:
        return None
    edge_type = str(edge.get("edge_type") or edge.get("type") or "directed").lower()
    if edge_type not in {"directed", "bidirected", "uncertain"}:
        edge_type = "uncertain"
    return {
        "id": edge.get("id") or f"{source}__{target}",
        "source": source,
        "target": target,
        "edge_type": edge_type,
        "rationale": edge.get("rationale") or "",
        "supporting_evidence": edge.get("supporting_evidence") or [],
        "confidence": edge.get("confidence") or ("uncertain" if edge_type == "uncertain" else "medium"),
        "locked": bool(edge.get("locked", False)),
        "user_modified": bool(edge.get("user_modified", False)),
    }


def _derive_exposure_outcome(nodes: list[dict[str, Any]], exposure: str, outcome: str) -> tuple[str, str]:
    exposure = _as_id(exposure)
    outcome = _as_id(outcome)
    if not exposure:
        exposure = next((node["id"] for node in nodes if node.get("role") == "exposure"), "")
    if not outcome:
        outcome = next((node["id"] for node in nodes if node.get("role") == "outcome"), "")
    return exposure, outcome


def validate_structured_graph(
    *,
    graph_type: str = "DAG",
    nodes: list[Any],
    edges: list[Any],
    exposure: str = "",
    outcome: str = "",
    adjustment_set: list[str] | None = None,
    timestamp_fields: list[str] | None = None,
    participant_id: str = "",
    selected_variables: list[Any] | None = None,
    feasibility_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    graph_type = (graph_type or "DAG").upper()
    adjustment_set = adjustment_set or []
    timestamp_fields = timestamp_fields or []
    selected_variables = selected_variables or []
    selected_metadata = _selected_metadata(selected_variables)
    normalized_nodes = [node for node in (_normalize_node(item, selected_metadata) for item in nodes) if node]
    normalized_edges = [edge for edge in (_normalize_edge(item) for item in edges) if edge]

    node_ids = {node["id"] for node in normalized_nodes}
    role_by_id = {node["id"]: node.get("role", "unknown") for node in normalized_nodes}
    temporal_by_id = {node["id"]: node.get("temporal_role", "unknown") for node in normalized_nodes}
    exposure, outcome = _derive_exposure_outcome(normalized_nodes, exposure, outcome)
    participant_id = participant_id or next((name for name in node_ids if name.lower() in {"pid", "participant_id", "subject_id"}), "")

    errors: list[str] = []
    warnings: list[str] = []
    checks = {
        "acyclic": True,
        "no_self_loops": True,
        "no_duplicate_edges": True,
        "all_nodes_known": True,
        "outcome_not_adjusted_for": True,
        "id_not_causal_variable": True,
        "timestamps_not_causal_variables": True,
        "temporal_order_reviewed": True,
        "post_treatment_adjustment_reviewed": True,
        "collider_adjustment_reviewed": True,
    }

    if graph_type not in SUPPORTED_GRAPH_TYPES:
        errors.append(f"Unsupported graph_type '{graph_type}'. Use DAG, CPDAG, PAG, or MAG.")
    elif graph_type != "DAG":
        warnings.append(f"{graph_type} support is experimental in this proof of concept; deterministic checks are DAG-oriented.")

    for edge in normalized_edges:
        if edge["source"] == edge["target"]:
            checks["no_self_loops"] = False
            errors.append(f"Self-loop detected on {edge['source']}.")
        if edge["source"] not in node_ids or edge["target"] not in node_ids:
            checks["all_nodes_known"] = False
            errors.append(f"Edge {edge['source']} -> {edge['target']} references a node that is not in the graph.")

    counts = Counter((edge["source"], edge["target"]) for edge in normalized_edges)
    for (source, target), count in counts.items():
        if count > 1:
            checks["no_duplicate_edges"] = False
            errors.append(f"Duplicate edge detected: {source} -> {target}.")

    if graph_type == "DAG":
        directed_graph = nx.DiGraph()
        directed_graph.add_nodes_from(node_ids)
        directed_graph.add_edges_from(
            (edge["source"], edge["target"])
            for edge in normalized_edges
            if edge["edge_type"] in {"directed", "uncertain"} and edge["source"] in node_ids and edge["target"] in node_ids
        )
        if not nx.is_directed_acyclic_graph(directed_graph):
            checks["acyclic"] = False
            errors.append("DAG validation failed because the graph contains a directed cycle.")

    if exposure and outcome and any(edge["source"] == outcome and edge["target"] == exposure for edge in normalized_edges):
        warnings.append(f"{outcome} points to {exposure}; confirm this is not reverse temporal ordering.")

    if outcome and outcome in adjustment_set:
        checks["outcome_not_adjusted_for"] = False
        errors.append(f"Outcome '{outcome}' should not be included in the adjustment set.")

    if participant_id:
        if participant_id == exposure or participant_id == outcome or role_by_id.get(participant_id) in {"exposure", "outcome"}:
            checks["id_not_causal_variable"] = False
            warnings.append(f"{participant_id} is a participant/grouping ID and should not be treated as exposure or outcome.")

    for field in timestamp_fields:
        if field in node_ids and role_by_id.get(field) in {"exposure", "outcome", "confounder", "mediator", "collider_candidate", "proxy"}:
            checks["timestamps_not_causal_variables"] = False
            warnings.append(f"{field} is a timestamp/context field; treat it as temporal structure, not a standalone causal variable.")

    for variable in adjustment_set:
        role = role_by_id.get(variable, "unknown")
        if temporal_by_id.get(variable) == "post_treatment":
            checks["post_treatment_adjustment_reviewed"] = False
            warnings.append(f"{variable} appears post-treatment; adjusting for it may bias the target effect.")
        if role == "collider_candidate":
            checks["collider_adjustment_reviewed"] = False
            warnings.append(f"{variable} is marked as a possible collider; adjusting for it can open a noncausal path.")

    for node in normalized_nodes:
        if _has_high_missingness(node["id"], selected_metadata.get(node["id"], {}), feasibility_result):
            warnings.append(f"{node['id']} has high missingness; review missing-data handling before relying on this node.")

    if any(edge["edge_type"] == "uncertain" for edge in normalized_edges):
        checks["temporal_order_reviewed"] = False
        warnings.append("At least one edge is uncertain; temporal direction and evidence support require user review.")
    if any(temporal_by_id.get(node_id) == "unknown" for node_id in node_ids if node_id not in {participant_id}):
        checks["temporal_order_reviewed"] = False
        warnings.append("Some node temporal roles are unknown; review ordering before continuing.")

    connected = {edge["source"] for edge in normalized_edges} | {edge["target"] for edge in normalized_edges}
    key_nodes = {exposure, outcome} - {""}
    for node_id in key_nodes:
        if node_id not in connected:
            warnings.append(f"Key variable '{node_id}' is isolated in the graph.")
    for variable in _selected_variable_names(selected_variables):
        if variable in node_ids and variable not in connected and variable not in {participant_id}:
            warnings.append(f"Selected variable '{variable}' is currently isolated; confirm whether it should be omitted or connected.")

    status = "invalid" if errors else "valid_with_warnings" if warnings else "valid"
    return {
        "status": status,
        "safe_to_continue": status != "invalid",
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "normalized_nodes": normalized_nodes,
        "normalized_edges": normalized_edges,
    }


def generate_structured_graph(
    *,
    graph_type: str = "DAG",
    confirmed_question: str = "",
    selected_variables: list[Any],
    provisional_roles: dict[str, Any] | None = None,
    feasibility_result: dict[str, Any] | None = None,
    rag_evidence: list[dict[str, Any]] | None = None,
    user_feedback: str = "",
    preserve_user_locked_edges: bool = True,
) -> dict[str, Any]:
    names = _selected_variable_names(selected_variables)
    metadata = _selected_metadata(selected_variables)
    if not names:
        names = ["acc_mean_magnitude", "label", "time_of_day", "day_of_week", "avg_latitude", "pid"]

    nodes = []
    for name in names:
        notes = ""
        if name.lower() in {"pid", "participant_id", "subject_id"}:
            notes = "Participant/grouping ID only; not a causal exposure or outcome."
        elif _has_high_missingness(name, metadata.get(name, {}), feasibility_result):
            notes = "High missingness warning; review missing-data handling."
        elif "time" in name.lower() or "day" in name.lower():
            notes = "Temporal/context field; use for ordering and stratification with care."
        nodes.append(
            {
                "id": name,
                "label": _label_from_id(name),
                "role": _role_from_source(name, provisional_roles),
                "temporal_role": _temporal_role(name),
                "measurement_role": _measurement_role(name),
                "locked": False,
                "notes": notes,
            }
        )

    node_ids = {node["id"] for node in nodes}
    exposure = next((node["id"] for node in nodes if node["role"] == "exposure"), "")
    outcome = next((node["id"] for node in nodes if node["role"] == "outcome"), "")
    context_nodes = [
        node["id"]
        for node in nodes
        if node["id"] not in {exposure, outcome}
        and node["role"] in {"confounder", "proxy", "unknown"}
        and node["id"].lower() not in {"pid", "participant_id", "subject_id"}
    ]

    edges: list[dict[str, Any]] = []

    def add_edge(source: str, target: str, rationale: str, confidence: str = "medium", edge_type: str = "directed") -> None:
        if source in node_ids and target in node_ids and source != target and not any(e["source"] == source and e["target"] == target for e in edges):
            edges.append(
                {
                    "id": f"{source}__{target}",
                    "source": source,
                    "target": target,
                    "edge_type": edge_type,
                    "rationale": rationale,
                    "supporting_evidence": [],
                    "confidence": confidence,
                    "locked": False,
                    "user_modified": False,
                }
            )

    for context in context_nodes[:4]:
        if exposure:
            add_edge(context, exposure, "Context/proxy variable may precede or shape exposure-window measurement.", "low", "uncertain")
        if outcome and context.lower() in {"time_of_day", "day_of_week"} or (outcome and "lat" in context.lower()):
            add_edge(context, outcome, "Context/proxy variable may be associated with the outcome and should be reviewed.", "low", "uncertain")
    if exposure and outcome:
        add_edge(exposure, outcome, "Draft target relation from the confirmed research question; requires user review and validation.", "medium")

    evidence_notes = []
    for item in rag_evidence or []:
        source = item.get("source_filename") or item.get("metadata", {}).get("source_filename")
        if source:
            evidence_notes.append(f"Evidence retrieved from {source}.")
    if not evidence_notes:
        evidence_notes.append("Deterministic fallback draft generated from selected variables and provisional roles.")
    if user_feedback.strip():
        evidence_notes.append("User feedback was considered as a drafting note; locked user edits should be preserved in later iterations.")
    if preserve_user_locked_edges:
        evidence_notes.append("User-locked edges are intended to be preserved during regeneration.")

    timestamp_fields = [name for name in names if "time" in name.lower() or "date" in name.lower() or "day" in name.lower()]
    participant_id = next((name for name in names if name.lower() in {"pid", "participant_id", "subject_id"}), "")
    adjustment_set = [
        node["id"]
        for node in nodes
        if node["role"] in {"confounder", "proxy"} and node["id"] not in {exposure, outcome, participant_id}
    ]
    validation = validate_structured_graph(
        graph_type=graph_type,
        nodes=nodes,
        edges=edges,
        exposure=exposure,
        outcome=outcome,
        adjustment_set=adjustment_set,
        timestamp_fields=timestamp_fields,
        participant_id=participant_id,
        selected_variables=selected_variables,
        feasibility_result=feasibility_result,
    )
    warnings = list(dict.fromkeys(validation["warnings"] + ["Graph is an AI/deterministic first-pass draft and requires user review."]))
    if (graph_type or "DAG").upper() != "DAG":
        warnings.append(f"{graph_type} graph support is experimental; DAG is the validated default.")

    return {
        "graph_type": (graph_type or "DAG").upper(),
        "version_label": "Version 1",
        "nodes": nodes,
        "edges": edges,
        "validation_result": {key: value for key, value in validation.items() if not key.startswith("normalized_")},
        "warnings": warnings,
        "evidence_notes": evidence_notes,
        "status": "fallback",
        "generated_at": _now_iso(),
        "confirmed_question": confirmed_question,
        "requires_user_review": True,
    }
