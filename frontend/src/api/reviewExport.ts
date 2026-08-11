import { API_BASE_URL } from "./health";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail ?? "Review/export request failed.");
  return data as T;
}

export async function assembleReviewPackage(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/review-export/assemble`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function auditReviewClaims(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/review-export/claim-audit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function exportReviewPackage(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/review-export/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
}
