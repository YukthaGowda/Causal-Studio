import { API_BASE_URL } from "./health";
import type {
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
    throw new Error(detail ?? "Identification check failed.");
  }

  return data as T;
}

export async function runIdentificationCheck({
  confirmedQuestion,
  datasetFilename,
  graph,
  roleRecommendations,
  userAdjustmentSet,
  estimandType = "total_effect",
  topKEvidence = 5,
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  graph: Pick<CausalGraphDraft, "graph_type" | "nodes" | "edges">;
  roleRecommendations: CausalRoleRecommendation[];
  userAdjustmentSet?: string[];
  estimandType?: string;
  topKEvidence?: number;
}): Promise<IdentificationCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/identification/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      confirmed_question: confirmedQuestion,
      dataset_filename: datasetFilename,
      graph,
      role_recommendations: roleRecommendations,
      user_adjustment_set: userAdjustmentSet,
      estimand_type: estimandType,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<IdentificationCheckResponse>(response);
}
