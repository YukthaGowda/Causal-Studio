from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
import logging
import os
import traceback
from threading import Lock
from pathlib import Path
from typing import Any


UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "documents"
CHROMA_DB_DIR = Path(__file__).resolve().parents[2] / "chroma_db"
COLLECTION_NAME = "causal_design_agent_documents"
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200


logger = logging.getLogger("uvicorn.error.rag_ingestion")


class IngestionDependencyError(RuntimeError):
    pass


class IngestionError(RuntimeError):
    def __init__(self, message, failed_step, details, http_status=500):
        super().__init__(message)
        self.payload = {"status": "error", "message": message, "details": details, "failed_step": failed_step}
        self.http_status = http_status


_ingestion_lock = Lock()
_ingestion_state = {"status": "idle", "failed_step": None, "status_scope": "process"}


def _update_status(**fields):
    _ingestion_state.update(fields, updated_at=datetime.now(UTC).isoformat())
    logger.info("Ingestion status updated: status=%s step=%s", _ingestion_state.get("status"), _ingestion_state.get("step"))


def safe_ingestion_trace():
    text = traceback.format_exc()
    for key, value in os.environ.items():
        if value and any(word in key.upper() for word in ("TOKEN", "SECRET", "PASSWORD", "API_KEY")):
            text = text.replace(value, "[redacted]")
    return text


# Importing this module must not download model weights. The model is initialized
# only by an ingestion or search request that needs embeddings.
_embedding_model: Any | None = None
_embedding_model_error: IngestionDependencyError | None = None


logger.info(
    "RAG embedding model loading is lazy and will initialize only when ingestion/search is requested."
)


@dataclass(frozen=True)
class TextUnit:
    text: str
    page_number: int | None = None


@dataclass(frozen=True)
class TextChunk:
    text: str
    chunk_index: int
    page_number: int | None = None


def get_uploaded_document_paths() -> list[Path]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return [
        file_path
        for file_path in sorted(UPLOAD_DIR.iterdir())
        if file_path.is_file() and file_path.suffix.lower() in ALLOWED_EXTENSIONS
    ]


def get_file_hash(file_path: Path) -> str:
    digest = sha256()
    with file_path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_pdf_text(file_path: Path) -> list[TextUnit]:
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise IngestionDependencyError("Missing dependency: pypdf") from error

    reader = PdfReader(str(file_path))
    text_units: list[TextUnit] = []
    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            text_units.append(TextUnit(text=text, page_number=page_index))
    return text_units


def read_docx_text(file_path: Path) -> list[TextUnit]:
    try:
        from docx import Document
    except ImportError as error:
        raise IngestionDependencyError("Missing dependency: python-docx") from error

    document = Document(str(file_path))
    paragraphs = [
        paragraph.text.strip()
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    ]
    return [TextUnit(text="\n".join(paragraphs))] if paragraphs else []


def read_txt_text(file_path: Path) -> list[TextUnit]:
    text = file_path.read_text(encoding="utf-8", errors="ignore").strip()
    return [TextUnit(text=text)] if text else []


def read_document_text(file_path: Path) -> list[TextUnit]:
    extension = file_path.suffix.lower()
    if extension == ".pdf":
        return read_pdf_text(file_path)
    if extension == ".docx":
        return read_docx_text(file_path)
    if extension == ".txt":
        return read_txt_text(file_path)
    return []


def split_text(text: str) -> list[str]:
    cleaned_text = " ".join(text.split())
    if not cleaned_text:
        return []

    chunks: list[str] = []
    start = 0
    text_length = len(cleaned_text)

    while start < text_length:
        end = min(start + CHUNK_SIZE, text_length)
        chunks.append(cleaned_text[start:end])
        if end == text_length:
            break
        start = max(0, end - CHUNK_OVERLAP)

    return chunks


def chunk_text_units(text_units: list[TextUnit]) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    for text_unit in text_units:
        for chunk_text in split_text(text_unit.text):
            chunks.append(
                TextChunk(
                    text=chunk_text,
                    chunk_index=len(chunks),
                    page_number=text_unit.page_number,
                )
            )
    return chunks


def get_chroma_collection() -> Any:
    try:
        import chromadb
    except ImportError as error:
        raise IngestionDependencyError("Missing dependency: chromadb") from error

    CHROMA_DB_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("Opening ChromaDB vector store at %s.", CHROMA_DB_DIR)
    client = chromadb.PersistentClient(path=str(CHROMA_DB_DIR))
    # Embeddings are supplied explicitly below, so prevent Chroma from selecting
    # its own embedding function during normal collection access.
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=None,
    )


def get_embedding_model() -> Any:
    """Initialize the sentence-transformers model only for a RAG operation."""
    global _embedding_model, _embedding_model_error

    if _embedding_model is not None:
        return _embedding_model
    # A transient download/load failure must be retryable without restarting the service.

    try:
        from sentence_transformers import SentenceTransformer

        logger.info("Initializing RAG embedding model for an ingestion or search request.")
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        logger.info("RAG embedding model initialized successfully: %s.", EMBEDDING_MODEL_NAME)
        return _embedding_model
    except ImportError as error:
        _embedding_model_error = IngestionDependencyError(
            "RAG embedding support is unavailable because sentence-transformers is not installed."
        )
        raise _embedding_model_error from error
    except Exception as error:
        logger.error("RAG embedding model initialization failed:\n%s", safe_ingestion_trace())
        _embedding_model_error = IngestionDependencyError(
            "RAG embedding model could not be initialized. Check model availability or server connectivity, then retry ingestion or search."
        )
        raise _embedding_model_error from error


def create_embeddings(texts: list[str]) -> list[list[float]]:
    model = get_embedding_model()
    try:
        embeddings = model.encode(texts, normalize_embeddings=True)
    except Exception as error:
        logger.error("RAG embedding generation failed:\n%s", safe_ingestion_trace())
        raise IngestionDependencyError(
            "RAG embeddings could not be generated. Check model availability or server connectivity, then retry ingestion."
        ) from error
    return embeddings.tolist()


def build_chunk_metadata(
    file_path: Path,
    file_hash: str,
    chunk: TextChunk,
    ingestion_timestamp: str,
) -> dict[str, str | int]:
    extension = file_path.suffix.lower()
    metadata: dict[str, str | int] = {
        "source_filename": file_path.name,
        "file_extension": extension,
        "chunk_index": chunk.chunk_index,
        "document_type": extension.removeprefix("."),
        "ingestion_timestamp": ingestion_timestamp,
        "file_hash": file_hash,
    }

    if chunk.page_number is not None:
        metadata["page_number"] = chunk.page_number

    return metadata


def _run_ingestion() -> dict[str, str | int | list[str]]:
    _update_status(step="document_loading")
    document_paths = get_uploaded_document_paths()
    logger.info(
        "Starting document ingestion. Found %d document(s): %s",
        len(document_paths),
        [str(path) for path in document_paths],
    )
    logger.info("Document extensions: %s", [path.suffix.lower() for path in document_paths])
    logger.info("Document ingestion will use ChromaDB path: %s", CHROMA_DB_DIR)
    if not document_paths:
        raise IngestionError("No uploaded documents were found on this backend.", "document_loading",
                             "Upload PDF, DOCX, or TXT files to this deployment before ingestion. Local uploads do not transfer to Railway.", 400)
    _update_status(step="vector_store", documents_found=len(document_paths))
    collection = get_chroma_collection()
    logger.info("Vector store initialization finished.")
    ingestion_timestamp = datetime.now(UTC).isoformat()

    chunks_created = 0
    processed_filenames: list[str] = []

    for file_path in document_paths:
        logger.info("Reading document for ingestion: %s (%s)", file_path, file_path.suffix.lower())
        _update_status(step="document_loading", current_file=file_path.name)
        text_units = read_document_text(file_path)
        _update_status(step="chunking")
        chunks = chunk_text_units(text_units)
        logger.info("Chunking finished: path=%s chunks=%d", file_path, len(chunks))
        processed_filenames.append(file_path.name)

        if not chunks:
            continue

        file_hash = get_file_hash(file_path)
        chunk_texts = [chunk.text for chunk in chunks]
        chunk_ids = [f"{file_hash}:{chunk.chunk_index}" for chunk in chunks]
        metadatas = [
            build_chunk_metadata(
                file_path=file_path,
                file_hash=file_hash,
                chunk=chunk,
                ingestion_timestamp=ingestion_timestamp,
            )
            for chunk in chunks
        ]
        _update_status(step="embedding")
        logger.info("Embedding started: path=%s chunks=%d", file_path, len(chunks))
        embeddings = create_embeddings(chunk_texts)
        logger.info("Embedding finished: path=%s", file_path)
        _update_status(step="vector_store")
        logger.info("Vector upsert started: path=%s", file_path)
        collection.upsert(
            ids=chunk_ids,
            documents=chunk_texts,
            metadatas=metadatas,
            embeddings=embeddings,
        )
        chunks_created += len(chunks)
        logger.info("Vector upsert finished: path=%s total_chunks=%d", file_path, chunks_created)
        _update_status(chunks_created=chunks_created)

    logger.info(
        "Document ingestion completed. Files processed: %d; chunks created: %d; ChromaDB path: %s",
        len(processed_filenames),
        chunks_created,
        CHROMA_DB_DIR,
    )
    return {
        "status": "completed",
        "files_processed": len(processed_filenames),
        "chunks_created": chunks_created,
        "processed_filenames": processed_filenames,
        "collection_name": COLLECTION_NAME,
        "chroma_storage_path": str(CHROMA_DB_DIR),
    }


def ingest_uploaded_documents():
    if not _ingestion_lock.acquire(blocking=False):
        raise IngestionError("Document ingestion is already running.", "unknown", "Check /documents/ingest/status before retrying.", 409)
    try:
        _update_status(status="running", step="document_loading", failed_step=None, message=None,
                       details=None, chunks_created=0, documents_found=0, current_file=None)
        result = _run_ingestion()
        if not result["chunks_created"]:
            raise IngestionError("Documents contain no extractable text.", "chunking", "Scanned PDFs require text extraction/OCR before ingestion.", 400)
        _update_status(status="completed", step=None, **{k: v for k, v in result.items() if k != "status"})
        return result
    except Exception as error:
        logger.error("Document ingestion failed:\n%s", safe_ingestion_trace())
        failure = error if isinstance(error, IngestionError) else IngestionError(
            "Document ingestion failed during " + str(_ingestion_state.get("step") or "unknown") + ".",
            _ingestion_state.get("step") or "unknown",
            str(error) if isinstance(error, IngestionDependencyError) else type(error).__name__ + ": check the backend ingestion logs for the detailed cause.",
            503 if isinstance(error, IngestionDependencyError) else 500,
        )
        _update_status(**failure.payload)
        raise failure from error
    finally:
        _ingestion_lock.release()


def get_ingestion_status() -> dict[str, Any]:
    if _ingestion_state.get("status") in {"running", "error"}:
        return {**_ingestion_state, "stored_chunks": None, "collection_name": COLLECTION_NAME}
    chroma_exists = CHROMA_DB_DIR.exists() and any(CHROMA_DB_DIR.iterdir())
    stored_chunks: int | None = None

    if chroma_exists and _ingestion_state.get("status") != "running":
        collection = get_chroma_collection()
        stored_chunks = collection.count()

    return {
        **_ingestion_state,
        "chroma_exists": chroma_exists,
        "collection_name": COLLECTION_NAME,
        "stored_chunks": stored_chunks,
        "chroma_storage_path": str(CHROMA_DB_DIR),
    }
