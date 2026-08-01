from typing import Any, Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.services.targeted_feasibility import (
    TargetedFeasibilityError,
    run_targeted_feasibility,
)


router = APIRouter(prefix="/feasibility", tags=["feasibility"])


class ComparatorDefinition(BaseModel):
    type: Literal["binary", "threshold", "continuous_unit_change", "custom"] = "continuous_unit_change"
    reference: str = ""
    treatment: str = ""


class TimeWindowDefinition(BaseModel):
    exposure_window: str = ""
    lag: str = ""
    outcome_window: str = ""


class FeasibilityCheckRequest(BaseModel):
    dataset_filename: str = Field(..., min_length=1)
    confirmed_question: str = Field(..., min_length=1)
    exposure: str = Field(..., min_length=1)
    outcome: str = Field(..., min_length=1)
    comparator: ComparatorDefinition = Field(default_factory=ComparatorDefinition)
    time_window: TimeWindowDefinition = Field(default_factory=TimeWindowDefinition)
    selected_variables: list[str] = Field(default_factory=list)
    candidate_confounders: list[str] = Field(default_factory=list)
    candidate_mediators: list[str] = Field(default_factory=list)
    effect_modifiers: list[str] = Field(default_factory=list)
    proxy_variables: list[str] = Field(default_factory=list)
    derived_features: list[Any] = Field(default_factory=list)
    participant_id: str = "pid"
    timestamp: str = "time_stamp"

    @field_validator("dataset_filename", "confirmed_question", "exposure", "outcome")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("Required text field cannot be empty.")
        return stripped_value


def flatten_time_window(time_window: TimeWindowDefinition) -> str:
    parts = [
        f"exposure: {time_window.exposure_window}" if time_window.exposure_window else "",
        f"lag: {time_window.lag}" if time_window.lag else "",
        f"outcome: {time_window.outcome_window}" if time_window.outcome_window else "",
    ]
    return "; ".join(part for part in parts if part)


def flatten_comparator(comparator: ComparatorDefinition) -> str:
    details = [comparator.type]
    if comparator.reference:
        details.append(f"reference={comparator.reference}")
    if comparator.treatment:
        details.append(f"treatment={comparator.treatment}")
    return "; ".join(details)


def phase5_status(raw_status: str) -> str:
    return {
        "feasible_for_graph_design": "ready",
        "feasible_with_warnings": "marginal",
        "needs_revision_before_graph": "requires_revision",
        "not_feasible_with_current_data": "not_feasible",
    }.get(raw_status, "requires_revision")


def summarize_status(status_name: str, warning_count: int, blocking_count: int) -> str:
    if status_name == "ready":
        return "Ready to proceed to graph design after user review."
    if status_name == "marginal":
        return f"Technically possible, but {warning_count} limitation(s) should be explicitly accepted."
    if status_name == "not_feasible":
        return f"The current data cannot support this proposed analysis; {blocking_count} blocking issue(s) were found."
    return f"Please revise the question, exposure, comparator, timing, or variables before graph design; {blocking_count} blocking issue(s) were found."


def adapt_targeted_result(
    raw_result: dict[str, Any],
    request: FeasibilityCheckRequest,
) -> dict[str, Any]:
    warnings = raw_result.get("data_quality_warnings", [])
    blocking_issues = [warning for warning in warnings if warning.get("severity") == "blocking"]
    status_name = phase5_status(raw_result.get("feasibility_status", ""))

    missingness_rows = [
        {
            "variable": item.get("variable_name"),
            "missing_count": item.get("missing_count"),
            "missing_percentage": item.get("missing_percentage"),
            "severity": "high" if (item.get("missing_percentage") or 0) >= 30 else "ok",
        }
        for item in raw_result.get("variable_summaries", [])
    ]

    return {
        "status": status_name,
        "summary": summarize_status(status_name, len(warnings), len(blocking_issues)),
        "dataset_filename": raw_result.get("dataset_filename"),
        "confirmed_question": raw_result.get("confirmed_question"),
        "exposure_check": raw_result.get("exposure_feasibility", {}),
        "outcome_check": raw_result.get("outcome_feasibility", {}),
        "comparator_check": {
            "definition": request.comparator.model_dump(),
            "overlap_summary": raw_result.get("overlap_or_comparator_summary", {}),
        },
        "missingness_check": {
            "variables": missingness_rows,
            "high_missingness_variables": raw_result.get("missingness_and_coverage_summary", {}).get(
                "selected_variables_above_30_percent_missing",
                [],
            ),
        },
        "coverage_check": raw_result.get("participant_level_availability", {}),
        "temporal_ordering_check": raw_result.get("temporal_ordering_summary", {}),
        "lag_feasibility_check": raw_result.get("lag_feasibility", {}),
        "overlap_positivity_check": raw_result.get("overlap_or_comparator_summary", {}),
        "correlation_redundancy_check": raw_result.get("redundancy_or_correlation_summary", {}),
        "derived_feature_check": {
            **raw_result.get("derived_feature_feasibility", {}),
            "requested_derived_features": request.derived_features,
        },
        "analysis_ready_sample_check": raw_result.get("analysis_ready_sample_summary", {}),
        "warnings": warnings,
        "blocking_issues": blocking_issues,
        "recommended_revisions": raw_result.get("recommended_revision_actions", []),
        "safe_to_continue_to_graph": bool(raw_result.get("safe_to_continue_to_graph", False)),
        "python_calculation_note": (
            "Python calculated these implementation diagnostics from the uploaded dataset. "
            "They do not estimate an effect or establish causality."
        ),
    }


@router.post("/check")
def check_targeted_feasibility(request: FeasibilityCheckRequest) -> dict[str, Any]:
    selected_variables = list(
        dict.fromkeys(
            [
                request.exposure,
                request.outcome,
                request.participant_id,
                request.timestamp,
                *request.selected_variables,
                *request.candidate_confounders,
                *request.candidate_mediators,
                *request.effect_modifiers,
                *request.proxy_variables,
            ]
        )
    )
    try:
        raw_result = run_targeted_feasibility(
            dataset_filename=request.dataset_filename,
            confirmed_question=request.confirmed_question,
            selected_variables=selected_variables,
            exposure=request.exposure,
            outcome=request.outcome,
            comparator=flatten_comparator(request.comparator),
            participant_id_column=request.participant_id,
            timestamp_column=request.timestamp,
            time_window=flatten_time_window(request.time_window),
            lag_definition=request.time_window.lag,
        )
    except TargetedFeasibilityError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    return adapt_targeted_result(raw_result, request)
