export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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

export async function checkBackendHealth() {
  const response = await fetch(`${API_BASE_URL}/health`);
  return parseJsonResponse(response, "Backend health check failed.");
}

export async function uploadDataset(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE_URL}/datasets/upload`, {
    method: "POST",
    body: formData,
  });
  return parseJsonResponse(response, "Dataset upload failed.");
}

export async function listDatasets() {
  const response = await fetch(`${API_BASE_URL}/datasets`);
  return parseJsonResponse(response, "Could not list datasets.");
}

export async function getDatasetSchema(filename) {
  const response = await fetch(`${API_BASE_URL}/datasets/${encodeURIComponent(filename)}/schema`);
  return parseJsonResponse(response, "Dataset schema parsing failed.");
}

export async function uploadDocument(file, category) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);
  const response = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: "POST",
    body: formData,
  });
  return parseJsonResponse(response, "Document upload failed.");
}

export async function listDocuments() {
  const response = await fetch(`${API_BASE_URL}/documents`);
  return parseJsonResponse(response, "Could not list documents.");
}

export async function ingestDocuments() {
  const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
    method: "POST",
  });
  return parseJsonResponse(response, "Document ingestion failed.");
}

export async function getIngestionStatus() {
  const response = await fetch(`${API_BASE_URL}/documents/ingest/status`);
  return parseJsonResponse(response, "Could not check document ingestion status.");
}

export async function searchRag(query, topK = 5) {
  const response = await fetch(`${API_BASE_URL}/rag/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: topK }),
  });
  return parseJsonResponse(response, "RAG search failed.");
}

export async function runBroadExploration(filename) {
  const response = await fetch(`${API_BASE_URL}/exploration/broad`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_filename: filename }),
  });
  return parseJsonResponse(response, "Broad exploration failed.");
}

export async function runFeasibilityCheck(payload) {
  const response = await fetch(`${API_BASE_URL}/feasibility/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Targeted feasibility check failed.");
}

export async function assistantAction(payload) {
  const response = await fetch(`${API_BASE_URL}/assistant/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Assistant action failed.");
}

export async function generateQuestionCandidates(payload) {
  const response = await fetch(`${API_BASE_URL}/questions/generate-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Question candidate generation failed.");
}

export async function recommendCandidateVariables(payload) {
  const response = await fetch(`${API_BASE_URL}/variables/recommend-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Candidate variable recommendation failed.");
}

export async function generateCausalGraph(payload) {
  const response = await fetch(`${API_BASE_URL}/causal-graph/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Causal graph generation failed.");
}

export async function validateCausalGraph(payload) {
  const response = await fetch(`${API_BASE_URL}/causal-graph/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Causal graph validation failed.");
}

export async function runEstimation(payload) {
  const response = await fetch(`${API_BASE_URL}/estimation/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Estimation run failed.");
}

export async function listEstimationRuns() {
  const response = await fetch(`${API_BASE_URL}/estimation/runs`);
  return parseJsonResponse(response, "Could not list estimation runs.");
}

export async function interpretEstimation(payload) {
  const response = await fetch(`${API_BASE_URL}/estimation/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Estimation interpretation failed.");
}

export async function generateReport(payload) {
  const response = await fetch(`${API_BASE_URL}/reports/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Report generation failed.");
}

export async function auditClaims(payload) {
  const response = await fetch(`${API_BASE_URL}/reports/audit-claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, "Claim audit failed.");
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
