from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from app.core.langsmith_tracing import compact_value, record_trace_event, summarize_sources
from app.services.causal_questions import DEFAULT_MODEL, format_openai_error


SUPPORTED_PHASES = {
    "phase_1_project_setup",
    "phase_2_data_foundation",
    "phase_3_broad_exploration",
    "phase_4_question_variables",
    "phase_5_feasibility",
    "phase_6_causal_graph",
    "phase_7_analysis_strategy",
    "phase_8_estimation",
    "phase_9_review_export",
}

SUPPORTED_ACTIONS = {
    "interpret",
    "explain_warning",
    "regenerate",
    "generate_alternative",
    "reprocess_with_feedback",
    "revise_using_my_changes",
    "summarize",
    "recommend_next_action",
}

PHASE_GUIDANCE = {
    "phase_1_project_setup": (
        "Interpret uploaded files, ingestion status, missing documents, and project readiness. "
        "Do not perform causal analysis."
    ),
    "phase_2_data_foundation": (
        "Explain schema, missingness, ID fields, timestamps, data quality, and ambiguous variables. "
        "Do not assign final causal roles."
    ),
    "phase_3_broad_exploration": (
        "Explain Python-generated exploration output. Emphasize that exploratory patterns do not establish causality."
    ),
    "phase_4_question_variables": (
        "Interpret candidate questions and provisional variables. Regenerate using schema, RAG evidence, and user feedback only."
    ),
    "phase_5_feasibility": (
        "Explain feasibility checks and warnings. Reprocess only from provided exposure, outcome, comparator, time window, and variables."
    ),
    "phase_6_causal_graph": (
        "Interpret graph, selected node, selected edge, validation results, and chain/fork/collider/backdoor logic. "
        "Do not decide graph validity independently."
    ),
    "phase_7_analysis_strategy": (
        "Interpret deterministic identification results, adjustment set, estimand, assumptions, and strategy. "
        "Do not claim identification unless backend state confirms it."
    ),
    "phase_8_estimation": (
        "Interpret computed estimates and diagnostics only if values already exist in page_state. "
        "Never create point estimates, standard errors, confidence intervals, or p-values."
    ),
    "phase_9_review_export": (
        "Explain claim audit, report sections, missing evidence, and blocked wording."
    ),
}


class AssistantActionError(RuntimeError):
    pass


def _summarize_page_state(phase: str, page_state: dict[str, Any]) -> str:
    def _format_bool(value: Any) -> str:
        return "yes" if bool(value) else "no"

    def _format_count(value: Any) -> str:
        if isinstance(value, list):
            return str(len(value))
        if isinstance(value, int):
            return str(value)
        return "0"

    if phase == "phase_2_data_foundation":
        rows = page_state.get("rows") or page_state.get("number_of_rows")
        columns = page_state.get("columns") or page_state.get("number_of_columns")
        ids = page_state.get("possible_id_columns") or []
        timestamps = page_state.get("possible_timestamp_columns") or page_state.get(
            "possible_timestamp_date_columns"
        ) or []
        high_missing = page_state.get("high_missingness") or page_state.get(
            "high_missingness_columns"
        ) or []
        parts = []
        if rows is not None and columns is not None:
            parts.append(f"The dataset has {rows} rows and {columns} columns.")
        if ids:
            parts.append(f"Possible ID field(s): {', '.join(map(str, ids))}.")
        if timestamps:
            parts.append(f"Possible timestamp/context field(s): {', '.join(map(str, timestamps))}.")
        if high_missing:
            formatted = []
            for item in high_missing[:5]:
                column = item.get("column") if isinstance(item, dict) else str(item)
                pct = (
                    item.get("missing_percent")
                    or item.get("missing_percentage")
                    if isinstance(item, dict)
                    else None
                )
                formatted.append(f"{column}{f' ({pct}% missing)' if pct is not None else ''}")
            parts.append(f"High missingness to review: {', '.join(formatted)}.")
        parts.append("Phase 2 explains data structure and quality; it does not assign final causal roles.")
        return " ".join(parts)

    if phase == "phase_3_broad_exploration":
        rows = page_state.get("number_of_rows") or page_state.get("rows")
        columns = page_state.get("number_of_columns") or page_state.get("columns")
        warnings = page_state.get("data_quality_warnings") or []
        caution = page_state.get("exploration_warning") or (
            "Exploratory patterns can support hypothesis generation, but they do not establish causality."
        )
        return (
            f"Python broad exploration returned {rows or 'unknown'} rows and {columns or 'unknown'} columns, "
            f"with {len(warnings)} warning(s). {caution}"
        )

    if phase == "phase_4_question_variables":
        question = page_state.get("selected_question") or page_state.get("confirmed_question") or {}
        if isinstance(question, str):
            question_text = question
        else:
            question_text = question.get("question") or "not yet confirmed"
        exposure = page_state.get("selected_exposure") or (question.get("exposure") if isinstance(question, dict) else None) or "not selected"
        outcome = page_state.get("selected_outcome") or (question.get("outcome") if isinstance(question, dict) else None) or "not selected"
        covariates = page_state.get("selected_covariates") or []
        study_mode = page_state.get("study_mode") or {}
        parts = [
            f"Phase 4 is for reviewing the research question and variable roles.",
            f"Current question: {question_text}.",
            f"Exposure: {exposure}. Outcome: {outcome}.",
            f"Selected candidate confounders: {', '.join(map(str, covariates)) or 'none'}.",
        ]
        if study_mode:
            parts.append("The approved BDE workspace is loaded: prepared drafts are editable and must be confirmed before downstream use.")
        parts.append("Confirm the question and review variable roles before feasibility; this does not establish a causal claim.")
        return " ".join(parts)

    if phase == "phase_5_feasibility":
        result = page_state.get("targeted_feasibility_result") or {}
        status = result.get("status") or page_state.get("feasibility_status") or "not run"
        warnings = result.get("warnings") or page_state.get("warnings") or []
        blocking = result.get("blocking_issues") or page_state.get("blocking_issues") or []
        revisions = result.get("recommended_revisions") or page_state.get("recommended_revisions") or []
        sample = result.get("analysis_ready_sample_check") or {}
        complete_cases = (
            sample.get("complete_case_rows_for_exposure_outcome_and_selected")
            or sample.get("complete_case_rows_for_selected_variables")
        )
        parts = [
            f"Phase 5 feasibility status: {str(status).replace('_', ' ')}.",
            f"Python returned {len(warnings)} warning(s) and {len(blocking)} blocking issue(s).",
        ]
        if complete_cases is not None:
            parts.append(f"Analysis-ready complete-case rows: {complete_cases}.")
        if blocking:
            parts.append("Blocking issues should be resolved before graph design.")
        elif status == "marginal":
            parts.append("This can proceed only if limitations are explicitly accepted.")
        elif status == "ready":
            parts.append("Ready to proceed to graph design after user review.")
        if revisions:
            parts.append(f"Recommended revisions: {' '.join(map(str, revisions[:4]))}")
        parts.append("These feasibility diagnostics do not establish causality or estimate an effect.")
        return " ".join(parts)

    if phase == "phase_6_causal_graph":
        graph = page_state.get("current_graph") or {}
        nodes = graph.get("nodes") or page_state.get("graph_nodes") or []
        edges = graph.get("edges") or page_state.get("graph_edges") or []
        validation = page_state.get("validation_result") or page_state.get("graph_validation_result") or {}
        selected_node = page_state.get("selected_node")
        selected_edge = page_state.get("selected_edge")
        status = validation.get("status") or "not validated"
        errors = validation.get("errors") or []
        warnings = validation.get("warnings") or []
        graph_type = graph.get("graph_type") or page_state.get("graph_type") or "DAG"
        parts = [
            f"Phase 6 graph status: {graph_type} with {len(nodes)} node(s) and {len(edges)} edge(s).",
            f"Deterministic validation status: {str(status).replace('_', ' ')} with {len(errors)} error(s) and {len(warnings)} warning(s).",
        ]
        if selected_node:
            node_id = selected_node.get("id") if isinstance(selected_node, dict) else str(selected_node)
            parts.append(f"Selected node: {node_id}. Review its role, timing, measurement meaning, and missingness before confirming.")
        if selected_edge:
            if isinstance(selected_edge, dict):
                source = selected_edge.get("source") or selected_edge.get("from")
                target = selected_edge.get("target") or selected_edge.get("to")
                confidence = selected_edge.get("confidence") or selected_edge.get("type") or "uncertain"
                parts.append(f"Selected edge: {source} -> {target}, marked {confidence}. Treat this as an assumption until reviewed.")
        if errors:
            parts.append(f"Blocking graph issues: {' '.join(map(str, errors[:4]))}")
        elif warnings:
            parts.append(f"Warnings to document before continuing: {' '.join(map(str, warnings[:4]))}")
        parts.append(
            "Graph edges are assumptions, not proven causal relationships. The assistant can explain alternatives, but backend validation is the source of truth."
        )
        return " ".join(parts)

    if phase == "phase_7_analysis_strategy":
        identification = page_state.get("identification_result") or {}
        validation = page_state.get("analysis_strategy_validation") or {}
        adjustment_set = page_state.get("adjustment_set") or []
        estimand = page_state.get("estimand") or {}
        strategy = page_state.get("strategy") or {}
        assumptions = page_state.get("assumption_checklist") or []
        warnings = (
            identification.get("warnings")
            or validation.get("warnings")
            or page_state.get("warnings")
            or []
        )
        parts = [
            f"Phase 7 identification status: {identification.get('status') or identification.get('identification_status') or 'not run'}.",
            f"Current adjustment set has {len(adjustment_set)} variable(s): {', '.join(map(str, adjustment_set)) or 'none'}.",
            f"Estimand: {estimand.get('label') or estimand.get('effect_type') or 'not finalized'}.",
            f"Estimator family: {strategy.get('estimator_family') or 'not selected'}.",
            f"Assumption checklist items: {len(assumptions)}.",
        ]
        if validation:
            parts.append(f"Adjustment-set validation status: {validation.get('status', 'unknown')}.")
        if warnings:
            parts.append(f"Warnings to review before Phase 8: {' '.join(map(str, warnings[:4]))}")
        parts.append(
            "Phase 7 defines the analysis plan only. It does not calculate treatment effects, and backend checks do not prove causal validity."
        )
        return " ".join(parts)

    if phase == "phase_8_estimation":
        result = page_state.get("estimation_result") or page_state.get("latest_estimation_run") or {}
        raw = result.get("raw") if isinstance(result, dict) else {}
        if isinstance(raw, dict) and raw:
            result = raw
        primary = result.get("primary_result") or result.get("estimate") or {}
        diagnostics = page_state.get("diagnostics") or result.get("diagnostics") or {}
        warnings = page_state.get("warnings") or result.get("warnings") or []
        provenance = page_state.get("provenance") or result.get("provenance") or result.get("reproducibility") or {}
        if not primary or primary.get("point_estimate") is None:
            return (
                "No computed estimate is available to interpret yet. Validate the configuration, run Phase 8 estimation "
                "in backend Python, then review the returned diagnostics and warnings. The assistant cannot invent point "
                "estimates, standard errors, confidence intervals, or p-values."
            )
        parts = [
            f"Phase 8 returned a backend-computed estimate for {primary.get('exposure', 'the exposure')} -> {primary.get('outcome', 'the outcome')}.",
            (
                f"Point estimate: {primary.get('point_estimate')}; SE: {primary.get('standard_error')}; "
                f"95% CI: {primary.get('confidence_interval')}; p-value: {primary.get('p_value')}; "
                f"N: {primary.get('sample_size')}."
            ),
            f"Model status: {result.get('status', 'unknown')}; model type: {result.get('model_type') or provenance.get('estimator') or 'not returned'}.",
        ]
        if diagnostics:
            parts.append(
                f"Diagnostics: rows before filtering {diagnostics.get('rows_before_filtering') or diagnostics.get('rows_before_preprocessing')}; "
                f"rows after filtering {diagnostics.get('rows_after_filtering') or diagnostics.get('rows_after_preprocessing')}; "
                f"convergence {diagnostics.get('convergence', 'not returned')}."
            )
        if warnings:
            parts.append(f"Warnings to review: {' '.join(map(str, warnings[:5]))}")
        parts.append(
            "These are computed model outputs under the selected graph, adjustment set, model, and assumptions. "
            "They do not prove causality, and the assistant did not generate or alter the numerical values."
        )
        return " ".join(parts)

    if phase == "phase_9_review_export":
        package = page_state.get("assembled_package") or {}
        audit = page_state.get("claim_audit_result") or {}
        final_design = page_state.get("final_design_summary") or package.get("final_design_summary") or {}
        selected_run = (
            page_state.get("selected_estimation_run")
            or page_state.get("selected_primary_estimation_run")
            or package.get("selected_estimation_summary")
            or {}
        )
        warnings = page_state.get("unresolved_warnings") or package.get("unresolved_warnings") or []
        evidence = page_state.get("evidence_summary") or package.get("evidence_summary") or {}
        flagged = audit.get("flagged_claims") or []
        parts = [
            f"Phase 9 review package status: {package.get('status', 'not assembled')}.",
            f"Confirmed question: {final_design.get('confirmed_question') or 'not available'}.",
            f"Selected estimation run available: {'yes' if bool(selected_run) else 'no'}.",
            f"Unresolved warnings: {len(warnings)}.",
            f"Claim audit status: {audit.get('status', 'not run')} with {len(flagged)} flagged claim(s).",
        ]
        if evidence:
            parts.append(f"Evidence summary: {evidence.get('summary') or evidence.get('evidence_item_count') or 'available but not summarized'}.")
        if warnings:
            parts.append(f"Warnings to document: {' '.join(map(str, warnings[:5]))}")
        if flagged:
            parts.append(
                "Claim audit issues to revise: "
                + " ".join(str(item.get("explanation") or item.get("text")) for item in flagged[:4] if isinstance(item, dict))
            )
        parts.append(
            "This package supports review and reporting. It does not prove causality, and claims must remain conditional "
            "on the selected design, assumptions, diagnostics, and evidence."
        )
        return " ".join(parts)

    if phase == "phase_1_project_setup":
        datasets = page_state.get("datasets") or []
        documents = page_state.get("documents") or {}
        readiness = page_state.get("readiness") or {}
        lines = [
            "Project setup status:",
            f"- Dataset files uploaded: {len(datasets)}",
            f"- Data dictionary uploaded: {_format_bool(documents.get('dictionary_uploaded'))}",
            f"- Protocol uploaded: {_format_bool(documents.get('protocol_uploaded'))}",
            f"- Research papers uploaded: {_format_count(documents.get('papers_uploaded'))}",
            f"- Domain guidance uploaded: {_format_count(documents.get('guidelines_uploaded'))}",
        ]
        ingestion_status = documents.get("ingestion_status")
        if isinstance(ingestion_status, dict):
            chunk_count = ingestion_status.get("stored_chunks") or ingestion_status.get("chunk_count")
            collection = ingestion_status.get("collection_name")
            if chunk_count is not None or collection:
                lines.append(
                    f"- RAG ingestion: {chunk_count if chunk_count is not None else 'unknown'} chunks"
                    f"{f' in {collection}' if collection else ''}"
                )
        if isinstance(readiness, dict) and readiness:
            completed = [name for name, ok in readiness.items() if ok]
            pending = [name for name, ok in readiness.items() if not ok]
            lines.append(f"- Readiness checks complete: {len(completed)}")
            if pending:
                lines.append(f"- Still to review: {', '.join(map(str, pending[:5]))}")
        lines.append("This setup stage checks completeness and context only; it does not perform causal analysis.")
        return "\n".join(lines)

    return (
        "Assistant action completed from the provided structured page state. "
        "Use deterministic backend validation for causal roles, graph checks, identification, estimation, diagnostics, and claims."
    )



PHASE_LABELS = {
    "phase_1_project_setup": "Project Setup",
    "phase_2_data_foundation": "Data Foundation",
    "phase_3_broad_exploration": "Broad Exploration",
    "phase_4_question_variables": "Question & Variables",
    "phase_5_feasibility": "Feasibility",
    "phase_6_causal_graph": "Causal Graph",
    "phase_7_analysis_strategy": "Analysis Strategy",
    "phase_8_estimation": "Estimation & Calculation",
    "phase_9_review_export": "Review & Export",
}


def _assistant_intent(question: str) -> str:
    lowered = " ".join(str(question or "").lower().split())
    bare = lowered.strip("!?.,;: ")
    if any(term in lowered for term in (
        "diagnos", "treatment", "medication", "clinical advice", "medical advice",
        "should i drink", "should i stop drinking",
    )):
        return "clinical"
    if any(term in lowered for term in ("prove", "causes", "cause binge", "causal proof")):
        return "causal"
    if bare in {"hi", "hello", "hey", "hello there", "hi there", "hey there"} or bare.startswith(("hi ", "hello ", "hey ")):
        return "greeting"
    if bare in {"help", "what can you do", "what do you do", "how can you help"}:
        return "capabilities"
    if bare in {"what is your name", "who are you", "what's your name"}:
        return "identity"
    if any(term in lowered for term in ("what should i do next", "what do i do next", "what next", "next step", "can i continue", "how do i", "how can i", "how do we")):
        return "next_step"
    if any(term in lowered for term in ("project status", "setup status", "readiness status", "show readiness", "what is the status")):
        return "status"
    if any(term in lowered for term in ("what is wrong", "what's wrong", "what am i missing", "what is missing", "why can't")):
        return "issues"
    if "warning" in lowered:
        return "warning"
    if "exposure" in lowered or "outcome" in lowered:
        return "variables"
    return "general"


def _workspace_message(page_state: dict[str, Any]) -> str:
    if page_state.get("study_mode_active") or page_state.get("study_mode"):
        return (
            "The approved BDE workspace is loaded. Its prepared drafts are editable and not yet confirmed; "
            "the graph is assumption-based, and any numerical result must be computed by the backend."
        )
    return (
        "You can load the approved BDE study workspace to begin the prepared task, "
        "or manually upload a dataset and data dictionary."
    )


def _deterministic_guidance(*, phase: str, page_state: dict[str, Any], user_question: str) -> str:
    intent = _assistant_intent(user_question)
    phase_label = PHASE_LABELS.get(phase, "the current workflow phase")
    workspace = _workspace_message(page_state)
    warnings = page_state.get("active_warnings") or page_state.get("warnings") or []
    exposure = page_state.get("selected_exposure") or "not selected"
    outcome = page_state.get("selected_outcome") or "not selected"

    if intent == "clinical":
        return "I can help with the Causal Studio study workflow, but I cannot provide clinical advice or unsupported causal conclusions."
    if intent == "causal":
        return (
            "No. This workflow cannot prove that movement causes binge drinking. It can support a reviewed, "
            "backend-computed analysis only after assumptions, timing, graph validation, feasibility, and diagnostics are considered."
        )
    if intent == "greeting":
        return f"Hi! I can help you work through the Causal Studio workflow. You are currently in {phase_label}. {workspace}"
    if intent == "capabilities":
        return (
            f"I can explain the current {phase_label} step, warnings, variables, graph, feasibility, backend-computed results, "
            f"and what to check next. {workspace}"
        )
    if intent == "identity":
        return f"I’m the Causal Studio assistant. I can help you navigate {phase_label}, understand the dashboard state, and identify the next workflow check. {workspace}"
    if intent == "status":
        return _summarize_page_state(phase, page_state)
    if intent == "next_step":
        if phase == "phase_1_project_setup" and not (page_state.get("study_mode_active") or page_state.get("study_mode")):
            return f"You are in Project Setup. {workspace}"
        if phase == "phase_1_project_setup":
            return "You are in Project Setup. Review the loaded objective, dataset, and data dictionary, then continue to Data Foundation."
        return f"You are currently in {phase_label}. Review the visible required fields and warnings for this phase before continuing; use backend validation for any numerical or causal-design decision."
    if intent == "issues":
        if warnings:
            return f"The current item to review is: {str(warnings[0])}. Resolve blocking issues before continuing; non-blocking warnings should remain documented."
        return f"I do not see an active warning in the supplied dashboard state. In {phase_label}, review the required fields and any visible validation messages before continuing."
    if intent == "warning":
        if warnings:
            return f"Current warning: {str(warnings[0])}. It should be reviewed and documented; it does not by itself establish a causal conclusion."
        return "There is no active warning in the supplied dashboard state. If you see a warning in the interface, share its text and I can explain its workflow consequence."
    if intent == "variables":
        return f"Current exposure: {exposure}. Current outcome: {outcome}. These selections remain drafts until they are reviewed and confirmed in the workflow."
    return f"I can help with the current {phase_label} workflow state, including warnings, variables, feasibility, graph review, and backend-computed outputs. {workspace}"


def _fallback_response(
    *,
    phase: str,
    action: str,
    page_state: dict[str, Any],
    selected_item: dict[str, Any],
    rag_evidence: list[dict[str, Any]],
    warning: str | None = None,
    unavailable_reason: str | None = None,
    user_question: str = "",
) -> dict[str, Any]:
    intent = _assistant_intent(user_question)
    guidance = _deterministic_guidance(
        phase=phase,
        page_state=page_state,
        user_question=user_question,
    )
    # Greetings and safety requests stay concise even when the model is unavailable.
    show_availability_note = intent == "general"
    fallback_note = unavailable_reason or (
        "LLM response is unavailable, but I can still explain the current workflow state using deterministic dashboard information."
    )
    assistant_message = f"{fallback_note}\n\n{guidance}" if show_availability_note else guidance
    if selected_item and intent == "general":
        assistant_message += "\n\nSelected item was included in the request and should be reviewed against deterministic backend output."
    if rag_evidence and intent == "general":
        assistant_message += f"\n\n{len(rag_evidence)} RAG evidence item(s) were provided. They can support explanation, but they do not prove causal claims."
    if warning:
        assistant_message += f"\n\nNote: {warning}"

    return {
        "status": "fallback",
        "assistant_message": assistant_message,
        "summary": _summarize_page_state(phase, page_state),
        "limitations": [
            "LLM generation was not used.",
            "No causal validity decision was made by the assistant.",
            "Numerical values are limited to values already present in page_state.",
        ],
        "recommended_next_actions": [
            "Review deterministic backend warnings.",
            "Confirm required data fields and timing before moving to causal design.",
        ],
        "warnings": [warning] if warning else [],
        "used_llm": False,
        "used_rag": bool(rag_evidence),
    }


def _build_rag_summary(rag_evidence: list[dict[str, Any]]) -> str:
    if not rag_evidence:
        return "No RAG evidence was supplied with this assistant action."

    blocks = []
    for index, item in enumerate(rag_evidence[:8], start=1):
        source = item.get("source_filename") or item.get("filename") or "Unknown source"
        page = item.get("page_number")
        chunk = item.get("chunk_index")
        text = str(item.get("chunk_text") or item.get("text") or "").strip()
        location = []
        if page is not None:
            location.append(f"page {page}")
        if chunk is not None:
            location.append(f"chunk {chunk}")
        suffix = f" ({', '.join(location)})" if location else ""
        blocks.append(f"[{index}] {source}{suffix}\n{text[:800]}")
    return "\n\n".join(blocks)


def _build_system_prompt() -> str:
    return (
        "You are the Causal Design Agent assistant. You explain, summarize, draft, "
        "and suggest next actions for a causal-design support workflow.\n\n"
        "Safety rules:\n"
        "- Do not invent numerical results.\n"
        "- Do not invent dataset facts.\n"
        "- Do not invent RAG evidence.\n"
        "- Do not decide causal validity.\n"
        "- Do not say causality is proven.\n"
        "- Numerical values must come only from Python/R backend outputs already present in page_state.\n"
        "- Graph validity, identification, estimation, diagnostics, and claims must come from deterministic backend checks.\n"
        "- Always distinguish Python/R computation from GenAI explanation.\n"
        "- Causal Design Agent is not a diagnostic tool or treatment-decision system.\n"
        "- For clinical, diagnosis, treatment, or unsupported-causality requests, state that you can help with the workflow but cannot provide clinical advice or unsupported causal conclusions.\n\n"
        "For greetings, help requests, and next-step questions, answer in one or two conversational sentences and do not dump a readiness checklist unless the user asks for status. "
        "Return concise, state-specific guidance. If a value or evidence source is missing, say so clearly."
    )


def run_assistant_action(
    *,
    phase: str,
    action: str,
    page_state: dict[str, Any],
    selected_item: dict[str, Any] | None = None,
    user_feedback: str = "",
    rag_evidence: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if phase not in SUPPORTED_PHASES:
        raise AssistantActionError("Missing or unsupported phase.")
    if action not in SUPPORTED_ACTIONS:
        raise AssistantActionError("Missing or unsupported action.")
    if not isinstance(page_state, dict):
        raise AssistantActionError("Invalid page_state. Expected an object.")

    normalized_selected_item = selected_item or {}
    normalized_rag_evidence = rag_evidence or []
    direct_intent = _assistant_intent(user_feedback)
    if direct_intent in {"greeting", "capabilities", "identity", "next_step", "issues", "warning", "variables", "status", "clinical", "causal"}:
        return _fallback_response(
            phase=phase,
            action=action,
            page_state=page_state,
            selected_item=normalized_selected_item,
            rag_evidence=normalized_rag_evidence,
            user_question=user_feedback,
        )
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)

    if not api_key:
        response = _fallback_response(
            phase=phase,
            action=action,
            page_state=page_state,
            selected_item=normalized_selected_item,
            rag_evidence=normalized_rag_evidence,
            unavailable_reason=(
                "LLM response is unavailable, but I can still explain the current workflow state using deterministic dashboard information."
            ),
            user_question=user_feedback,
        )
    else:
        safe_state = compact_value(page_state, max_items=20)
        safe_selected = compact_value(normalized_selected_item, max_items=12)
        evidence_summary = _build_rag_summary(normalized_rag_evidence)
        user_prompt = (
            f"Phase: {phase}\n"
            f"Action: {action}\n"
            f"Phase-specific behavior: {PHASE_GUIDANCE[phase]}\n\n"
            f"Structured page_state:\n{json.dumps(safe_state, indent=2, default=str)}\n\n"
            f"Selected item:\n{json.dumps(safe_selected, indent=2, default=str)}\n\n"
            f"User feedback:\n{user_feedback or 'None provided.'}\n\n"
            f"RAG evidence supplied by backend/frontend:\n{evidence_summary}\n\n"
            "Write a context-aware assistant response. Include limitations and recommended next actions. "
            "Do not create facts or numbers not present above."
        )
        try:
            client = OpenAI(api_key=api_key)
            llm_response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _build_system_prompt()},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
            assistant_message = llm_response.choices[0].message.content or _summarize_page_state(
                phase,
                page_state,
            )
            response = {
                "status": "success",
                "assistant_message": assistant_message,
                "summary": _summarize_page_state(phase, page_state),
                "limitations": [
                    "The assistant explains supplied state; deterministic backend checks remain the source of truth.",
                    "No causal conclusion is proven by this response.",
                ],
                "recommended_next_actions": [
                    "Review deterministic warnings before proceeding.",
                    "Use backend validation for roles, timing, graph, identification, estimation, and claims.",
                ],
                "warnings": [],
                "used_llm": True,
                "used_rag": bool(normalized_rag_evidence),
            }
        except Exception as error:
            warning = format_openai_error(error) if isinstance(error, OpenAIError) else "OpenAI request failed; deterministic workflow guidance is shown instead."
            response = _fallback_response(
                phase=phase,
                action=action,
                page_state=page_state,
                selected_item=normalized_selected_item,
                rag_evidence=normalized_rag_evidence,
                warning=warning,
                unavailable_reason=(
                    "LLM response is unavailable, but I can still explain the current workflow state using deterministic dashboard information."
                ),
                user_question=user_feedback,
            )

    record_trace_event(
        "assistant_action",
        {
            "workflow_step": phase,
            "action": action,
            "dataset_filename": page_state.get("dataset_filename"),
            "research_objective": page_state.get("research_objective"),
            "confirmed_question": page_state.get("confirmed_question"),
            "evidence_chunks_used": len(normalized_rag_evidence),
            "source_filenames": summarize_sources(normalized_rag_evidence),
            "warning_count": len(response.get("warnings", [])),
            "error_count": 1 if response.get("status") == "error" else 0,
            "llm_used": response.get("used_llm", False),
        },
    )

    return response
