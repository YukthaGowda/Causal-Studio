"""Conservative study-log filtering. Not a guarantee of free-text anonymization."""
import json
import re

SOURCES = {"llm_response", "deterministic_response", "fallback_response", "error_response"}
ENUMS = {
    "source": SOURCES,
    "status": {"started", "running", "completed", "success", "error", "failed", "blocked", "unknown", "ready", "requires_revision"},
    "format": {"json", "markdown", "pdf"},
}
PHASES = {"setup", "data-foundation", "explore", "question", "feasibility", "graph", "strategy", "estimation", "review"}
ENUMS.update({
    "from_phase": PHASES, "to_phase": PHASES,
    "role": {"exposure", "outcome", "confounder", "mediator", "collider", "context", "proxy", "unassigned"},
    "failed_step": {"document_loading", "chunking", "embedding", "vector_store", "unknown"},
    "error_category": {"action_failed", "unavailable", "validation", "blocked"},
})
COUNTS = {"row_count", "column_count", "document_count", "chunk_count", "warning_count", "sample_size", "node_count", "edge_count", "duration_ms"}


def redact_phones(text):
    # Keep formats/boundaries aligned with studyEvents.js. Match whole phone
    # groups, never a decimal tail or a fragment of scientific notation.
    candidates = (
        r'(?:\+?[0-9]{1,3}[ -]?)?\([0-9]{2,4}\)[ -]?[0-9]{3,4}[ -]?[0-9]{3,4}'
        r'|(?:\+?1[ .-]?)?[0-9]{3}([ .-])[0-9]{3}\1[0-9]{4}'
        r'|\+[0-9]{1,3}(?:[ -][0-9]{1,6}){2,4}'
        r'|\+[0-9]{1,3}[ -][0-9]{7,12}'
        r'|\+?[0-9]{10,15}'
    )

    def replace(match):
        candidate = match.group()
        before, after = text[:match.start()], text[match.end():]
        if re.search(r'[A-Za-z0-9_.+-]$', before) or re.match(r'(?:[A-Za-z0-9_]|[.+-][0-9])', after):
            return candidate
        if not 10 <= len(re.sub(r'[^0-9]', '', candidate)) <= 15:
            return candidate
        # Only an explicitly labeled statistical integer/CI bound is exempt;
        # formatted contacts and other text in the same sentence stay filtered.
        contexts = (
            r'\b(?:n|sample[ _]size|sample[ _]count|observation[ _]count|row[ _]count)\s*[:=]\s*$',
            r'\b(?:point estimate|coefficient|standard error|se|p-value)\s*(?:[:=]\s*|\s+)$',
            r'\b(?:ci(?: bounds)?|confidence interval)\s*:?\s*[(\[]?\s*(?:[+-]?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?(?:\s*,\s*|\s+))?$',
        )
        if re.fullmatch(r'\+?[0-9]+', candidate) and any(re.search(context, before, re.I | re.ASCII) for context in contexts):
            return candidate
        return '[phone-like text removed]'

    return re.sub(candidates, replace, text)


def safe_text(text):
    # Do not retain diagnostic dumps or recognizable credentials at all.
    if re.search(r'Traceback \(most recent call last\)|-----BEGIN .*PRIVATE KEY|\b(?:api[_ -]?key|authorization|password|secret)\s*[:=]', text, re.I):
        return "[Sensitive content omitted]"
    text = re.sub(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[email removed]', text, flags=re.I)
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', '[network address removed]', text)
    text = redact_phones(text)
    text = re.sub(r'\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)', '[credential removed]', text, flags=re.I)
    text = re.sub(r'(?i)\b[^\s/\\]+\.(?:csv|xlsx?|pdf|docx?|txt|json)\b', '[filename removed]', text)
    return text


def sanitize_metadata(value):
    """Only typed aggregate counters and fixed enums; no nested arbitrary payloads."""
    if len(json.dumps(value, allow_nan=False).encode()) > 8192:
        raise ValueError("Metadata exceeds size limit")
    clean = {}
    for key, item in value.items():
        if key == "request_id" and isinstance(item, str) and re.fullmatch(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}", item):
            clean[key] = item
        elif key in {"text_sanitized", "text_truncated", "metadata_sanitized"} and item is True:
            clean[key] = True
        elif key in ENUMS and isinstance(item, str) and item in ENUMS[key]:
            clean[key] = item
        elif key in COUNTS and type(item) is int and 0 <= item <= 10**12:
            clean[key] = item
    if clean != value:
        clean['metadata_sanitized'] = True
    return clean
