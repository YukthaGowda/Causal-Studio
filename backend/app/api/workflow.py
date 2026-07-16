from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.orchestration.causal_workflow import (
    WorkflowError,
    advance_workflow,
    confirm_workflow,
    get_state,
    revise_workflow,
    start_workflow,
)


router = APIRouter(prefix="/workflow", tags=["workflow"])


class WorkflowStartRequest(BaseModel):
    project_title: str | None = None
    research_objective: str | None = None
    dataset_filename: str | None = None


class WorkflowAdvanceRequest(BaseModel):
    inputs: dict[str, Any] = Field(default_factory=dict)


class WorkflowConfirmRequest(BaseModel):
    confirmation: dict[str, Any] = Field(default_factory=dict)


class WorkflowReviseRequest(BaseModel):
    target_step: int = Field(..., ge=1, le=8)
    reason: str | None = None


@router.post("/start")
def start_causal_workflow(request: WorkflowStartRequest) -> dict[str, Any]:
    return start_workflow(request.model_dump(exclude_none=True))


@router.get("/{workflow_id}/state")
def read_causal_workflow_state(workflow_id: str) -> dict[str, Any]:
    try:
        return get_state(workflow_id)
    except WorkflowError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error


@router.post("/{workflow_id}/advance")
def advance_causal_workflow(
    workflow_id: str,
    request: WorkflowAdvanceRequest,
) -> dict[str, Any]:
    try:
        return advance_workflow(workflow_id, request.inputs)
    except WorkflowError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post("/{workflow_id}/confirm")
def confirm_causal_workflow(
    workflow_id: str,
    request: WorkflowConfirmRequest,
) -> dict[str, Any]:
    try:
        return confirm_workflow(workflow_id, request.confirmation)
    except WorkflowError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.post("/{workflow_id}/revise")
def revise_causal_workflow(
    workflow_id: str,
    request: WorkflowReviseRequest,
) -> dict[str, Any]:
    try:
        return revise_workflow(workflow_id, request.target_step, request.reason)
    except WorkflowError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
