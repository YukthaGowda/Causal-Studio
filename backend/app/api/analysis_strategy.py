from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.analysis_strategy import (
    AnalysisStrategyError,
    generate_analysis_strategy,
)


router = APIRouter(prefix="/analysis-strategy", tags=["analysis-strategy"])


class AnalysisStrategyRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    graph: dict[str, Any]
    role_recommendations: list[dict[str, Any]] = Field(..., min_length=1)
    identification_result: dict[str, Any]
    exposure: str | None = None
    outcome: str | None = None
    adjustment_set: list[str] | None = None
    estimand_type: str = Field(default="total_effect", min_length=1)
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("confirmed_question", "dataset_filename", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/generate")
def generate_strategy(request: AnalysisStrategyRequest) -> dict[str, Any]:
    try:
        return generate_analysis_strategy(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            graph=request.graph,
            role_recommendations=request.role_recommendations,
            identification_result=request.identification_result,
            exposure=request.exposure,
            outcome=request.outcome,
            adjustment_set=request.adjustment_set,
            estimand_type=request.estimand_type,
            top_k_evidence=request.top_k_evidence,
        )
    except AnalysisStrategyError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
