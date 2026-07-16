from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.causal_graph import (
    CausalGraphGenerationError,
    generate_and_validate_graph,
    validate_edited_graph,
)


router = APIRouter(prefix="/causal-graph", tags=["causal-graph"])


class SelectedGraphVariable(BaseModel):
    variable_name: str = Field(..., min_length=1)
    source_field: str | None = None
    data_category: str | None = None
    direct_or_derived: str | None = None
    measurement_timing: str | None = None
    missingness_warning: str | None = None
    user_notes: str | None = None


class GraphRoleRecommendation(BaseModel):
    variable_name: str = Field(..., min_length=1)
    recommended_roles: list[str] = Field(default_factory=list)
    primary_role: str | None = None
    temporal_role: str | None = None
    measurement_role: str | None = None
    adjustment_recommendation: str | None = None
    confidence: str | None = None
    rationale: str | None = None


class GenerateAndValidateGraphRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    selected_variables: list[SelectedGraphVariable] = Field(..., min_length=1)
    role_recommendations: list[GraphRoleRecommendation] = Field(..., min_length=1)
    estimand_type: str = Field(default="total_effect", min_length=1)
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("confirmed_question", "dataset_filename", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


class ValidateEditedGraphRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    graph_draft: dict[str, Any] = Field(..., min_length=1)
    selected_variables: list[SelectedGraphVariable] = Field(..., min_length=1)
    role_recommendations: list[GraphRoleRecommendation] = Field(..., min_length=1)
    estimand_type: str = Field(default="total_effect", min_length=1)

    @field_validator("confirmed_question", "dataset_filename", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/generate-and-validate")
def generate_graph(
    request: GenerateAndValidateGraphRequest,
) -> dict[str, Any]:
    try:
        return generate_and_validate_graph(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            selected_variables=[
                variable.model_dump(exclude_none=True)
                for variable in request.selected_variables
            ],
            role_recommendations=[
                role.model_dump(exclude_none=True)
                for role in request.role_recommendations
            ],
            estimand_type=request.estimand_type,
            top_k_evidence=request.top_k_evidence,
        )
    except CausalGraphGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post("/validate-edited")
def validate_edited_graph_route(
    request: ValidateEditedGraphRequest,
) -> dict[str, Any]:
    try:
        return validate_edited_graph(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            graph_draft=request.graph_draft,
            selected_variables=[
                variable.model_dump(exclude_none=True)
                for variable in request.selected_variables
            ],
            role_recommendations=[
                role.model_dump(exclude_none=True)
                for role in request.role_recommendations
            ],
            estimand_type=request.estimand_type,
        )
    except CausalGraphGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
