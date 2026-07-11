from pathlib import Path
from shutil import copyfileobj
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.services.dataset_schema import DatasetSchemaError, parse_dataset_schema


router = APIRouter(prefix="/datasets", tags=["datasets"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "datasets"
ALLOWED_EXTENSIONS = {".csv"}


def get_file_extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def build_saved_filename(original_filename: str) -> str:
    extension = get_file_extension(original_filename)
    stem = Path(original_filename).stem or "dataset"
    safe_stem = "".join(
        character if character.isalnum() or character in ("-", "_") else "_"
        for character in stem
    ).strip("_")
    return f"{safe_stem or 'dataset'}_{uuid4().hex}{extension}"


def resolve_dataset_path(filename: str) -> Path:
    requested_path = Path(filename)
    if requested_path.name != filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dataset filename must not include a path.",
        )

    dataset_path = UPLOAD_DIR / filename
    if not dataset_path.exists() or not dataset_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset file was not found.",
        )

    if dataset_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only CSV datasets can be parsed.",
        )

    return dataset_path


@router.post("/upload", status_code=status.HTTP_201_CREATED)
def upload_dataset(file: UploadFile = File(...)) -> dict[str, str | int]:
    extension = get_file_extension(file.filename)

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Upload a .csv file.",
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
def list_datasets() -> dict[str, str | list[dict[str, str | int]]]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    datasets = []
    for file_path in sorted(UPLOAD_DIR.iterdir()):
        if file_path.is_file() and file_path.suffix.lower() in ALLOWED_EXTENSIONS:
            datasets.append(
                {
                    "filename": file_path.name,
                    "file_extension": file_path.suffix.lower(),
                    "file_size": file_path.stat().st_size,
                    "upload_folder_path": str(UPLOAD_DIR),
                }
            )

    return {
        "upload_folder_path": str(UPLOAD_DIR),
        "datasets": datasets,
    }


@router.get("/{filename}/schema")
def read_dataset_schema(filename: str) -> dict[str, object]:
    dataset_path = resolve_dataset_path(filename)

    try:
        return parse_dataset_schema(dataset_path)
    except DatasetSchemaError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
