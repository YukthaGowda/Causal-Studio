from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.analysis_strategy import (
    AnalysisStrategyError,
    generate_analysis_strategy,
)
from app.services.phase7_analysis_strategy import (
    generate_phase7_analysis_strategy,
    validate_phase7_analysis_strategy,
)


router = APIRouter(prefix="/analysis-strategy", tags=["analysis-strategy"])


class AnalysisStrategyRequest(BaseModel):
    confirmed_question: str = ""
    dataset_filename: str | None = None
    graph: dict[str, Any] = Field(default_factory=dict)
    role_recommendations: list[dict[str, Any]] | None = None
    identification_result: dict[str, Any] | None = None
    exposure: str | None = None
    outcome: str | None = None
    adjustment_set: list[str] | None = None
    estimand_type: str = "total_effect"
    top_k_evidence: int = Field(default=5, ge=1, le=10)
    comparator: dict[str, Any] = Field(default_factory=dict)
    time_window: dict[str, Any] = Field(default_factory=dict)
    selected_variables: list[Any] = Field(default_factory=list)
    provisional_roles: dict[str, Any] = Field(default_factory=dict)
    confirmed_roles: dict[str, Any] = Field(default_factory=dict)
    feasibility_result: dict[str, Any] = Field(default_factory=dict)
    schema_summary: dict[str, Any] = Field(default_factory=dict)
    rag_evidence: list[dict[str, Any]] = Field(default_factory=list)
    user_feedback: str = ""
    locked_decisions: dict[str, Any] = Field(default_factory=dict)

    @field_validator("confirmed_question", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        return stripped_value


class AnalysisStrategyValidationRequest(BaseModel):
    graph: dict[str, Any] = Field(default_factory=dict)
    exposure: str = ""
    outcome: str = ""
    adjustment_set: list[str] = Field(default_factory=list)
    estimand: dict[str, Any] = Field(default_factory=dict)
    strategy: dict[str, Any] = Field(default_factory=dict)
    feasibility_result: dict[str, Any] = Field(default_factory=dict)
    schema_summary: dict[str, Any] = Field(default_factory=dict)


@router.post("/generate")
def generate_strategy(request: AnalysisStrategyRequest) -> dict[str, Any]:
    if not (request.dataset_filename and request.role_recommendations and request.identification_result):
        return generate_phase7_analysis_strategy(request.model_dump())

    try:
        return generate_analysis_strategy(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename or "",
            graph=request.graph,
            role_recommendations=request.role_recommendations or [],
            identification_result=request.identification_result or {},
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


@router.post("/validate")
def validate_strategy(request: AnalysisStrategyValidationRequest) -> dict[str, Any]:
    return validate_phase7_analysis_strategy(request.model_dump())
