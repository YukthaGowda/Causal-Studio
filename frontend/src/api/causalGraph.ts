import { API_BASE_URL } from "./health";
import type {
  CausalGraphDraft,
  CausalGraphValidationResponse,
  CausalRoleRecommendation,
  SelectedCausalVariable,
} from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Causal graph generation failed.");
  }

  return data as T;
}

export async function generateAndValidateGraph({
  confirmedQuestion,
  datasetFilename,
  selectedVariables,
  roleRecommendations,
  estimandType = "total_effect",
  topKEvidence = 5,
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  selectedVariables: SelectedCausalVariable[];
  roleRecommendations: CausalRoleRecommendation[];
  estimandType?: string;
  topKEvidence?: number;
}): Promise<CausalGraphValidationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/causal-graph/generate-and-validate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirmed_question: confirmedQuestion,
        dataset_filename: datasetFilename,
        selected_variables: selectedVariables,
        role_recommendations: roleRecommendations,
        estimand_type: estimandType,
        top_k_evidence: topKEvidence,
      }),
    },
  );

  return parseJsonResponse<CausalGraphValidationResponse>(response);
}

export async function validateEditedGraph({
  confirmedQuestion,
  datasetFilename,
  graphDraft,
  selectedVariables,
  roleRecommendations,
  estimandType = "total_effect",
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  graphDraft: CausalGraphDraft;
  selectedVariables: SelectedCausalVariable[];
  roleRecommendations: CausalRoleRecommendation[];
  estimandType?: string;
}): Promise<CausalGraphValidationResponse> {
  const response = await fetch(`${API_BASE_URL}/causal-graph/validate-edited`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      confirmed_question: confirmedQuestion,
      dataset_filename: datasetFilename,
      graph_draft: graphDraft,
      selected_variables: selectedVariables,
      role_recommendations: roleRecommendations,
      estimand_type: estimandType,
    }),
  });

  return parseJsonResponse<CausalGraphValidationResponse>(response);
}
