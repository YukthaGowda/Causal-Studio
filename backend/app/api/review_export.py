from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.review_export import (
    ReviewExportError,
    assemble_review_package,
    audit_claim_text,
    export_review_package,
)


router = APIRouter(prefix="/review-export", tags=["review-export"])


class ReviewPackageRequest(BaseModel):
    project: dict[str, Any] = Field(default_factory=dict)
    phase_2_data_foundation: dict[str, Any] = Field(default_factory=dict)
    phase_3_broad_exploration: dict[str, Any] = Field(default_factory=dict)
    phase_4_question_variables: dict[str, Any] = Field(default_factory=dict)
    phase_5_feasibility: dict[str, Any] = Field(default_factory=dict)
    phase_6_graph: dict[str, Any] = Field(default_factory=dict)
    phase_7_strategy: dict[str, Any] = Field(default_factory=dict)
    phase_8_estimation: dict[str, Any] = Field(default_factory=dict)
    rag_evidence: list[Any] = Field(default_factory=list)
    user_notes: str = ""
    report_preferences: dict[str, Any] = Field(default_factory=dict)


@router.post("/assemble")
def assemble_review_export_package(request: ReviewPackageRequest) -> dict[str, Any]:
    try:
        return assemble_review_package(request.model_dump())
    except ReviewExportError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


class ClaimAuditRequest(BaseModel):
    report_text: str = ""
    final_design_summary: dict[str, Any] = Field(default_factory=dict)
    selected_estimation_summary: dict[str, Any] = Field(default_factory=dict)
    assumption_checklist: list[Any] = Field(default_factory=list)
    unresolved_warnings: list[Any] = Field(default_factory=list)
    rag_evidence: list[Any] = Field(default_factory=list)


@router.post("/claim-audit")
def audit_review_export_claims(request: ClaimAuditRequest) -> dict[str, Any]:
    return audit_claim_text(request.model_dump())


class ExportRequest(BaseModel):
    assembled_package: dict[str, Any] = Field(default_factory=dict)
    claim_audit_result: dict[str, Any] = Field(default_factory=dict)
    format: str = "json"
    include_appendix: bool = True
    include_reproducibility: bool = True


@router.post("/export")
def export_review_export_package(request: ExportRequest) -> dict[str, Any]:
    try:
        return export_review_package(request.model_dump())
    except ReviewExportError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
