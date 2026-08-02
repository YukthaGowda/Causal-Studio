from __future__ import annotations

import json
import os
from collections import defaultdict
from typing import Any

import networkx as nx
from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from app.services.causal_questions import DEFAULT_MODEL


FORMAL_ID_WARNING = (
    "Full formal identification is not yet implemented. This result uses "
    "structural graph checks and candidate adjustment-set heuristics and "
    "requires expert review."
)

FALLBACK_WARNING = (
    "LLM strategy generation is unavailable, so this is a deterministic "
    "placeholder based on graph roles and feasibility checks."
)

ASSUMPTIONS = [
    "Temporal ordering",
    "Exchangeability / no unmeasured confounding",
    "Positivity",
    "Consistency",
    "SUTVA / interference",
    "Measurement validity",
    "Exposure-definition validity",
    "Outcome-definition validity",
    "Missingness assumptions",
    "Selection bias",
    "No inappropriate collider adjustment",
    "No inappropriate post-treatment adjustment",
    "Sufficient overlap",
    "Correct model specification",
]


def generate_phase7_analysis_strategy(payload: dict[str, Any]) -> dict[str, Any]:
    graph, nodes, edges = _build_graph(payload.get("graph") or payload)
    exposure = _clean(payload.get("exposure")) or _first_role(nodes, "exposure")
    outcome = _clean(payload.get("outcome")) or _first_role(nodes, "outcome")
    roles = _role_map(nodes, payload)
    schema = payload.get("schema_summary") or {}
    feasibility = payload.get("feasibility_result") or {}

    errors: list[str] = []
    warnings: list[str] = [FORMAL_ID_WARNING, FALLBACK_WARNING]
    if not exposure:
        errors.append("Exposure is missing. Select an exposure before Phase 7 can define an analysis plan.")
    if not outcome:
        errors.append("Outcome is missing. Select an outcome before Phase 7 can define an analysis plan.")
    if exposure and exposure not in graph:
        errors.append(f"Exposure '{exposure}' is not present in the graph.")
    if outcome and outcome not in graph:
        errors.append(f"Outcome '{outcome}' is not present in the graph.")

    cycles: list[list[str]] = []
    if graph.number_of_nodes() > 0:
        cycles = list(nx.simple_cycles(graph))
        if cycles:
            errors.append("The graph contains a directed cycle. A DAG-based identification plan requires an acyclic graph.")

    directed_paths = _safe_paths(graph, exposure, outcome)
    backdoor_paths = _backdoor_paths(graph, exposure, outcome)
    recommended = _recommended_adjustment_set(graph, roles, exposure, outcome, schema)
    variables_not_to_adjust = _variables_not_to_adjust_for(graph, roles, exposure, outcome, schema)
    candidate_sets = [recommended] if recommended else [[]]

    warnings.extend(_feasibility_warnings(feasibility))
    warnings.extend(_schema_warnings(schema))
    warnings.extend(_adjustment_warnings(recommended, roles, exposure, outcome, schema))
    if exposure and outcome and not directed_paths and not errors:
        warnings.append("No directed path from exposure to outcome was found in the current graph. Confirm the graph direction before estimation.")
    if not backdoor_paths and not recommended and exposure and outcome and not errors:
        warnings.append("No measured backdoor paths were detected by the heuristic. This does not rule out unmeasured confounding.")

    identification_status = "not_identified" if errors else "requires_review"
    summary = (
        "The current graph can be reviewed with structural checks, but expert review is required before estimation."
        if not errors
        else "Phase 7 cannot define a usable strategy until the blocking graph or variable issues are fixed."
    )

    estimand = _estimand(payload, exposure, outcome)
    strategy = _strategy(payload, exposure, outcome, recommended, schema, feasibility)
    assumption_checklist = _assumption_checklist(recommended, schema, feasibility, warnings)
    status = "fallback"

    llm_draft = _draft_strategy_with_llm(
        payload=payload,
        deterministic_identification={
            "status": identification_status,
            "summary": summary,
            "backdoor_paths": backdoor_paths,
            "candidate_adjustment_sets": candidate_sets,
            "recommended_adjustment_set": recommended,
            "variables_not_to_adjust_for": variables_not_to_adjust,
            "warnings": warnings,
        },
        estimand=estimand,
        strategy=strategy,
        assumption_checklist=assumption_checklist,
    )
    if llm_draft:
        status = "success"
        warnings = [warning for warning in warnings if warning != FALLBACK_WARNING]
        estimand = _merge_known_keys(estimand, llm_draft.get("estimand"))
        strategy = _merge_known_keys(strategy, llm_draft.get("strategy"))
        assumption_checklist = _merge_assumption_checklist(assumption_checklist, llm_draft.get("assumption_checklist"))
        for warning in llm_draft.get("warnings") or []:
            warning_text = str(warning).strip()
            if warning_text:
                warnings.append(warning_text)
        warnings = list(dict.fromkeys(warnings))

    return {
        "status": status,
        "identification": {
            "status": identification_status,
            "summary": summary,
            "directed_paths": directed_paths,
            "backdoor_paths": backdoor_paths,
            "candidate_adjustment_sets": candidate_sets,
            "recommended_adjustment_set": recommended,
            "variables_not_to_adjust_for": variables_not_to_adjust,
            "warnings": warnings,
        },
        "estimand": estimand,
        "strategy": strategy,
        "assumption_checklist": assumption_checklist,
        "warnings": warnings,
        "recommended_next_actions": _next_actions(errors, warnings),
        "requires_user_review": True,
    }


def validate_phase7_analysis_strategy(payload: dict[str, Any]) -> dict[str, Any]:
    graph, nodes, _edges = _build_graph(payload.get("graph") or {})
    roles = _role_map(nodes, payload)
    schema = payload.get("schema_summary") or {}
    feasibility = payload.get("feasibility_result") or {}
    exposure = _clean(payload.get("exposure")) or _first_role(nodes, "exposure")
    outcome = _clean(payload.get("outcome")) or _first_role(nodes, "outcome")
    adjustment_set = [_clean(v) for v in payload.get("adjustment_set") or [] if _clean(v)]

    node_ids = set(graph.nodes)
    timestamp_fields = set(_timestamp_fields(schema))
    id_fields = set(_id_fields(schema)) | {"pid", "participant_id", "subject_id", "id"}
    role_lower = {k: str(v).lower() for k, v in roles.items()}

    checks = {
        "exposure_present": bool(exposure and exposure in node_ids),
        "outcome_present": bool(outcome and outcome in node_ids),
        "adjustment_set_variables_exist": all(v in node_ids for v in adjustment_set),
        "outcome_not_adjusted_for": outcome not in adjustment_set,
        "exposure_not_adjusted_for": exposure not in adjustment_set,
        "no_id_in_adjustment_set": not any(_is_id(v, id_fields) for v in adjustment_set),
        "no_timestamp_in_adjustment_set": not any(v in timestamp_fields or _looks_timestamp(v) for v in adjustment_set),
        "mediator_adjustment_reviewed": not any("mediator" in role_lower.get(v, "") or "post" in role_lower.get(v, "") for v in adjustment_set),
        "collider_adjustment_reviewed": not any("collider" in role_lower.get(v, "") for v in adjustment_set),
        "feasibility_warnings_reviewed": True,
    }

    errors: list[str] = []
    warnings: list[str] = [FORMAL_ID_WARNING]
    if not checks["exposure_present"]:
        errors.append("Exposure is missing from the graph.")
    if not checks["outcome_present"]:
        errors.append("Outcome is missing from the graph.")
    if not checks["adjustment_set_variables_exist"]:
        missing = [v for v in adjustment_set if v not in node_ids]
        errors.append(f"Adjustment-set variables are not in the graph: {', '.join(missing)}.")
    if not checks["outcome_not_adjusted_for"]:
        errors.append("The outcome cannot be included in the adjustment set.")
    if not checks["exposure_not_adjusted_for"]:
        errors.append("The exposure cannot be included in the adjustment set.")
    if graph.number_of_nodes() and not nx.is_directed_acyclic_graph(graph):
        errors.append("The graph contains a directed cycle.")

    if not checks["no_id_in_adjustment_set"]:
        warnings.append("Participant ID or grouping variables should not be adjusted for as causal covariates.")
    if not checks["no_timestamp_in_adjustment_set"]:
        warnings.append("Timestamp/context variables in the adjustment set require careful interpretation.")
    if not checks["mediator_adjustment_reviewed"]:
        warnings.append("Mediator or post-treatment variables appear in the adjustment set and require explicit review.")
    if not checks["collider_adjustment_reviewed"]:
        warnings.append("Collider candidates appear in the adjustment set and require explicit review.")
    warnings.extend(_feasibility_warnings(feasibility))
    warnings.extend(_schema_warnings(schema))

    if errors:
        status = "invalid"
    elif warnings:
        status = "requires_review"
    else:
        status = "valid"

    return {
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "safe_to_continue_to_estimation": status != "invalid",
    }


def _build_graph(raw_graph: dict[str, Any]) -> tuple[nx.DiGraph, list[dict[str, Any]], list[dict[str, Any]]]:
    nodes = raw_graph.get("nodes") or []
    edges = raw_graph.get("edges") or []
    graph = nx.DiGraph()
    for node in nodes:
        node_id = _node_id(node)
        if node_id:
            graph.add_node(node_id, **node)
    for edge in edges:
        source = _clean(edge.get("source") or edge.get("from"))
        target = _clean(edge.get("target") or edge.get("to"))
        if source and target:
            graph.add_edge(source, target, **edge)
            if source not in graph:
                graph.add_node(source)
            if target not in graph:
                graph.add_node(target)
    return graph, nodes, edges


def _draft_strategy_with_llm(
    *,
    payload: dict[str, Any],
    deterministic_identification: dict[str, Any],
    estimand: dict[str, Any],
    strategy: dict[str, Any],
    assumption_checklist: list[dict[str, Any]],
) -> dict[str, Any] | None:
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    prompt = {
        "confirmed_question": payload.get("confirmed_question") or "",
        "deterministic_identification": deterministic_identification,
        "estimand_draft": estimand,
        "strategy_draft": strategy,
        "assumption_checklist": assumption_checklist,
        "feasibility_result": _compact_value(payload.get("feasibility_result") or {}, max_items=14),
        "schema_summary": _compact_value(payload.get("schema_summary") or {}, max_items=14),
        "rag_evidence": _compact_evidence(payload.get("rag_evidence") or []),
        "user_feedback": payload.get("user_feedback") or "",
        "locked_decisions": _compact_value(payload.get("locked_decisions") or {}, max_items=10),
        "rules": [
            "Return JSON only.",
            "Do not override deterministic identification status, errors, or warnings.",
            "If deterministic status is not_identified or requires_review, do not claim identified.",
            "Do not calculate treatment effects, estimates, confidence intervals, p-values, or sample results.",
            "Do not say causality is proven.",
            "Draft analysis guidance only.",
        ],
        "response_shape": {
            "estimand": estimand,
            "strategy": strategy,
            "assumption_checklist": assumption_checklist,
            "warnings": ["optional additional caution"],
        },
    }
    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", DEFAULT_MODEL),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You draft Phase 7 identification and analysis-strategy guidance for Causal Design Agent. "
                        "Deterministic backend checks are authoritative. Never produce effect estimates or proof claims."
                    ),
                },
                {"role": "user", "content": json.dumps(prompt, default=str)},
            ],
            temperature=0.15,
        )
        parsed = _extract_json_object(response.choices[0].message.content or "")
        return parsed if parsed else None
    except OpenAIError:
        return None


def _extract_json_object(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(text[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


def _merge_known_keys(base: dict[str, Any], draft: Any) -> dict[str, Any]:
    if not isinstance(draft, dict):
        return base
    merged = dict(base)
    for key in base:
        value = draft.get(key)
        if value not in (None, "", []):
            merged[key] = value
    return merged


def _merge_assumption_checklist(base: list[dict[str, Any]], draft: Any) -> list[dict[str, Any]]:
    if not isinstance(draft, list):
        return base
    by_name = {str(item.get("assumption")): item for item in draft if isinstance(item, dict)}
    merged = []
    for item in base:
        name = str(item.get("assumption"))
        candidate = by_name.get(name)
        if candidate:
            merged_item = dict(item)
            for key in ("status", "rationale", "evidence", "requires_user_review"):
                value = candidate.get(key)
                if value not in (None, "", []):
                    merged_item[key] = value
            merged_item["requires_user_review"] = True
            merged.append(merged_item)
        else:
            merged.append(item)
    return merged


def _compact_value(value: Any, max_items: int = 12) -> Any:
    if isinstance(value, dict):
        return {str(k): _compact_value(v, max_items=max_items) for k, v in list(value.items())[:max_items]}
    if isinstance(value, list):
        return [_compact_value(item, max_items=max_items) for item in value[:max_items]]
    text = str(value)
    return text[:500] if len(text) > 500 else value


def _compact_evidence(rag_evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact = []
    for item in rag_evidence[:5]:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        compact.append({
            "source_filename": item.get("source_filename") or item.get("filename") or metadata.get("source_filename"),
            "page_number": item.get("page_number") or metadata.get("page_number"),
            "chunk_index": item.get("chunk_index") or metadata.get("chunk_index"),
            "snippet": str(item.get("text") or item.get("chunk_text") or item.get("summary") or "")[:500],
        })
    return compact


def _role_map(nodes: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, str]:
    roles: dict[str, str] = {}
    for source in (payload.get("provisional_roles"), payload.get("confirmed_roles")):
        if isinstance(source, dict):
            roles.update({str(k): str(v) for k, v in source.items()})
    for node in nodes:
        node_id = _node_id(node)
        if node_id and node.get("role"):
            roles[node_id] = str(node["role"])
    return roles


def _first_role(nodes: list[dict[str, Any]], role: str) -> str:
    for node in nodes:
        node_role = str(node.get("role") or "").lower()
        if node_role == role:
            return _node_id(node)
    return ""


def _safe_paths(graph: nx.DiGraph, source: str, target: str, limit: int = 10) -> list[list[str]]:
    if not source or not target or source not in graph or target not in graph:
        return []
    try:
        return list(nx.all_simple_paths(graph, source, target, cutoff=6))[:limit]
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return []


def _backdoor_paths(graph: nx.DiGraph, exposure: str, outcome: str) -> list[list[str]]:
    if not exposure or not outcome or exposure not in graph or outcome not in graph:
        return []
    paths: list[list[str]] = []
    for parent in graph.predecessors(exposure):
        if parent == outcome:
            continue
        if nx.has_path(graph, parent, outcome):
            for path in _safe_paths(graph, parent, outcome, limit=4):
                paths.append([exposure, "<-", parent, *path[1:]])
    return paths[:10]


def _recommended_adjustment_set(
    graph: nx.DiGraph,
    roles: dict[str, str],
    exposure: str,
    outcome: str,
    schema: dict[str, Any],
) -> list[str]:
    id_fields = set(_id_fields(schema)) | {"pid", "participant_id", "subject_id", "id"}
    timestamps = set(_timestamp_fields(schema))
    candidates: set[str] = set()
    for variable, role in roles.items():
        role_l = role.lower()
        if "confounder" in role_l or "context" in role_l or "covariate" in role_l:
            candidates.add(variable)
    if exposure in graph and outcome in graph:
        for parent in graph.predecessors(exposure):
            if parent != outcome and nx.has_path(graph, parent, outcome):
                candidates.add(parent)
    return sorted(
        v for v in candidates
        if v
        and v not in {exposure, outcome}
        and not _is_id(v, id_fields)
        and v not in timestamps
        and not _looks_timestamp(v)
        and "mediator" not in roles.get(v, "").lower()
        and "collider" not in roles.get(v, "").lower()
    )


def _variables_not_to_adjust_for(
    graph: nx.DiGraph,
    roles: dict[str, str],
    exposure: str,
    outcome: str,
    schema: dict[str, Any],
) -> list[dict[str, str]]:
    id_fields = set(_id_fields(schema)) | {"pid", "participant_id", "subject_id", "id"}
    timestamps = set(_timestamp_fields(schema))
    reasons: dict[str, set[str]] = defaultdict(set)
    for variable in graph.nodes:
        role = roles.get(variable, "").lower()
        if variable == exposure:
            reasons[variable].add("exposure")
        if variable == outcome:
            reasons[variable].add("outcome")
        if _is_id(variable, id_fields):
            reasons[variable].add("participant/grouping identifier")
        if variable in timestamps or _looks_timestamp(variable):
            reasons[variable].add("timestamp/context field")
        if "mediator" in role or "post" in role:
            reasons[variable].add("mediator or post-treatment variable")
        if "collider" in role:
            reasons[variable].add("collider candidate")
    return [{"variable": variable, "reason": ", ".join(sorted(reason))} for variable, reason in sorted(reasons.items())]


def _estimand(payload: dict[str, Any], exposure: str, outcome: str) -> dict[str, str]:
    comparator = payload.get("comparator") or {}
    time_window = payload.get("time_window") or {}
    locked = payload.get("locked_decisions") or {}
    effect_type = locked.get("effect_type") or payload.get("effect_type") or "total_effect"
    if effect_type == "total":
        effect_type = "total_effect"
    if effect_type == "direct":
        effect_type = "direct_effect"
    comparator_text = comparator.get("treatment") or comparator.get("reference") or "specified exposure contrast"
    time_text = time_window.get("lag") or time_window.get("exposure_window") or "specified temporal window"
    return {
        "label": f"{effect_type.replace('_', ' ').title()} of {exposure or 'exposure'} on {outcome or 'outcome'}",
        "effect_type": effect_type if effect_type in {"total_effect", "direct_effect", "controlled_direct_effect"} else "unknown",
        "population": _population_from_question(payload.get("confirmed_question") or ""),
        "exposure": exposure or "",
        "comparator": str(comparator_text),
        "outcome": outcome or "",
        "time_window": str(time_text),
        "unit_of_analysis": locked.get("unit_of_analysis") or "participant-window observation",
    }


def _strategy(
    payload: dict[str, Any],
    exposure: str,
    outcome: str,
    adjustment_set: list[str],
    schema: dict[str, Any],
    feasibility: dict[str, Any],
) -> dict[str, Any]:
    outcome_l = (outcome or "").lower()
    estimator = "Mixed-effects logistic regression" if outcome_l in {"label", "binary", "event", "alcohol_use_event"} or "label" in outcome_l else "Mixed-effects generalized regression"
    high_missing = _high_missing_columns(schema)
    missing_strategy = (
        f"Plan multiple imputation or a complete-case sensitivity analysis for high-missingness fields: {', '.join(high_missing[:5])}."
        if high_missing
        else "Use complete-case analysis with a documented missingness audit; add imputation if key variables exceed missingness thresholds."
    )
    sensitivity = [
        "Compare primary adjustment set against a reduced set and an expanded set.",
        "Assess robustness to alternative lag windows.",
        "Check overlap/positivity across exposure strata.",
        "Run complete-case versus missing-data sensitivity analysis.",
        "Report that estimates depend on untestable exchangeability assumptions.",
    ]
    robustness = [
        "Cluster or random-intercept handling for repeated participant observations.",
        "Inspect influential participants and sparse exposure strata.",
        "Re-run after excluding variables with severe missingness.",
        "Compare estimator family with GEE if repeated-measures assumptions are uncertain.",
    ]
    if _feasibility_warnings(feasibility):
        robustness.append("Carry Phase 5 feasibility warnings into the analysis report and sensitivity plan.")
    return {
        "estimator_family": estimator,
        "repeated_measures_strategy": "Use participant-level clustering or a random participant intercept because repeated observations are nested within people.",
        "missing_data_strategy": missing_strategy,
        "sensitivity_plan": sensitivity,
        "robustness_checks": robustness,
        "assumptions_to_review": ASSUMPTIONS,
        "adjustment_set_used": adjustment_set,
        "analysis_scope": "Guidance only; no treatment effect is calculated in Phase 7.",
    }


def _assumption_checklist(adjustment_set: list[str], schema: dict[str, Any], feasibility: dict[str, Any], warnings: list[str]) -> list[dict[str, Any]]:
    high_missing = _high_missing_columns(schema)
    checklist = []
    for assumption in ASSUMPTIONS:
        status = "uncertain"
        rationale = "Requires expert review before estimation."
        if assumption == "Temporal ordering":
            rationale = "Exposure, outcome, and lag decisions must be checked against the graph and timestamp fields."
        elif assumption == "Exchangeability / no unmeasured confounding":
            rationale = "The recommended adjustment set is heuristic and cannot rule out unmeasured confounding."
        elif assumption == "Missingness assumptions":
            rationale = f"High missingness was detected in {', '.join(high_missing[:4])}." if high_missing else "No severe missingness was detected in the compact schema summary."
        elif assumption == "No inappropriate collider adjustment":
            status = "supported" if not any("collider" in w.lower() for w in warnings) else "uncertain"
            rationale = "No collider adjustment was detected by the role heuristic." if status == "supported" else "Collider-related warnings require review."
        elif assumption == "No inappropriate post-treatment adjustment":
            status = "supported" if not any("post-treatment" in w.lower() or "mediator" in w.lower() for w in warnings) else "uncertain"
            rationale = "No post-treatment adjustment was detected by the role heuristic." if status == "supported" else "Mediator/post-treatment warnings require review."
        elif assumption == "Positivity":
            rationale = "Use Phase 5 overlap and positivity summaries to confirm sufficient treated/control support."
        checklist.append({
            "assumption": assumption,
            "status": status,
            "rationale": rationale,
            "evidence": _assumption_evidence(assumption, adjustment_set, feasibility),
            "requires_user_review": True,
        })
    return checklist


def _assumption_evidence(assumption: str, adjustment_set: list[str], feasibility: dict[str, Any]) -> list[str]:
    if assumption == "Exchangeability / no unmeasured confounding" and adjustment_set:
        return [f"Candidate adjustment set: {', '.join(adjustment_set)}"]
    if assumption == "Positivity":
        overlap = feasibility.get("overlap_positivity_check") or {}
        if overlap:
            return [str(overlap.get("summary") or overlap.get("status") or overlap)]
    return []


def _next_actions(errors: list[str], warnings: list[str]) -> list[str]:
    if errors:
        return ["Fix blocking graph and variable-selection errors before Phase 8."]
    actions = [
        "Review the recommended adjustment set and remove identifiers, timestamps, mediators, and colliders if present.",
        "Validate the edited adjustment set with the backend before Phase 8.",
        "Document assumptions and unresolved warnings in the final report.",
    ]
    if warnings:
        actions.append("Proceed only after acknowledging that this plan requires expert review.")
    return actions


def _adjustment_warnings(adjustment_set: list[str], roles: dict[str, str], exposure: str, outcome: str, schema: dict[str, Any]) -> list[str]:
    id_fields = set(_id_fields(schema)) | {"pid", "participant_id", "subject_id", "id"}
    timestamps = set(_timestamp_fields(schema))
    warnings: list[str] = []
    for variable in adjustment_set:
        role = roles.get(variable, "").lower()
        if variable == outcome:
            warnings.append(f"{variable} is the outcome and should not be in the adjustment set.")
        if variable == exposure:
            warnings.append(f"{variable} is the exposure and should not be in the adjustment set.")
        if _is_id(variable, id_fields):
            warnings.append(f"{variable} appears to be a participant/grouping ID and should not be adjusted for as a causal covariate.")
        if variable in timestamps or _looks_timestamp(variable):
            warnings.append(f"{variable} appears to be a timestamp/context field and requires careful interpretation if used for adjustment.")
        if "mediator" in role or "post" in role:
            warnings.append(f"{variable} is marked as mediator/post-treatment; adjusting for it can change the estimand.")
        if "collider" in role:
            warnings.append(f"{variable} is marked as a collider candidate and should not be adjusted for without justification.")
    return warnings


def _feasibility_warnings(feasibility: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    for item in feasibility.get("warnings") or []:
        warnings.append(_message(item))
    for item in feasibility.get("blocking_issues") or []:
        warnings.append(_message(item))
    return [w for w in warnings if w]


def _schema_warnings(schema: dict[str, Any]) -> list[str]:
    warnings = [str(w) for w in schema.get("warnings") or [] if w]
    for col in _high_missing_columns(schema):
        warnings.append(f"{col} has high missingness, so a missing-data strategy is required.")
    return warnings


def _high_missing_columns(schema: dict[str, Any], threshold: float = 30.0) -> list[str]:
    pct = schema.get("missing_value_percentage_per_column") or schema.get("missingness_percent") or {}
    result = []
    if isinstance(pct, dict):
        for key, value in pct.items():
            try:
                if float(value) >= threshold:
                    result.append(str(key))
            except (TypeError, ValueError):
                continue
    return result


def _timestamp_fields(schema: dict[str, Any]) -> list[str]:
    fields = schema.get("possible_timestamp_date_columns") or schema.get("possible_timestamp_columns") or []
    return [str(v) for v in fields]


def _id_fields(schema: dict[str, Any]) -> list[str]:
    fields = schema.get("possible_id_columns") or []
    return [str(v) for v in fields]


def _looks_timestamp(value: str) -> bool:
    value_l = value.lower()
    return any(token in value_l for token in ("time", "date", "day", "timestamp"))


def _is_id(value: str, id_fields: set[str]) -> bool:
    value_l = value.lower()
    return value in id_fields or value_l in id_fields or value_l.endswith("_id") or value_l == "pid"


def _population_from_question(question: str) -> str:
    if question.lower().startswith("among "):
        return question.split(",", 1)[0].replace("Among ", "").strip() or "uploaded study population"
    return "uploaded study population"


def _node_id(node: dict[str, Any]) -> str:
    return _clean(node.get("id") or node.get("node_id") or node.get("variable") or node.get("name"))


def _clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _message(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("message") or item.get("summary") or item)
    return str(item)
