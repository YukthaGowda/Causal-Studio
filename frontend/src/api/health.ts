import type { HealthResponse } from "../types/api";

export const API_BASE_URL = "http://127.0.0.1:8010";

const HEALTH_ENDPOINT = `${API_BASE_URL}/health`;

export async function getBackendHealth(): Promise<HealthResponse> {
  const response = await fetch(HEALTH_ENDPOINT);

  if (!response.ok) {
    throw new Error("Backend health check failed.");
  }

  return response.json() as Promise<HealthResponse>;
}
