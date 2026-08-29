from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.rag.ingestion import IngestionDependencyError
from app.rag.search import (
    RagEmbeddingUnavailableError,
    RagSearchError,
    search_rag_chunks,
)


router = APIRouter(prefix="/rag", tags=["rag"])


class RagSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=5, ge=1, le=10)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Search query cannot be empty.")
        return stripped_value


@router.post("/search")
def search_documents(request: RagSearchRequest) -> dict[str, str | int | list[dict[str, Any]]]:
    try:
        return search_rag_chunks(query=request.query, top_k=request.top_k)
    except RagEmbeddingUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except RagSearchError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
    except IngestionDependencyError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
