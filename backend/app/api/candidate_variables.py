from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.candidate_variables import (
    CandidateVariableRecommendationError,
    recommend_candidate_variables,
)


router = APIRouter(prefix="/candidate-variables", tags=["candidate-variables"])


class RecommendCandidateVariablesRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("confirmed_question", "dataset_filename")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/recommend")
def recommend_variables(
    request: RecommendCandidateVariablesRequest,
) -> dict[str, Any]:
    try:
        return recommend_candidate_variables(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            top_k_evidence=request.top_k_evidence,
        )
    except CandidateVariableRecommendationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
