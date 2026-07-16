import { API_BASE_URL } from "./health";
import type { WorkflowState } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail ?? "Workflow request failed.");
  }

  return data as T;
}

export async function startWorkflow(payload: {
  projectTitle?: string;
  researchObjective?: string;
  datasetFilename?: string;
}): Promise<WorkflowState> {
  const response = await fetch(`${API_BASE_URL}/workflow/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_title: payload.projectTitle || null,
      research_objective: payload.researchObjective || null,
      dataset_filename: payload.datasetFilename || null,
    }),
  });
  return parseJsonResponse<WorkflowState>(response);
}

export async function getWorkflowState(workflowId: string): Promise<WorkflowState> {
  const response = await fetch(`${API_BASE_URL}/workflow/${workflowId}/state`);
  return parseJsonResponse<WorkflowState>(response);
}

export async function advanceWorkflow(
  workflowId: string,
  inputs: Record<string, unknown>,
): Promise<WorkflowState> {
  const response = await fetch(`${API_BASE_URL}/workflow/${workflowId}/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs }),
  });
  return parseJsonResponse<WorkflowState>(response);
}

export async function confirmWorkflow(
  workflowId: string,
  confirmation: Record<string, unknown>,
): Promise<WorkflowState> {
  const response = await fetch(`${API_BASE_URL}/workflow/${workflowId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });
  return parseJsonResponse<WorkflowState>(response);
}

export async function reviseWorkflow(
  workflowId: string,
  targetStep: number,
  reason?: string,
): Promise<WorkflowState> {
  const response = await fetch(`${API_BASE_URL}/workflow/${workflowId}/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_step: targetStep, reason: reason || null }),
  });
  return parseJsonResponse<WorkflowState>(response);
}
