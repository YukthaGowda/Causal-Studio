import type { HealthResponse } from "../types/api";

const HEALTH_ENDPOINT = "http://localhost:8000/health";

export async function getBackendHealth(): Promise<HealthResponse> {
  const response = await fetch(HEALTH_ENDPOINT);

  if (!response.ok) {
    throw new Error("Backend health check failed.");
  }

  return response.json() as Promise<HealthResponse>;
}
