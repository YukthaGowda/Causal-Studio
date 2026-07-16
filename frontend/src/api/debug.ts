import { API_BASE_URL } from "./health";
import type { LangSmithStatusResponse, LangSmithTestTraceResponse } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Debug request failed.");
  }

  return data as T;
}

export async function getLangSmithStatus(): Promise<LangSmithStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/debug/langsmith-status`);
  return parseJsonResponse<LangSmithStatusResponse>(response);
}

export async function runLangSmithTestTrace(): Promise<LangSmithTestTraceResponse> {
  const response = await fetch(`${API_BASE_URL}/debug/test-trace`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "What should the system validate deterministically?",
      top_k: 2,
    }),
  });

  return parseJsonResponse<LangSmithTestTraceResponse>(response);
}
