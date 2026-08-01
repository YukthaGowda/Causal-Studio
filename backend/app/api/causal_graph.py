from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.causal_graph import (
    CausalGraphGenerationError,
    generate_and_validate_graph,
    validate_edited_graph,
)
from app.services.structured_causal_graph import (
    generate_structured_graph,
    validate_structured_graph,
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
    graph_type: str = Field(default="DAG")
    confirmed_question: str = Field(default="")
    exposure: str = Field(default="")
    outcome: str = Field(default="")
    comparator: dict[str, Any] = Field(default_factory=dict)
    time_window: dict[str, Any] = Field(default_factory=dict)
    schema_summary: dict[str, Any] = Field(default_factory=dict)
    locked_decisions: dict[str, Any] = Field(default_factory=dict)
    dataset_filename: str | None = None
    selected_variables: list[Any] = Field(default_factory=list)
    role_recommendations: list[Any] = Field(default_factory=list)
    provisional_roles: dict[str, Any] = Field(default_factory=dict)
    feasibility_result: dict[str, Any] = Field(default_factory=dict)
    rag_evidence: list[dict[str, Any]] = Field(default_factory=list)
    user_feedback: str = Field(default="")
    preserve_user_locked_edges: bool = True
    estimand_type: str = Field(default="total_effect", min_length=1)
    top_k_evidence: int = Field(default=5, ge=1, le=10)

    @field_validator("graph_type", "estimand_type")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Value cannot be empty.")
        return stripped_value


class ValidateGraphRequest(BaseModel):
    graph_type: str = Field(default="DAG")
    nodes: list[Any] = Field(default_factory=list)
    edges: list[Any] = Field(default_factory=list)
    exposure: str = Field(default="")
    outcome: str = Field(default="")
    adjustment_set: list[str] = Field(default_factory=list)
    timestamp_fields: list[str] = Field(default_factory=list)
    participant_id: str = Field(default="")
    selected_variables: list[Any] = Field(default_factory=list)
    feasibility_result: dict[str, Any] = Field(default_factory=dict)


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
        uses_legacy_llm_shape = (
            request.dataset_filename
            and request.confirmed_question.strip()
            and request.role_recommendations
            and request.selected_variables
            and all(isinstance(variable, dict) and "variable_name" in variable for variable in request.selected_variables)
        )
        if not uses_legacy_llm_shape:
            return generate_structured_graph(
                graph_type=request.graph_type,
                confirmed_question=request.confirmed_question,
                selected_variables=request.selected_variables,
                provisional_roles=request.provisional_roles,
                feasibility_result=request.feasibility_result,
                rag_evidence=request.rag_evidence,
                user_feedback=request.user_feedback,
                preserve_user_locked_edges=request.preserve_user_locked_edges,
            )

        return generate_and_validate_graph(
            confirmed_question=request.confirmed_question,
            dataset_filename=request.dataset_filename or "",
            selected_variables=request.selected_variables,
            role_recommendations=request.role_recommendations,
            estimand_type=request.estimand_type,
            top_k_evidence=request.top_k_evidence,
        )
    except CausalGraphGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post("/generate")
def generate_structured_graph_route(
    request: GenerateAndValidateGraphRequest,
) -> dict[str, Any]:
    try:
        provisional_roles = dict(request.provisional_roles)
        if request.exposure:
            provisional_roles.setdefault(request.exposure, "exposure")
        if request.outcome:
            provisional_roles.setdefault(request.outcome, "outcome")
        response = generate_structured_graph(
            graph_type=request.graph_type,
            confirmed_question=request.confirmed_question,
            selected_variables=request.selected_variables,
            provisional_roles=provisional_roles,
            feasibility_result=request.feasibility_result,
            rag_evidence=request.rag_evidence,
            user_feedback=request.user_feedback,
            preserve_user_locked_edges=request.preserve_user_locked_edges,
        )
        if request.graph_type.upper() != "DAG":
            warning = (
                "This graph type is currently experimental. Full representation-specific "
                "validation is not yet implemented."
            )
            response["warnings"] = list(dict.fromkeys([*response.get("warnings", []), warning]))
        response["graph_type"] = request.graph_type.upper()
        response["requires_user_review"] = True
        return response
    except CausalGraphGenerationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post("/validate")
def validate_graph(
    request: ValidateGraphRequest,
) -> dict[str, Any]:
    validation = validate_structured_graph(
        graph_type=request.graph_type,
        nodes=request.nodes,
        edges=request.edges,
        exposure=request.exposure,
        outcome=request.outcome,
        adjustment_set=request.adjustment_set,
        timestamp_fields=request.timestamp_fields,
        participant_id=request.participant_id,
        selected_variables=request.selected_variables,
        feasibility_result=request.feasibility_result,
    )
    return {
        key: value
        for key, value in validation.items()
        if not key.startswith("normalized_")
    }


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
