from __future__ import annotations

from typing import Any

from app.services.causal_questions import (
    CausalQuestionGenerationError,
    resolve_dataset_path,
)
from app.services.dataset_schema import (
    DatasetSchemaError,
    parse_dataset_schema,
    read_csv_dataset,
)


HIGH_MISSINGNESS_THRESHOLD = 30.0
VERY_HIGH_MISSINGNESS_THRESHOLD = 50.0
DEFAULT_LIMIT = 10


class BroadExplorationError(RuntimeError):
    pass


def scalar(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    return value


def round_float(value: Any, digits: int = 3) -> float | None:
    try:
        if value != value:
            return None
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def summarize_missingness(schema: dict[str, Any]) -> dict[str, Any]:
    percentages = schema["missing_value_percentage_per_column"]
    highest = sorted(
        (
            {
                "column": column,
                "missing_percentage": percentage,
                "severity": "high"
                if percentage >= VERY_HIGH_MISSINGNESS_THRESHOLD
                else "warning"
                if percentage >= HIGH_MISSINGNESS_THRESHOLD
                else "info",
            }
            for column, percentage in percentages.items()
        ),
        key=lambda item: item["missing_percentage"],
        reverse=True,
    )[:DEFAULT_LIMIT]

    return {
        "highest_missingness_columns": highest,
        "high_missingness_columns": [
            item for item in highest if item["missing_percentage"] >= HIGH_MISSINGNESS_THRESHOLD
        ],
    }


def infer_possible_outcomes(columns: list[str]) -> list[str]:
    tokens = ("label", "outcome", "target", "alcohol", "drink", "binge", "use")
    return [
        column
        for column in columns
        if any(token in column.lower() for token in tokens)
    ]


def summarize_low_variation(schema: dict[str, Any], row_count: int) -> list[dict[str, Any]]:
    low_variation = []
    for column, unique_count in schema["unique_values_per_column"].items():
        unique_ratio = unique_count / row_count if row_count else 0
        if unique_count <= 1 or (row_count >= 100 and unique_ratio <= 0.01):
            low_variation.append(
                {
                    "column": column,
                    "unique_values": unique_count,
                    "unique_ratio": round(unique_ratio, 4),
                }
            )
    return low_variation[:DEFAULT_LIMIT]


def summarize_participants(dataframe: Any, id_column: str | None) -> dict[str, Any] | None:
    if not id_column or id_column not in dataframe.columns:
        return None

    counts = dataframe[id_column].dropna().value_counts()
    if counts.empty:
        return None

    min_rows = int(counts.min())
    max_rows = int(counts.max())
    average_rows = round_float(counts.mean(), 2)
    imbalance_ratio = round_float(max_rows / min_rows, 2) if min_rows else None
    warnings = []
    if imbalance_ratio and imbalance_ratio >= 5:
        warnings.append(
            "Participant row counts are imbalanced; repeated-measures analyses may need coverage checks."
        )

    return {
        "participant_id_column": id_column,
        "number_of_unique_participants": int(counts.shape[0]),
        "rows_per_participant": {
            "min": min_rows,
            "max": max_rows,
            "average": average_rows,
            "median": round_float(counts.median(), 2),
            "imbalance_ratio": imbalance_ratio,
        },
        "warnings": warnings,
    }


def summarize_temporal(dataframe: Any, timestamp_columns: list[str], selected_column: str | None) -> dict[str, Any]:
    import pandas as pd

    common_fields = [
        column
        for column in dataframe.columns
        if str(column).lower() in {"time_of_day", "day_of_week"}
    ]
    parse_candidates = [selected_column] if selected_column else timestamp_columns
    parse_candidates = [column for column in parse_candidates if column in dataframe.columns]
    parsed_summary = None
    warnings = []

    for column in parse_candidates:
        parsed = pd.to_datetime(dataframe[column], errors="coerce")
        parse_rate = parsed.notna().mean() if len(parsed) else 0
        if parse_rate >= 0.8:
            parsed_summary = {
                "timestamp_column": column,
                "min_timestamp": parsed.min().isoformat() if parsed.notna().any() else None,
                "max_timestamp": parsed.max().isoformat() if parsed.notna().any() else None,
                "number_of_unique_days": int(parsed.dt.date.nunique(dropna=True)),
                "parse_success_rate": round_float(parse_rate * 100, 2),
            }
            break

    if timestamp_columns and not parsed_summary:
        warnings.append("Timestamp/date structure was detected by name, but parsing is unclear.")

    return {
        "detected_timestamp_columns": timestamp_columns,
        "common_time_fields": common_fields,
        "parsed_timestamp_summary": parsed_summary,
        "warnings": warnings,
    }


def group_sensor_features(columns: list[str]) -> dict[str, list[str]]:
    groups = {
        "accelerometer": [],
        "mobility_location": [],
        "temporal": [],
        "screen_phone": [],
        "label_outcome_like": [],
        "other": [],
    }
    for column in columns:
        lowered = column.lower()
        if lowered.startswith("acc") or "accelerometer" in lowered:
            groups["accelerometer"].append(column)
        elif any(token in lowered for token in ("latitude", "longitude", "gps", "location")):
            groups["mobility_location"].append(column)
        elif any(token in lowered for token in ("time", "day", "date", "week")):
            groups["temporal"].append(column)
        elif any(token in lowered for token in ("screen", "phone")):
            groups["screen_phone"].append(column)
        elif any(token in lowered for token in ("label", "outcome", "target", "alcohol", "drink")):
            groups["label_outcome_like"].append(column)
        else:
            groups["other"].append(column)

    return {name: values[:25] for name, values in groups.items() if values}


def summarize_correlations(dataframe: Any, numeric_columns: list[str], max_columns: int) -> dict[str, Any]:
    if len(numeric_columns) < 2:
        return {
            "numeric_columns_used": numeric_columns,
            "strongest_positive": [],
            "strongest_negative": [],
            "warning": "Correlation summary requires at least two numeric columns and is exploratory only.",
        }

    selected_columns = numeric_columns[:max_columns]
    correlation_matrix = dataframe[selected_columns].corr(numeric_only=True)
    correlations = []
    for index, column_a in enumerate(selected_columns):
        for column_b in selected_columns[index + 1 :]:
            value = round_float(correlation_matrix.loc[column_a, column_b], 3)
            if value is None:
                continue
            correlations.append(
                {
                    "column_a": column_a,
                    "column_b": column_b,
                    "correlation": value,
                }
            )

    strongest_positive = sorted(
        [item for item in correlations if item["correlation"] > 0],
        key=lambda item: item["correlation"],
        reverse=True,
    )[:DEFAULT_LIMIT]
    strongest_negative = sorted(
        [item for item in correlations if item["correlation"] < 0],
        key=lambda item: item["correlation"],
    )[:DEFAULT_LIMIT]

    return {
        "numeric_columns_used": selected_columns,
        "strongest_positive": strongest_positive,
        "strongest_negative": strongest_negative,
        "warning": "Broad correlations are exploratory associations only and do not establish causality.",
    }


def build_data_quality_warnings(
    *,
    schema: dict[str, Any],
    participant_summary: dict[str, Any] | None,
    temporal_summary: dict[str, Any],
    possible_outcomes: list[str],
) -> list[dict[str, str]]:
    warnings = [
        {
            "warning_type": "exploration_not_causal",
            "message": "Broad associations and patterns do not establish causality.",
            "severity": "info",
        }
    ]

    for item in summarize_missingness(schema)["high_missingness_columns"]:
        warnings.append(
            {
                "warning_type": "high_missingness",
                "column": item["column"],
                "message": f"{item['column']} has {item['missing_percentage']}% missingness.",
                "severity": item["severity"],
            }
        )

    if participant_summary:
        warnings.append(
            {
                "warning_type": "possible_repeated_measures",
                "column": participant_summary["participant_id_column"],
                "message": "Participant ID detected; rows may be repeated observations within participant.",
                "severity": "warning",
            }
        )
        for message in participant_summary["warnings"]:
            warnings.append(
                {
                    "warning_type": "participant_imbalance",
                    "message": message,
                    "severity": "warning",
                }
            )

    for message in temporal_summary["warnings"]:
        warnings.append(
            {
                "warning_type": "unclear_timestamp_structure",
                "message": message,
                "severity": "warning",
            }
        )

    if possible_outcomes:
        warnings.append(
            {
                "warning_type": "possible_outcome_columns",
                "message": f"Outcome/label-like columns detected: {', '.join(possible_outcomes[:8])}.",
                "severity": "info",
            }
        )

    location_columns = [
        column
        for column in schema["column_names"]
        if any(token in column.lower() for token in ("latitude", "longitude", "gps", "location"))
    ]
    if location_columns:
        warnings.append(
            {
                "warning_type": "location_data_sensitivity",
                "message": f"Location/GPS-like columns may be sensitive and may have missingness: {', '.join(location_columns[:8])}.",
                "severity": "warning",
            }
        )

    return warnings


def explore_broad_dataset(
    *,
    dataset_filename: str,
    max_columns: int = 30,
    target_column: str | None = None,
    participant_id_column: str | None = None,
    timestamp_column: str | None = None,
) -> dict[str, Any]:
    try:
        dataset_path = resolve_dataset_path(dataset_filename)
    except CausalQuestionGenerationError as error:
        raise BroadExplorationError(str(error)) from error

    try:
        dataframe = read_csv_dataset(dataset_path)
        schema = parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise BroadExplorationError(str(error)) from error

    normalized_max_columns = max(2, min(max_columns, 50))
    columns = schema["column_names"]
    id_columns = schema["possible_id_columns"]
    timestamp_columns = schema["possible_timestamp_date_columns"]
    numeric_columns = schema["possible_numeric_columns"]
    categorical_columns = schema["possible_categorical_columns"]
    chosen_id = participant_id_column if participant_id_column in columns else (id_columns[0] if id_columns else None)
    chosen_timestamp = timestamp_column if timestamp_column in columns else None

    missingness_summary = summarize_missingness(schema)
    participant_summary = summarize_participants(dataframe, chosen_id)
    temporal_summary = summarize_temporal(dataframe, timestamp_columns, chosen_timestamp)
    possible_outcomes = infer_possible_outcomes(columns)
    high_missingness_columns = missingness_summary["high_missingness_columns"]

    return {
        "dataset_filename": dataset_path.name,
        "number_of_rows": schema["number_of_rows"],
        "number_of_columns": schema["number_of_columns"],
        "possible_id_columns": id_columns,
        "possible_timestamp_columns": timestamp_columns,
        "numeric_columns": numeric_columns,
        "categorical_columns": categorical_columns,
        "missingness_summary": missingness_summary,
        "high_missingness_columns": high_missingness_columns,
        "low_variation_columns": summarize_low_variation(schema, schema["number_of_rows"]),
        "possible_label_or_outcome_columns": possible_outcomes,
        "target_column": target_column if target_column in columns else None,
        "participant_summary": participant_summary,
        "temporal_summary": temporal_summary,
        "sensor_or_feature_groups": group_sensor_features(columns),
        "broad_correlation_summary": summarize_correlations(
            dataframe,
            numeric_columns,
            normalized_max_columns,
        ),
        "data_quality_warnings": build_data_quality_warnings(
            schema=schema,
            participant_summary=participant_summary,
            temporal_summary=temporal_summary,
            possible_outcomes=possible_outcomes,
        ),
        "exploration_warning": (
            "Exploratory patterns can support hypothesis generation, but they do not establish causality."
        ),
    }
