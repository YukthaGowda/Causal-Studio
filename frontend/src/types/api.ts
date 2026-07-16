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

export type MissingnessItem = {
  column: string;
  missing_percentage: number;
  severity: "info" | "warning" | "high";
};

export type ParticipantSummary = {
  participant_id_column: string;
  number_of_unique_participants: number;
  rows_per_participant: {
    min: number;
    max: number;
    average: number | null;
    median: number | null;
    imbalance_ratio: number | null;
  };
  warnings: string[];
};

export type TemporalSummary = {
  detected_timestamp_columns: string[];
  common_time_fields: string[];
  parsed_timestamp_summary: {
    timestamp_column: string;
    min_timestamp: string | null;
    max_timestamp: string | null;
    number_of_unique_days: number;
    parse_success_rate: number | null;
  } | null;
  warnings: string[];
};

export type BroadCorrelationItem = {
  column_a: string;
  column_b: string;
  correlation: number;
};

export type BroadExplorationWarning = {
  warning_type: string;
  column?: string;
  message: string;
  severity: "info" | "warning" | "high";
};

export type BroadExplorationResponse = {
  dataset_filename: string;
  number_of_rows: number;
  number_of_columns: number;
  possible_id_columns: string[];
  possible_timestamp_columns: string[];
  numeric_columns: string[];
  categorical_columns: string[];
  missingness_summary: {
    highest_missingness_columns: MissingnessItem[];
    high_missingness_columns: MissingnessItem[];
  };
  high_missingness_columns: MissingnessItem[];
  low_variation_columns: Array<{
    column: string;
    unique_values: number;
    unique_ratio: number;
  }>;
  possible_label_or_outcome_columns: string[];
  target_column: string | null;
  participant_summary: ParticipantSummary | null;
  temporal_summary: TemporalSummary;
  sensor_or_feature_groups: Record<string, string[]>;
  broad_correlation_summary: {
    numeric_columns_used: string[];
    strongest_positive: BroadCorrelationItem[];
    strongest_negative: BroadCorrelationItem[];
    warning: string;
  };
  data_quality_warnings: BroadExplorationWarning[];
  exploration_warning: string;
};

export type TargetedFeasibilityWarning = {
  warning_type: string;
  variable?: string;
  message: string;
  severity: "info" | "warning" | "high" | "blocking";
};

export type TargetedVariableSummary = {
  variable_name: string;
  exists_in_dataset: boolean;
  data_type: string | null;
  missing_count: number | null;
  missing_percentage: number | null;
  unique_values: number | null;
  sample_values: Array<string | number | boolean | null>;
  numeric_summary: {
    min: number | null;
    max: number | null;
    mean: number | null;
    median: number | null;
    std: number | null;
  } | null;
  categorical_summary: {
    most_common_values: Array<{ value: string; count: number }>;
  } | null;
  feasibility_notes: string[];
  warnings: TargetedFeasibilityWarning[];
};

export type TargetedFeasibilitySection = {
  variable?: string | null;
  exists?: boolean;
  has_variation?: boolean;
  unique_values?: number;
  non_missing_observations?: number;
  status: string;
  warnings: TargetedFeasibilityWarning[];
};

export type TargetedFeasibilityResponse = {
  dataset_filename: string;
  confirmed_question: string;
  selected_variables_checked: string[];
  missing_selected_variables: string[];
  exposure: string | null;
  outcome: string | null;
  participant_id_column: string | null;
  timestamp_column: string | null;
  feasibility_status:
    | "feasible_for_graph_design"
    | "feasible_with_warnings"
    | "needs_revision_before_graph"
    | "not_feasible_with_current_data";
  feasibility_score: number;
  variable_summaries: TargetedVariableSummary[];
  exposure_feasibility: TargetedFeasibilitySection;
  outcome_feasibility: TargetedFeasibilitySection;
  lag_feasibility: Record<string, unknown> & {
    status: string;
    warnings: TargetedFeasibilityWarning[];
  };
  temporal_ordering_summary: Record<string, string | null>;
  missingness_and_coverage_summary: {
    selected_variables_above_30_percent_missing: string[];
    analysis_ready_complete_case_rows: number | null;
  };
  participant_level_availability: Record<string, unknown> & {
    warnings: TargetedFeasibilityWarning[];
  };
  overlap_or_comparator_summary: Record<string, unknown> & {
    status: string;
    warnings: TargetedFeasibilityWarning[];
  };
  redundancy_or_correlation_summary: {
    numeric_variables_checked: string[];
    high_correlations: BroadCorrelationItem[];
    warning: string;
  };
  derived_feature_feasibility: Record<string, string | boolean>;
  analysis_ready_sample_summary: Record<string, number | null>;
  data_quality_warnings: TargetedFeasibilityWarning[];
  recommended_revision_actions: string[];
  safe_to_continue_to_graph: boolean;
  exploration_warning: string;
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

export type IdentificationIssue = {
  issue_type: string;
  variable_name?: string | null;
  source?: string | null;
  target?: string | null;
  message: string;
  severity: "info" | "warning" | "high" | "blocking";
  suggested_fix: string;
};

export type IdentificationCheckResponse = {
  status: string;
  identification_status:
    | "ready_for_analysis_planning"
    | "requires_revision"
    | "not_identifiable_with_current_design"
    | "identifiable_only_under_additional_assumptions";
  exposure: string | null;
  outcome: string | null;
  proposed_adjustment_set: string[];
  adjustment_set_status: "acceptable" | "needs_review" | "invalid" | "unavailable";
  open_issues: IdentificationIssue[];
  warnings: IdentificationIssue[];
  errors: IdentificationIssue[];
  assumptions_required: string[];
  missing_variables: string[];
  recommended_next_action: string;
  safe_to_continue_to_analysis_strategy: boolean;
  plain_language_summary: string;
  evidence_chunks_used: number;
};

export type StrategyIssue = {
  issue_type: string;
  variable_name?: string | null;
  message: string;
  severity: "info" | "warning" | "high" | "blocking";
  suggested_fix: string;
};

export type AnalysisStrategyPlan = {
  strategy_status:
    | "ready_for_review"
    | "requires_design_revision"
    | "not_ready_for_analysis"
    | "ready_only_under_additional_assumptions";
  target_estimand: string;
  exposure_definition: string;
  comparator_definition: string;
  outcome_definition: string;
  time_window: string;
  unit_of_analysis: string;
  adjustment_set: string[];
  repeated_measures_handling: string;
  missing_data_strategy: string;
  recommended_estimator_family: string[];
  estimator_rationale: string;
  data_requirements: string[];
  sensitivity_checks: string[];
  robustness_checks: string[];
  limitations: string[];
  assumptions_needed: string[];
  what_can_be_claimed: string;
  what_cannot_be_claimed: string;
  recommended_next_action: string;
  confidence: string;
};

export type AnalysisStrategyResponse = {
  status: string;
  confirmed_question: string;
  dataset_filename: string;
  estimand_type: string;
  exposure: string | null;
  outcome: string | null;
  adjustment_set: string[];
  strategy_plan: AnalysisStrategyPlan;
  deterministic_warnings: StrategyIssue[];
  deterministic_errors: StrategyIssue[];
  evidence_chunks_used: number;
};

export type AssumptionItem = {
  assumption_name: string;
  status: "supported" | "uncertain" | "not_supported" | "not_applicable";
  rationale: string;
  evidence_summary: string;
  dataset_support: string;
  risk_if_violated: string;
  recommended_check: string;
  recommended_revision_if_needed: string;
  severity: "info" | "warning" | "high" | "blocking";
};

export type AssumptionReview = {
  review_status:
    | "ready_for_report_review"
    | "requires_design_revision"
    | "needs_additional_user_review"
    | "not_ready";
  assumptions: AssumptionItem[];
  sensitivity_checks: string[];
  robustness_checks: string[];
  data_quality_concerns: string[];
  measurement_concerns: string[];
  causal_interpretation_limits: string[];
  recommended_next_action: string;
  deterministic_warnings?: StrategyIssue[];
  plain_language_summary: string;
  confidence: string;
};

export type AssumptionReviewResponse = {
  status: string;
  confirmed_question: string;
  dataset_filename: string;
  exposure: string | null;
  outcome: string | null;
  adjustment_set: string[];
  review: AssumptionReview;
  deterministic_warnings: StrategyIssue[];
  evidence_chunks_used: number;
};

export type ClaimAuditFinding = {
  unsafe_language: string;
  severity: "info" | "warning" | "high" | "blocking";
  suggested_safe_alternative: string;
};

export type ClaimAudit = {
  status: "passed" | "passed_with_warnings";
  unsafe_claims_found: ClaimAuditFinding[];
  required_safe_statements: string[];
};

export type ReportGenerationResponse = {
  report_title: string;
  report_type: "Causal Design and Analysis Guidance Report";
  generated_at: string;
  project_summary: Record<string, unknown>;
  research_objective: string | null;
  final_research_question: string;
  population: string;
  data_sources: Record<string, unknown>;
  dataset_summary: Record<string, unknown>;
  broad_data_exploration_summary: Record<string, unknown> | null;
  data_feasibility_summary: Record<string, unknown> | null;
  unit_of_analysis: string;
  exposure: string | null;
  comparator: string;
  outcome: string | null;
  time_window: string;
  selected_variables: string[];
  causal_role_table: Array<Record<string, unknown>>;
  final_causal_graph_summary: Record<string, unknown>;
  graph_edges: Array<Record<string, unknown>>;
  identification_assessment: Record<string, unknown>;
  adjustment_set: string[];
  analysis_strategy: Record<string, unknown>;
  assumption_checklist: AssumptionItem[];
  sensitivity_plan: string[];
  robustness_plan: string[];
  supporting_evidence: unknown[];
  limitations: string[];
  unsupported_or_uncertain_assumptions: AssumptionItem[];
  what_can_be_claimed: string;
  what_cannot_be_claimed: string;
  claim_audit: ClaimAudit;
  recommended_next_steps: string[];
  pdf_export_status: "not_implemented";
  pdf_export_message: string;
};

export type WorkflowMessage = {
  message: string;
  severity: "info" | "warning" | "high" | "blocking";
};

export type WorkflowState = {
  workflow_id: string;
  current_step: number;
  current_step_name: string;
  completed_steps: number[];
  project_title?: string | null;
  research_objective?: string | null;
  dataset_filename?: string | null;
  schema_summary?: Record<string, unknown> | null;
  broad_exploration_summary?: Record<string, unknown> | null;
  selected_candidate_question?: unknown;
  selected_variables?: unknown[];
  targeted_feasibility_result?: Record<string, unknown> | null;
  role_recommendations?: Array<Record<string, unknown>>;
  role_validation_result?: Record<string, unknown> | null;
  graph?: Record<string, unknown> | null;
  graph_validation_result?: Record<string, unknown> | null;
  identification_result?: Record<string, unknown> | null;
  analysis_strategy?: Record<string, unknown> | null;
  assumptions_review?: Record<string, unknown> | null;
  report?: Record<string, unknown> | null;
  warnings: WorkflowMessage[];
  errors: WorkflowMessage[];
  next_required_user_action: string;
  updated_at: string;
};

export type LangSmithStatusResponse = {
  tracing_enabled: boolean;
  langchain_project: string | null;
  api_key_present: boolean;
  warning: string | null;
};

export type LangSmithTestTraceResponse = LangSmithStatusResponse & {
  trace_completed: boolean;
  rag_status: string;
  results_count: number;
  source_filenames: string[];
};
