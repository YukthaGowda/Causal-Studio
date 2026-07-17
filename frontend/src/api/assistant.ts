import { API_BASE_URL } from "./health";
import type { AssistantChatResponse } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Assistant request failed.");
  }

  return data as T;
}

export async function chatWithAssistant(
  message: string,
  workflowStep?: string,
  topKEvidence = 4,
): Promise<AssistantChatResponse> {
  const response = await fetch(`${API_BASE_URL}/assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      workflow_step: workflowStep,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<AssistantChatResponse>(response);
}
