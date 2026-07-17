from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI, OpenAIError

from app.core.langsmith_tracing import record_trace_event, summarize_sources
from app.rag.ingestion import IngestionDependencyError
from app.rag.search import RagSearchError, search_rag_chunks
from app.services.causal_questions import DEFAULT_MODEL, format_openai_error


DATA_DICTIONARY_FALLBACK = (
    "A formal data dictionary is ideal, but it is not mandatory for setup. "
    "You can upload a plain TXT, DOCX, or PDF that explains each dataset column, "
    "including variable names, meanings, value ranges, units, collection timing, "
    "participant ID fields, and timestamp fields. If those details are missing, "
    "Causal Studio should mark the item as needing clarification instead of "
    "inventing schema details."
)


class AssistantChatError(RuntimeError):
    pass


def _build_evidence_summary(results: list[dict[str, Any]]) -> str:
    if not results:
        return "No RAG evidence was retrieved."

    evidence_blocks = []
    for index, result in enumerate(results[:5], start=1):
        filename = result.get("source_filename") or "Unknown source"
        page = result.get("page_number")
        page_text = f", page {page}" if page else ""
        chunk = result.get("chunk_index")
        chunk_text = f", chunk {chunk}" if chunk is not None else ""
        text = str(result.get("chunk_text") or "").strip()
        evidence_blocks.append(
            f"[{index}] {filename}{page_text}{chunk_text}\n{text[:1200]}"
        )

    return "\n\n".join(evidence_blocks)


def _fallback_answer(message: str, rag_response: dict[str, Any], warning: str | None = None) -> str:
    lowered_message = message.lower()
    if "data dictionary" in lowered_message and (
        "don't have" in lowered_message
        or "do not have" in lowered_message
        or "no formal" in lowered_message
    ):
        return DATA_DICTIONARY_FALLBACK

    results = rag_response.get("results", [])
    if not results:
        base_answer = (
            "I could not find matching evidence in the ingested knowledge base yet. "
            "Upload and ingest the relevant project documents, then ask again. "
            "I can still help with setup questions, but I should not invent document details."
        )
    else:
        sources = summarize_sources(results)
        source_text = ", ".join(sources) if sources else "the retrieved sources"
        base_answer = (
            f"I found {len(results)} relevant evidence chunk(s) from {source_text}. "
            "Review the cited snippets before using them in the causal-design workflow. "
            "These retrieved materials can support setup, variable interpretation, and "
            "draft explanations, but they do not prove causal conclusions."
        )

    if warning:
        return f"{base_answer}\n\nNote: {warning}"
    return base_answer


def generate_assistant_response(
    message: str,
    workflow_step: str | None = None,
    top_k_evidence: int = 4,
) -> dict[str, Any]:
    normalized_message = message.strip()
    if not normalized_message:
        raise AssistantChatError("Assistant message cannot be empty.")

    try:
        rag_response = search_rag_chunks(normalized_message, top_k=top_k_evidence)
    except (RagSearchError, IngestionDependencyError) as error:
        rag_response = {
            "query": normalized_message,
            "number_of_results": 0,
            "message": str(error),
            "results": [],
        }

    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)

    warning = None
    if not api_key:
        warning = "OPENAI_API_KEY is not configured, so I returned deterministic guidance without an LLM call."
        answer = _fallback_answer(normalized_message, rag_response, warning)
        llm_used = False
    else:
        evidence_summary = _build_evidence_summary(rag_response.get("results", []))
        system_prompt = (
            "You are the Causal Studio AI Research Assistant. Help with causal-design "
            "support only. Do not provide diagnosis, treatment decisions, effect estimates, "
            "or claims that causality is proven. Use retrieved evidence when available, "
            "name uncertainty, and say when documents do not contain enough evidence. "
            "The deterministic Python backend remains the source of truth for causal roles, "
            "timing, graph structure, assumptions, validation, and claims."
        )
        user_prompt = (
            f"Workflow step: {workflow_step or 'unspecified'}\n\n"
            f"User question:\n{normalized_message}\n\n"
            f"Retrieved evidence:\n{evidence_summary}\n\n"
            "Answer conversationally and concisely. If evidence is missing, say that clearly. "
            "Do not invent project facts."
        )

        try:
            client = OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
            )
            answer = response.choices[0].message.content or _fallback_answer(
                normalized_message,
                rag_response,
            )
            llm_used = True
        except OpenAIError as error:
            warning = format_openai_error(error)
            answer = _fallback_answer(normalized_message, rag_response, warning)
            llm_used = False

    results = rag_response.get("results", [])
    record_trace_event(
        "assistant_chat",
        {
            "workflow_step": workflow_step or "assistant_chat",
            "query_length": len(normalized_message),
            "evidence_chunks_used": len(results),
            "source_filenames": summarize_sources(results),
            "llm_used": llm_used,
            "warning_count": 1 if warning else 0,
            "error_count": 0,
        },
    )

    return {
        "message": normalized_message,
        "answer": answer,
        "llm_used": llm_used,
        "model": model if llm_used else None,
        "warning": warning,
        "evidence_chunks_used": len(results),
        "sources": [
            {
                "source_filename": result.get("source_filename"),
                "page_number": result.get("page_number"),
                "chunk_index": result.get("chunk_index"),
                "distance": result.get("distance"),
                "chunk_text": result.get("chunk_text"),
            }
            for result in results
        ],
    }
