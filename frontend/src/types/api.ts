export type HealthResponse = {
  status: string;
  message: string;
};

export type DocumentUploadResponse = {
  original_filename: string;
  saved_filename: string;
  file_extension: string;
  file_size_bytes: number;
  saved_path: string;
  upload_status: string;
};

export type UploadedDocument = {
  filename: string;
  file_extension: string;
  file_size: number;
  upload_folder_path: string;
};

export type DocumentListResponse = {
  upload_folder_path: string;
  documents: UploadedDocument[];
};

export type IngestDocumentsResponse = {
  status: string;
  files_processed: number;
  chunks_created: number;
  processed_filenames: string[];
  collection_name: string;
  chroma_storage_path: string;
};

export type IngestionStatusResponse = {
  chroma_exists: boolean;
  collection_name: string;
  stored_chunks: number | null;
  chroma_storage_path: string;
};

export type RagSearchResult = {
  chunk_text: string;
  source_filename: string | null;
  file_extension: string | null;
  chunk_index: number | null;
  document_type: string | null;
  distance: number | null;
  page_number?: number;
};

export type RagSearchResponse = {
  query: string;
  number_of_results: number;
  message?: string;
  results: RagSearchResult[];
};

export type DatasetUploadResponse = {
  original_filename: string;
  saved_filename: string;
  file_extension: string;
  file_size_bytes: number;
  saved_path: string;
  upload_status: string;
};

export type UploadedDataset = {
  filename: string;
  file_extension: string;
  file_size: number;
  upload_folder_path: string;
};

export type DatasetListResponse = {
  upload_folder_path: string;
  datasets: UploadedDataset[];
};

export type DatasetSchemaResponse = {
  filename: string;
  number_of_rows: number;
  number_of_columns: number;
  column_names: string[];
  pandas_data_types: Record<string, string>;
  missing_value_count_per_column: Record<string, number>;
  missing_value_percentage_per_column: Record<string, number>;
  unique_values_per_column: Record<string, number>;
  possible_numeric_columns: string[];
  possible_categorical_columns: string[];
  possible_id_columns: string[];
  possible_timestamp_date_columns: string[];
  sample_values: Record<string, Array<string | number | boolean | null>>;
  warnings: Array<{
    column: string | null;
    warning: string;
    missing_percentage: number | null;
  }>;
};

export type CandidateCausalQuestion = {
  candidate_id: string;
  question_text: string;
  population: string;
  exposure: string;
  comparator: string;
  outcome: string;
  time_window: string;
  unit_of_analysis: string;
  within_person_or_between_person_focus: string;
  required_variables: string[];
  available_dataset_variables: string[];
  missing_or_uncertain_variables: string[];
  supporting_evidence: string[];
  limitations: string[];
  confidence: string;
};

export type GenerateCausalQuestionsResponse = {
  status: string;
  research_objective: string;
  dataset_filename: string;
  model: string;
  evidence_chunks_used: number;
  candidates: CandidateCausalQuestion[];
};

export type CandidateVariableRecommendation = {
  variable_name: string;
  source_field: string;
  data_category: string;
  direct_or_derived: string;
  relevance_to_question: string;
  possible_role_hint: string;
  measurement_timing: string;
  data_quality_notes: string;
  missingness_warning: string;
  supporting_evidence: string[];
  recommendation_status: string;
  confidence: string;
  user_decision_default: string;
};

export type DerivedFeatureRecommendation = {
  derived_feature_name: string;
  source_columns_needed: string[];
  calculation_window: string;
  aggregation_method: string;
  minimum_data_requirement: string;
  leakage_risk: string;
  missing_data_handling: string;
  supporting_evidence: string[];
  confidence: string;
};

export type CandidateVariableRecommendationResponse = {
  status: string;
  confirmed_question: string;
  dataset_filename: string;
  model: string;
  evidence_chunks_used: number;
  data_categories: string[];
  variable_groups: Record<string, CandidateVariableRecommendation[]>;
  derived_features: DerivedFeatureRecommendation[];
};

export type SelectedCausalVariable = {
  variable_name: string;
  source_field?: string;
  data_category?: string;
  direct_or_derived?: string;
  measurement_timing?: string;
  user_notes?: string;
  missingness_warning?: string;
  possible_role_hint?: string;
};

export type CausalRoleRecommendation = {
  variable_name: string;
  source_field?: string;
  recommended_roles: string[];
  primary_role: string;
  temporal_role: string;
  measurement_role: string;
  adjustment_recommendation: string;
  rationale: string;
  supporting_evidence: string[];
  uncertainty_notes: string;
  confidence: string;
};

export type CausalRoleValidationIssue = {
  variable_name: string | null;
  warning_type?: string;
  error_type?: string;
  message: string;
  severity: "info" | "warning" | "high" | "blocking";
  suggested_fix: string;
};

export type BackendCausalRoleValidation = {
  validation_status: "passed" | "passed_with_warnings" | "failed";
  warnings: CausalRoleValidationIssue[];
  errors: CausalRoleValidationIssue[];
  recommended_next_action: string;
  safe_to_continue_to_graph: boolean;
};

export type CausalRoleValidationResponse = {
  status: string;
  confirmed_question: string;
  dataset_filename: string;
  estimand_type: string;
  model: string;
  evidence_chunks_used: number;
  selected_variables: SelectedCausalVariable[];
  role_recommendations: CausalRoleRecommendation[];
  backend_validation: BackendCausalRoleValidation;
};

export type CausalGraphNode = {
  node_id: string;
  variable_name: string;
  display_name: string;
  role: string;
  temporal_role: string;
  data_category: string;
  is_observed: boolean;
  confidence: string;
};

export type CausalGraphEdge = {
  source: string;
  target: string;
  edge_type: string;
  rationale: string;
  supporting_evidence: string[];
  confidence: string;
  temporal_assumption: string;
  user_editable: boolean;
};

export type CausalGraphUncertainEdge = {
  source: string;
  target: string;
  possible_direction: string;
  uncertainty_reason: string;
  evidence_gap: string;
  recommended_user_review: string;
};

export type CausalGraphDraft = {
  graph_type: string;
  nodes: CausalGraphNode[];
  edges: CausalGraphEdge[];
  uncertain_edges: CausalGraphUncertainEdge[];
  omitted_variables: Array<Record<string, string>>;
  latent_confounder_warnings: string[];
  graph_rationale: string;
  evidence_summary: string;
  limitations: string[];
};

export type CausalGraphValidationIssue = {
  warning_type?: string;
  error_type?: string;
  source: string | null;
  target: string | null;
  message: string;
  severity: "info" | "warning" | "high" | "blocking";
  suggested_fix: string;
};

export type BackendCausalGraphValidation = {
  graph_validation_status: "passed" | "passed_with_warnings" | "failed";
  warnings: CausalGraphValidationIssue[];
  errors: CausalGraphValidationIssue[];
  suggested_graph_edits: string[];
  safe_to_continue_to_identification: boolean;
};

export type CausalGraphValidationResponse = {
  status: string;
  confirmed_question: string;
  dataset_filename: string;
  estimand_type: string;
  model: string;
  evidence_chunks_used: number;
  graph_draft: CausalGraphDraft;
  backend_validation: BackendCausalGraphValidation;
};
