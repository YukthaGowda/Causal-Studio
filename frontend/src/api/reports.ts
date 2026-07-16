import { API_BASE_URL } from "./health";
import type { ReportGenerationResponse } from "../types/api";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg).join(" ")
      : data.detail;
    throw new Error(detail ?? "Report generation failed.");
  }

  return data as T;
}

export async function generateReport(payload: {
  projectTitle?: string;
  researchObjective?: string;
  confirmedQuestion: string;
  datasetFilename: string;
  schemaSummary?: Record<string, unknown>;
  broadExplorationSummary?: Record<string, unknown>;
  candidateQuestions?: unknown[];
  selectedCandidateQuestion?: unknown;
  candidateVariables?: unknown[];
  targetedFeasibilityResult?: Record<string, unknown>;
  selectedVariables: unknown[];
  roleRecommendations: Array<Record<string, unknown>>;
  roleValidationResult?: Record<string, unknown>;
  graph: Record<string, unknown>;
  graphValidationResult?: Record<string, unknown>;
  identificationResult: Record<string, unknown>;
  analysisStrategy: Record<string, unknown>;
  assumptionsReview: Record<string, unknown>;
  evidenceSummary?: unknown[];
  userNotes?: string;
}): Promise<ReportGenerationResponse> {
  const response = await fetch(`${API_BASE_URL}/reports/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project_title: payload.projectTitle || null,
      research_objective: payload.researchObjective || null,
      confirmed_question: payload.confirmedQuestion,
      dataset_filename: payload.datasetFilename,
      schema_summary: payload.schemaSummary || null,
      broad_exploration_summary: payload.broadExplorationSummary || null,
      candidate_questions: payload.candidateQuestions || [],
      selected_candidate_question: payload.selectedCandidateQuestion || null,
      candidate_variables: payload.candidateVariables || [],
      targeted_feasibility_result: payload.targetedFeasibilityResult || null,
      selected_variables: payload.selectedVariables,
      role_recommendations: payload.roleRecommendations,
      role_validation_result: payload.roleValidationResult || null,
      graph: payload.graph,
      graph_validation_result: payload.graphValidationResult || null,
      identification_result: payload.identificationResult,
      analysis_strategy: payload.analysisStrategy,
      assumptions_review: payload.assumptionsReview,
      evidence_summary: payload.evidenceSummary || [],
      user_notes: payload.userNotes || null,
    }),
  });

  return parseJsonResponse<ReportGenerationResponse>(response);
}
