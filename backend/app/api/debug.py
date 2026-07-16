from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.langsmith_tracing import (
    get_langsmith_status,
    record_trace_event,
    summarize_sources,
)
from app.rag.search import RagSearchError, search_rag_chunks


router = APIRouter(prefix="/debug", tags=["debug"])


class TestTraceRequest(BaseModel):
    query: str = Field(
        default="What should the system validate deterministically?",
        min_length=1,
    )
    top_k: int = Field(default=2, ge=1, le=5)


@router.get("/langsmith-status")
def read_langsmith_status() -> dict[str, Any]:
    return get_langsmith_status()


@router.post("/test-trace")
def run_test_trace(request: TestTraceRequest = TestTraceRequest()) -> dict[str, Any]:
    status = get_langsmith_status()
    rag_status = "not_run"
    results_count = 0
    source_filenames: list[str] = []

    try:
        search_result = search_rag_chunks(query=request.query, top_k=request.top_k)
        results = search_result.get("results", [])
        if isinstance(results, list):
            results_count = len(results)
            source_filenames = summarize_sources(results)
        rag_status = "completed"
    except RagSearchError as error:
        rag_status = f"rag_error: {error}"

    record_trace_event(
        "debug_test_trace",
        {
            "workflow_step": "debug",
            "query_length": len(request.query),
            "top_k": request.top_k,
            "rag_status": rag_status,
            "results_count": results_count,
            "source_filenames": source_filenames,
        },
    )

    return {
        "trace_completed": True,
        "tracing_enabled": status["tracing_enabled"],
        "langchain_project": status["langchain_project"],
        "api_key_present": status["api_key_present"],
        "rag_status": rag_status,
        "results_count": results_count,
        "source_filenames": source_filenames,
        "warning": status["warning"],
    }
