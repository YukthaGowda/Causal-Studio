from pathlib import Path
from shutil import copyfileobj
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.rag.ingestion import (
    IngestionDependencyError,
    get_ingestion_status,
    ingest_uploaded_documents,
)


router = APIRouter(prefix="/documents", tags=["documents"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "documents"
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


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
def upload_document(file: UploadFile = File(...)) -> dict[str, str | int]:
    extension = get_file_extension(file.filename)

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


@router.post("/ingest")
def ingest_documents() -> dict[str, str | int | list[str]]:
    try:
        return ingest_uploaded_documents()
    except IngestionDependencyError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error


@router.get("/ingest/status")
def read_ingestion_status() -> dict[str, str | int | bool | None]:
    try:
        return get_ingestion_status()
    except IngestionDependencyError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
