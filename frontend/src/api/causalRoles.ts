import { API_BASE_URL } from "./health";
import type {
  CausalRoleValidationResponse,
  SelectedCausalVariable,
} from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Causal role validation failed.");
  }

  return data as T;
}

export async function recommendAndValidateRoles({
  confirmedQuestion,
  datasetFilename,
  selectedVariables,
  estimandType = "total_effect",
  topKEvidence = 5,
}: {
  confirmedQuestion: string;
  datasetFilename: string;
  selectedVariables: SelectedCausalVariable[];
  estimandType?: string;
  topKEvidence?: number;
}): Promise<CausalRoleValidationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/causal-roles/recommend-and-validate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        confirmed_question: confirmedQuestion,
        dataset_filename: datasetFilename,
        selected_variables: selectedVariables,
        estimand_type: estimandType,
        top_k_evidence: topKEvidence,
      }),
    },
  );

  return parseJsonResponse<CausalRoleValidationResponse>(response);
}
