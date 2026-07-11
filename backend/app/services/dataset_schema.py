from __future__ import annotations

from pathlib import Path
from typing import Any


HIGH_MISSINGNESS_THRESHOLD = 50.0
SAMPLE_VALUE_LIMIT = 5


class DatasetSchemaError(RuntimeError):
    pass


def read_csv_dataset(file_path: Path) -> Any:
    try:
        import pandas as pd
    except ImportError as error:
        raise DatasetSchemaError("Missing dependency: pandas") from error

    try:
        return pd.read_csv(file_path)
    except pd.errors.EmptyDataError as error:
        raise DatasetSchemaError("CSV file is empty or has no readable columns.") from error
    except UnicodeDecodeError as error:
        raise DatasetSchemaError(
            "CSV file could not be decoded. Save it as UTF-8 CSV and try again."
        ) from error
    except Exception as error:
        raise DatasetSchemaError(f"CSV file could not be read: {error}") from error


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
    }
