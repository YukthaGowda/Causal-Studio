from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
import logging
from pathlib import Path
from typing import Any


UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads" / "documents"
CHROMA_DB_DIR = Path(__file__).resolve().parents[2] / "chroma_db"
COLLECTION_NAME = "causal_design_agent_documents"
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
EMBEDDING_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200


logger = logging.getLogger(__name__)


class IngestionDependencyError(RuntimeError):
    pass


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
    if _embedding_model_error is not None:
        raise _embedding_model_error

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
        logger.exception("RAG embedding model initialization failed.")
        _embedding_model_error = IngestionDependencyError(
            "RAG embedding model could not be initialized. Check model availability or server connectivity, then retry ingestion or search."
        )
        raise _embedding_model_error from error


def create_embeddings(texts: list[str]) -> list[list[float]]:
    model = get_embedding_model()
    try:
        embeddings = model.encode(texts, normalize_embeddings=True)
    except Exception as error:
        logger.exception("RAG embedding generation failed during document ingestion.")
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


def ingest_uploaded_documents() -> dict[str, str | int | list[str]]:
    document_paths = get_uploaded_document_paths()
    logger.info(
        "Starting document ingestion. Found %d document(s): %s",
        len(document_paths),
        [str(path) for path in document_paths],
    )
    logger.info("Document extensions: %s", [path.suffix.lower() for path in document_paths])
    logger.info("Document ingestion will use ChromaDB path: %s", CHROMA_DB_DIR)
    collection = get_chroma_collection()
    ingestion_timestamp = datetime.now(UTC).isoformat()

    chunks_created = 0
    processed_filenames: list[str] = []

    for file_path in document_paths:
        logger.info("Reading document for ingestion: %s (%s)", file_path, file_path.suffix.lower())
        text_units = read_document_text(file_path)
        chunks = chunk_text_units(text_units)
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
        embeddings = create_embeddings(chunk_texts)

        collection.upsert(
            ids=chunk_ids,
            documents=chunk_texts,
            metadatas=metadatas,
            embeddings=embeddings,
        )
        chunks_created += len(chunks)

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


def get_ingestion_status() -> dict[str, str | int | bool | None]:
    chroma_exists = CHROMA_DB_DIR.exists() and any(CHROMA_DB_DIR.iterdir())
    stored_chunks: int | None = None

    if chroma_exists:
        collection = get_chroma_collection()
        stored_chunks = collection.count()

    return {
        "chroma_exists": chroma_exists,
        "collection_name": COLLECTION_NAME,
        "stored_chunks": stored_chunks,
        "chroma_storage_path": str(CHROMA_DB_DIR),
    }
