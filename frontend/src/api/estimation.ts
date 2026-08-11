import { API_BASE_URL } from "./health";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail ?? "Estimation request failed.");
  return data as T;
}

export type EstimationConfig = {
  dataset_filename: string;
  exposure: string;
  outcome: string;
  adjustment_set?: string[];
  strategy?: Record<string, unknown>;
  participant_id?: string;
  timestamp?: string;
};

export async function validateEstimationConfig(payload: EstimationConfig): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/estimation/validate-config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function runEstimation(payload: EstimationConfig & Record<string, unknown>): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/estimation/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
}

export async function listEstimationRuns(): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/estimation/runs`));
}

export async function selectPrimaryEstimationRun(runId: string): Promise<Record<string, unknown>> {
  return parseJsonResponse(await fetch(`${API_BASE_URL}/estimation/select-primary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: runId }) }));
}
