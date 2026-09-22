"""Conservative study-log filtering. Not a guarantee of free-text anonymization."""
import json
import re

SOURCES = {"llm_response", "deterministic_response", "fallback_response", "error_response"}
ENUMS = {
    "source": SOURCES,
    "status": {"started", "running", "completed", "success", "error", "failed", "blocked", "unknown", "ready", "requires_revision"},
    "format": {"json", "markdown", "pdf"},
}
COUNTS = {"row_count", "column_count", "document_count", "chunk_count", "warning_count", "sample_size", "node_count", "edge_count", "duration_ms"}


def safe_text(text):
    # Do not retain diagnostic dumps or recognizable credentials at all.
    if re.search(r'Traceback \(most recent call last\)|-----BEGIN .*PRIVATE KEY|\b(?:api[_ -]?key|authorization|password|secret)\s*[:=]', text, re.I):
        return "[Sensitive content omitted]"
    text = re.sub(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[email removed]', text, flags=re.I)
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '[network address removed]', text)
    text = re.sub(r'(?<!\w)(?:\+?\d[\d ()-]{8,}\d)(?!\w)', '[phone-like text removed]', text)
    text = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)', '[credential removed]', text, flags=re.I)
    text = re.sub(r'(?i)\b[^\s/\\]+\.(?:csv|xlsx?|pdf|docx?|txt|json)\b', '[filename removed]', text)
    return text


def sanitize_metadata(value):
    """Only typed aggregate counters and fixed enums; no nested arbitrary payloads."""
    if len(json.dumps(value, allow_nan=False).encode()) > 8192:
        raise ValueError("Metadata exceeds size limit")
    clean = {}
    for key, item in value.items():
        if key in ENUMS and isinstance(item, str) and item in ENUMS[key]:
            clean[key] = item
        elif key in COUNTS and type(item) is int and 0 <= item <= 10**12:
            clean[key] = item
    if clean != value:
        clean['metadata_sanitized'] = True
    return clean
