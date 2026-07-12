import { API_BASE_URL } from "./health";
import type {
  AnalysisStrategyPlan,
  AssumptionReviewResponse,
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
    throw new Error(detail ?? "Assumption review failed.");
  }

  return data as T;
}

export async function reviewAssumptions({
  confirmedQuestion,
  datasetFilename,
  graph,
  roleRecommendations,
  identificationResult,
  analysisStrategy,
  exposure,
  outcome,
  adjustmentSet,
  topKEvidence = 5,
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  graph: Pick<CausalGraphDraft, "graph_type" | "nodes" | "edges">;
  roleRecommendations: CausalRoleRecommendation[];
  identificationResult: IdentificationCheckResponse;
  analysisStrategy: AnalysisStrategyPlan;
  exposure?: string;
  outcome?: string;
  adjustmentSet?: string[];
  topKEvidence?: number;
}): Promise<AssumptionReviewResponse> {
  const response = await fetch(`${API_BASE_URL}/assumptions/review`, {
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
      analysis_strategy: analysisStrategy,
      exposure,
      outcome,
      adjustment_set: adjustmentSet,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<AssumptionReviewResponse>(response);
}
