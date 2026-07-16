import { API_BASE_URL } from "./health";
import type {
  BroadExplorationResponse,
  TargetedFeasibilityResponse,
} from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Broad exploration failed.");
  }

  return data as T;
}

export async function runBroadExploration({
  datasetFilename,
  maxColumns = 30,
  targetColumn,
  participantIdColumn,
  timestampColumn,
}: {
  datasetFilename: string;
  maxColumns?: number;
  targetColumn?: string;
  participantIdColumn?: string;
  timestampColumn?: string;
}): Promise<BroadExplorationResponse> {
  const response = await fetch(`${API_BASE_URL}/exploration/broad`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dataset_filename: datasetFilename,
      max_columns: maxColumns,
      target_column: targetColumn || null,
      participant_id_column: participantIdColumn || null,
      timestamp_column: timestampColumn || null,
    }),
  });

  return parseJsonResponse<BroadExplorationResponse>(response);
}

export async function runTargetedFeasibility({
  datasetFilename,
  confirmedQuestion,
  selectedVariables,
  exposure,
  outcome,
  comparator,
  participantIdColumn,
  timestampColumn,
  timeWindow,
  lagDefinition,
  topKEvidence = 5,
}: {
  datasetFilename: string;
  confirmedQuestion: string;
  selectedVariables: Array<string | Record<string, unknown>>;
  exposure?: string;
  outcome?: string;
  comparator?: string;
  participantIdColumn?: string;
  timestampColumn?: string;
  timeWindow?: string;
  lagDefinition?: string;
  topKEvidence?: number;
}): Promise<TargetedFeasibilityResponse> {
  const response = await fetch(`${API_BASE_URL}/exploration/targeted-feasibility`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dataset_filename: datasetFilename,
      confirmed_question: confirmedQuestion,
      selected_variables: selectedVariables,
      exposure: exposure || null,
      outcome: outcome || null,
      comparator: comparator || null,
      participant_id_column: participantIdColumn || null,
      timestamp_column: timestampColumn || null,
      time_window: timeWindow || null,
      lag_definition: lagDefinition || null,
      top_k_evidence: topKEvidence,
    }),
  });

  return parseJsonResponse<TargetedFeasibilityResponse>(response);
}
