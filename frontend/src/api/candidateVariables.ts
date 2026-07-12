import { API_BASE_URL } from "./health";
import type { CandidateVariableRecommendationResponse } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Candidate variable recommendation failed.");
  }

  return data as T;
}

export async function recommendCandidateVariables({
  confirmedQuestion,
  datasetFilename,
  topKEvidence = 5,
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  topKEvidence?: number;
}): Promise<CandidateVariableRecommendationResponse> {
  const response = await fetch(`${API_BASE_URL}/candidate-variables/recommend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      confirmed_question: confirmedQuestion,
      dataset_filename: datasetFilename,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<CandidateVariableRecommendationResponse>(response);
}
