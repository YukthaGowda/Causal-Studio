from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.identification import IdentificationCheckError, check_identification


router = APIRouter(prefix="/identification", tags=["identification"])


class IdentificationGraph(BaseModel):
    graph_type: str = "DAG"
    nodes: list[dict[str, Any]] = Field(..., min_length=1)
    edges: list[dict[str, Any]] = Field(..., min_length=1)
    latent_confounder_warnings: list[str] | None = None


class IdentificationCheckRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    graph: IdentificationGraph
    role_recommendations: list[dict[str, Any]] = Field(..., min_length=1)
    estimand_type: str = Field(default="total_effect", min_length=1)
    user_adjustment_set: list[str] | None = None
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("confirmed_question", "dataset_filename", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/check")
def run_identification_check(
    request: IdentificationCheckRequest,
) -> dict[str, Any]:
    try:
        return check_identification(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            graph_payload=request.graph.model_dump(exclude_none=True),
            role_recommendations=request.role_recommendations,
            estimand_type=request.estimand_type,
            user_adjustment_set=request.user_adjustment_set,
            top_k_evidence=request.top_k_evidence,
        )
    except IdentificationCheckError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
