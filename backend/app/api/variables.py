from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.phase4_design import Phase4DesignError, recommend_structured_candidate_variables


router = APIRouter(prefix="/variables", tags=["variables"])


class RecommendCandidateVariablesRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = ""
    schema_summary: dict[str, Any] = Field(default_factory=dict)
    broad_exploration_summary: dict[str, Any] = Field(default_factory=dict)
    rag_evidence: list[dict[str, Any]] = Field(default_factory=list)
    user_feedback: str = ""
    locked_decisions: dict[str, Any] = Field(default_factory=dict)

    @field_validator("confirmed_question")
    @classmethod
    def validate_question(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Missing confirmed_question.")
        return stripped


@router.post("/recommend-candidates")
def recommend_candidate_variables(request: RecommendCandidateVariablesRequest) -> dict[str, Any]:
    try:
        return recommend_structured_candidate_variables(request.model_dump())
    except Phase4DesignError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
