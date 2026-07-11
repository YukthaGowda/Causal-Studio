from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.causal_questions import (
    CausalQuestionGenerationError,
    generate_candidate_questions,
)


router = APIRouter(prefix="/causal-questions", tags=["causal-questions"])


class GenerateCausalQuestionsRequest(BaseModel):
    research_objective: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("research_objective", "dataset_filename")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/generate")
def generate_questions(
    request: GenerateCausalQuestionsRequest,
) -> dict[str, Any]:
    try:
        return generate_candidate_questions(
            research_objective=request.research_objective,
            dataset_filename=request.dataset_filename,
            top_k_evidence=request.top_k_evidence,
        )
    except CausalQuestionGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
