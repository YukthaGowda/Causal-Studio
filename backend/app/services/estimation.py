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
    return {
        "status": "ok",
        "number_of_runs": len(runs),
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
        working[column] = pd.to_numeric(working[column], errors="ignore")

    selected = [exposure, outcome, *adjustment_set]
    complete = working.dropna(subset=selected)
    variables_dropped: list[str] = []
    y = pd.to_numeric(complete[outcome], errors="coerce")
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


def run_estimation(request: dict[str, Any]) -> dict[str, Any]:
    import pandas as pd
    import statsmodels.api as sm

    random_seed = int(request.get("random_seed") or 42)
    dataset_path = resolve_dataset_path(request.get("dataset_filename", ""))
    dataframe = pd.read_csv(dataset_path)
    readiness = check_readiness(request, [str(column) for column in dataframe.columns])
    run_id = f"est_{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    if not readiness["ready"]:
        return {
            "run_id": run_id,
            "status": "blocked_not_ready",
            "readiness": readiness,
            "estimate": None,
            "diagnostics": {},
            "sensitivity": {"available": False, "checks": [], "warnings": ["Estimation was blocked before model fitting."]},
            "reproducibility": {
                "dataset_filename": request.get("dataset_filename"),
                "timestamp": now,
                "estimator": request.get("estimator"),
                "python_version": sys.version.split()[0],
                "package_versions": package_versions(),
                "random_seed": random_seed,
                "variables_used": [],
                "complete_case_filter": request.get("missing_data_strategy") == "complete_case",
            },
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

    variation, overlap, exposure_warnings = exposure_diagnostics(dataframe.loc[y.index, exposure])
    data_warnings.extend(exposure_warnings)
    if rows_after < 30:
        data_warnings.append("Complete-case sample size is below 30; model estimates may be unstable.")
    if excluded_percent >= 20:
        data_warnings.append(f"Complete-case filtering excluded {excluded_percent}% of rows; missing-data sensitivity is required.")

    if variation.get("unique_values", 0) <= 1:
        raise EstimationError("Exposure has no variation after filtering; estimation cannot be fit.")

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
        raise EstimationError(
            f"Statsmodels estimation failed: {error}. If this was Logit, try a linear probability model fallback or simplify the adjustment set."
        ) from error

    if exposure not in result.params.index:
        raise EstimationError(f"Exposure coefficient '{exposure}' was not returned by the fitted model.")

    point = float(result.params[exposure])
    se = float(result.bse[exposure])
    ci = [float(value) for value in result.conf_int().loc[exposure].tolist()]
    p_value = float(result.pvalues[exposure])
    status_value = "completed_with_warnings" if readiness["warnings"] or model_warnings or data_warnings else "completed"
    response = {
        "run_id": run_id,
        "status": status_value,
        "readiness": readiness,
        "estimate": {
            "estimand": request.get("estimand") or "ATE",
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
            "rows_before_filtering": rows_before,
            "rows_after_filtering": rows_after,
            "excluded_rows": excluded_rows,
            "excluded_percent": excluded_percent,
            "convergence": convergence,
            "outcome_type": outcome_type,
            "exposure_variation": variation,
            "overlap": overlap,
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
        "reproducibility": {
            "dataset_filename": dataset_path.name,
            "timestamp": now,
            "estimator": request.get("estimator") or ("statsmodels_logit" if outcome_type == "binary" else "statsmodels_linear"),
            "python_version": sys.version.split()[0],
            "package_versions": package_versions(),
            "random_seed": random_seed,
            "variables_used": variables_used,
            "variables_dropped": variables_dropped,
            "complete_case_filter": request.get("missing_data_strategy") == "complete_case",
        },
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
