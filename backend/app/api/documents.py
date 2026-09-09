from pathlib import Path
from shutil import copyfileobj
from uuid import uuid4
import logging
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.rag.ingestion import (
    IngestionError,
    safe_ingestion_trace,
    get_ingestion_status,
    ingest_uploaded_documents,
)
from app.services.document_validation import validate_document_category


router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger("uvicorn.error.documents")

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "documents"
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


class DocumentCategoryValidationRequest(BaseModel):
    filename: str = Field(..., min_length=1)
    declared_category: str = Field(
        "unknown",
        pattern="^(data_dictionary|protocol|research_paper|clinical_guideline|domain_guidance|unknown)$",
    )


def get_file_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def build_saved_filename(original_filename: str) -> str:
    extension = get_file_extension(original_filename)
    stem = Path(original_filename).stem or "document"
    safe_stem = "".join(
        character if character.isalnum() or character in ("-", "_") else "_"
        for character in stem
    ).strip("_")
    return f"{safe_stem or 'document'}_{uuid4().hex}{extension}"


@router.post("/upload", status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    category: str = Form("unknown"),
) -> dict[str, str | int]:
    extension = get_file_extension(file.filename)

    if category == "research_paper" and extension != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Research papers must be PDF files.",
        )

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Upload a .pdf, .docx, or .txt file.",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    saved_filename = build_saved_filename(file.filename)
    saved_path = UPLOAD_DIR / saved_filename

    with saved_path.open("wb") as output_file:
        copyfileobj(file.file, output_file)

    return {
        "original_filename": file.filename,
        "saved_filename": saved_filename,
        "file_extension": extension,
        "file_size_bytes": saved_path.stat().st_size,
        "saved_path": str(saved_path),
        "upload_status": "stored",
    }


@router.get("")
def list_documents() -> dict[str, str | list[dict[str, str | int]]]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    documents = []
    for file_path in sorted(UPLOAD_DIR.iterdir()):
        if file_path.is_file() and file_path.suffix.lower() in ALLOWED_EXTENSIONS:
            documents.append(
                {
                    "filename": file_path.name,
                    "file_extension": file_path.suffix.lower(),
                    "file_size": file_path.stat().st_size,
                    "upload_folder_path": str(UPLOAD_DIR),
                }
            )

    return {
        "upload_folder_path": str(UPLOAD_DIR),
        "documents": documents,
    }


@router.post("/validate-category")
def validate_category(request: DocumentCategoryValidationRequest) -> dict[str, object]:
    return validate_document_category(
        filename=request.filename,
        declared_category=request.declared_category,
    )


@router.post("/ingest")
def ingest_documents() -> dict[str, str | int | list[str]]:
    logger.info("Received POST /documents/ingest.")
    try:
        result = ingest_uploaded_documents()
        logger.info("POST /documents/ingest completed: %s", result.get("status"))
        return result
    except IngestionError as error:
        return JSONResponse(status_code=error.http_status, content=error.payload)
    except Exception as error:
        logger.error("POST /documents/ingest failed unexpectedly:\n%s", safe_ingestion_trace())
        return JSONResponse(status_code=500, content={
            "status": "error", "message": "Document ingestion failed unexpectedly.",
            "details": type(error).__name__ + ": check backend logs.", "failed_step": "unknown",
        })


@router.get("/ingest/status")
def read_ingestion_status() -> dict[str, Any]:
    try:
        return get_ingestion_status()
    except Exception as error:
        logger.error("Could not read ingestion status:\n%s", safe_ingestion_trace())
        return JSONResponse(status_code=503, content={
            "status": "error", "message": "Could not read the ingestion/vector-store status.",
            "details": type(error).__name__ + ": check backend logs.", "failed_step": "vector_store",
        })
