from __future__ import annotations

from typing import Any

from app.services.causal_questions import CausalQuestionGenerationError, resolve_dataset_path
from app.services.dataset_schema import DatasetSchemaError, get_sample_values, read_csv_dataset


HIGH_MISSINGNESS_THRESHOLD = 30.0
VERY_HIGH_MISSINGNESS_THRESHOLD = 50.0
MIN_NON_MISSING = 30
MIN_MEDIAN_ROWS_PER_PARTICIPANT = 2


class TargetedFeasibilityError(RuntimeError):
    pass


def normalize_variable_name(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        value = item.get("variable_name") or item.get("source_field") or item.get("name")
        return str(value).strip() if value else ""
    return ""


def scalar(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    return value


def round_number(value: Any, digits: int = 3) -> float | None:
    try:
        if value != value:
            return None
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def is_id_like(variable: str) -> bool:
    lowered = variable.lower()
    return lowered in {"pid", "id"} or any(token in lowered for token in ("participant", "subject", "patient"))


def is_time_like(variable: str) -> bool:
    lowered = variable.lower()
    return any(token in lowered for token in ("time", "date", "day", "week", "timestamp"))


def is_proxy_like(variable: str) -> bool:
    lowered = variable.lower()
    return any(token in lowered for token in ("acc_", "latitude", "longitude", "gps", "screen", "phone", "sensor"))


def summarize_variable(dataframe: Any, variable: str) -> dict[str, Any]:
    exists = variable in dataframe.columns
    if not exists:
        return {
            "variable_name": variable,
            "exists_in_dataset": False,
            "data_type": None,
            "missing_count": None,
            "missing_percentage": None,
            "unique_values": None,
            "sample_values": [],
            "numeric_summary": None,
            "categorical_summary": None,
            "feasibility_notes": ["Variable was not found in the uploaded dataset."],
            "warnings": [
                {
                    "warning_type": "selected_variable_not_found",
                    "message": f"{variable} was not found in the dataset.",
                    "severity": "blocking",
                }
            ],
        }

    series = dataframe[variable]
    row_count = len(dataframe)
    missing_count = int(series.isna().sum())
    missing_percentage = round((missing_count / row_count) * 100, 2) if row_count else 0.0
    unique_values = int(series.nunique(dropna=True))
    warnings = []
    notes = []

    if missing_percentage >= VERY_HIGH_MISSINGNESS_THRESHOLD:
        warnings.append(
            {
                "warning_type": "very_high_missingness",
                "message": f"{variable} has {missing_percentage}% missingness.",
                "severity": "high",
            }
        )
    elif missing_percentage >= HIGH_MISSINGNESS_THRESHOLD:
        warnings.append(
            {
                "warning_type": "high_missingness",
                "message": f"{variable} has {missing_percentage}% missingness.",
                "severity": "warning",
            }
        )

    if unique_values <= 1:
        warnings.append(
            {
                "warning_type": "low_variation",
                "message": f"{variable} has little or no observed variation.",
                "severity": "blocking",
            }
        )
    if is_proxy_like(variable):
        warnings.append(
            {
                "warning_type": "proxy_variable_uncertainty",
                "message": f"{variable} appears to be a proxy/sensing variable and needs measurement-validity review.",
                "severity": "warning",
            }
        )

    numeric_summary = None
    categorical_summary = None
    if str(series.dtype).startswith(("int", "float")):
        numeric_summary = {
            "min": round_number(series.min()),
            "max": round_number(series.max()),
            "mean": round_number(series.mean()),
            "median": round_number(series.median()),
            "std": round_number(series.std()),
        }
        notes.append("Numeric variable can be summarized for variation and overlap checks.")
    else:
        value_counts = series.dropna().astype(str).value_counts().head(8)
        categorical_summary = {
            "most_common_values": [
                {"value": str(index), "count": int(count)}
                for index, count in value_counts.items()
            ]
        }
        notes.append("Categorical/text-like variable summarized using most common values.")

    return {
        "variable_name": variable,
        "exists_in_dataset": True,
        "data_type": str(series.dtype),
        "missing_count": missing_count,
        "missing_percentage": missing_percentage,
        "unique_values": unique_values,
        "sample_values": [scalar(value) for value in get_sample_values(series)],
        "numeric_summary": numeric_summary,
        "categorical_summary": categorical_summary,
        "feasibility_notes": notes,
        "warnings": warnings,
    }


def check_variable_feasibility(dataframe: Any, variable: str | None, role: str) -> dict[str, Any]:
    if not variable:
        return {
            "variable": None,
            "exists": False,
            "has_variation": False,
            "non_missing_observations": 0,
            "status": "missing",
            "warnings": [
                {
                    "warning_type": f"missing_{role}",
                    "message": f"{role.capitalize()} is not specified.",
                    "severity": "blocking",
                }
            ],
        }

    if variable not in dataframe.columns:
        return {
            "variable": variable,
            "exists": False,
            "has_variation": False,
            "non_missing_observations": 0,
            "status": "missing",
            "warnings": [
                {
                    "warning_type": f"{role}_not_found",
                    "message": f"{role.capitalize()} {variable} was not found in the dataset.",
                    "severity": "blocking",
                }
            ],
        }

    series = dataframe[variable]
    non_missing = int(series.notna().sum())
    unique_values = int(series.nunique(dropna=True))
    warnings = []
    if unique_values <= 1:
        warnings.append(
            {
                "warning_type": f"no_{role}_variation",
                "message": f"{role.capitalize()} {variable} has little or no variation.",
                "severity": "blocking",
            }
        )
    if non_missing < MIN_NON_MISSING:
        warnings.append(
            {
                "warning_type": f"low_{role}_coverage",
                "message": f"{role.capitalize()} {variable} has only {non_missing} non-missing observations.",
                "severity": "high",
            }
        )
    if is_id_like(variable):
        warnings.append(
            {
                "warning_type": f"{role}_is_id_like",
                "message": f"{variable} looks like an ID/grouping column and should not be used as {role}.",
                "severity": "blocking",
            }
        )
    if is_time_like(variable):
        warnings.append(
            {
                "warning_type": f"{role}_is_time_like",
                "message": f"{variable} looks like a timestamp/context column; justify using it as {role}.",
                "severity": "warning",
            }
        )

    return {
        "variable": variable,
        "exists": True,
        "has_variation": unique_values > 1,
        "unique_values": unique_values,
        "non_missing_observations": non_missing,
        "status": "ready" if not any(w["severity"] == "blocking" for w in warnings) else "not_ready",
        "warnings": warnings,
    }


def participant_availability(dataframe: Any, participant_id_column: str | None) -> dict[str, Any]:
    if not participant_id_column or participant_id_column not in dataframe.columns:
        return {
            "participant_id_column": participant_id_column,
            "participant_id_exists": False,
            "repeated_measures_possible": False,
            "warnings": [
                {
                    "warning_type": "participant_id_missing",
                    "message": "Participant ID is missing or not found, limiting within-person feasibility checks.",
                    "severity": "high",
                }
            ],
        }

    counts = dataframe[participant_id_column].dropna().value_counts()
    if counts.empty:
        return {
            "participant_id_column": participant_id_column,
            "participant_id_exists": True,
            "repeated_measures_possible": False,
            "warnings": [
                {
                    "warning_type": "participant_id_empty",
                    "message": "Participant ID exists but has no non-missing values.",
                    "severity": "blocking",
                }
            ],
        }

    median_rows = round_number(counts.median(), 2)
    min_rows = int(counts.min())
    max_rows = int(counts.max())
    imbalance_ratio = round_number(max_rows / min_rows, 2) if min_rows else None
    few_rows = int((counts < MIN_MEDIAN_ROWS_PER_PARTICIPANT).sum())
    warnings = []
    if median_rows is not None and median_rows < MIN_MEDIAN_ROWS_PER_PARTICIPANT:
        warnings.append(
            {
                "warning_type": "insufficient_repeated_observations",
                "message": "Median rows per participant is too low for repeated-measures lag checks.",
                "severity": "blocking",
            }
        )
    if imbalance_ratio and imbalance_ratio >= 5:
        warnings.append(
            {
                "warning_type": "participant_imbalance",
                "message": "Participant row counts are imbalanced; coverage sensitivity checks are needed.",
                "severity": "warning",
            }
        )

    return {
        "participant_id_column": participant_id_column,
        "participant_id_exists": True,
        "number_of_participants": int(counts.shape[0]),
        "rows_per_participant": {
            "min": min_rows,
            "max": max_rows,
            "average": round_number(counts.mean(), 2),
            "median": median_rows,
            "imbalance_ratio": imbalance_ratio,
        },
        "participants_with_very_few_rows": few_rows,
        "repeated_measures_possible": bool(median_rows and median_rows >= MIN_MEDIAN_ROWS_PER_PARTICIPANT),
        "warnings": warnings,
    }


def lag_feasibility(
    *,
    dataframe: Any,
    participant_id_column: str | None,
    timestamp_column: str | None,
    lag_definition: str | None,
) -> dict[str, Any]:
    lag_text = (lag_definition or "").lower()
    needs_lag = any(token in lag_text for token in ("lag", "next", "prior", "previous", "window", "time"))
    warnings = []
    detected_time_variables = [
        column
        for column in dataframe.columns
        if is_time_like(str(column))
    ]
    if needs_lag and (not timestamp_column or timestamp_column not in dataframe.columns):
        warnings.append(
            {
                "warning_type": "timestamp_missing_or_unclear",
                "message": "Lag definition requires time ordering, but timestamp column is missing or unclear.",
                "severity": "high",
            }
        )
    if needs_lag and (not participant_id_column or participant_id_column not in dataframe.columns):
        warnings.append(
            {
                "warning_type": "participant_id_missing_for_lag",
                "message": "Within-person lag construction usually requires participant ID.",
                "severity": "high",
            }
        )
    if needs_lag and timestamp_column in dataframe.columns:
        warnings.append(
            {
                "warning_type": "lag_not_fully_verified",
                "message": "Exact lag timing cannot be fully confirmed by this broad deterministic check.",
                "severity": "warning",
            }
        )
    return {
        "lag_definition": lag_definition,
        "needs_time_ordering": needs_lag,
        "timestamp_column_exists": bool(timestamp_column and timestamp_column in dataframe.columns),
        "participant_id_exists": bool(participant_id_column and participant_id_column in dataframe.columns),
        "detected_time_variables": detected_time_variables,
        "status": "review_required" if warnings else "not_requested",
        "warnings": warnings,
    }


def overlap_summary(dataframe: Any, exposure: str | None, comparator: str | None) -> dict[str, Any]:
    if not exposure or exposure not in dataframe.columns:
        return {
            "exposure": exposure,
            "comparator": comparator,
            "status": "unavailable",
            "warnings": [
                {
                    "warning_type": "overlap_unavailable",
                    "message": "Exposure is missing, so overlap/comparator feasibility cannot be assessed.",
                    "severity": "blocking",
                }
            ],
        }

    series = dataframe[exposure].dropna()
    warnings = []
    if not comparator:
        warnings.append(
            {
                "warning_type": "comparator_unclear",
                "message": "Comparator is not defined; positivity/overlap cannot be fully assessed yet.",
                "severity": "warning",
            }
        )
    distribution = None
    if str(series.dtype).startswith(("int", "float")):
        distribution = {
            "min": round_number(series.min()),
            "max": round_number(series.max()),
            "mean": round_number(series.mean()),
            "median": round_number(series.median()),
            "std": round_number(series.std()),
        }
        if series.nunique(dropna=True) <= 1:
            warnings.append(
                {
                    "warning_type": "no_exposure_overlap",
                    "message": "Exposure has no variation, so comparator/overlap is not feasible.",
                    "severity": "blocking",
                }
            )
    else:
        counts = series.astype(str).value_counts().head(8)
        distribution = {
            "category_counts": [
                {"value": str(index), "count": int(count)}
                for index, count in counts.items()
            ]
        }
        if counts.shape[0] <= 1:
            warnings.append(
                {
                    "warning_type": "no_exposure_group_variation",
                    "message": "Exposure has only one observed category.",
                    "severity": "blocking",
                }
            )

    return {
        "exposure": exposure,
        "comparator": comparator,
        "status": "review_required" if warnings else "initially_plausible",
        "exposure_distribution": distribution,
        "warnings": warnings,
    }


def redundancy_summary(dataframe: Any, selected_variables: list[str]) -> dict[str, Any]:
    numeric_selected = [
        variable
        for variable in selected_variables
        if variable in dataframe.columns and str(dataframe[variable].dtype).startswith(("int", "float"))
    ]
    if len(numeric_selected) < 2:
        return {
            "numeric_variables_checked": numeric_selected,
            "high_correlations": [],
            "warning": "Correlation among selected numeric variables is exploratory only and does not establish causality.",
        }
    corr = dataframe[numeric_selected].corr(numeric_only=True)
    high = []
    for index, left in enumerate(numeric_selected):
        for right in numeric_selected[index + 1 :]:
            value = round_number(corr.loc[left, right], 3)
            if value is not None and abs(value) >= 0.9:
                high.append({"column_a": left, "column_b": right, "correlation": value})
    return {
        "numeric_variables_checked": numeric_selected,
        "high_correlations": high,
        "warning": "High correlations may indicate redundancy; correlation is not causation.",
    }


def derive_status(warnings: list[dict[str, Any]], score: int) -> str:
    if any(w["severity"] == "blocking" for w in warnings):
        return "not_feasible_with_current_data"
    if any(w["severity"] == "high" for w in warnings) and score < 55:
        return "needs_revision_before_graph"
    if warnings:
        return "feasible_with_warnings"
    return "feasible_for_graph_design"


def run_targeted_feasibility(
    *,
    dataset_filename: str,
    confirmed_question: str,
    selected_variables: list[Any],
    exposure: str | None = None,
    outcome: str | None = None,
    comparator: str | None = None,
    participant_id_column: str | None = None,
    timestamp_column: str | None = None,
    time_window: str | None = None,
    lag_definition: str | None = None,
    top_k_evidence: int = 5,
) -> dict[str, Any]:
    del top_k_evidence
    if not confirmed_question.strip():
        raise TargetedFeasibilityError("confirmed_question cannot be empty.")

    normalized_variables = [
        variable for variable in (normalize_variable_name(item) for item in selected_variables) if variable
    ]
    if not normalized_variables:
        raise TargetedFeasibilityError("selected_variables cannot be empty.")

    try:
        dataset_path = resolve_dataset_path(dataset_filename)
        dataframe = read_csv_dataset(dataset_path)
    except (CausalQuestionGenerationError, DatasetSchemaError) as error:
        raise TargetedFeasibilityError(str(error)) from error

    selected_summaries = [
        summarize_variable(dataframe, variable) for variable in normalized_variables
    ]
    missing_variables = [
        summary["variable_name"] for summary in selected_summaries if not summary["exists_in_dataset"]
    ]
    exposure_result = check_variable_feasibility(dataframe, exposure, "exposure")
    outcome_result = check_variable_feasibility(dataframe, outcome, "outcome")
    participant_result = participant_availability(dataframe, participant_id_column)
    lag_result = lag_feasibility(
        dataframe=dataframe,
        participant_id_column=participant_id_column,
        timestamp_column=timestamp_column,
        lag_definition=lag_definition,
    )
    overlap_result = overlap_summary(dataframe, exposure, comparator)
    redundancy_result = redundancy_summary(dataframe, normalized_variables)

    all_warnings: list[dict[str, Any]] = [
        {
            "warning_type": "targeted_exploration_not_causal",
            "message": "Targeted exploration checks implementation feasibility and does not establish causality.",
            "severity": "info",
        }
    ]
    for summary in selected_summaries:
        for warning in summary["warnings"]:
            all_warnings.append({**warning, "variable": summary["variable_name"]})
    for section in (exposure_result, outcome_result, participant_result, lag_result, overlap_result):
        all_warnings.extend(section.get("warnings", []))
    if redundancy_result["high_correlations"]:
        all_warnings.append(
            {
                "warning_type": "high_selected_variable_correlation",
                "message": "One or more selected numeric variables are highly correlated; review redundancy.",
                "severity": "warning",
            }
        )

    blocking_count = sum(1 for warning in all_warnings if warning["severity"] == "blocking")
    high_count = sum(1 for warning in all_warnings if warning["severity"] == "high")
    warning_count = sum(1 for warning in all_warnings if warning["severity"] == "warning")
    score = max(0, 100 - blocking_count * 35 - high_count * 18 - warning_count * 5)
    status = derive_status(all_warnings, score)
    safe_to_continue = status in {"feasible_for_graph_design", "feasible_with_warnings"}

    revision_actions = []
    if missing_variables:
        revision_actions.append("Return to Step 4 and replace missing selected variables.")
    if not exposure_result["exists"] or exposure_result["status"] == "not_ready":
        revision_actions.append("Revise the exposure definition before graph design.")
    if not outcome_result["exists"] or outcome_result["status"] == "not_ready":
        revision_actions.append("Revise the outcome definition before graph design.")
    if any(w["warning_type"] in {"timestamp_missing_or_unclear", "lag_not_fully_verified"} for w in all_warnings):
        revision_actions.append("Clarify the lag/window definition and timestamp structure.")
    if any("missingness" in w["warning_type"] for w in all_warnings):
        revision_actions.append("Review missingness or choose more complete variables.")
    if not revision_actions:
        revision_actions.append("Proceed to Step 6 only after user review of warnings.")

    analysis_ready_non_missing = None
    if exposure in dataframe.columns and outcome in dataframe.columns:
        required = [exposure, outcome, *[v for v in normalized_variables if v in dataframe.columns]]
        analysis_ready_non_missing = int(dataframe[list(dict.fromkeys(required))].dropna().shape[0])

    return {
        "dataset_filename": dataset_path.name,
        "confirmed_question": confirmed_question.strip(),
        "selected_variables_checked": normalized_variables,
        "missing_selected_variables": missing_variables,
        "exposure": exposure,
        "outcome": outcome,
        "participant_id_column": participant_id_column,
        "timestamp_column": timestamp_column,
        "feasibility_status": status,
        "feasibility_score": score,
        "variable_summaries": selected_summaries,
        "exposure_feasibility": exposure_result,
        "outcome_feasibility": outcome_result,
        "lag_feasibility": lag_result,
        "temporal_ordering_summary": {
            "time_window": time_window,
            "lag_definition": lag_definition,
            "timestamp_column": timestamp_column,
            "warning": "Exact temporal ordering must be user-reviewed before causal graph design.",
        },
        "missingness_and_coverage_summary": {
            "selected_variables_above_30_percent_missing": [
                summary["variable_name"]
                for summary in selected_summaries
                if summary["exists_in_dataset"] and summary["missing_percentage"] >= HIGH_MISSINGNESS_THRESHOLD
            ],
            "analysis_ready_complete_case_rows": analysis_ready_non_missing,
        },
        "participant_level_availability": participant_result,
        "overlap_or_comparator_summary": overlap_result,
        "redundancy_or_correlation_summary": redundancy_result,
        "derived_feature_feasibility": {
            "lagged_exposure_possible": bool(
                exposure in dataframe.columns
                and participant_id_column in dataframe.columns
                and timestamp_column in dataframe.columns
            ),
            "previous_window_outcome_possible": bool(
                outcome in dataframe.columns
                and participant_id_column in dataframe.columns
                and timestamp_column in dataframe.columns
            ),
            "rolling_or_cumulative_features_possible": bool(
                participant_id_column in dataframe.columns and timestamp_column in dataframe.columns
            ),
            "leakage_warning": "Do not use future outcome information to construct exposure or adjustment features.",
        },
        "analysis_ready_sample_summary": {
            "total_rows": int(len(dataframe)),
            "complete_case_rows_for_selected_variables": int(
                dataframe[[v for v in normalized_variables if v in dataframe.columns]].dropna().shape[0]
            ),
            "complete_case_rows_for_exposure_outcome_and_selected": analysis_ready_non_missing,
        },
        "data_quality_warnings": all_warnings,
        "recommended_revision_actions": revision_actions,
        "safe_to_continue_to_graph": safe_to_continue,
        "exploration_warning": "Targeted exploration checks implementation feasibility. It does not establish causality.",
    }
