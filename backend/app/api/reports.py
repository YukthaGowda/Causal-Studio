from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.report_generation import ReportGenerationError, audit_user_claims, generate_report


router = APIRouter(prefix="/reports", tags=["reports"])


class ReportGenerationRequest(BaseModel):
    project: dict[str, Any] | None = None
    dataset_summary: dict[str, Any] | None = None
    data_foundation: dict[str, Any] | None = None
    project_title: str | None = None
    research_objective: str | None = None
    confirmed_question: str = ""
    dataset_filename: str = ""
    schema_summary: dict[str, Any] | None = None
    broad_exploration_summary: dict[str, Any] | None = None
    candidate_questions: list[Any] | None = None
    selected_candidate_question: Any | None = None
    candidate_variables: list[Any] | None = None
    targeted_feasibility_result: dict[str, Any] | None = None
    selected_variables: list[Any] = Field(default_factory=list)
    role_recommendations: list[dict[str, Any]] = Field(default_factory=list)
    role_validation_result: dict[str, Any] | None = None
    graph: dict[str, Any] = Field(default_factory=dict)
    final_graph: dict[str, Any] | None = None
    graph_validation_result: dict[str, Any] | None = None
    identification_result: dict[str, Any] = Field(default_factory=dict)
    analysis_strategy: dict[str, Any] = Field(default_factory=dict)
    assumptions_review: dict[str, Any] = Field(default_factory=dict)
    selected_primary_estimation_run: dict[str, Any] | None = None
    evidence_summary: list[Any] | None = None
    rag_evidence: list[Any] | None = None
    claim_audit: dict[str, Any] | None = None
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
    project_title = request.project_title or (request.project or {}).get("project_title") or (request.project or {}).get("name")
    dataset_filename = request.dataset_filename or (request.dataset_summary or {}).get("filename") or "uploaded_dataset.csv"
    schema_summary = request.schema_summary or request.dataset_summary or request.data_foundation
    graph = request.graph or request.final_graph or {}
    try:
        return generate_report(
            project_title=project_title,
            research_objective=request.research_objective,
            confirmed_question=request.confirmed_question,
            dataset_filename=dataset_filename,
            schema_summary=schema_summary,
            broad_exploration_summary=request.broad_exploration_summary,
            candidate_questions=request.candidate_questions,
            selected_candidate_question=request.selected_candidate_question,
            candidate_variables=request.candidate_variables,
            targeted_feasibility_result=request.targeted_feasibility_result,
            selected_variables=request.selected_variables,
            role_recommendations=request.role_recommendations,
            role_validation_result=request.role_validation_result,
            graph=graph,
            graph_validation_result=request.graph_validation_result,
            identification_result=request.identification_result,
            analysis_strategy=request.analysis_strategy,
            assumptions_review=request.assumptions_review,
            selected_primary_estimation_run=request.selected_primary_estimation_run,
            evidence_summary=request.evidence_summary or request.rag_evidence,
            user_notes=request.user_notes,
        )
    except ReportGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


class ClaimAuditRequest(BaseModel):
    claims: list[Any] = Field(default_factory=list)
    confirmed_question: str | None = None
    final_graph: dict[str, Any] | None = None
    identification_result: dict[str, Any] | None = None
    analysis_strategy: dict[str, Any] | None = None
    assumptions_review: dict[str, Any] | None = None
    selected_primary_estimation_run: dict[str, Any] | None = None
    rag_evidence: list[Any] | None = None


@router.post("/audit-claims")
def audit_report_claims(request: ClaimAuditRequest) -> dict[str, Any]:
    try:
        return audit_user_claims(
            claims=request.claims,
            confirmed_question=request.confirmed_question,
            final_graph=request.final_graph,
            identification_result=request.identification_result,
            analysis_strategy=request.analysis_strategy,
            assumptions_review=request.assumptions_review,
            selected_primary_estimation_run=request.selected_primary_estimation_run,
            rag_evidence=request.rag_evidence,
        )
    except ReportGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
