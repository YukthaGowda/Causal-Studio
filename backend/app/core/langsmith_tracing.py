from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv

try:
    from langsmith import traceable
except ImportError:  # pragma: no cover - allows app startup before deps install
    traceable = None


SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "content",
    "chunk_text",
    "document_text",
    "raw_dataset",
    "rows",
    "samples",
}


def _env_loaded() -> None:
    load_dotenv()


def is_tracing_enabled() -> bool:
    _env_loaded()
    return os.getenv("LANGCHAIN_TRACING_V2", "").lower() == "true"


def get_langsmith_status() -> dict[str, Any]:
    _env_loaded()
    tracing_enabled = is_tracing_enabled()
    api_key_present = bool(os.getenv("LANGCHAIN_API_KEY"))
    project = os.getenv("LANGCHAIN_PROJECT") or None
    warning = None
    if not tracing_enabled:
        warning = "LangSmith tracing is disabled. Set LANGCHAIN_TRACING_V2=true to enable it."
    elif not api_key_present:
        warning = "LangSmith tracing is enabled but LANGCHAIN_API_KEY is not configured."
    return {
        "tracing_enabled": tracing_enabled,
        "langchain_project": project,
        "api_key_present": api_key_present,
        "warning": warning,
    }


def compact_value(value: Any, *, max_items: int = 12) -> Any:
    if isinstance(value, dict):
        compacted: dict[str, Any] = {}
        for key, nested_value in value.items():
            key_text = str(key)
            if key_text.lower() in SENSITIVE_KEYS:
                compacted[key_text] = "[redacted]"
            else:
                compacted[key_text] = compact_value(nested_value, max_items=max_items)
        return compacted
    if isinstance(value, list):
        return [compact_value(item, max_items=max_items) for item in value[:max_items]]
    if isinstance(value, str) and len(value) > 500:
        return f"{value[:500]}... [truncated]"
    return value


def summarize_sources(results: list[dict[str, Any]]) -> list[str]:
    sources: list[str] = []
    for result in results:
        filename = result.get("source_filename")
        if filename and filename not in sources:
            sources.append(str(filename))
    return sources[:20]


if traceable is not None:

    @traceable(name="causal_design_agent_trace_event", run_type="chain")
    def _emit_trace_event(event_name: str, metadata: dict[str, Any]) -> dict[str, Any]:
        return {
            "event_name": event_name,
            "metadata": compact_value(metadata),
        }

else:

    def _emit_trace_event(event_name: str, metadata: dict[str, Any]) -> dict[str, Any]:
        return {
            "event_name": event_name,
            "metadata": compact_value(metadata),
        }


def record_trace_event(event_name: str, metadata: dict[str, Any]) -> dict[str, Any]:
    if not is_tracing_enabled():
        return {
            "tracing_enabled": False,
            "event_name": event_name,
        }
    return _emit_trace_event(event_name, compact_value(metadata))
