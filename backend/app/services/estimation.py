from __future__ import annotations

import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


class EstimationError(RuntimeError):
    pass


DATASET_DIR = Path(__file__).resolve().parents[2] / "uploads" / "datasets"
RUNTIME_DIR = Path(__file__).resolve().parents[2] / "runtime"
RUNS_FILE = RUNTIME_DIR / "estimation_runs.json"
PRIMARY_RUN_FILE = RUNTIME_DIR / "primary_estimation_run.json"


def resolve_dataset_path(filename: str) -> Path:
    requested = Path(filename)
    if not filename or requested.name != filename:
        raise EstimationError("Dataset filename is missing or includes an unsafe path.")
    dataset_path = DATASET_DIR / filename
    if not dataset_path.exists() or not dataset_path.is_file():
        raise EstimationError("Dataset file was not found.")
    if dataset_path.suffix.lower() != ".csv":
        raise EstimationError("Only CSV datasets can be estimated in this proof of concept.")
    return dataset_path


def load_runs() -> list[dict[str, Any]]:
    if not RUNS_FILE.exists():
        return []
    try:
        return json.loads(RUNS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_run(run: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    runs = load_runs()
    runs.append(run)
    RUNS_FILE.write_text(json.dumps(runs[-100:], indent=2), encoding="utf-8")


def list_estimation_runs() -> dict[str, Any]:
    runs = load_runs()
    selected_primary_run_id = None
    if PRIMARY_RUN_FILE.exists():
        try:
            selected_primary_run_id = json.loads(PRIMARY_RUN_FILE.read_text(encoding="utf-8")).get("run_id")
        except json.JSONDecodeError:
            selected_primary_run_id = None
    return {
        "status": "ok",
        "number_of_runs": len(runs),
        "selected_primary_run_id": selected_primary_run_id,
        "runs": [
            {
                "run_id": run.get("run_id"),
                "status": run.get("status"),
                "dataset_filename": run.get("reproducibility", {}).get("dataset_filename"),
                "timestamp": run.get("reproducibility", {}).get("timestamp"),
                "estimator": run.get("estimate", {}).get("estimator"),
                "exposure": run.get("estimate", {}).get("exposure"),
                "outcome": run.get("estimate", {}).get("outcome"),
                "sample_size": run.get("estimate", {}).get("sample_size"),
            }
            for run in runs
        ],
    }


def select_primary_estimation_run(run_id: str) -> dict[str, Any]:
    runs = load_runs()
    if not any(run.get("run_id") == run_id for run in runs):
        return {
            "status": "error",
            "selected_primary_run_id": "",
            "message": f"Run '{run_id}' was not found.",
        }
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    PRIMARY_RUN_FILE.write_text(json.dumps({"run_id": run_id, "selected_at": datetime.now(timezone.utc).isoformat()}, indent=2), encoding="utf-8")
    return {
        "status": "success",
        "selected_primary_run_id": run_id,
        "message": "Primary estimation run selected.",
    }


def infer_outcome_type(series: Any) -> str:
    non_missing = series.dropna()
    unique_values = set(non_missing.unique().tolist())
    if len(unique_values) <= 2 and unique_values.issubset({0, 1, 0.0, 1.0, False, True}):
        return "binary"
    if str(series.dtype).startswith(("int", "float")):
        return "continuous"
    return "unknown"


def to_jsonable(value: Any) -> Any:
    try:
        import numpy as np
    except ImportError:
        np = None
    if np is not None and isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float):
        if value != value:
            return None
        return round(value, 6)
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    return value


def check_readiness(request: dict[str, Any], columns: list[str]) -> dict[str, Any]:
    blocking_issues: list[str] = []
    warnings: list[str] = []
    exposure = request.get("exposure")
    outcome = request.get("outcome")
    adjustment_set = request.get("adjustment_set") or []
    participant_id = request.get("participant_id") or ""
    timestamp = request.get("timestamp") or ""
    allow_unconfirmed = bool(request.get("allow_unconfirmed_analysis", False))

    if not exposure:
        blocking_issues.append("Exposure is required.")
    elif exposure not in columns:
        blocking_issues.append(f"Exposure '{exposure}' does not exist in the dataset.")
    if not outcome:
        blocking_issues.append("Outcome is required.")
    elif outcome not in columns:
        blocking_issues.append(f"Outcome '{outcome}' does not exist in the dataset.")
    for variable in adjustment_set:
        if variable not in columns:
            blocking_issues.append(f"Adjustment variable '{variable}' does not exist in the dataset.")
    if request.get("cluster_or_repeated_measures") == "cluster_by_participant":
        if not participant_id:
            blocking_issues.append("participant_id is required for clustered standard errors.")
        elif participant_id not in columns:
            blocking_issues.append(f"Participant ID '{participant_id}' does not exist in the dataset.")
    if timestamp and timestamp not in columns:
        warnings.append(f"Timestamp '{timestamp}' was supplied but does not exist in the dataset.")

    for key, label in (
        ("graph_confirmed", "Graph has not been confirmed."),
        ("identification_confirmed", "Identification has not been confirmed."),
        ("assumptions_reviewed", "Assumptions have not been reviewed."),
    ):
        if not request.get(key):
            if allow_unconfirmed:
                warnings.append(f"{label} Estimation is allowed only because allow_unconfirmed_analysis=true.")
            else:
                blocking_issues.append(f"{label} Set allow_unconfirmed_analysis=true to run an exploratory calculation with warnings.")

    return {
        "ready": not blocking_issues,
        "blocking_issues": blocking_issues,
        "warnings": warnings,
    }


def normalize_estimation_request(request: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(request)
    strategy = normalized.get("strategy") or {}
    estimand = normalized.get("estimand")
    preprocessing = normalized.get("preprocessing") or {}

    if isinstance(estimand, dict):
        normalized["estimand_label"] = estimand.get("label") or estimand.get("effect_type") or "Specified estimand"
        normalized["estimand"] = estimand.get("effect_type") or estimand.get("label") or "specified_estimand"
        normalized["exposure"] = normalized.get("exposure") or estimand.get("exposure") or ""
        normalized["outcome"] = normalized.get("outcome") or estimand.get("outcome") or ""
    else:
        normalized["estimand_label"] = str(estimand or "ATE")

    estimator_family = str(strategy.get("estimator_family") or normalized.get("estimator") or "").lower()
    if "logit" in estimator_family or "logistic" in estimator_family:
        normalized["estimator"] = "statsmodels_logit"
    elif estimator_family in {"ols", "linear_regression", "glm"} or "linear" in estimator_family:
        normalized["estimator"] = "statsmodels_linear"

    if strategy.get("missing_data_strategy"):
        normalized["missing_data_strategy"] = strategy.get("missing_data_strategy")
    if strategy.get("repeated_measures_strategy"):
        repeated = str(strategy.get("repeated_measures_strategy")).lower()
        normalized["cluster_or_repeated_measures"] = "none" if "not_implemented" in repeated or "none" in repeated else "cluster_by_participant"
    if "drop_missing" in preprocessing:
        normalized["missing_data_strategy"] = "complete_case" if preprocessing.get("drop_missing") else normalized.get("missing_data_strategy", "complete_case")
    return normalized


def validate_estimation_config(request: dict[str, Any]) -> dict[str, Any]:
    import pandas as pd

    dataset_path = resolve_dataset_path(request.get("dataset_filename", ""))
    dataframe = pd.read_csv(dataset_path)
    columns = [str(column) for column in dataframe.columns]
    exposure = request.get("exposure") or ""
    outcome = request.get("outcome") or ""
    adjustment_set = request.get("adjustment_set") or []
    errors: list[str] = []
    warnings: list[str] = [
        "Only complete-case preprocessing is implemented in this proof of concept.",
        "Sensitivity/refutation analyses are not yet implemented.",
    ]

    checks = {
        "dataset_found": True,
        "exposure_found": exposure in columns,
        "outcome_found": outcome in columns,
        "adjustment_variables_found": all(variable in columns for variable in adjustment_set),
        "exposure_has_variation": False,
        "outcome_has_variation": False,
        "sample_size_sufficient": False,
        "missingness_reviewed": True,
    }

    if not checks["exposure_found"]:
        errors.append(f"Exposure '{exposure}' does not exist in the dataset.")
    if not checks["outcome_found"]:
        errors.append(f"Outcome '{outcome}' does not exist in the dataset.")
    missing_adjusters = [variable for variable in adjustment_set if variable not in columns]
    if missing_adjusters:
        errors.append(f"Adjustment variables do not exist in the dataset: {', '.join(missing_adjusters)}.")

    required = [exposure, outcome, *adjustment_set]
    if not errors:
        complete = dataframe[required].dropna()
        checks["sample_size_sufficient"] = len(complete) >= 30
        checks["exposure_has_variation"] = complete[exposure].nunique(dropna=True) > 1
        checks["outcome_has_variation"] = complete[outcome].nunique(dropna=True) > 1
        if not checks["sample_size_sufficient"]:
            errors.append("Complete-case sample size is below 30.")
        if not checks["exposure_has_variation"]:
            errors.append("Exposure has no variation after complete-case preprocessing.")
        if not checks["outcome_has_variation"]:
            errors.append("Outcome has no variation after complete-case preprocessing.")
        dropped = len(dataframe) - len(complete)
        if len(dataframe) and dropped / len(dataframe) >= 0.2:
            warnings.append(f"Complete-case preprocessing would drop {round((dropped / len(dataframe)) * 100, 2)}% of rows.")

    participant_id = request.get("participant_id") or ""
    if participant_id and participant_id in columns:
        warnings.append("Repeated-measures handling is not fully implemented in this proof of concept. Results should be treated as preliminary.")

    status = "invalid" if errors else "valid_with_warnings" if warnings else "valid"
    return {
        "status": status,
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "safe_to_run_estimation": status != "invalid",
    }


def prepare_design_matrix(dataframe: Any, exposure: str, outcome: str, adjustment_set: list[str], participant_id: str, cluster: bool) -> tuple[Any, Any, Any, list[str], list[str]]:
    import pandas as pd
    import statsmodels.api as sm

    variables = [exposure, outcome, *adjustment_set]
    if cluster and participant_id:
        variables.append(participant_id)
    variables = list(dict.fromkeys(variables))
    working = dataframe[variables].copy()
    rows_before = len(working)

    for column in [exposure, outcome, *adjustment_set]:
        converted = pd.to_numeric(working[column], errors="coerce")
        if converted.notna().sum() > 0:
            working[column] = converted

    selected = [exposure, outcome, *adjustment_set]
    complete = working.dropna(subset=selected)
    variables_dropped: list[str] = []
    y = pd.to_numeric(complete[outcome], errors="coerce")
    if y.notna().sum() == 0:
        codes, _ = pd.factorize(complete[outcome], sort=True)
        y = pd.Series(codes, index=complete.index).replace(-1, pd.NA)
    X_raw = complete[[exposure, *adjustment_set]].copy()
    X_raw[exposure] = pd.to_numeric(X_raw[exposure], errors="coerce")
    X = pd.get_dummies(X_raw, columns=[col for col in adjustment_set if not pd.api.types.is_numeric_dtype(X_raw[col])], drop_first=True)
    X = X.apply(pd.to_numeric, errors="coerce")
    model_frame = pd.concat([y.rename(outcome), X, complete[[participant_id]] if cluster and participant_id in complete.columns else pd.DataFrame(index=complete.index)], axis=1).dropna()
    y = model_frame[outcome].astype(float)
    X = sm.add_constant(model_frame[X.columns].astype(float), has_constant="add")
    groups = model_frame[participant_id] if cluster and participant_id in model_frame.columns else None

    used_columns = [exposure, *adjustment_set]
    if cluster and participant_id:
        used_columns.append(participant_id)
    if len(model_frame) < rows_before:
        variables_dropped = [column for column in selected if working[column].isna().any()]
    return y, X, groups, used_columns, variables_dropped


def exposure_diagnostics(series: Any) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    import pandas as pd

    numeric = pd.to_numeric(series, errors="coerce").dropna()
    warnings: list[str] = []
    variation = {
        "min": to_jsonable(float(numeric.min())) if len(numeric) else None,
        "max": to_jsonable(float(numeric.max())) if len(numeric) else None,
        "mean": to_jsonable(float(numeric.mean())) if len(numeric) else None,
        "std": to_jsonable(float(numeric.std())) if len(numeric) else None,
        "unique_values": int(numeric.nunique()) if len(numeric) else 0,
    }
    if variation["unique_values"] <= 1:
        warnings.append("Exposure has no variation after filtering; estimation is not meaningful.")

    overlap: dict[str, Any] = {}
    unique = sorted(numeric.unique().tolist()) if len(numeric) else []
    if len(unique) == 2:
        counts = numeric.value_counts().sort_index().to_dict()
        overlap["binary_group_counts"] = {str(to_jsonable(key)): int(value) for key, value in counts.items()}
        smallest = min(counts.values()) if counts else 0
        if smallest < 20:
            warnings.append("One exposure group has fewer than 20 complete-case observations; positivity/overlap may be weak.")
    else:
        overlap["note"] = "Continuous exposure; min/max/std summarize overlap for this proof of concept."
    return variation, overlap, warnings


def package_versions() -> dict[str, str]:
    versions: dict[str, str] = {"python": platform.python_version()}
    for name in ("pandas", "numpy", "scipy", "statsmodels"):
        try:
            module = __import__(name)
            versions[name] = getattr(module, "__version__", "installed")
        except ImportError:
            versions[name] = "not_installed"
    return versions


def build_not_runnable_response(
    *,
    request: dict[str, Any],
    dataset_path: Path,
    dataframe: Any,
    run_id: str,
    timestamp: str,
    reason: str,
    readiness: dict[str, Any],
    warnings: list[str] | None = None,
    diagnostics: dict[str, Any] | None = None,
    formula: str = "",
    model_type: str = "not_fit",
) -> dict[str, Any]:
    package_info = package_versions()
    all_warnings = [*readiness.get("warnings", []), *(warnings or [])]
    if "Only complete-case preprocessing is implemented in this proof of concept." not in all_warnings:
        all_warnings.append("Only complete-case preprocessing is implemented in this proof of concept.")
    if "Sensitivity/refutation analyses are not yet implemented." not in all_warnings:
        all_warnings.append("Sensitivity/refutation analyses are not yet implemented.")

    base_diagnostics = {
        "rows_before_preprocessing": int(len(dataframe)),
        "rows_after_preprocessing": None,
        "rows_dropped_missing": None,
        "rows_before_filtering": int(len(dataframe)),
        "rows_after_filtering": None,
        "excluded_rows": None,
        "excluded_percent": None,
        "missingness_summary": [],
        "convergence": "not_fit",
        "exposure_variation": {},
        "outcome_variation": {},
        "covariate_balance_placeholder": "Covariate balance diagnostics are not implemented in this proof of concept.",
        "overlap_placeholder": "Overlap diagnostics are summarized heuristically only.",
        "model_warnings": [reason],
        "data_warnings": all_warnings,
    }
    if diagnostics:
        base_diagnostics.update(diagnostics)
        base_diagnostics["model_warnings"] = [
            *base_diagnostics.get("model_warnings", []),
            reason,
        ]

    return {
        "run_id": run_id,
        "run_label": request.get("run_label") or "Primary run",
        "status": "not_runnable",
        "estimand_label": request.get("estimand_label") or request.get("estimand") or "",
        "model_type": model_type,
        "formula": formula,
        "primary_result": {
            "exposure": request.get("exposure") or "",
            "outcome": request.get("outcome") or "",
            "point_estimate": None,
            "standard_error": None,
            "confidence_interval": [None, None],
            "p_value": None,
            "sample_size": base_diagnostics.get("rows_after_filtering"),
        },
        "readiness": {
            **readiness,
            "ready": False,
            "blocking_issues": [*readiness.get("blocking_issues", []), reason],
        },
        "estimate": None,
        "diagnostics": base_diagnostics,
        "sensitivity": {
            "available": False,
            "checks": [],
            "warnings": ["Sensitivity/refutation analyses are not yet implemented."],
        },
        "sensitivity_results": [],
        "warnings": all_warnings,
        "limitations": [
            reason,
            "The estimation configuration was not runnable, so no numerical result was computed.",
            "This phase does not prove causality.",
        ],
        "reproducibility": {
            "dataset_filename": dataset_path.name,
            "input_dataset_version": dataset_path.stem,
            "timestamp": timestamp,
            "estimator": request.get("estimator"),
            "python_version": sys.version.split()[0],
            "package_versions": package_info,
            "random_seed": int(request.get("random_seed") or 42),
            "variables_used": [],
            "complete_case_filter": request.get("missing_data_strategy") == "complete_case",
            "configuration": request,
            "code_path": "backend/app/services/estimation.py",
        },
        "provenance": {
            "dataset_filename": dataset_path.name,
            "input_dataset_version": dataset_path.stem,
            "timestamp": timestamp,
            "python_version": sys.version.split()[0],
            "packages": package_info,
            "random_seed": int(request.get("random_seed") or 42),
            "code_path": "backend/app/services/estimation.py",
            "configuration": request,
        },
        "requires_user_review": True,
        "safe_interpretation_note": "The LLM may interpret this computed output, but it must not invent or modify numerical results.",
        "safety_boundary": [
            "No numerical estimate was computed.",
            "Review the blocking issue and rerun from the backend.",
            "The LLM cannot repair or invent estimation results.",
        ],
    }


def run_estimation(request: dict[str, Any]) -> dict[str, Any]:
    import pandas as pd
    import statsmodels.api as sm

    request = normalize_estimation_request(request)
    random_seed = int(request.get("random_seed") or 42)
    dataset_path = resolve_dataset_path(request.get("dataset_filename", ""))
    dataframe = pd.read_csv(dataset_path)
    readiness = check_readiness(request, [str(column) for column in dataframe.columns])
    run_id = f"est_{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    if not readiness["ready"]:
        return {
            "run_id": run_id,
            "run_label": request.get("run_label") or "Primary run",
            "status": "not_runnable",
            "estimand_label": request.get("estimand_label") or request.get("estimand") or "",
            "model_type": request.get("estimator") or "not_fit",
            "formula": "",
            "primary_result": {
                "exposure": request.get("exposure") or "",
                "outcome": request.get("outcome") or "",
                "point_estimate": None,
                "standard_error": None,
                "confidence_interval": [None, None],
                "p_value": None,
                "sample_size": None,
            },
            "readiness": readiness,
            "estimate": None,
            "diagnostics": {
                "rows_before_preprocessing": int(len(dataframe)),
                "rows_after_preprocessing": None,
                "rows_dropped_missing": None,
                "missingness_summary": [],
                "exposure_variation": {},
                "outcome_variation": {},
                "covariate_balance_placeholder": "Covariate balance diagnostics are not implemented in this proof of concept.",
                "overlap_placeholder": "Overlap diagnostics are summarized heuristically only.",
                "model_warnings": readiness["blocking_issues"],
            },
            "sensitivity": {"available": False, "checks": [], "warnings": ["Estimation was blocked before model fitting."]},
            "sensitivity_results": [],
            "warnings": readiness["warnings"],
            "limitations": ["The estimation configuration was not runnable, so no numerical result was computed."],
            "reproducibility": {
                "dataset_filename": request.get("dataset_filename"),
                "input_dataset_version": Path(request.get("dataset_filename") or "").stem,
                "timestamp": now,
                "estimator": request.get("estimator"),
                "python_version": sys.version.split()[0],
                "package_versions": package_versions(),
                "random_seed": random_seed,
                "variables_used": [],
                "complete_case_filter": request.get("missing_data_strategy") == "complete_case",
                "configuration": request,
                "code_path": "backend/app/services/estimation.py",
            },
            "provenance": {
                "dataset_filename": request.get("dataset_filename"),
                "input_dataset_version": Path(request.get("dataset_filename") or "").stem,
                "timestamp": now,
                "python_version": sys.version.split()[0],
                "packages": package_versions(),
                "random_seed": random_seed,
                "code_path": "backend/app/services/estimation.py",
                "configuration": request,
            },
            "requires_user_review": True,
            "safe_interpretation_note": "The LLM may interpret this computed output, but it must not invent or modify numerical results.",
        }

    exposure = request["exposure"]
    outcome = request["outcome"]
    adjustment_set = request.get("adjustment_set") or []
    participant_id = request.get("participant_id") or ""
    cluster = request.get("cluster_or_repeated_measures") == "cluster_by_participant"
    rows_before = int(len(dataframe))
    y, X, groups, variables_used, variables_dropped = prepare_design_matrix(dataframe, exposure, outcome, adjustment_set, participant_id, cluster)
    rows_after = int(len(y))
    excluded_rows = rows_before - rows_after
    excluded_percent = round((excluded_rows / rows_before) * 100, 2) if rows_before else 0.0
    outcome_type = infer_outcome_type(y)
    model_warnings: list[str] = []
    data_warnings: list[str] = []
    data_warnings.append("Only complete-case preprocessing is implemented in this proof of concept.")
    data_warnings.append("Sensitivity/refutation analyses are not yet implemented.")
    if participant_id and participant_id in dataframe.columns:
        data_warnings.append("Repeated-measures handling is not fully implemented in this proof of concept. Results should be treated as preliminary.")
    if pd.to_numeric(dataframe[outcome], errors="coerce").notna().sum() == 0:
        data_warnings.append(
            f"Outcome '{outcome}' is non-numeric and was encoded for this proof-of-concept calculation; confirm the outcome definition before interpreting estimates."
        )

    variation, overlap, exposure_warnings = exposure_diagnostics(dataframe.loc[y.index, exposure])
    data_warnings.extend(exposure_warnings)
    if rows_after < 30:
        data_warnings.append("Complete-case sample size is below 30; model estimates may be unstable.")
    if excluded_percent >= 20:
        data_warnings.append(f"Complete-case filtering excluded {excluded_percent}% of rows; missing-data sensitivity is required.")

    formula = f"{outcome} ~ {exposure}" + (f" + {' + '.join(adjustment_set)}" if adjustment_set else "")
    model_type = request.get("estimator") or ("statsmodels_logit" if outcome_type == "binary" else "statsmodels_linear")

    if variation.get("unique_values", 0) <= 1:
        return build_not_runnable_response(
            request=request,
            dataset_path=dataset_path,
            dataframe=dataframe,
            run_id=run_id,
            timestamp=now,
            reason="Exposure has no variation after filtering; estimation cannot be fit.",
            readiness=readiness,
            warnings=data_warnings,
            model_type=model_type,
            formula=formula,
            diagnostics={
                "rows_after_preprocessing": rows_after,
                "rows_dropped_missing": excluded_rows,
                "rows_after_filtering": rows_after,
                "excluded_rows": excluded_rows,
                "excluded_percent": excluded_percent,
                "missingness_summary": [
                    {
                        "variable": variable,
                        "missing_count": int(dataframe[variable].isna().sum()),
                        "missing_percent": round(float(dataframe[variable].isna().mean() * 100), 4),
                    }
                    for variable in [exposure, outcome, *adjustment_set]
                    if variable in dataframe.columns
                ],
                "exposure_variation": variation,
                "overlap": overlap,
            },
        )

    convergence = "not_applicable"
    try:
        if outcome_type == "binary" and request.get("estimator") != "statsmodels_linear":
            model = sm.Logit(y, X)
            fit_kwargs: dict[str, Any] = {"disp": False, "maxiter": 100}
            if cluster and groups is not None:
                result = model.fit(**fit_kwargs, cov_type="cluster", cov_kwds={"groups": groups})
            else:
                result = model.fit(**fit_kwargs)
            convergence = "converged" if result.mle_retvals.get("converged") else "failed"
        else:
            model = sm.OLS(y, X)
            if cluster and groups is not None:
                result = model.fit(cov_type="cluster", cov_kwds={"groups": groups})
            else:
                result = model.fit(cov_type="HC1")
            convergence = "not_applicable"
    except Exception as error:
        return build_not_runnable_response(
            request=request,
            dataset_path=dataset_path,
            dataframe=dataframe,
            run_id=run_id,
            timestamp=now,
            reason=(
                f"Statsmodels estimation failed: {error}. If this was Logit, try a linear probability model fallback "
                "or simplify the adjustment set."
            ),
            readiness=readiness,
            warnings=data_warnings,
            model_type=model_type,
            formula=formula,
            diagnostics={
                "rows_after_preprocessing": rows_after,
                "rows_dropped_missing": excluded_rows,
                "rows_after_filtering": rows_after,
                "excluded_rows": excluded_rows,
                "excluded_percent": excluded_percent,
                "convergence": "failed",
                "exposure_variation": variation,
                "overlap": overlap,
            },
        )

    if exposure not in result.params.index:
        return build_not_runnable_response(
            request=request,
            dataset_path=dataset_path,
            dataframe=dataframe,
            run_id=run_id,
            timestamp=now,
            reason=f"Exposure coefficient '{exposure}' was not returned by the fitted model.",
            readiness=readiness,
            warnings=data_warnings,
            model_type=model_type,
            formula=formula,
            diagnostics={
                "rows_after_preprocessing": rows_after,
                "rows_dropped_missing": excluded_rows,
                "rows_after_filtering": rows_after,
                "excluded_rows": excluded_rows,
                "excluded_percent": excluded_percent,
                "convergence": convergence,
                "exposure_variation": variation,
                "overlap": overlap,
            },
        )

    point = float(result.params[exposure])
    se = float(result.bse[exposure])
    ci = [float(value) for value in result.conf_int().loc[exposure].tolist()]
    p_value = float(result.pvalues[exposure])
    status_value = "completed_with_warnings" if readiness["warnings"] or model_warnings or data_warnings else "success"
    missingness_summary = [
        {
            "variable": variable,
            "missing_count": int(dataframe[variable].isna().sum()),
            "missing_percent": round(float(dataframe[variable].isna().mean() * 100), 4),
        }
        for variable in [exposure, outcome, *adjustment_set]
        if variable in dataframe.columns
    ]
    outcome_numeric = pd.to_numeric(dataframe.loc[y.index, outcome], errors="coerce")
    outcome_variation = {
        "unique_values": int(y.nunique()),
        "mean": to_jsonable(float(outcome_numeric.mean())) if outcome_numeric.notna().sum() else to_jsonable(float(y.mean())),
        "std": to_jsonable(float(outcome_numeric.std())) if outcome_numeric.notna().sum() else to_jsonable(float(y.std())),
    }
    package_info = package_versions()
    response = {
        "run_id": run_id,
        "run_label": request.get("run_label") or "Primary run",
        "status": status_value,
        "estimand_label": request.get("estimand_label") or request.get("estimand") or "Specified estimand",
        "model_type": request.get("estimator") or ("statsmodels_logit" if outcome_type == "binary" else "statsmodels_linear"),
        "formula": formula,
        "primary_result": {
            "exposure": exposure,
            "outcome": outcome,
            "point_estimate": to_jsonable(point),
            "standard_error": to_jsonable(se),
            "confidence_interval": to_jsonable(ci),
            "p_value": to_jsonable(p_value),
            "sample_size": rows_after,
        },
        "readiness": readiness,
        "estimate": {
            "estimand": request.get("estimand_label") or request.get("estimand") or "ATE",
            "estimator": request.get("estimator") or ("statsmodels_logit" if outcome_type == "binary" else "statsmodels_linear"),
            "exposure": exposure,
            "outcome": outcome,
            "point_estimate": to_jsonable(point),
            "standard_error": to_jsonable(se),
            "confidence_interval": to_jsonable(ci),
            "p_value": to_jsonable(p_value),
            "sample_size": rows_after,
            "interpretation_boundary": "Computed association/estimate under the specified model and assumptions. This does not by itself prove causality.",
        },
        "diagnostics": {
            "rows_before_preprocessing": rows_before,
            "rows_after_preprocessing": rows_after,
            "rows_dropped_missing": excluded_rows,
            "rows_before_filtering": rows_before,
            "rows_after_filtering": rows_after,
            "excluded_rows": excluded_rows,
            "excluded_percent": excluded_percent,
            "missingness_summary": missingness_summary,
            "convergence": convergence,
            "outcome_type": outcome_type,
            "exposure_variation": variation,
            "outcome_variation": outcome_variation,
            "overlap": overlap,
            "covariate_balance_placeholder": "Covariate balance diagnostics are not implemented in this proof of concept.",
            "overlap_placeholder": "Overlap diagnostics are summarized heuristically only.",
            "model_warnings": model_warnings,
            "data_warnings": data_warnings,
        },
        "sensitivity": {
            "available": True,
            "checks": [
                "Complete-case analysis completed; compare with multiple imputation in a later implementation.",
                "Alternative estimator placeholder: linear probability model or GEE can be added as a robustness run.",
                "Advanced refutation checks such as placebo exposure/outcome and unmeasured confounding sensitivity are planned, not faked.",
            ],
            "warnings": [
                "Advanced sensitivity analysis is not implemented in this proof of concept.",
                "This is computed under the specified graph, adjustment set, model, and assumptions.",
                "This does not prove causality by itself.",
            ],
        },
        "sensitivity_results": [],
        "warnings": [*readiness["warnings"], *model_warnings, *data_warnings],
        "limitations": [
            "Complete-case preprocessing only is implemented.",
            "Full repeated-measures modeling is not implemented in this proof of concept.",
            "Sensitivity/refutation analyses are placeholders only.",
            "The result is conditional on the selected graph, adjustment set, model, assumptions, and data limitations.",
            "This phase does not prove causality.",
        ],
        "reproducibility": {
            "dataset_filename": dataset_path.name,
            "input_dataset_version": dataset_path.stem,
            "timestamp": now,
            "estimator": request.get("estimator") or ("statsmodels_logit" if outcome_type == "binary" else "statsmodels_linear"),
            "python_version": sys.version.split()[0],
            "package_versions": package_info,
            "random_seed": random_seed,
            "variables_used": variables_used,
            "variables_dropped": variables_dropped,
            "complete_case_filter": request.get("missing_data_strategy") == "complete_case",
            "configuration": request,
            "code_path": "backend/app/services/estimation.py",
        },
        "provenance": {
            "dataset_filename": dataset_path.name,
            "input_dataset_version": dataset_path.stem,
            "timestamp": now,
            "python_version": sys.version.split()[0],
            "packages": package_info,
            "random_seed": random_seed,
            "code_path": "backend/app/services/estimation.py",
            "configuration": request,
        },
        "requires_user_review": True,
        "safe_interpretation_note": "The LLM may interpret this computed output, but it must not invent or modify numerical results.",
        "safety_boundary": [
            "This is computed under the specified graph, adjustment set, model, and assumptions.",
            "This does not prove causality by itself.",
            "The LLM interprets computed outputs only and does not generate numerical results.",
        ],
    }
    save_run(response)
    return response


def interpret_estimation_result(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("estimation_result") or payload
    estimate = result.get("estimate") or {}
    diagnostics = result.get("diagnostics") or {}
    if not estimate:
        return {
            "status": "no_estimate",
            "assistant_message": "No computed estimate was provided to interpret. Run Phase 8 estimation first.",
        }
    return {
        "status": "completed",
        "assistant_message": (
            f"Python computed the {estimate.get('estimand', 'estimand')} using {estimate.get('estimator', 'the selected estimator')}. "
            f"The point estimate is {estimate.get('point_estimate')}, SE {estimate.get('standard_error')}, "
            f"95% CI {estimate.get('confidence_interval')}, p-value {estimate.get('p_value')}, with N={estimate.get('sample_size')}. "
            f"Rows before filtering: {diagnostics.get('rows_before_filtering')}; rows after filtering: {diagnostics.get('rows_after_filtering')}. "
            "Interpret this only as a computed model estimate under the specified graph, adjustment set, and assumptions. "
            "It does not prove causality by itself, and I did not generate or alter the numerical values."
        ),
    }
