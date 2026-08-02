const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const LOCAL_API_CANDIDATES = [
  "http://127.0.0.1:8000",
  "http://localhost:8000",
  "http://127.0.0.1:8010",
  "http://localhost:8010",
  "http://127.0.0.1:8005",
  "http://localhost:8005",
];

export let API_BASE_URL = configuredApiBaseUrl || LOCAL_API_CANDIDATES[0];

function apiBaseCandidates() {
  return [...new Set([configuredApiBaseUrl, API_BASE_URL, ...LOCAL_API_CANDIDATES].filter(Boolean))];
}

async function parseJsonResponse(response, fallbackMessage) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.detail;
    if (Array.isArray(detail)) {
      throw new Error(detail.map((item) => item.msg || item.message).filter(Boolean).join("; ") || fallbackMessage);
    }
    throw new Error(detail || data?.message || fallbackMessage);
  }

  return data;
}

async function apiFetch(path, options) {
  const candidates = apiBaseCandidates();
  const errors = [];

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, options);
      API_BASE_URL = baseUrl;
      return response;
    } catch (error) {
      errors.push(`${baseUrl}: ${error?.message || "network error"}`);
    }
  }

  throw new Error(
    `Could not reach the FastAPI backend. Tried ${candidates.join(", ")}. Start FastAPI or set VITE_API_BASE_URL. ${errors.at(-1) || ""}`.trim()
  );
}

export async function checkBackendHealth() {
  const response = await apiFetch("/health");
  const data = await parseJsonResponse(response, "Backend health check failed.");
  return { ...data, api_base_url: API_BASE_URL };
}

export async function uploadDataset(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch("/datasets/upload", {
    method: "POST",
    body: formData,
  });
  return parseJsonResponse(response, "Dataset upload failed.");
}

export async function listDatasets() {
  const response = await apiFetch("/datasets");
  return parseJsonResponse(response, "Could not list datasets.");
}

export async function getDatasetSchema(filename) {
  const response = await apiFetch(`/datasets/${encodeURIComponent(filename)}/schema`);
  return parseJsonResponse(response, "Dataset schema parsing failed.");
}

export async function uploadDocument(file, category) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);
  const response = await apiFetch("/documents/upload", {
    method: "POST",
    body: formData,
  });
  return parseJsonResponse(response, "Document upload failed.");
}

export async function validateDocumentCategory(filename, declaredCategory = "unknown") {
  const response = await apiFetch("/documents/validate-category", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, declared_category: declaredCategory }),
  });
  return parseJsonResponse(response, "Document category validation failed.");
}

export async function listDocuments() {
  const response = await apiFetch("/documents");
  return parseJsonResponse(response, "Could not list documents.");
}

export async function ingestDocuments() {
  const response = await apiFetch("/documents/ingest", {
    method: "POST",
  });
  return parseJsonResponse(response, "Document ingestion failed.");
}

export async function getIngestionStatus() {
  const response = await apiFetch("/documents/ingest/status");
  return parseJsonResponse(response, "Could not check document ingestion status.");
}

export async function searchRag(query, topK = 5) {
  const response = await apiFetch("/rag/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK }),
  });
  return parseJsonResponse(response, "RAG search failed.");
}

export async function runBroadExploration(filename) {
  const response = await apiFetch("/exploration/broad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_filename: filename }),
  });
  return parseJsonResponse(response, "Broad exploration failed.");
}

export async function runFeasibilityCheck(payload) {
  const response = await apiFetch("/feasibility/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Targeted feasibility check failed.");
}

export async function assistantAction(payload) {
  const response = await apiFetch("/assistant/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Assistant action failed.");
}

export async function generateQuestionCandidates(payload) {
  const response = await apiFetch("/questions/generate-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Question candidate generation failed.");
}

export async function recommendCandidateVariables(payload) {
  const response = await apiFetch("/variables/recommend-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Candidate variable recommendation failed.");
}

export async function generateCausalGraph(payload) {
  const response = await apiFetch("/causal-graph/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Causal graph generation failed.");
}

export async function validateCausalGraph(payload) {
  const response = await apiFetch("/causal-graph/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Causal graph validation failed.");
}

export async function generateAnalysisStrategy(payload) {
  const response = await apiFetch("/analysis-strategy/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Analysis strategy generation failed.");
}

export async function validateAnalysisStrategy(payload) {
  const response = await apiFetch("/analysis-strategy/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Analysis strategy validation failed.");
}

export async function runEstimation(payload) {
  const response = await apiFetch("/estimation/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Estimation run failed.");
}

export async function listEstimationRuns() {
  const response = await apiFetch("/estimation/runs");
  return parseJsonResponse(response, "Could not list estimation runs.");
}

export async function validateEstimationConfig(payload) {
  const response = await apiFetch("/estimation/validate-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Estimation config validation failed.");
}

export async function selectPrimaryEstimationRun(payload) {
  const response = await apiFetch("/estimation/select-primary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Primary estimation run selection failed.");
}

export async function interpretEstimation(payload) {
  const response = await apiFetch("/estimation/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Estimation interpretation failed.");
}

export async function generateReport(payload) {
  const response = await apiFetch("/reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Report generation failed.");
}

export async function auditClaims(payload) {
  const response = await apiFetch("/reports/audit-claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Claim audit failed.");
}

export async function assembleReviewPackage(payload) {
  const response = await apiFetch("/review-export/assemble", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Review package assembly failed.");
}

export async function runClaimAudit(payload) {
  const response = await apiFetch("/review-export/claim-audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Review claim audit failed.");
}

export async function exportReviewPackage(payload) {
  const response = await apiFetch("/review-export/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Review package export failed.");
}

export function exportReport(payload, format = "json") {
  const extension = format === "markdown" ? "md" : "json";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `causal_design_estimation_evidence_report_${date}.${extension}`;
  const content = format === "markdown"
    ? payload.markdown || JSON.stringify(payload, null, 2)
    : JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: format === "markdown" ? "text/markdown" : "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return filename;
}
