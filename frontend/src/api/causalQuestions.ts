import { API_BASE_URL } from "./health";
import type { GenerateCausalQuestionsResponse } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Candidate question generation failed.");
  }

  return data as T;
}

export async function generateCausalQuestions({
  researchObjective,
  datasetFilename,
  topKEvidence = 5,
}: {
  researchObjective: string;
  datasetFilename: string;
  topKEvidence?: number;
}): Promise<GenerateCausalQuestionsResponse> {
  const response = await fetch(`${API_BASE_URL}/causal-questions/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      research_objective: researchObjective,
      dataset_filename: datasetFilename,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<GenerateCausalQuestionsResponse>(response);
}
