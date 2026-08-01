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


def _fallback_response(
    *,
    phase: str,
    action: str,
    page_state: dict[str, Any],
    selected_item: dict[str, Any],
    rag_evidence: list[dict[str, Any]],
    warning: str | None = None,
    unavailable_reason: str | None = None,
) -> dict[str, Any]:
    fallback_note = unavailable_reason or (
        "LLM interpretation is unavailable because the API key is not configured, "
        "but deterministic checks and backend outputs are still available."
    )
    summary = _summarize_page_state(phase, page_state)
    assistant_message = f"{fallback_note}\n\n{summary}"
    if selected_item:
        assistant_message += "\n\nSelected item was included in the request and should be reviewed against deterministic backend output."
    if rag_evidence:
        assistant_message += f"\n\n{len(rag_evidence)} RAG evidence item(s) were provided. They can support explanation, but they do not prove causal claims."
    if warning:
        assistant_message += f"\n\nNote: {warning}"

    return {
        "status": "fallback",
        "assistant_message": assistant_message,
        "summary": summary,
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
        "- Causal Design Agent is not a diagnostic tool or treatment-decision system.\n\n"
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
                "LLM interpretation is unavailable because the API key is not configured, "
                "but deterministic checks and backend outputs are still available."
            ),
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
        except OpenAIError as error:
            warning = format_openai_error(error)
            response = _fallback_response(
                phase=phase,
                action=action,
                page_state=page_state,
                selected_item=normalized_selected_item,
                rag_evidence=normalized_rag_evidence,
                warning=warning,
                unavailable_reason=(
                    "LLM interpretation is unavailable because the configured OpenAI request failed, "
                    "but deterministic checks and backend outputs are still available."
                ),
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
