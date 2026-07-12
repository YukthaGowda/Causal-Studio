import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  getIngestionStatus,
  ingestDocuments,
  listDocuments,
  uploadDocument,
} from "../api/documents";
import { getDatasetSchema, listDatasets, uploadDataset } from "../api/datasets";
import { searchRag } from "../api/rag";
import { generateCausalQuestions } from "../api/causalQuestions";
import { recommendCandidateVariables } from "../api/candidateVariables";
import { BackendStatus } from "../components/BackendStatus";
import type {
  CandidateCausalQuestion,
  CandidateVariableRecommendation,
  DatasetSchemaResponse,
  DerivedFeatureRecommendation,
  IngestionStatusResponse,
  RagSearchResult,
  UploadedDataset,
  UploadedDocument,
} from "../types/api";

const navItems = [
  "Home",
  "Data Foundation",
  "Explore",
  "Causal Studio",
  "Temporal & Estimation",
  "Review & Export",
  "Clinician Reference",
];

const progressStages = [
  { label: "Data Foundation", state: "done" },
  { label: "Explore", state: "active" },
  { label: "Causal Studio", state: "warning" },
  { label: "Temporal", state: "pending" },
  { label: "Review", state: "pending" },
  { label: "Clinician Ref.", state: "locked" },
];

const warnings = [
  "GPS missing for some participants",
  "phone_screen_time is a proxy and does not directly measure craving",
  "Aim type unconfirmed - causal language may be premature",
];

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStageSymbol(state: string) {
  if (state === "done") {
    return "✓";
  }
  if (state === "warning") {
    return "!";
  }
  if (state === "locked") {
    return "□";
  }
  return "";
}

export function HomePage() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentMessage, setDocumentMessage] = useState("");
  const [documentError, setDocumentError] = useState("");
  const [ingestionStatus, setIngestionStatus] =
    useState<IngestionStatusResponse | null>(null);
  const [documentBusy, setDocumentBusy] = useState(false);

  const [datasets, setDatasets] = useState<UploadedDataset[]>([]);
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [datasetSchema, setDatasetSchema] =
    useState<DatasetSchemaResponse | null>(null);
  const [datasetMessage, setDatasetMessage] = useState("");
  const [datasetError, setDatasetError] = useState("");
  const [datasetBusy, setDatasetBusy] = useState(false);

  const [ragQuery, setRagQuery] = useState(
    "What should the system validate deterministically?",
  );
  const [topK, setTopK] = useState(5);
  const [ragResults, setRagResults] = useState<RagSearchResult[]>([]);
  const [ragMessage, setRagMessage] = useState("");
  const [ragError, setRagError] = useState("");
  const [ragBusy, setRagBusy] = useState(false);
  const [researchObjective, setResearchObjective] = useState(
    "I want to study temporal relationships between sleep, stress, and next-day alcohol use.",
  );
  const [candidateDataset, setCandidateDataset] = useState("");
  const [candidateQuestions, setCandidateQuestions] = useState<
    CandidateCausalQuestion[]
  >([]);
  const [candidateMessage, setCandidateMessage] = useState("");
  const [candidateError, setCandidateError] = useState("");
  const [candidateBusy, setCandidateBusy] = useState(false);
  const [confirmedQuestion, setConfirmedQuestion] = useState(
    "Among adults in the uploaded EMA/passive sensing dataset, what is the effect of sleep-related features during window t on alcohol-use-related label during the next observation window?",
  );
  const [variableDataset, setVariableDataset] = useState("");
  const [variableGroups, setVariableGroups] = useState<
    Record<string, CandidateVariableRecommendation[]>
  >({});
  const [derivedFeatures, setDerivedFeatures] = useState<
    DerivedFeatureRecommendation[]
  >([]);
  const [variableMessage, setVariableMessage] = useState("");
  const [variableError, setVariableError] = useState("");
  const [variableBusy, setVariableBusy] = useState(false);

  const schemaRows = useMemo(() => {
    if (!datasetSchema) {
      return [];
    }

    return datasetSchema.column_names.slice(0, 8).map((column) => ({
      column,
      dtype: datasetSchema.pandas_data_types[column],
      missing:
        datasetSchema.missing_value_percentage_per_column[column]?.toFixed(2) ??
        "0.00",
      unique: datasetSchema.unique_values_per_column[column],
    }));
  }, [datasetSchema]);

  async function refreshDocuments() {
    const [documentList, status] = await Promise.all([
      listDocuments(),
      getIngestionStatus(),
    ]);
    setDocuments(documentList.documents);
    setIngestionStatus(status);
  }

  async function refreshDatasets() {
    const datasetList = await listDatasets();
    setDatasets(datasetList.datasets);
    if (!selectedDataset && datasetList.datasets.length > 0) {
      setSelectedDataset(datasetList.datasets[0].filename);
    }
    if (!candidateDataset && datasetList.datasets.length > 0) {
      setCandidateDataset(datasetList.datasets[0].filename);
    }
    if (!variableDataset && datasetList.datasets.length > 0) {
      setVariableDataset(datasetList.datasets[0].filename);
    }
  }

  useEffect(() => {
    refreshDocuments().catch((error: Error) => {
      setDocumentError(error.message);
    });
    refreshDatasets().catch((error: Error) => {
      setDatasetError(error.message);
    });
  }, []);

  async function handleDocumentUpload() {
    if (!documentFile) {
      setDocumentError("Choose a PDF or DOCX file first.");
      return;
    }

    setDocumentBusy(true);
    setDocumentError("");
    setDocumentMessage("");

    try {
      const result = await uploadDocument(documentFile);
      setDocumentMessage(`Stored ${result.saved_filename}`);
      setDocumentFile(null);
      await refreshDocuments();
    } catch (error) {
      setDocumentError((error as Error).message);
    } finally {
      setDocumentBusy(false);
    }
  }

  async function handleDocumentIngestion() {
    setDocumentBusy(true);
    setDocumentError("");
    setDocumentMessage("");

    try {
      const result = await ingestDocuments();
      setDocumentMessage(
        `Ingested ${result.files_processed} files into ${result.chunks_created} chunks.`,
      );
      await refreshDocuments();
    } catch (error) {
      setDocumentError((error as Error).message);
    } finally {
      setDocumentBusy(false);
    }
  }

  async function handleDatasetUpload() {
    if (!datasetFile) {
      setDatasetError("Choose a CSV file first.");
      return;
    }

    setDatasetBusy(true);
    setDatasetError("");
    setDatasetMessage("");

    try {
      const result = await uploadDataset(datasetFile);
      setDatasetMessage(`Stored ${result.saved_filename}`);
      setSelectedDataset(result.saved_filename);
      setDatasetFile(null);
      await refreshDatasets();
    } catch (error) {
      setDatasetError((error as Error).message);
    } finally {
      setDatasetBusy(false);
    }
  }

  async function handleSchemaLoad() {
    if (!selectedDataset) {
      setDatasetError("Select a dataset first.");
      return;
    }

    setDatasetBusy(true);
    setDatasetError("");
    setDatasetMessage("");

    try {
      const schema = await getDatasetSchema(selectedDataset);
      setDatasetSchema(schema);
      setDatasetMessage(`Parsed ${schema.number_of_columns} columns.`);
    } catch (error) {
      setDatasetError((error as Error).message);
    } finally {
      setDatasetBusy(false);
    }
  }

  async function handleRagSearch() {
    setRagBusy(true);
    setRagError("");
    setRagMessage("");

    try {
      const response = await searchRag(ragQuery, topK);
      setRagResults(response.results);
      setRagMessage(
        response.message ?? `Found ${response.number_of_results} matching chunks.`,
      );
    } catch (error) {
      setRagError((error as Error).message);
    } finally {
      setRagBusy(false);
    }
  }

  async function handleCandidateGeneration() {
    if (!candidateDataset) {
      setCandidateError("Select a dataset first.");
      return;
    }

    setCandidateBusy(true);
    setCandidateError("");
    setCandidateMessage("");

    try {
      const response = await generateCausalQuestions({
        researchObjective,
        datasetFilename: candidateDataset,
        topKEvidence: topK,
      });
      setCandidateQuestions(response.candidates);
      setCandidateMessage(
        `Generated ${response.candidates.length} design candidates using ${response.evidence_chunks_used} evidence chunks.`,
      );
    } catch (error) {
      setCandidateError((error as Error).message);
    } finally {
      setCandidateBusy(false);
    }
  }

  async function handleVariableRecommendation() {
    if (!variableDataset) {
      setVariableError("Select a dataset first.");
      return;
    }

    setVariableBusy(true);
    setVariableError("");
    setVariableMessage("");

    try {
      const response = await recommendCandidateVariables({
        confirmedQuestion,
        datasetFilename: variableDataset,
        topKEvidence: topK,
      });
      setVariableGroups(response.variable_groups);
      setDerivedFeatures(response.derived_features);
      const variableCount = Object.values(response.variable_groups).reduce(
        (total, recommendations) => total + recommendations.length,
        0,
      );
      setVariableMessage(
        `Recommended ${variableCount} candidate variables and ${response.derived_features.length} derived features using ${response.evidence_chunks_used} evidence chunks.`,
      );
    } catch (error) {
      setVariableError((error as Error).message);
    } finally {
      setVariableBusy(false);
    }
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">CS</div>
          <div>
            <strong>Causal Studio</strong>
            <span>Research Platform</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item, index) => (
            <button
              className={`nav-item ${index === 0 ? "nav-item--active" : ""}`}
              key={item}
              type="button"
            >
              <span className="nav-icon" aria-hidden="true">
                {index + 1}
              </span>
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item" type="button">
            <span className="nav-icon" aria-hidden="true">
              ⚙
            </span>
            Settings
          </button>
          <div className="user-card">
            <div className="avatar">RM</div>
            <div>
              <strong>Dr. R. Martinez</strong>
              <span>Lead Researcher</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="project-header">
          <div>
            <h1>AWARE-2023 Substance Use Study</h1>
            <p>EMA + Passive Sensing · 124 participants · 30-day observation</p>
          </div>
          <div className="header-actions">
            <span className="pill pill--warning">3 Warnings</span>
            <span className="pill">Stage 2/6</span>
          </div>
        </header>

        <section className="progress-card panel">
          <p className="section-label">Analysis Progress</p>
          <div className="progress-steps">
            {progressStages.map((stage) => (
              <div className="progress-step" key={stage.label}>
                <span className={`step-node step-node--${stage.state}`}>
                  {getStageSymbol(stage.state)}
                </span>
                <span>{stage.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="architecture-bar">
          <strong>Interaction Loop Architecture</strong>
          <span>Architecture Guide</span>
          <button type="button" aria-label="Collapse architecture guide">
            ˅
          </button>
        </section>

        <section className="workspace-grid">
          <article className="panel">
            <h2>Project Context</h2>
            <dl className="context-list">
              <dt>Population</dt>
              <dd>Adults 18-45 with AUD</dd>
              <dt>Dataset</dt>
              <dd>AWARE-2023 EMA + Passive Sensing</dd>
              <dt>Research Goal</dt>
              <dd>
                Temporal relationships between sleep, stress, and next-day
                alcohol use
              </dd>
              <dt>Aim Type</dt>
              <dd className="muted-italic">Use chatbot to select</dd>
            </dl>
          </article>

          <article className="panel">
            <h2>Edit Project Details</h2>
            <label className="field-label" htmlFor="project-context">
              Project Context
            </label>
            <textarea
              id="project-context"
              defaultValue="Longitudinal EMA study examining substance-use triggers in adults with AUD."
              rows={3}
            />
            <label className="field-label" htmlFor="population-details">
              Population Details
            </label>
            <input
              id="population-details"
              defaultValue="Adults 18-45, clinical sample, outpatient centers"
            />
            <label className="field-label" htmlFor="aim-type">
              Aim Type
            </label>
            <select id="aim-type" defaultValue="">
              <option value="" disabled>
                Select...
              </option>
              <option>Descriptive</option>
              <option>Predictive</option>
              <option>Causal</option>
            </select>
          </article>
        </section>

        <section className="warning-card">
          <strong>3 Analysis Warnings</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>

        <section className="feature-grid">
          <article className="panel feature-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">RAG Documents</p>
                <h2>Document Knowledge Base</h2>
              </div>
              <span className="small-badge">{documents.length} files</span>
            </div>

            <div className="control-row">
              <input
                accept=".pdf,.docx"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setDocumentFile(event.target.files?.[0] ?? null)
                }
                type="file"
              />
              <button disabled={documentBusy} onClick={handleDocumentUpload} type="button">
                Upload
              </button>
            </div>

            <div className="list-box">
              {documents.length === 0 ? (
                <p>No uploaded documents yet.</p>
              ) : (
                documents.slice(0, 5).map((document) => (
                  <div className="list-row" key={document.filename}>
                    <span>{document.filename}</span>
                    <small>{formatBytes(document.file_size)}</small>
                  </div>
                ))
              )}
            </div>

            <div className="action-row">
              <button
                disabled={documentBusy}
                onClick={handleDocumentIngestion}
                type="button"
              >
                Ingest Documents
              </button>
              <span className="status-line">
                {ingestionStatus?.chroma_exists
                  ? `${ingestionStatus.stored_chunks ?? 0} chunks stored`
                  : "No ChromaDB yet"}
              </span>
            </div>
            <StatusMessage error={documentError} message={documentMessage} />
          </article>

          <article className="panel feature-panel">
            <div className="panel-heading">
              <div>
                <p className="section-label">Data Foundation</p>
                <h2>Dataset Schema Review</h2>
              </div>
              <span className="small-badge">{datasets.length} CSV</span>
            </div>

            <div className="control-row">
              <input
                accept=".csv"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setDatasetFile(event.target.files?.[0] ?? null)
                }
                type="file"
              />
              <button disabled={datasetBusy} onClick={handleDatasetUpload} type="button">
                Upload
              </button>
            </div>

            <div className="control-row">
              <select
                onChange={(event) => setSelectedDataset(event.target.value)}
                value={selectedDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button disabled={datasetBusy} onClick={handleSchemaLoad} type="button">
                View Schema
              </button>
            </div>

            {datasetSchema && (
              <div className="schema-summary">
                <div>
                  <strong>{datasetSchema.number_of_rows}</strong>
                  <span>Rows</span>
                </div>
                <div>
                  <strong>{datasetSchema.number_of_columns}</strong>
                  <span>Columns</span>
                </div>
                <div>
                  <strong>{datasetSchema.possible_id_columns.join(", ") || "None"}</strong>
                  <span>Possible IDs</span>
                </div>
                <div>
                  <strong>
                    {datasetSchema.possible_timestamp_date_columns.join(", ") ||
                      "None"}
                  </strong>
                  <span>Time Columns</span>
                </div>
              </div>
            )}

            {datasetSchema && datasetSchema.warnings.length > 0 && (
              <ul className="compact-warnings">
                {datasetSchema.warnings.map((warning) => (
                  <li key={`${warning.column}-${warning.warning}`}>
                    {warning.column}: {warning.warning} (
                    {warning.missing_percentage}%)
                  </li>
                ))}
              </ul>
            )}

            {schemaRows.length > 0 && (
              <table className="schema-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Missing</th>
                    <th>Unique</th>
                  </tr>
                </thead>
                <tbody>
                  {schemaRows.map((row) => (
                    <tr key={row.column}>
                      <td>{row.column}</td>
                      <td>{row.dtype}</td>
                      <td>{row.missing}%</td>
                      <td>{row.unique}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <StatusMessage error={datasetError} message={datasetMessage} />
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Knowledge Retrieval</p>
                <h2>RAG Search</h2>
              </div>
            </div>

            <div className="search-row">
              <input
                onChange={(event) => setRagQuery(event.target.value)}
                placeholder="Search uploaded documents..."
                value={ragQuery}
              />
              <input
                max={10}
                min={1}
                onChange={(event) => setTopK(Number(event.target.value))}
                type="number"
                value={topK}
              />
              <button disabled={ragBusy} onClick={handleRagSearch} type="button">
                Search
              </button>
            </div>

            <StatusMessage error={ragError} message={ragMessage} />

            <div className="rag-results">
              {ragResults.map((result, index) => (
                <article className="result-card" key={`${result.source_filename}-${index}`}>
                  <div className="result-meta">
                    <strong>{result.source_filename ?? "Unknown source"}</strong>
                    <span>
                      {result.page_number ? `Page ${result.page_number} · ` : ""}
                      Chunk {result.chunk_index ?? "?"} · Distance{" "}
                      {typeof result.distance === "number"
                        ? result.distance.toFixed(3)
                        : "n/a"}
                    </span>
                  </div>
                  <p>{result.chunk_text}</p>
                </article>
              ))}
            </div>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Causal Design Support</p>
                <h2>Candidate Causal Questions</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="research-objective">
              Research Objective
            </label>
            <textarea
              id="research-objective"
              onChange={(event) => setResearchObjective(event.target.value)}
              rows={3}
              value={researchObjective}
            />

            <div className="control-row">
              <select
                onChange={(event) => setCandidateDataset(event.target.value)}
                value={candidateDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={candidateBusy}
                onClick={handleCandidateGeneration}
                type="button"
              >
                Generate Questions
              </button>
            </div>

            <StatusMessage error={candidateError} message={candidateMessage} />

            <div className="candidate-list">
              {candidateQuestions.map((candidate) => (
                <article className="candidate-card" key={candidate.candidate_id}>
                  <div className="candidate-header">
                    <strong>{candidate.candidate_id}</strong>
                    <span>{candidate.confidence} confidence</span>
                  </div>
                  <h3>{candidate.question_text}</h3>
                  <dl>
                    <dt>Population</dt>
                    <dd>{candidate.population}</dd>
                    <dt>Exposure</dt>
                    <dd>{candidate.exposure}</dd>
                    <dt>Outcome</dt>
                    <dd>{candidate.outcome}</dd>
                    <dt>Time Window</dt>
                    <dd>{candidate.time_window}</dd>
                    <dt>Limitations</dt>
                    <dd>{candidate.limitations.join("; ")}</dd>
                    <dt>Evidence</dt>
                    <dd>{candidate.supporting_evidence.join("; ")}</dd>
                  </dl>
                  <button type="button">Mark for Review</button>
                </article>
              ))}
            </div>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Variable Review</p>
                <h2>Candidate Variables</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="confirmed-question">
              Confirmed Question
            </label>
            <textarea
              id="confirmed-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setVariableDataset(event.target.value)}
                value={variableDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={variableBusy}
                onClick={handleVariableRecommendation}
                type="button"
              >
                Recommend Variables
              </button>
            </div>

            <StatusMessage error={variableError} message={variableMessage} />

            <div className="variable-group-list">
              {Object.entries(variableGroups).map(([category, recommendations]) =>
                recommendations.length > 0 ? (
                  <section className="variable-group" key={category}>
                    <h3>{category.replaceAll("_", " ")}</h3>
                    <div className="candidate-list">
                      {recommendations.map((recommendation) => (
                        <article
                          className="variable-card"
                          key={`${category}-${recommendation.variable_name}-${recommendation.source_field}`}
                        >
                          <div className="candidate-header">
                            <strong>{recommendation.variable_name}</strong>
                            <span>
                              {recommendation.recommendation_status} -{" "}
                              {recommendation.confidence}
                            </span>
                          </div>
                          <dl>
                            <dt>Source</dt>
                            <dd>{recommendation.source_field}</dd>
                            <dt>Role Hint</dt>
                            <dd>{recommendation.possible_role_hint}</dd>
                            <dt>Timing</dt>
                            <dd>{recommendation.measurement_timing}</dd>
                            <dt>Missingness</dt>
                            <dd>{recommendation.missingness_warning}</dd>
                            <dt>Evidence</dt>
                            <dd>{recommendation.supporting_evidence.join("; ")}</dd>
                          </dl>
                          <button type="button">
                            {recommendation.user_decision_default}
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null,
              )}
            </div>

            {derivedFeatures.length > 0 && (
              <section className="derived-feature-list">
                <h3>Derived Feature Recommendations</h3>
                <div className="candidate-list">
                  {derivedFeatures.map((feature) => (
                    <article
                      className="variable-card"
                      key={feature.derived_feature_name}
                    >
                      <div className="candidate-header">
                        <strong>{feature.derived_feature_name}</strong>
                        <span>{feature.confidence} confidence</span>
                      </div>
                      <dl>
                        <dt>Source Columns</dt>
                        <dd>{feature.source_columns_needed.join(", ")}</dd>
                        <dt>Window</dt>
                        <dd>{feature.calculation_window}</dd>
                        <dt>Aggregation</dt>
                        <dd>{feature.aggregation_method}</dd>
                        <dt>Data Requirement</dt>
                        <dd>{feature.minimum_data_requirement}</dd>
                        <dt>Leakage Risk</dt>
                        <dd>{feature.leakage_risk}</dd>
                        <dt>Missing Data</dt>
                        <dd>{feature.missing_data_handling}</dd>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </article>
        </section>
      </main>

      <aside className="assistant-panel">
        <header className="assistant-header">
          <div>
            <strong>AI Assistant</strong>
            <span className="online-dot" aria-label="Online" />
          </div>
          <button type="button" aria-label="Open assistant transcript">
            □
          </button>
        </header>

        <div className="assistant-message">
          Welcome to Causal Studio. Is your analytical aim descriptive,
          predictive, or causal?
        </div>

        <div className="chip-row">
          <button type="button">Descriptive</button>
          <button type="button">Predictive</button>
          <button type="button">Causal</button>
        </div>

        <div className="assistant-spacer" />

        <div className="assistant-input">
          <input placeholder='Try "use ADMG" or "set lag 2"...' />
          <button type="button" aria-label="Send message">
            ↑
          </button>
        </div>
      </aside>
    </div>
  );
}

function StatusMessage({
  error,
  message,
}: {
  error: string;
  message: string;
}) {
  if (!error && !message) {
    return null;
  }

  return (
    <p className={`status-message ${error ? "status-message--error" : ""}`}>
      {error || message}
    </p>
  );
}
