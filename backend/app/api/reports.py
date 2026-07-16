from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.report_generation import ReportGenerationError, generate_report


router = APIRouter(prefix="/reports", tags=["reports"])


class ReportGenerationRequest(BaseModel):
    project_title: str | None = None
    research_objective: str | None = None
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    schema_summary: dict[str, Any] | None = None
    broad_exploration_summary: dict[str, Any] | None = None
    candidate_questions: list[Any] | None = None
    selected_candidate_question: Any | None = None
    candidate_variables: list[Any] | None = None
    targeted_feasibility_result: dict[str, Any] | None = None
    selected_variables: list[Any] = Field(..., min_length=1)
    role_recommendations: list[dict[str, Any]] = Field(..., min_length=1)
    role_validation_result: dict[str, Any] | None = None
    graph: dict[str, Any]
    graph_validation_result: dict[str, Any] | None = None
    identification_result: dict[str, Any]
    analysis_strategy: dict[str, Any]
    assumptions_review: dict[str, Any]
    evidence_summary: list[Any] | None = None
    user_notes: str | None = None

    @field_validator("confirmed_question", "dataset_filename")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/generate")
def generate_design_report(request: ReportGenerationRequest) -> dict[str, Any]:
    try:
        return generate_report(
            project_title=request.project_title,
            research_objective=request.research_objective,
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            schema_summary=request.schema_summary,
            broad_exploration_summary=request.broad_exploration_summary,
            candidate_questions=request.candidate_questions,
            selected_candidate_question=request.selected_candidate_question,
            candidate_variables=request.candidate_variables,
            targeted_feasibility_result=request.targeted_feasibility_result,
            selected_variables=request.selected_variables,
            role_recommendations=request.role_recommendations,
            role_validation_result=request.role_validation_result,
            graph=request.graph,
            graph_validation_result=request.graph_validation_result,
            identification_result=request.identification_result,
            analysis_strategy=request.analysis_strategy,
            assumptions_review=request.assumptions_review,
            evidence_summary=request.evidence_summary,
            user_notes=request.user_notes,
        )
    except ReportGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
