import { API_BASE_URL } from "./health";
import type {
  AnalysisStrategyResponse,
  CausalGraphDraft,
  CausalRoleRecommendation,
  IdentificationCheckResponse,
} from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Analysis strategy generation failed.");
  }

  return data as T;
}

export async function generateAnalysisStrategy({
  confirmedQuestion,
  datasetFilename,
  graph,
  roleRecommendations,
  identificationResult,
  exposure,
  outcome,
  adjustmentSet,
  estimandType = "total_effect",
  topKEvidence = 5,
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  graph: Pick<CausalGraphDraft, "graph_type" | "nodes" | "edges">;
  roleRecommendations: CausalRoleRecommendation[];
  identificationResult: IdentificationCheckResponse;
  exposure?: string;
  outcome?: string;
  adjustmentSet?: string[];
  estimandType?: string;
  topKEvidence?: number;
}): Promise<AnalysisStrategyResponse> {
  const response = await fetch(`${API_BASE_URL}/analysis-strategy/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      confirmed_question: confirmedQuestion,
      dataset_filename: datasetFilename,
      graph,
      role_recommendations: roleRecommendations,
      identification_result: identificationResult,
      exposure,
      outcome,
      adjustment_set: adjustmentSet,
      estimand_type: estimandType,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<AnalysisStrategyResponse>(response);
}
