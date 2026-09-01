from __future__ import annotations

from pathlib import Path
from typing import Any


HIGH_MISSINGNESS_THRESHOLD = 50.0
SAMPLE_VALUE_LIMIT = 5


class DatasetSchemaError(RuntimeError):
    pass


def read_csv_dataset(file_path: Path) -> Any:
    """Read an allowed dataset while preserving the existing caller interface."""
    try:
        import pandas as pd
    except ImportError as error:
        raise DatasetSchemaError("Missing dependency: pandas") from error

    extension = file_path.suffix.lower()
    try:
        if extension == ".csv":
            return pd.read_csv(file_path)
        if extension in {".xlsx", ".xls"}:
            return pd.read_excel(file_path)
    except pd.errors.EmptyDataError as error:
        raise DatasetSchemaError("CSV file is empty or has no readable columns.") from error
    except UnicodeDecodeError as error:
        raise DatasetSchemaError(
            "CSV file could not be decoded. Save it as UTF-8 CSV and try again."
        ) from error
    except Exception as error:
        if extension in {".xlsx", ".xls"}:
            raise DatasetSchemaError(
                "Excel dataset could not be parsed. Please check the file format and sheet contents."
            ) from error
        raise DatasetSchemaError(f"CSV file could not be read: {error}") from error

    raise DatasetSchemaError("Unsupported dataset type. Upload a .csv, .xlsx, or .xls file.")


def get_sample_values(series: Any) -> list[Any]:
    values = series.dropna().drop_duplicates().head(SAMPLE_VALUE_LIMIT).tolist()
    return [value.item() if hasattr(value, "item") else value for value in values]


def infer_possible_id_columns(dataframe: Any) -> list[str]:
    possible_ids: list[str] = []
    id_name_tokens = ("id", "participant", "subject", "patient", "record")
    for column in dataframe.columns:
        column_lower = str(column).lower()
        if any(token in column_lower for token in id_name_tokens):
            possible_ids.append(str(column))
    return possible_ids


def infer_possible_timestamp_columns(dataframe: Any) -> list[str]:
    try:
        import pandas as pd
    except ImportError as error:
        raise DatasetSchemaError("Missing dependency: pandas") from error

    possible_timestamps: list[str] = []
    explicit_time_columns = {
        "time",
        "timestamp",
        "time_stamp",
        "datetime",
        "date",
        "time_of_day",
        "day_of_week",
    }
    name_tokens = ("date", "datetime", "timestamp")
    for column in dataframe.columns:
        column_lower = str(column).lower()
        dtype_name = str(dataframe[column].dtype)
        if column_lower in explicit_time_columns or any(
            token in column_lower for token in name_tokens
        ):
            possible_timestamps.append(str(column))
            continue
        if dtype_name.startswith("datetime"):
            possible_timestamps.append(str(column))
            continue
        if dtype_name not in ("object", "string", "str"):
            continue

        sample = dataframe[column].dropna().head(25)
        if sample.empty:
            continue
        parsed = pd.to_datetime(sample, errors="coerce")
        if parsed.notna().mean() >= 0.8:
            possible_timestamps.append(str(column))
    return possible_timestamps


def classify_column(name: str, schema: dict[str, Any]) -> str:
    lowered = name.lower()
    if name in schema.get("possible_id_columns", []):
        return "Identifier"
    if name in schema.get("possible_timestamp_date_columns", []):
        return "Timestamp"
    if any(token in lowered for token in ("age", "sex", "gender", "baseline", "race", "ethnicity")):
        return "Demographic"
    if any(token in lowered for token in ("clinic", "diagnosis", "aud", "treatment", "visit")):
        return "Clinical"
    if any(token in lowered for token in ("ema", "survey", "stress", "sleep", "craving", "mood", "label")):
        return "EMA/self-report"
    if any(token in lowered for token in ("phone", "screen", "unlock", "call", "sms")):
        return "Smartphone-derived"
    if any(token in lowered for token in ("acc", "actigraphy", "wear", "step", "heart", "hrv")):
        return "Wearable-derived"
    if any(token in lowered for token in ("mean", "avg", "min", "max", "sum", "count", "score", "index", "ratio")):
        return "Derived feature"
    return "Needs clarification"


def infer_measurement_frequency(name: str) -> str:
    lowered = name.lower()
    if any(token in lowered for token in ("time_stamp", "timestamp", "datetime", "date")):
        return "timestamped; frequency must be confirmed"
    if any(token in lowered for token in ("day", "daily")):
        return "daily or day-indexed"
    if any(token in lowered for token in ("hour", "minute", "epoch")):
        return "sub-daily or sensor epoch"
    return "unknown"


def infer_aggregation_level(name: str) -> str:
    lowered = name.lower()
    if lowered in {"pid", "participant_id", "subject_id", "patient_id"}:
        return "participant"
    if any(token in lowered for token in ("avg", "mean", "min", "max", "sum", "count")):
        return "aggregated feature"
    if any(token in lowered for token in ("time", "day", "date", "week")):
        return "time/context"
    return "row-level"


def summarize_timestamp_ranges(dataframe: Any, timestamp_columns: list[str]) -> dict[str, Any]:
    try:
        import pandas as pd
    except ImportError as error:
        raise DatasetSchemaError("Missing dependency: pandas") from error

    ranges: dict[str, Any] = {}
    invalid: dict[str, Any] = {}
    for column in timestamp_columns:
        if column not in dataframe.columns:
            continue
        parsed = pd.to_datetime(dataframe[column], errors="coerce")
        parse_rate = round(float(parsed.notna().mean() * 100), 2) if len(parsed) else 0.0
        invalid_count = int(parsed.isna().sum())
        invalid[column] = {
            "invalid_timestamp_count": invalid_count,
            "parse_success_percentage": parse_rate,
        }
        if parsed.notna().any():
            timezone = "unknown"
            try:
                timezone = str(parsed.dt.tz) if parsed.dt.tz is not None else "unknown"
            except AttributeError:
                timezone = "unknown"
            ranges[column] = {
                "min_timestamp": parsed.min().isoformat(),
                "max_timestamp": parsed.max().isoformat(),
                "timezone": timezone,
            }
    return {"timestamp_ranges": ranges, "invalid_timestamp_columns": invalid}


def summarize_duplicate_records(dataframe: Any, id_columns: list[str], timestamp_columns: list[str]) -> dict[str, Any]:
    duplicate_rows = int(dataframe.duplicated().sum())
    duplicate_participant_time_records: list[dict[str, Any]] = []
    for id_column in id_columns:
        if id_column not in dataframe.columns:
            continue
        for timestamp_column in timestamp_columns:
            if timestamp_column not in dataframe.columns:
                continue
            duplicate_count = int(dataframe.duplicated(subset=[id_column, timestamp_column]).sum())
            if duplicate_count > 0:
                duplicate_participant_time_records.append(
                    {
                        "participant_id_column": id_column,
                        "timestamp_column": timestamp_column,
                        "duplicate_count": duplicate_count,
                    }
                )
    return {
        "duplicate_row_count": duplicate_rows,
        "duplicate_participant_time_records": duplicate_participant_time_records,
    }


def summarize_numeric_ranges(dataframe: Any, numeric_columns: list[str]) -> dict[str, Any]:
    summaries: dict[str, Any] = {}
    impossible_value_warnings: list[dict[str, Any]] = []
    for column in numeric_columns:
        series = dataframe[column].dropna()
        if series.empty:
            continue
        min_value = series.min()
        max_value = series.max()
        summaries[column] = {
            "min": min_value.item() if hasattr(min_value, "item") else min_value,
            "max": max_value.item() if hasattr(max_value, "item") else max_value,
        }
        lowered = column.lower()
        if "latitude" in lowered and ((series < -90).any() or (series > 90).any()):
            impossible_value_warnings.append({"column": column, "warning": "Latitude outside [-90, 90]."})
        if "longitude" in lowered and ((series < -180).any() or (series > 180).any()):
            impossible_value_warnings.append({"column": column, "warning": "Longitude outside [-180, 180]."})
        if any(token in lowered for token in ("percent", "pct", "percentage")) and ((series < 0).any() or (series > 100).any()):
            impossible_value_warnings.append({"column": column, "warning": "Percentage-like column outside [0, 100]."})
        if any(token in lowered for token in ("age", "duration", "minutes", "seconds", "count")) and (series < 0).any():
            impossible_value_warnings.append({"column": column, "warning": "Nonnegative measure contains negative values."})
    return {"numeric_ranges": summaries, "possible_impossible_numeric_values": impossible_value_warnings}


def parse_dataset_schema(file_path: Path) -> dict[str, Any]:
    dataframe = read_csv_dataset(file_path)

    row_count = int(len(dataframe))
    column_count = int(len(dataframe.columns))
    column_names = [str(column) for column in dataframe.columns]
    dtypes = {str(column): str(dtype) for column, dtype in dataframe.dtypes.items()}
    missing_counts = {
        str(column): int(count) for column, count in dataframe.isna().sum().items()
    }
    missing_percentages = {
        column: round((missing_counts[column] / row_count) * 100, 2)
        if row_count > 0
        else 0.0
        for column in column_names
    }
    unique_counts = {
        str(column): int(dataframe[column].nunique(dropna=True))
        for column in dataframe.columns
    }
    sample_values = {
        str(column): get_sample_values(dataframe[column]) for column in dataframe.columns
    }

    numeric_columns = [
        str(column)
        for column in dataframe.select_dtypes(include=["number"]).columns
    ]
    timestamp_columns = infer_possible_timestamp_columns(dataframe)
    id_columns = infer_possible_id_columns(dataframe)
    categorical_columns = [
        str(column)
        for column in dataframe.columns
        if str(column) not in numeric_columns
        and str(column) not in timestamp_columns
        and str(column) not in id_columns
    ]

    warnings = [
        {
            "column": column,
            "warning": "High missingness",
            "missing_percentage": missing_percentages[column],
        }
        for column in column_names
        if missing_percentages[column] >= HIGH_MISSINGNESS_THRESHOLD
    ]

    if row_count == 0:
        warnings.append(
            {
                "column": None,
                "warning": "Dataset has columns but no rows.",
                "missing_percentage": None,
            }
        )

    timestamp_info = summarize_timestamp_ranges(dataframe, timestamp_columns)
    duplicate_summary = summarize_duplicate_records(dataframe, id_columns, timestamp_columns)
    range_summary = summarize_numeric_ranges(dataframe, numeric_columns)
    constant_columns = [
        column for column, unique_count in unique_counts.items() if unique_count <= 1
    ]
    coverage = {
        column: round(100.0 - missing_percentages[column], 2) for column in column_names
    }
    column_classification = {
        column: classify_column(column, {
            "possible_id_columns": id_columns,
            "possible_timestamp_date_columns": timestamp_columns,
        })
        for column in column_names
    }
    measurement_frequency = {
        column: infer_measurement_frequency(column) for column in column_names
    }
    aggregation_level = {
        column: infer_aggregation_level(column) for column in column_names
    }

    for column in constant_columns:
        warnings.append({"column": column, "warning": "Constant/no-variation variable.", "missing_percentage": missing_percentages[column]})
    for item in range_summary["possible_impossible_numeric_values"]:
        warnings.append({"column": item["column"], "warning": item["warning"], "missing_percentage": missing_percentages.get(item["column"])})
    for column, item in timestamp_info["invalid_timestamp_columns"].items():
        if item["parse_success_percentage"] < 80 and column not in {"time_of_day", "day_of_week"}:
            warnings.append({"column": column, "warning": "Timestamp parsing success below 80%.", "missing_percentage": missing_percentages.get(column)})

    return {
        "filename": file_path.name,
        "number_of_rows": row_count,
        "number_of_columns": column_count,
        "column_names": column_names,
        "pandas_data_types": dtypes,
        "missing_value_count_per_column": missing_counts,
        "missing_value_percentage_per_column": missing_percentages,
        "unique_values_per_column": unique_counts,
        "possible_numeric_columns": numeric_columns,
        "possible_categorical_columns": categorical_columns,
        "possible_id_columns": id_columns,
        "possible_timestamp_date_columns": timestamp_columns,
        "sample_values": sample_values,
        "warnings": warnings,
        "dataset_summary": {
            "rows": row_count,
            "columns": column_count,
            "files": [file_path.name],
            "unit_of_observation": "participant-time record" if id_columns and timestamp_columns else "row-level record; confirm unit",
        },
        "column_classification": column_classification,
        "measurement_frequency": measurement_frequency,
        "aggregation_level": aggregation_level,
        "timestamp_ranges": timestamp_info["timestamp_ranges"],
        "invalid_timestamp_columns": timestamp_info["invalid_timestamp_columns"],
        "timezone_by_timestamp_column": {
            column: details.get("timezone", "unknown")
            for column, details in timestamp_info["timestamp_ranges"].items()
        },
        "duplicate_row_count": duplicate_summary["duplicate_row_count"],
        "duplicate_participant_time_records": duplicate_summary["duplicate_participant_time_records"],
        "constant_or_no_variation_columns": constant_columns,
        "numeric_ranges": range_summary["numeric_ranges"],
        "possible_impossible_numeric_values": range_summary["possible_impossible_numeric_values"],
        "coverage_percentage_per_column": coverage,
        "linking_keys": id_columns,
        "dictionary_consistency": {
            "status": "not_checked",
            "dataset_columns_missing_from_dictionary": [],
            "dictionary_variables_missing_from_dataset": [],
            "ambiguous_variable_definitions": [],
        },
    }
