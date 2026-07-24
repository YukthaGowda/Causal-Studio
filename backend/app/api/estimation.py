from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.estimation import (
    EstimationError,
    interpret_estimation_result,
    list_estimation_runs,
    run_estimation,
)


router = APIRouter(prefix="/estimation", tags=["estimation"])


class Comparator(BaseModel):
    type: str = "continuous_unit_change"
    reference: str | None = None
    treatment: str | None = None


class TimeWindow(BaseModel):
    exposure_window: str | None = None
    lag: str | None = None
    outcome_window: str | None = None


class RunEstimationRequest(BaseModel):
    dataset_filename: str = Field(..., min_length=1)
    confirmed_question: str = ""
    estimand: str = "ATE"
    exposure: str = Field(..., min_length=1)
    comparator: Comparator = Field(default_factory=Comparator)
    outcome: str = Field(..., min_length=1)
    adjustment_set: list[str] = Field(default_factory=list)
    participant_id: str = ""
    timestamp: str = ""
    time_window: TimeWindow = Field(default_factory=TimeWindow)
    estimator: str = "statsmodels_linear"
    missing_data_strategy: str = "complete_case"
    cluster_or_repeated_measures: str = "cluster_by_participant"
    random_seed: int = 42
    identification_confirmed: bool = False
    graph_confirmed: bool = False
    assumptions_reviewed: bool = False
    allow_unconfirmed_analysis: bool = False


class InterpretEstimationRequest(BaseModel):
    estimation_result: dict[str, Any] = Field(default_factory=dict)
    user_question: str = ""


@router.post("/run")
def run_estimation_endpoint(request: RunEstimationRequest) -> dict[str, Any]:
    try:
        return run_estimation(request.model_dump())
    except EstimationError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error


@router.get("/runs")
def list_runs_endpoint() -> dict[str, Any]:
    return list_estimation_runs()


@router.post("/interpret")
def interpret_estimation_endpoint(request: InterpretEstimationRequest) -> dict[str, Any]:
    return interpret_estimation_result(request.model_dump())
