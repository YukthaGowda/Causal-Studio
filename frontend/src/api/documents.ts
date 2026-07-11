import { API_BASE_URL } from "./health";
import type {
  DocumentListResponse,
  DocumentUploadResponse,
  IngestDocumentsResponse,
  IngestionStatusResponse,
} from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail ?? "Document request failed.");
  }

  return data as T;
}

export async function uploadDocument(file: File): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: "POST",
    body: formData,
  });

  return parseJsonResponse<DocumentUploadResponse>(response);
}

export async function listDocuments(): Promise<DocumentListResponse> {
  const response = await fetch(`${API_BASE_URL}/documents`);
  return parseJsonResponse<DocumentListResponse>(response);
}

export async function ingestDocuments(): Promise<IngestDocumentsResponse> {
  const response = await fetch(`${API_BASE_URL}/documents/ingest`, {
    method: "POST",
  });

  return parseJsonResponse<IngestDocumentsResponse>(response);
}

export async function getIngestionStatus(): Promise<IngestionStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/documents/ingest/status`);
  return parseJsonResponse<IngestionStatusResponse>(response);
}
