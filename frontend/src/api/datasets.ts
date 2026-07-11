import { API_BASE_URL } from "./health";
import type {
  DatasetListResponse,
  DatasetSchemaResponse,
  DatasetUploadResponse,
} from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail ?? "Dataset request failed.");
  }

  return data as T;
}

export async function uploadDataset(file: File): Promise<DatasetUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/datasets/upload`, {
    method: "POST",
    body: formData,
  });

  return parseJsonResponse<DatasetUploadResponse>(response);
}

export async function listDatasets(): Promise<DatasetListResponse> {
  const response = await fetch(`${API_BASE_URL}/datasets`);
  return parseJsonResponse<DatasetListResponse>(response);
}

export async function getDatasetSchema(
  filename: string,
): Promise<DatasetSchemaResponse> {
  const encodedFilename = encodeURIComponent(filename);
  const response = await fetch(`${API_BASE_URL}/datasets/${encodedFilename}/schema`);
  return parseJsonResponse<DatasetSchemaResponse>(response);
}
