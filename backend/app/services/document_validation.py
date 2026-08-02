from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "documents"
DATASET_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "datasets"
ALLOWED_CATEGORIES = {
    "data_dictionary",
    "protocol",
    "research_paper",
    "clinical_guideline",
    "domain_guidance",
    "unknown",
}


def _read_text(file_path: Path) -> str:
    extension = file_path.suffix.lower()
    if extension == ".txt":
        return file_path.read_text(encoding="utf-8", errors="ignore")
    if extension == ".docx":
        try:
            from docx import Document
        except ImportError:
            return ""
        document = Document(str(file_path))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    if extension == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            return ""
        reader = PdfReader(str(file_path))
        return "\n".join(page.extract_text() or "" for page in reader.pages[:5])
    return ""


def _latest_dataset_schema() -> dict[str, Any] | None:
    if not DATASET_UPLOAD_DIR.exists():
        return None
    csv_files = sorted(DATASET_UPLOAD_DIR.glob("*.csv"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not csv_files:
        return None
    try:
        return parse_dataset_schema(csv_files[0])
    except DatasetSchemaError:
        return None


def _detect_category(text: str, filename: str) -> str:
    lowered = f"{filename}\n{text}".lower()
    category_tokens = [
        ("data_dictionary", ("data dictionary", "variable", "permitted values", "valid range", "missing value", "units")),
        ("protocol", ("protocol", "study design", "eligibility", "recruitment", "objective", "methods")),
        ("research_paper", ("abstract", "introduction", "methods", "results", "discussion", "doi", "preprint")),
        ("clinical_guideline", ("guideline", "clinical practice", "recommendation", "diagnostic criteria", "strobe", "consort")),
        ("domain_guidance", ("domain guidance", "measurement standard", "reporting checklist", "best practice", "standard")),
    ]
    scores = {
        category: sum(1 for token in tokens if token in lowered)
        for category, tokens in category_tokens
    }
    best_category, best_score = max(scores.items(), key=lambda item: item[1])
    return best_category if best_score > 0 else "unknown"


def _dictionary_details(text: str, dataset_schema: dict[str, Any] | None) -> tuple[list[str], list[str], list[str], list[str]]:
    lowered = text.lower()
    checks = {
        "variable names": ("variable", "column", "field"),
        "data types": ("type", "dtype", "integer", "numeric", "string", "binary"),
        "permitted values/ranges": ("permitted", "valid", "range", "values", "coding"),
        "units": ("unit", "minutes", "hours", "score", "scale"),
        "collection methods": ("collection", "collected", "survey", "sensor", "ema", "actigraphy"),
        "measurement timing": ("timing", "timestamp", "date", "daily", "window", "frequency"),
        "missing-value coding": ("missing", "na", "null", "unknown", "-999"),
    }
    detected = [label for label, tokens in checks.items() if any(token in lowered for token in tokens)]
    missing = [label for label in checks if label not in detected]
    warnings: list[str] = []
    next_actions: list[str] = []

    if dataset_schema:
        dataset_columns = set(dataset_schema.get("column_names", []))
        mentioned_columns = {column for column in dataset_columns if column.lower() in lowered}
        missing_from_dictionary = sorted(dataset_columns - mentioned_columns)
        if mentioned_columns:
            detected.append(f"{len(mentioned_columns)} dataset column name(s) mentioned")
        if missing_from_dictionary:
            warnings.append(
                f"{len(missing_from_dictionary)} uploaded dataset column(s) were not found by exact name in the dictionary text."
            )
            next_actions.append("Confirm dictionary variable names match the uploaded dataset columns.")
    else:
        warnings.append("No uploaded dataset schema was available for dictionary-column matching.")
        next_actions.append("Upload a CSV dataset before relying on dictionary consistency checks.")

    return detected, missing, warnings, next_actions


def validate_document_category(filename: str, declared_category: str) -> dict[str, Any]:
    if declared_category not in ALLOWED_CATEGORIES:
        return {
            "status": "error",
            "declared_category": declared_category,
            "detected_category": "unknown",
            "summary": "Unsupported declared category.",
            "missing_information": [],
            "detected_information": [],
            "warnings": [f"Category must be one of: {', '.join(sorted(ALLOWED_CATEGORIES))}."],
            "recommended_next_actions": ["Choose a supported document category and retry."],
        }

    requested_path = Path(filename)
    if requested_path.name != filename:
        return {
            "status": "error",
            "declared_category": declared_category,
            "detected_category": "unknown",
            "summary": "Filename must not include a path.",
            "missing_information": [],
            "detected_information": [],
            "warnings": ["Path traversal is not allowed."],
            "recommended_next_actions": ["Use the saved filename returned by /documents/upload."],
        }

    file_path = UPLOAD_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        return {
            "status": "error",
            "declared_category": declared_category,
            "detected_category": "unknown",
            "summary": "Uploaded document was not found.",
            "missing_information": [],
            "detected_information": [],
            "warnings": ["The saved filename does not exist in the document upload folder."],
            "recommended_next_actions": ["Upload the document again and validate the returned saved filename."],
        }

    text = _read_text(file_path)
    detected_category = _detect_category(text, filename)
    detected_information: list[str] = []
    missing_information: list[str] = []
    warnings: list[str] = []
    recommended_next_actions: list[str] = []

    if file_path.stat().st_size == 0:
        missing_information.append("readable document content")
        warnings.append("The file is empty.")

    if declared_category == "data_dictionary":
        detected_information, missing_information, warnings, recommended_next_actions = _dictionary_details(
            text,
            _latest_dataset_schema(),
        )
    elif declared_category == "protocol":
        required = {
            "research objective": ("objective", "aim", "goal", "hypothesis"),
            "study design": ("study design", "longitudinal", "cohort", "trial", "observational"),
            "population": ("population", "participant", "sample", "eligibility"),
            "measurement timing": ("timing", "follow-up", "window", "days", "timestamp"),
        }
        lowered = text.lower()
        detected_information = [label for label, tokens in required.items() if any(token in lowered for token in tokens)]
        missing_information = [label for label in required if label not in detected_information]
    elif declared_category in {"research_paper", "clinical_guideline", "domain_guidance"}:
        lowered = text.lower()
        detected_information = [
            label for label, tokens in {
                "source title or headings": ("title", "abstract", "guideline", "recommendation"),
                "methods or evidence basis": ("methods", "evidence", "study", "sample", "population"),
                "limitations or scope": ("limitation", "scope", "generaliz", "bias"),
            }.items()
            if any(token in lowered for token in tokens)
        ]
        missing_information = ["scope/evidence details"] if not detected_information else []

    if declared_category != "unknown" and detected_category not in {declared_category, "unknown"}:
        status = "incorrect_document_type"
        warnings.append(f"Declared category is {declared_category}, but text signals look more like {detected_category}.")
        recommended_next_actions.append("Review the selected document category or upload the correct file.")
    elif missing_information:
        status = "incomplete_document" if declared_category != "unknown" else "requires_clarification"
        recommended_next_actions.append("Add or upload documentation for the missing information.")
    elif declared_category == "unknown" or detected_category == "unknown":
        status = "requires_clarification"
        recommended_next_actions.append("Confirm this document's role in the project setup.")
    else:
        status = "uploaded_and_validated"
        recommended_next_actions.append("Continue after reviewing warnings and evidence limitations.")

    return {
        "status": status,
        "declared_category": declared_category,
        "detected_category": detected_category,
        "summary": (
            f"Validated {filename} as {declared_category}. "
            "This deterministic check reviews document type and setup completeness only; it does not establish causal validity."
        ),
        "missing_information": missing_information,
        "detected_information": detected_information,
        "warnings": warnings,
        "recommended_next_actions": recommended_next_actions,
    }
