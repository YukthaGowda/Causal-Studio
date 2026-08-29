from pathlib import Path
from shutil import copy2
from typing import Any

import pandas as pd

from fastapi import APIRouter, HTTPException

from app.api.datasets import UPLOAD_DIR as DATASET_DIR
from app.api.documents import UPLOAD_DIR as DOCUMENT_DIR
from app.services.dataset_schema import parse_dataset_schema

router = APIRouter(prefix="/study-mode", tags=["study-mode"])
ASSET_DIR = Path(__file__).resolve().parents[2] / "study_assets"
DATASET = "15_result_indexed_dataset_window1_distance1.csv"
DOCUMENTS = {
    "BDE data description.docx": "data_dictionary",
    "BDE Data collection.pdf": "protocol",
    "BDE Research paper.pdf": "research_paper",
}
OBJECTIVE = "Assess whether smartphone-derived movement patterns during a prior analysis window are associated with later binge-drinking event risk among participants in the approved BDE study dataset."
QUESTION = "Are smartphone-derived movement patterns during a prior analysis window associated with later binge-drinking event risk?"

def _register(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        raise FileNotFoundError(source.name)
    if not destination.exists() or source.stat().st_mtime > destination.stat().st_mtime:
        copy2(source, destination)

@router.post("/start")
def start_study_mode() -> dict[str, Any]:
    try:
        dataset_source = ASSET_DIR / DATASET
        dataset_destination = DATASET_DIR / DATASET
        _register(dataset_source, dataset_destination)
        documents = []
        for filename, category in DOCUMENTS.items():
            _register(ASSET_DIR / filename, DOCUMENT_DIR / filename)
            documents.append({"original_filename": filename, "saved_filename": filename, "category": category, "status": "registered"})
        frame = pd.read_csv(dataset_destination)
        if "label" not in frame.columns:
            raise ValueError("Approved fixed study dataset does not contain the required label field.")
        # This derived analysis field is computed transparently from the approved label
        # rather than supplied by an LLM or a hard-coded numerical result.
        frame["binge_drinking_event"] = (frame["label"].astype(str) == "BD").astype(int)
        frame.to_csv(dataset_destination, index=False)
        schema = parse_dataset_schema(dataset_destination)
        def numeric_summary(column: str) -> dict[str, Any]:
            values = pd.to_numeric(frame[column], errors="coerce")
            return {"column": column, "count": int(values.notna().sum()), "missing_count": int(values.isna().sum()), "mean": float(values.mean()), "std": float(values.std()), "min": float(values.min()), "max": float(values.max())}
        exposure_summary = numeric_summary("acc_mean_magnitude")
        outcome_counts = frame["label"].fillna("missing").astype(str).value_counts(dropna=False)
        outcome_distribution = [{"value": str(key), "count": int(value), "percentage": round(float(value / len(frame) * 100), 2)} for key, value in outcome_counts.items()]
        key_missingness = [{"column": column, "missing_count": int(frame[column].isna().sum()), "missing_percentage": round(float(frame[column].isna().mean() * 100), 2)} for column in ["acc_mean_magnitude", "label", "time_of_day", "day_of_week"] if column in frame.columns]
        candidate_columns = [column for column in ["acc_std_magnitude", "unlocks_per_minute", "number_of_minutes_interaction", "time_of_day", "day_of_week"] if column in frame.columns]
        candidate_summaries = [{"column": column, "missing_count": int(frame[column].isna().sum()), "unique_values": int(frame[column].nunique(dropna=True))} for column in candidate_columns]
    except (FileNotFoundError, OSError, ValueError) as error:
        raise HTTPException(status_code=500, detail=f"Fixed study task registration failed: {error}") from error
    return {
        "status": "ready", "label": "Approved BDE workspace loaded",
        "objective": OBJECTIVE,
        "dataset": {"original_filename": DATASET, "saved_filename": DATASET, "file_size_bytes": dataset_destination.stat().st_size, "schema": schema, "label": "Approved study dataset", "derived_outcome": {"column": "binge_drinking_event", "source": "label", "rule": "1 if label == BD; 0 otherwise", "label": "Backend-derived binary outcome from approved label field."}},
        "documents": documents,
        "frozen_drafts": {
          "label": "Prepared draft — editable, not yet confirmed.",
          "question": {"question_text": QUESTION, "exposure": "acc_mean_magnitude", "outcome": "label", "confounders": ["time_of_day", "day_of_week"]},
          "graph": {"nodes": ["time_of_day", "day_of_week", "acc_mean_magnitude", "label"], "edges": [["time_of_day", "acc_mean_magnitude"], ["time_of_day", "label"], ["day_of_week", "acc_mean_magnitude"], ["day_of_week", "label"], ["acc_mean_magnitude", "label"]]},
          "strategy": {
                "adjustment_set": ["time_of_day", "day_of_week"],
                "estimand": "Association between acc_mean_magnitude and the approved label outcome; not a causal effect claim.",
                "estimator": "Backend Python/statsmodels logistic or linear model selected only after configuration validation.",
                "repeated_measures_note": "Participant-window observations may be repeated; repeated-measures handling remains a preliminary proof-of-concept limitation.",
                "missing_data_note": "Complete-case preprocessing is used by the current backend estimation path.",
                "warning": "Observational association; residual confounding and temporal assumptions require review.",
            },
            "report": {
                "title": "Fixed BDE study report draft",
                "content": "Research question: Are smartphone-derived movement patterns during a prior analysis window associated with later binge-drinking event risk?\n\nExposure: acc_mean_magnitude\nOutcome: label (backend-derived binary outcome may be used only when shown in Phase 8).\nAdjustment draft: time_of_day; day_of_week.\nGraph status: draft — must be saved, validated, and confirmed.\nFeasibility status: not yet run.\nStrategy status: draft — must be validated and confirmed.\nEstimation status: not yet run.\n\nWarnings and limitations: This is an observational, assumption-based workflow. Residual confounding, timing assumptions, missing-data handling, repeated measurements, and support must be reviewed. Numerical results come only from the backend.\n\nClaim boundary: Do not interpret an association or model estimate as proof that movement causes a binge-drinking event.",
            },
        },
        "study_summary": {"label": "Backend-computed study summary", "exposure": exposure_summary, "outcome_distribution": outcome_distribution, "key_missingness": key_missingness, "candidate_variables": candidate_summaries},
        "safety": "Frozen drafts are editable and not confirmed. Python computes numerical outputs; no draft is a causal conclusion.",
    }
