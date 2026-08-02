from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from typing import Any


SAFE_LANGUAGE_SUGGESTIONS = [
    "under the specified model and assumptions",
    "conditional on the selected graph and adjustment set",
    "evidence-informed but not definitive",
    "exploratory association",
    "requires expert review",
    "not sufficient to establish causal proof",
    "limited by missingness, measurement, and overlap concerns",
]

BLOCKED_PATTERNS = [
    ("proves causality", "unsupported_causal_wording", "blocking", "Do not describe the design or estimate as causal proof."),
    ("proves", "unsupported_causal_wording", "blocking", "Do not describe the design or estimate as proof."),
    ("proven", "unsupported_causal_wording", "blocking", "Do not describe the design or estimate as proven."),
    ("confirms causality", "unsupported_causal_wording", "blocking", "Use conditional causal-design language instead of confirmation language."),
    ("caused relapse", "unsupported_generalization", "blocking", "Relapse claims are clinical/predictive claims outside this support tool."),
    ("predicts relapse clinically", "unsupported_generalization", "blocking", "Clinical prediction language is outside this workflow."),
    ("guarantees", "overstated_evidence", "blocking", "No design or model can guarantee an outcome."),
    ("definitive causal effect", "overstated_evidence", "blocking", "The estimate is conditional on assumptions and diagnostics."),
    ("true causal structure", "unsupported_causal_wording", "blocking", "The graph is a reviewed design assumption, not the true structure."),
    ("clinically actionable recommendation", "unsupported_generalization", "blocking", "This tool does not provide clinical action recommendations."),
    ("treatment recommendation", "unsupported_generalization", "blocking", "This tool is not a treatment-decision system."),
]

CAUSAL_WORDS = ["causes", "caused", "cause of", "leads to", "results in"]


class ReviewExportError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _first_present(*values: Any, default: Any = None) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return default


def _text(value: Any, fallback: str = "Not provided.") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        return value.strip() or fallback
    if isinstance(value, dict):
        for key in ("question_text", "question", "summary", "title", "label", "status"):
            if value.get(key):
                return str(value[key])
    return str(value)


def _status_for(value: Any, warning: bool = False) -> str:
    if value in (None, "", [], {}):
        return "missing"
    return "warning" if warning else "complete"


def _selected_estimation_summary(run: dict[str, Any] | None) -> dict[str, Any]:
    if not run:
        return {
            "available": False,
            "warning": "No selected primary estimation run is available. This export is a design-only draft, not a complete design and analysis package.",
        }
    raw = run.get("raw") if isinstance(run, dict) else None
    source = raw if isinstance(raw, dict) else run
    primary = source.get("primary_result") or source.get("results") or source.get("estimate") or {}
    diagnostics = source.get("diagnostics") or primary.get("diagnostics") or {}
    provenance = source.get("provenance") or source.get("reproducibility") or {}
    config = source.get("config") or {}
    return {
        "available": True,
        "run_id": _first_present(source.get("run_id"), source.get("id"), run.get("id")),
        "run_label": _first_present(source.get("run_label"), run.get("label"), default="Selected primary run"),
        "status": source.get("status"),
        "model_type": _first_present(source.get("model_type"), primary.get("model_type"), config.get("estimator")),
        "formula": source.get("formula"),
        "estimand_label": _first_present(source.get("estimand_label"), primary.get("estimandLabel"), primary.get("estimand")),
        "exposure": _first_present(primary.get("exposure"), config.get("exposure")),
        "outcome": _first_present(primary.get("outcome"), config.get("outcome")),
        "point_estimate": _first_present(primary.get("point_estimate"), primary.get("pointEstimate")),
        "standard_error": _first_present(primary.get("standard_error"), primary.get("se")),
        "confidence_interval": _first_present(
            primary.get("confidence_interval"),
            [primary.get("ciLower"), primary.get("ciUpper")] if primary.get("ciLower") is not None or primary.get("ciUpper") is not None else None,
        ),
        "p_value": _first_present(primary.get("p_value"), primary.get("pValue")),
        "sample_size": _first_present(primary.get("sample_size"), primary.get("n")),
        "diagnostics": diagnostics,
        "warnings": [
            *(_as_list(source.get("warnings"))),
            *(_as_list(diagnostics.get("model_warnings"))),
            *(_as_list(diagnostics.get("data_warnings"))),
        ],
        "limitations": _as_list(source.get("limitations")),
        "provenance": provenance,
    }


def _evidence_summary(rag_evidence: list[Any]) -> dict[str, Any]:
    sources = []
    for item in rag_evidence:
        if not isinstance(item, dict):
            continue
        source = _first_present(
            item.get("source_filename"),
            item.get("filename"),
            (item.get("metadata") or {}).get("source_filename") if isinstance(item.get("metadata"), dict) else None,
        )
        if source:
            sources.append(str(source))
    unique_sources = sorted(set(sources))
    return {
        "evidence_item_count": len(rag_evidence),
        "source_filenames": unique_sources,
        "summary": (
            f"{len(rag_evidence)} evidence item(s) linked from {len(unique_sources)} source file(s)."
            if rag_evidence
            else "No RAG evidence was linked to this review package."
        ),
        "evidence_boundary": "Evidence snippets support design reasoning and limitations; they do not prove causal claims.",
    }


def _collect_unresolved_warnings(payload: dict[str, Any], estimation_summary: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    warnings.extend(_as_list((payload.get("phase_2_data_foundation") or {}).get("data_quality_summary", {}).get("warnings")))
    warnings.extend(_as_list((payload.get("phase_3_broad_exploration") or {}).get("exploration_warnings")))
    warnings.extend(_as_list((payload.get("phase_5_feasibility") or {}).get("feasibility_result", {}).get("warnings")))
    warnings.extend(_as_list((payload.get("phase_6_graph") or {}).get("graph_validation_result", {}).get("warnings")))
    warnings.extend(_as_list((payload.get("phase_7_strategy") or {}).get("identification_result", {}).get("warnings")))
    warnings.extend(_as_list(estimation_summary.get("warnings")))
    if not estimation_summary.get("available"):
        warnings.append(estimation_summary["warning"])
    return [str(item) for item in warnings if item]


def _unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value).strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def _section(section_id: str, title: str, content: str, status: str = "complete", warnings: list[str] | None = None, evidence: list[Any] | None = None) -> dict[str, Any]:
    return {
        "section_id": section_id,
        "title": title,
        "content": content,
        "status": status,
        "warnings": warnings or [],
        "supporting_evidence": evidence or [],
    }


def assemble_review_package(payload: dict[str, Any]) -> dict[str, Any]:
    project = payload.get("project") or {}
    p2 = payload.get("phase_2_data_foundation") or {}
    p3 = payload.get("phase_3_broad_exploration") or {}
    p4 = payload.get("phase_4_question_variables") or {}
    p5 = payload.get("phase_5_feasibility") or {}
    p6 = payload.get("phase_6_graph") or {}
    p7 = payload.get("phase_7_strategy") or {}
    p8 = payload.get("phase_8_estimation") or {}
    preferences = payload.get("report_preferences") or {}
    rag_evidence = _as_list(payload.get("rag_evidence"))

    confirmed_question = p4.get("confirmed_question") or {}
    final_question_text = _text(confirmed_question, fallback="")
    estimation_summary = _selected_estimation_summary(p8.get("selected_primary_run"))
    evidence_summary = _evidence_summary(rag_evidence)
    unresolved_warnings = _collect_unresolved_warnings(payload, estimation_summary)

    graph = p6.get("confirmed_graph") or {}
    graph_validation = p6.get("graph_validation_result") or {}
    identification = p7.get("identification_result") or {}
    strategy = p7.get("strategy") or {}
    estimand = p7.get("estimand") or {}
    adjustment_set = _as_list(p7.get("adjustment_set"))
    assumptions = _as_list(p7.get("assumption_checklist"))
    schema = p2.get("schema_summary") or {}
    feasibility = p5.get("feasibility_result") or {}

    missing_required = []
    if not final_question_text:
        missing_required.append("confirmed_question")
    if not graph:
        missing_required.append("confirmed_graph")
    if not strategy:
        missing_required.append("analysis_strategy")
    if not estimation_summary.get("available"):
        missing_required.append("selected_primary_estimation_run")
    if unresolved_warnings and not preferences.get("unresolved_warnings_acknowledged", False):
        missing_required.append("unresolved_warnings_acknowledged")

    limitations = [
        "This package supports review and reporting. It does not prove causality.",
        "Claims must remain conditional on the selected design, assumptions, diagnostics, and evidence.",
        "Exploratory patterns do not establish causality.",
        *(_as_list(feasibility.get("limitations"))),
        *(_as_list(strategy.get("limitations"))),
        *(_as_list(estimation_summary.get("limitations"))),
    ]

    final_design_summary = {
        "project_title": project.get("title") or "Causal Design Agent Review Package",
        "research_objective": project.get("research_objective"),
        "dataset_filename": project.get("dataset_filename"),
        "confirmed_question": final_question_text,
        "population": _first_present(confirmed_question.get("population") if isinstance(confirmed_question, dict) else None, strategy.get("population")),
        "exposure": _first_present(confirmed_question.get("exposure") if isinstance(confirmed_question, dict) else None, estimation_summary.get("exposure")),
        "comparator": _first_present(confirmed_question.get("comparator") if isinstance(confirmed_question, dict) else None, strategy.get("comparator")),
        "outcome": _first_present(confirmed_question.get("outcome") if isinstance(confirmed_question, dict) else None, estimation_summary.get("outcome")),
        "time_window": _first_present(confirmed_question.get("time_window") if isinstance(confirmed_question, dict) else None, strategy.get("time_window")),
        "unit_of_analysis": _first_present(confirmed_question.get("unit_of_analysis") if isinstance(confirmed_question, dict) else None, strategy.get("unit_of_analysis")),
        "adjustment_set": adjustment_set,
    }

    sections = [
        _section("project_context", "Project context", f"Objective: {_text(project.get('research_objective'))}\nDataset: {_text(project.get('dataset_filename'))}", _status_for(project.get("research_objective"))),
        _section("uploaded_materials", "Uploaded materials and evidence readiness", f"Document status: {json.dumps(project.get('document_status') or {}, default=str)}\nRAG status: {json.dumps(project.get('rag_status') or {}, default=str)}", "complete"),
        _section("dataset_foundation", "Dataset foundation summary", f"Rows: {schema.get('number_of_rows', 'not available')}; columns: {schema.get('number_of_columns', 'not available')}; ID columns: {schema.get('possible_id_columns', [])}; timestamp columns: {schema.get('possible_timestamp_date_columns', [])}.", _status_for(schema)),
        _section("broad_exploration", "Broad exploration summary", _text(p3.get("promoted_patterns") or p3.get("saved_views"), "No broad exploration summary was provided."), _status_for(p3)),
        _section("final_research_question", "Final research question", final_question_text or "No confirmed question is available.", _status_for(final_question_text)),
        _section("pecot", "Population, exposure, comparator, outcome, and time window", json.dumps(final_design_summary, indent=2, default=str), _status_for(final_question_text)),
        _section("feasibility", "Data-feasibility summary", json.dumps(feasibility or {"status": "not provided"}, indent=2, default=str), _status_for(feasibility, bool(feasibility.get("warnings")) if isinstance(feasibility, dict) else False)),
        _section("role_table", "Final variable-role table", json.dumps(p4.get("confirmed_roles") or p4.get("candidate_variables") or [], indent=2, default=str), _status_for(p4.get("confirmed_roles") or p4.get("candidate_variables"))),
        _section("causal_graph", "Confirmed causal graph and alternative graphs", json.dumps({"confirmed_graph": graph, "alternative_graphs": p6.get("alternative_graphs") or []}, indent=2, default=str), _status_for(graph)),
        _section("graph_validation", "Graph validation summary", json.dumps(graph_validation or {"status": "not provided"}, indent=2, default=str), _status_for(graph_validation)),
        _section("identification", "Identification result", json.dumps(identification or {"status": "not provided"}, indent=2, default=str), _status_for(identification)),
        _section("adjustment_estimand", "Adjustment set and estimand", json.dumps({"adjustment_set": adjustment_set, "estimand": estimand}, indent=2, default=str), _status_for(adjustment_set or estimand)),
        _section("strategy_assumptions", "Analysis strategy and assumptions", json.dumps({"strategy": strategy, "assumptions": assumptions}, indent=2, default=str), _status_for(strategy)),
        _section("selected_estimation", "Selected primary estimation run", json.dumps(estimation_summary, indent=2, default=str), _status_for(estimation_summary.get("available")), [estimation_summary.get("warning")] if not estimation_summary.get("available") else []),
        _section("estimate_diagnostics", "Estimate, uncertainty, diagnostics, and sensitivity results", json.dumps({"estimate": estimation_summary, "diagnostics": estimation_summary.get("diagnostics"), "sensitivity_results": (p8.get("selected_primary_run") or {}).get("sensitivity_results")}, indent=2, default=str), _status_for(estimation_summary.get("available"), bool(estimation_summary.get("warnings")))),
        _section("rag_evidence", "RAG evidence summary", evidence_summary["summary"], _status_for(rag_evidence), evidence=evidence_summary.get("source_filenames")),
        _section("evidence_limitations", "Evidence limitations", evidence_summary["evidence_boundary"], "warning" if not rag_evidence else "complete"),
        _section("unresolved_warnings", "Unresolved warnings", "\n".join(unresolved_warnings) if unresolved_warnings else "No unresolved warnings were supplied.", "warning" if unresolved_warnings else "complete", unresolved_warnings),
        _section("claim_boundaries", "What can and cannot be claimed", "Can claim: conditional design and estimation summaries.\nCannot claim: causal proof, true graph structure, clinical prediction, diagnosis, or treatment recommendations.", "complete"),
        _section("reproducibility", "Reproducibility and provenance", json.dumps(estimation_summary.get("provenance") or {}, indent=2, default=str), _status_for(estimation_summary.get("provenance"))),
        _section("user_notes", "User notes and review history", _text(payload.get("user_notes"), "No user notes provided."), "complete"),
    ]

    if not preferences.get("include_appendix", True):
        sections = [section for section in sections if section["section_id"] not in {"reproducibility"}]
    if not preferences.get("include_evidence_table", True):
        sections = [section for section in sections if section["section_id"] != "rag_evidence"]

    blocking_required = [
        item
        for item in missing_required
        if item != "selected_primary_estimation_run"
    ]
    ready_for_export = not blocking_required
    status = "success" if ready_for_export else "fallback"

    return {
        "status": status,
        "package_title": f"{final_design_summary['project_title']} - Review and Export Package",
        "executive_summary": (
            "This package assembles the final causal design, evidence review, selected estimation run, diagnostics, "
            "limitations, and claim boundaries. It is conditional on the selected data, model, graph, assumptions, and evidence."
        ),
        "sections": sections,
        "final_design_summary": final_design_summary,
        "selected_estimation_summary": estimation_summary,
        "evidence_summary": evidence_summary,
        "unresolved_warnings": _unique_strings(unresolved_warnings),
        "limitations": _unique_strings(limitations),
        "missing_required_items": _unique_strings(missing_required),
        "ready_for_export": ready_for_export,
        "requires_user_review": True,
    }


def audit_claim_text(payload: dict[str, Any]) -> dict[str, Any]:
    report_text = str(payload.get("report_text") or "")
    final_design = payload.get("final_design_summary") or {}
    selected_estimation = payload.get("selected_estimation_summary") or {}
    assumptions = _as_list(payload.get("assumption_checklist"))
    unresolved = _as_list(payload.get("unresolved_warnings"))
    flagged = []
    blocked_phrases = []
    lowered = report_text.lower()

    for phrase, issue_type, severity, explanation in BLOCKED_PATTERNS:
        if phrase in lowered:
            blocked_phrases.append(phrase)
            flagged.append(
                {
                    "text": phrase,
                    "issue_type": issue_type,
                    "severity": severity,
                    "explanation": explanation,
                    "suggested_revision": "Revise to say the result is conditional on the selected graph, adjustment set, model, assumptions, diagnostics, and evidence.",
                }
            )

    for word in CAUSAL_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", lowered):
            flagged.append(
                {
                    "text": word,
                    "issue_type": "association_as_causation",
                    "severity": "medium",
                    "explanation": "Direct causal wording must be bounded by assumptions, graph, diagnostics, and evidence.",
                    "suggested_revision": "Use 'is associated with under the specified model and assumptions' unless the full design explicitly supports stronger conditional language.",
                }
            )

    if selected_estimation and selected_estimation.get("available") and "conditional on" not in lowered and "under the specified" not in lowered:
        flagged.append(
            {
                "text": "estimate language",
                "issue_type": "missing_limitation",
                "severity": "medium",
                "explanation": "The estimate is presented without a conditional interpretation boundary.",
                "suggested_revision": "Add 'under the specified model and assumptions' near the estimate.",
            }
        )

    if unresolved and not any(term in lowered for term in ["limitation", "warning", "missingness", "diagnostic"]):
        flagged.append(
            {
                "text": "unresolved warnings",
                "issue_type": "missing_limitation",
                "severity": "high",
                "explanation": "Unresolved warnings exist but are not discussed in the report text.",
                "suggested_revision": "Add a limitations paragraph describing unresolved warnings and required user review.",
            }
        )

    if assumptions and "assumption" not in lowered:
        flagged.append(
            {
                "text": "assumptions",
                "issue_type": "unresolved_assumption",
                "severity": "medium",
                "explanation": "The report should state that claims are conditional on reviewed assumptions.",
                "suggested_revision": "Add a sentence that causal interpretation depends on the selected assumptions.",
            }
        )

    if final_design.get("population") and "all adults" in lowered:
        flagged.append(
            {
                "text": "all adults",
                "issue_type": "unsupported_generalization",
                "severity": "high",
                "explanation": "The text may generalize beyond the uploaded study population.",
                "suggested_revision": "Limit wording to the uploaded study dataset and described population.",
            }
        )

    blocking = any(item["severity"] == "blocking" for item in flagged)
    warning = bool(flagged)
    return {
        "status": "fail" if blocking else "warning" if warning else "pass",
        "flagged_claims": flagged,
        "blocked_phrases": blocked_phrases,
        "safe_language_suggestions": SAFE_LANGUAGE_SUGGESTIONS,
        "ready_for_export": not blocking,
    }


def _markdown_for_package(package: dict[str, Any], include_appendix: bool = True, include_reproducibility: bool = True) -> str:
    lines = [
        f"# {package.get('package_title') or 'Causal Design Agent Review Package'}",
        "",
        package.get("executive_summary") or "",
        "",
        "> This package supports review and reporting. It does not prove causality.",
        "",
    ]
    for section in package.get("sections", []):
        if not include_reproducibility and section.get("section_id") == "reproducibility":
            continue
        lines.extend([
            f"## {section.get('title')}",
            "",
            str(section.get("content") or ""),
            "",
        ])
        if section.get("warnings"):
            lines.append("Warnings:")
            for warning in section["warnings"]:
                lines.append(f"- {warning}")
            lines.append("")
    if include_appendix:
        lines.extend([
            "## Appendix: Safety Boundary",
            "",
            "Numerical results must come from backend-computed Phase 8 outputs. Claims must remain conditional on the selected data, graph, adjustment set, model, assumptions, diagnostics, and evidence.",
            "",
        ])
    return "\n".join(lines)


def export_review_package(payload: dict[str, Any]) -> dict[str, Any]:
    package = payload.get("assembled_package") or {}
    audit = payload.get("claim_audit_result") or {}
    export_format = (payload.get("format") or "json").lower()
    warnings = []
    if export_format not in {"json", "markdown"}:
        return {
            "status": "error",
            "export_format": export_format,
            "filename": "",
            "content": "",
            "warnings": ["Only JSON and Markdown export are implemented in this proof of concept."],
        }
    if not package:
        raise ReviewExportError("assembled_package is required.")
    if not package.get("ready_for_export"):
        warnings.append("Package has missing required items. Export is a draft only.")
    if "selected_primary_estimation_run" in package.get("missing_required_items", []):
        warnings.append("No selected primary estimation run is available. This export is a design-only draft, not a complete design and analysis package.")
    if audit.get("status") == "fail" or any(item.get("severity") == "blocking" for item in audit.get("flagged_claims", [])):
        warnings.append("Claim audit has blocking issues. Export content is returned for revision only.")
    if package.get("unresolved_warnings"):
        warnings.append("Unresolved warnings remain and must be acknowledged before external use.")
    if audit.get("status") in (None, "", "not_run"):
        warnings.append("Run claim audit before export.")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    if export_format == "json":
        content = json.dumps({"assembled_package": package, "claim_audit_result": audit}, indent=2, default=str)
        filename = f"causal_design_agent_review_export_{timestamp}.json"
    else:
        content = _markdown_for_package(
            package,
            include_appendix=bool(payload.get("include_appendix", True)),
            include_reproducibility=bool(payload.get("include_reproducibility", True)),
        )
        filename = f"causal_design_agent_review_export_{timestamp}.md"

    return {
        "status": "success",
        "export_format": export_format,
        "filename": filename,
        "content": content,
        "warnings": warnings,
    }
