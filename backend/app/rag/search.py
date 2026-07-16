from __future__ import annotations

from typing import Any

from app.core.langsmith_tracing import record_trace_event, summarize_sources
from app.rag.ingestion import (
    CHROMA_DB_DIR,
    COLLECTION_NAME,
    EMBEDDING_MODEL_NAME,
    IngestionDependencyError,
)


class RagSearchError(RuntimeError):
    pass


def get_existing_chroma_collection() -> Any:
    if not CHROMA_DB_DIR.exists() or not any(CHROMA_DB_DIR.iterdir()):
        raise RagSearchError(
            "ChromaDB has not been created yet. Ingest documents before searching."
        )

    try:
        import chromadb
    except ImportError as error:
        raise IngestionDependencyError("Missing dependency: chromadb") from error

    client = chromadb.PersistentClient(path=str(CHROMA_DB_DIR))

    try:
        return client.get_collection(name=COLLECTION_NAME)
    except Exception as error:
        raise RagSearchError(
            "RAG collection was not found. Ingest documents before searching."
        ) from error


def create_query_embedding(query: str) -> list[float]:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise IngestionDependencyError("Missing dependency: sentence-transformers") from error

    model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    embedding = model.encode([query], normalize_embeddings=True)
    return embedding.tolist()[0]


def search_rag_chunks(query: str, top_k: int = 5) -> dict[str, str | int | list[dict[str, Any]]]:
    normalized_query = query.strip()
    if not normalized_query:
        raise RagSearchError("Search query cannot be empty.")

    collection = get_existing_chroma_collection()
    stored_chunks = collection.count()
    if stored_chunks == 0:
        record_trace_event(
            "rag_search",
            {
                "workflow_step": "rag_search",
                "query_length": len(normalized_query),
                "top_k": top_k,
                "stored_chunks": stored_chunks,
                "number_of_results": 0,
                "source_filenames": [],
            },
        )
        return {
            "query": normalized_query,
            "number_of_results": 0,
            "message": "No documents have been ingested yet.",
            "results": [],
        }

    result_limit = min(top_k, stored_chunks)
    query_embedding = create_query_embedding(normalized_query)
    query_results = collection.query(
        query_embeddings=[query_embedding],
        n_results=result_limit,
        include=["documents", "metadatas", "distances"],
    )

    documents = query_results.get("documents", [[]])[0]
    metadatas = query_results.get("metadatas", [[]])[0]
    distances = query_results.get("distances", [[]])[0]

    results: list[dict[str, Any]] = []
    for document, metadata, distance in zip(documents, metadatas, distances, strict=False):
        metadata = metadata or {}
        result = {
            "chunk_text": document,
            "source_filename": metadata.get("source_filename"),
            "file_extension": metadata.get("file_extension"),
            "chunk_index": metadata.get("chunk_index"),
            "document_type": metadata.get("document_type"),
            "distance": distance,
        }

        if "page_number" in metadata:
            result["page_number"] = metadata["page_number"]

        results.append(result)

    record_trace_event(
        "rag_search",
        {
            "workflow_step": "rag_search",
            "query_length": len(normalized_query),
            "top_k": top_k,
            "stored_chunks": stored_chunks,
            "number_of_results": len(results),
            "source_filenames": summarize_sources(results),
        },
    )

    return {
        "query": normalized_query,
        "number_of_results": len(results),
        "results": results,
    }
