from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.assumptions import AssumptionReviewError, review_assumptions


router = APIRouter(prefix="/assumptions", tags=["assumptions"])


class AssumptionReviewRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    graph: dict[str, Any]
    role_recommendations: list[dict[str, Any]] = Field(..., min_length=1)
    identification_result: dict[str, Any]
    analysis_strategy: dict[str, Any]
    exposure: str | None = None
    outcome: str | None = None
    adjustment_set: list[str] | None = None
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("confirmed_question", "dataset_filename")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/review")
def review_assumption_plan(request: AssumptionReviewRequest) -> dict[str, Any]:
    try:
        return review_assumptions(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            graph=request.graph,
            role_recommendations=request.role_recommendations,
            identification_result=request.identification_result,
            analysis_strategy=request.analysis_strategy,
            exposure=request.exposure,
            outcome=request.outcome,
            adjustment_set=request.adjustment_set,
            top_k_evidence=request.top_k_evidence,
        )
    except AssumptionReviewError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
