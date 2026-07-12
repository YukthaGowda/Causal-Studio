from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.causal_roles import (
    CausalRoleRecommendationError,
    recommend_and_validate_roles,
)


router = APIRouter(prefix="/causal-roles", tags=["causal-roles"])


class SelectedVariable(BaseModel):
    variable_name: str = Field(..., min_length=1)
    source_field: str | None = None
    data_category: str | None = None
    direct_or_derived: str | None = None
    measurement_timing: str | None = None
    user_notes: str | None = None
    missingness_warning: str | None = None
    possible_role_hint: str | None = None

    @field_validator("variable_name")
    @classmethod
    def validate_variable_name(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("variable_name cannot be empty.")
        return stripped_value


class RecommendAndValidateRolesRequest(BaseModel):
    confirmed_question: str = Field(..., min_length=1)
    dataset_filename: str = Field(..., min_length=1)
    selected_variables: list[SelectedVariable] = Field(..., min_length=1)
    estimand_type: str = Field(default="total_effect", min_length=1)
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("confirmed_question", "dataset_filename", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


@router.post("/recommend-and-validate")
def recommend_and_validate(
    request: RecommendAndValidateRolesRequest,
) -> dict[str, Any]:
    try:
        return recommend_and_validate_roles(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename,
            selected_variables=[
                variable.model_dump(exclude_none=True)
                for variable in request.selected_variables
            ],
            estimand_type=request.estimand_type,
            top_k_evidence=request.top_k_evidence,
        )
    except CausalRoleRecommendationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
