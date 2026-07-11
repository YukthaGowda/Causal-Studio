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
