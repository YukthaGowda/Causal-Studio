import { API_BASE_URL } from "./health";
import type { RagSearchResponse } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "RAG search request failed.");
  }

  return data as T;
}

export async function searchRag(
  query: string,
  topK = 5,
): Promise<RagSearchResponse> {
  const response = await fetch(`${API_BASE_URL}/rag/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      top_k: topK,
    }),
  });

  return parseJsonResponse<RagSearchResponse>(response);
}
