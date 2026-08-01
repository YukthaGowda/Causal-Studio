from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.phase4_design import Phase4DesignError, generate_structured_question_candidates


router = APIRouter(prefix="/questions", tags=["questions"])


class GenerateQuestionCandidatesRequest(BaseModel):
    research_objective: str = Field(..., min_length=1)
    dataset_filename: str = ""
    schema_summary: dict[str, Any] = Field(default_factory=dict)
    broad_exploration_summary: dict[str, Any] = Field(default_factory=dict)
    rag_evidence: list[dict[str, Any]] = Field(default_factory=list)
    user_feedback: str = ""
    locked_decisions: dict[str, Any] = Field(default_factory=dict)

    @field_validator("research_objective")
    @classmethod
    def validate_objective(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Missing research_objective.")
        return stripped


@router.post("/generate-candidates")
def generate_question_candidates(request: GenerateQuestionCandidatesRequest) -> dict[str, Any]:
    try:
        return generate_structured_question_candidates(request.model_dump())
    except Phase4DesignError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
