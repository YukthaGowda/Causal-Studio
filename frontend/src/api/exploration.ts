import { API_BASE_URL } from "./health";
import type { BroadExplorationResponse } from "../types/api";

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
