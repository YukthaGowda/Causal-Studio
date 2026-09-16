"""Deterministic presentation of recorded review artifacts; never computes estimates."""
import json
from typing import Any

MISSING = "Not yet specified"
BOUNDARY = "This report supports review of an association and workflow configuration, conditional on the selected graph, adjustment set, model, assumptions, diagnostics, and evidence. It does not establish causality and is not clinical decision support. It cannot establish the true graph structure or support clinical prediction, diagnosis, or treatment recommendations."

DISPLAY_TERMS = {
    "not_ready": "Not ready", "not_started": "Not started",
    "review_required": "Requires review", "requires_revision": "Requires revision",
    "not_requested": "Not requested", "initially_plausible": "Initially plausible; requires review",
    "feasible_for_graph_design": "Feasible for graph design",
    "feasible_with_warnings": "Feasible with warnings",
    "ready_for_analysis_planning": "Ready for analysis planning",
    "not_identifiable_with_current_design": "Not identifiable with the current design",
    "identifiable_only_under_additional_assumptions": "Identifiable only under additional assumptions",
    "complete_case": "Complete-case analysis",
    "logistic_regression": "Logistic regression", "linear_regression": "Linear regression",
}


def label(value: str) -> str:
    return value.replace("_", " ").capitalize()


def readable(value: Any) -> str:
    if value is None or value == "" or value == [] or value == {}:
        return MISSING
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, str):
        # Some stored artifacts contain serialized JSON rather than parsed objects.
        # Decode only containers; preserve identifiers, formulas and numeric text.
        if value.strip().startswith(("{", "[")):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, (dict, list)):
                    return readable(parsed)
            except ValueError:
                pass
        return DISPLAY_TERMS.get(value, value)
    if isinstance(value, dict):
        return "; ".join(f"{label(str(k))}: {readable(v)}" for k, v in value.items())
    if isinstance(value, list):
        return "; ".join(readable(v) for v in value)
    return str(value)


def bullets(value: Any) -> str:
    values = value if isinstance(value, list) else [value]
    return "\n".join(f"- {v}" for v in dict.fromkeys(readable(v) for v in values))


def table(headers: list[str], rows: list[list[Any]]) -> str:
    def row(cells):
        return "| " + " | ".join(readable(c).replace("|", "&#124;").replace("\n", " ") for c in cells) + " |"
    return "\n".join([row(headers), row(["---"] * len(headers)), *(row(r) for r in rows)])


def warning_texts(value: Any) -> list[str]:
    """Keep nested safety messages, including targeted-feasibility warnings."""
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if (key in {"warning", "warnings", "limitations", "errors", "error", "issues", "open_issues"} or key.endswith(("_warnings", "_warning"))) and item and not isinstance(item, bool):
                found.extend(readable(v) for v in (item if isinstance(item, list) else [item]))
            elif isinstance(item, (dict, list)):
                found.extend(warning_texts(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(warning_texts(item))
    return list(dict.fromkeys(found))


def format_sections(payload, design, estimate, evidence, consistency, limitations):
    project = payload.get("project") or {}
    p2 = payload.get("phase_2_data_foundation") or {}
    p4 = payload.get("phase_4_question_variables") or {}
    p6 = payload.get("phase_6_graph") or {}
    p7 = payload.get("phase_7_strategy") or {}
    schema = p2.get("schema_summary") or {}
    feasibility = (payload.get("phase_5_feasibility") or {}).get("feasibility_result") or {}
    graph = p6.get("confirmed_graph") or {}
    identification = p7.get("identification_result") or {}
    warnings = list(dict.fromkeys(readable(w) for w in [*consistency, *warning_texts(payload), *estimate.get("warnings", [])]))
    warnings = [readable(w) for w in warnings]
    if estimate.get("warning"):
        warnings.append(estimate["warning"])
    result = (f"The selected run reports an association estimate of {readable(estimate.get('point_estimate'))} between {readable(estimate.get('exposure'))} and {readable(estimate.get('outcome'))}. Interpret its scale using the recorded model and uncertainty below. This result does not prove causality."
              if estimate.get("point_estimate") is not None else "No numerical estimate is available for interpretation.")
    if consistency:
        result = "Interpretation is blocked until the question, graph, adjustment set, and selected run are aligned."
    sections = []
    def add(key, title, content):
        sections.append(dict(section_id=key, title=title, content=content, status="complete", warnings=[], evidence=[]))

    add("executive_summary", "Executive Summary", table(["Item", "Summary"], [
        ["Study objective", design.get("research_objective")], ["Dataset", design.get("dataset_filename")],
        ["Exposure", design.get("exposure")], ["Outcome", design.get("outcome")],
        ["Adjustment variables", design.get("adjustment_set") or "None recorded — requires review"],
        ["Estimation status", estimate.get("status") or "No completed status recorded"],
    ]) + "\n\n" + result + "\n\n" + bullets(warnings[:3] or ["Review all recorded assumptions and limitations before interpretation."]) + "\n\n" + BOUNDARY)
    add("study_context", "Study Context", table(["Item", "Recorded information"], [
        ["Objective", project.get("research_objective")], ["Dataset", project.get("dataset_filename")],
        ["Uploaded documents", project.get("document_status")], ["Knowledge base readiness", project.get("rag_status")],
        ["Linked evidence", evidence.get("summary")], ["Evidence sources", evidence.get("source_filenames")],
    ]) + "\n\n" + evidence["evidence_boundary"])
    exploration = payload.get("phase_3_broad_exploration") or {}
    promoted = exploration.get("promoted_patterns") or []
    if promoted:
        sections[-1]["content"] += "\n\nExploratory patterns selected for review (not causal evidence):\n\n" + bullets([
            (p.get("summary") or p.get("description") or p.get("label") or p.get("title") or "Saved pattern requires researcher review") if isinstance(p, dict) else p
            for p in promoted
        ])
    add("dataset_summary", "Dataset Summary", table(["Item", "Value", "Notes"], [
        ["Rows", schema.get("number_of_rows"), "Recorded dataset size"],
        ["Columns", schema.get("number_of_columns"), "Recorded schema"],
        ["Participants", schema.get("participant_count", (feasibility.get("participant_level_availability") or {}).get("number_of_participants")), "Only reported when available"],
        ["ID columns", schema.get("possible_id_columns"), "Confirm unit of analysis"],
        ["Timestamp columns", schema.get("possible_timestamp_date_columns"), "Confirm temporal ordering"],
        ["Data quality", p2.get("data_quality_summary"), "Review missingness and repeated observations"],
    ]))
    add("causal_question", "Causal Question", readable(design.get("confirmed_question")) + "\n\n" + table(["Element", "Definition"], [[label(k), design.get(k)] for k in ("population", "exposure", "comparator", "outcome", "time_window", "unit_of_analysis")]))
    roles = p4.get("confirmed_roles") or p4.get("candidate_variables") or []
    if isinstance(roles, dict):
        roles = [dict(variable=k, role=v) for k, v in roles.items()]
    add("variable_roles", "Variable Roles", table(["Variable", "Role", "Source", "Meaning", "Missingness / Warning"], [
        [r.get("variable") or r.get("variable_name") or r.get("name") or r.get("id"), r.get("final_role") or r.get("role"), r.get("source"), r.get("descriptive_meaning") or r.get("meaning") or r.get("description") or r.get("definition"), r.get("warnings") or r.get("warning") or (f"{r['missing_percentage']}% missing" if r.get("missing_percentage") is not None else None)]
        for r in roles if isinstance(r, dict)
    ]) if roles else "Variable roles are not yet specified.")
    checks = [("Exposure availability", "exposure_feasibility"), ("Outcome availability", "outcome_feasibility"), ("Missingness", "missingness_and_coverage_summary"), ("Participant coverage", "participant_level_availability"), ("Temporal / lag review", "lag_feasibility"), ("Positivity / overlap", "overlap_or_comparator_summary")]
    add("feasibility", "Feasibility Summary", table(["Check", "Status", "Key finding", "Action needed"], [
        [name, (feasibility.get(key) or {}).get("status", "Requires review") if isinstance(feasibility.get(key), dict) else "Requires review", feasibility.get(key), "Review recorded findings"] for name, key in checks
    ] + [["Safe to continue", feasibility.get("safe_to_continue_to_graph", feasibility.get("safe_to_continue")), feasibility.get("feasibility_status"), feasibility.get("recommended_revision_actions")]]))
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    add("causal_graph", "Causal Graph Summary", table(["Item", "Finding"], [
        ["Graph type", graph.get("graph_type")], ["Nodes and roles", [{"variable": n.get("label") or n.get("id"), "role": n.get("role")} if isinstance(n, dict) else n for n in nodes]],
        ["Edges", len(edges) if graph else None], ["Validation", p6.get("graph_validation_result")], ["Expert review", "Required; graph arrows represent assumptions"],
    ]) + "\n\n" + table(["From", "To", "Edge status", "Notes"], [[e.get("source") or e.get("from"), e.get("target") or e.get("to"), e.get("status") or e.get("type"), e.get("notes") or e.get("rationale")] for e in edges if isinstance(e, dict)]))
    add("identification", "Identification and Adjustment Summary", "Formal identification is not fully implemented; this result requires expert review.\n\n" + table(["Item", "Finding"], [
        ["Identification status", identification.get("identification_status") or identification.get("status")],
        ["Summary", identification.get("plain_language_summary")], ["Structural issues", identification.get("open_issues")],
        ["Required assumptions", identification.get("assumptions_required")], ["Adjustment set", design.get("adjustment_set") or "None recorded — requires review"],
        ["Do not adjust for", identification.get("variables_not_to_adjust_for") or "Review mediators and colliders with an expert"],
        ["Strategy and assumptions", p7.get("strategy")], ["Assumption checklist", p7.get("assumption_checklist")],
    ]))
    add("selected_estimation", "Estimation Result", table(["Field", "Value"], [[name, estimate.get(key)] for name, key in [
        ("Model type", "model_type"), ("Formula", "formula"), ("Exposure", "exposure"), ("Outcome", "outcome"), ("Adjustment set", "adjustment_set"), ("Sample size", "sample_size"), ("Point estimate", "point_estimate"), ("Standard error", "standard_error"), ("95% CI", "confidence_interval"), ("p-value", "p_value"), ("Status", "status"),
    ]]) + "\n\n" + result)
    if estimate.get("provenance"):
        provenance = estimate["provenance"]
        sections[-1]["content"] += "\n\n" + table(["Provenance", "Recorded value"], [
            ["Selected run", estimate.get("run_id")],
            *[[label(k), provenance[k]] for k in ("dataset_filename", "input_dataset_version", "timestamp", "estimator", "random_seed") if k in provenance],
        ])
    groups = {name: [] for name in ("Data quality", "Temporal / lag", "Repeated measures", "Model / estimation", "Causal validity", "Evidence / RAG")}
    for warning in warnings:
        low = warning.lower()
        group = next((name for name, terms in [("Evidence / RAG", ("rag", "document", "evidence")), ("Repeated measures", ("repeated", "participant", "cluster")), ("Temporal / lag", ("lag", "temporal", "timestamp", "window")), ("Data quality", ("missing", "complete-case", "coverage")), ("Causal validity", ("causal", "graph", "confound", "adjustment", "align"))] if any(t in low for t in terms)), "Model / estimation")
        groups[group].append(warning)
    add("diagnostics", "Diagnostics and Warnings", "\n\n".join(f"### {name}\n\n{bullets(items) if items else 'No warnings supplied in this category.'}" for name, items in groups.items()) + "\n\n" + table(["Diagnostic", "Recorded value"], [[label(k), v] for k, v in (estimate.get("diagnostics") or {}).items() if "warning" not in k]))
    add("limitations", "Limitations", bullets(limitations + (["Exact temporal window / lag requires confirmation."] if not design.get("time_window") else [])))
    add("claim_boundaries", "Claim Boundaries", BOUNDARY + ("\n\n" + bullets(consistency) if consistency else ""))
    steps = ["Confirm temporal ordering and the exact window / lag.", "Review the graph and adjustment set with an expert."]
    if any("participant" in w.lower() or "repeated" in w.lower() for w in warnings):
        steps.append("Review participant imbalance and repeated-measures handling.")
    if any("sensitivity" in readable(w).lower() or "placeholder" in readable(w).lower() for w in limitations + warnings):
        steps.append("Complete sensitivity checks when implemented; placeholders are not validation results.")
    steps.extend(feasibility.get("recommended_revision_actions") or [])
    add("next_steps", "Recommended Next Steps", bullets(steps))
    if payload.get("user_notes"):
        add("user_notes", "Researcher Notes", readable(payload["user_notes"]))
    return sections, warnings, result
