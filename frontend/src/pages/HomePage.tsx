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
import { recommendAndValidateRoles } from "../api/causalRoles";
import { generateAndValidateGraph } from "../api/causalGraph";
import { runIdentificationCheck } from "../api/identification";
import { BackendStatus } from "../components/BackendStatus";
import type {
  BackendCausalRoleValidation,
  BackendCausalGraphValidation,
  CandidateCausalQuestion,
  CandidateVariableRecommendation,
  CausalGraphDraft,
  CausalRoleRecommendation,
  DatasetSchemaResponse,
  DerivedFeatureRecommendation,
  IdentificationCheckResponse,
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
  const [roleDataset, setRoleDataset] = useState("");
  const [selectedVariablesJson, setSelectedVariablesJson] = useState(`[
  {
    "variable_name": "pid",
    "source_field": "pid",
    "data_category": "baseline_demographic",
    "direct_or_derived": "direct",
    "measurement_timing": "id/grouping variable",
    "possible_role_hint": "id_or_grouping_variable"
  },
  {
    "variable_name": "label",
    "source_field": "label",
    "data_category": "ema_self_report",
    "direct_or_derived": "direct",
    "measurement_timing": "next observation window",
    "possible_role_hint": "candidate outcome"
  },
  {
    "variable_name": "time_stamp",
    "source_field": "time_stamp",
    "data_category": "temporal_contextual",
    "direct_or_derived": "direct",
    "measurement_timing": "time index",
    "possible_role_hint": "temporal context"
  },
  {
    "variable_name": "time_of_day",
    "source_field": "time_of_day",
    "data_category": "temporal_contextual",
    "direct_or_derived": "direct",
    "measurement_timing": "window t context",
    "possible_role_hint": "temporal context"
  },
  {
    "variable_name": "day_of_week",
    "source_field": "day_of_week",
    "data_category": "temporal_contextual",
    "direct_or_derived": "direct",
    "measurement_timing": "window t context",
    "possible_role_hint": "temporal context"
  },
  {
    "variable_name": "acc_min_magnitude",
    "source_field": "acc_min_magnitude",
    "data_category": "smartphone_sensing",
    "direct_or_derived": "direct",
    "measurement_timing": "window t",
    "possible_role_hint": "activity proxy"
  },
  {
    "variable_name": "acc_max_magnitude",
    "source_field": "acc_max_magnitude",
    "data_category": "smartphone_sensing",
    "direct_or_derived": "direct",
    "measurement_timing": "window t",
    "possible_role_hint": "activity proxy"
  },
  {
    "variable_name": "acc_mean_magnitude",
    "source_field": "acc_mean_magnitude",
    "data_category": "smartphone_sensing",
    "direct_or_derived": "direct",
    "measurement_timing": "window t",
    "possible_role_hint": "activity proxy"
  },
  {
    "variable_name": "avg_latitude",
    "source_field": "avg_latitude",
    "data_category": "smartphone_sensing",
    "direct_or_derived": "direct",
    "measurement_timing": "window t",
    "missingness_warning": "known high missingness",
    "possible_role_hint": "mobility proxy"
  }
]`);
  const [roleRecommendations, setRoleRecommendations] = useState<
    CausalRoleRecommendation[]
  >([]);
  const [roleValidation, setRoleValidation] =
    useState<BackendCausalRoleValidation | null>(null);
  const [roleMessage, setRoleMessage] = useState("");
  const [roleError, setRoleError] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [graphDataset, setGraphDataset] = useState("");
  const [roleRecommendationsJson, setRoleRecommendationsJson] = useState(`[
  {
    "variable_name": "pid",
    "recommended_roles": ["id_or_grouping_variable"],
    "primary_role": "id_or_grouping_variable",
    "temporal_role": "not applicable",
    "measurement_role": "id/grouping",
    "adjustment_recommendation": "do_not_adjust",
    "confidence": "high",
    "rationale": "Participant identifier only."
  },
  {
    "variable_name": "label",
    "recommended_roles": ["outcome"],
    "primary_role": "outcome",
    "temporal_role": "outcome-window",
    "measurement_role": "observed outcome label",
    "adjustment_recommendation": "do_not_adjust",
    "confidence": "medium",
    "rationale": "Alcohol-use-related label is the likely outcome candidate."
  },
  {
    "variable_name": "time_stamp",
    "recommended_roles": ["temporal_context_variable"],
    "primary_role": "temporal_context_variable",
    "temporal_role": "time index",
    "measurement_role": "time structure",
    "adjustment_recommendation": "review_required",
    "confidence": "high",
    "rationale": "Used to define ordering and windows."
  },
  {
    "variable_name": "time_of_day",
    "recommended_roles": ["temporal_context_variable"],
    "primary_role": "temporal_context_variable",
    "temporal_role": "window t context",
    "measurement_role": "time context",
    "adjustment_recommendation": "review_required",
    "confidence": "medium",
    "rationale": "Contextual timing variable."
  },
  {
    "variable_name": "day_of_week",
    "recommended_roles": ["temporal_context_variable"],
    "primary_role": "temporal_context_variable",
    "temporal_role": "window t context",
    "measurement_role": "time context",
    "adjustment_recommendation": "review_required",
    "confidence": "medium",
    "rationale": "Contextual timing variable."
  },
  {
    "variable_name": "acc_min_magnitude",
    "recommended_roles": ["proxy_variable", "time_varying_covariate"],
    "primary_role": "time_varying_covariate",
    "temporal_role": "window t",
    "measurement_role": "proxy measure",
    "adjustment_recommendation": "review_required",
    "confidence": "medium",
    "rationale": "Sensing/activity proxy."
  },
  {
    "variable_name": "acc_max_magnitude",
    "recommended_roles": ["proxy_variable", "time_varying_covariate"],
    "primary_role": "time_varying_covariate",
    "temporal_role": "window t",
    "measurement_role": "proxy measure",
    "adjustment_recommendation": "review_required",
    "confidence": "medium",
    "rationale": "Sensing/activity proxy."
  },
  {
    "variable_name": "acc_mean_magnitude",
    "recommended_roles": ["proxy_variable", "time_varying_covariate"],
    "primary_role": "time_varying_covariate",
    "temporal_role": "window t",
    "measurement_role": "proxy measure",
    "adjustment_recommendation": "review_required",
    "confidence": "medium",
    "rationale": "Sensing/activity proxy."
  },
  {
    "variable_name": "avg_latitude",
    "recommended_roles": ["proxy_variable", "time_varying_covariate"],
    "primary_role": "time_varying_covariate",
    "temporal_role": "window t",
    "measurement_role": "proxy measure",
    "adjustment_recommendation": "review_required",
    "confidence": "low",
    "rationale": "Mobility/location proxy with known missingness."
  }
]`);
  const [graphDraft, setGraphDraft] = useState<CausalGraphDraft | null>(null);
  const [graphValidation, setGraphValidation] =
    useState<BackendCausalGraphValidation | null>(null);
  const [graphMessage, setGraphMessage] = useState("");
  const [graphError, setGraphError] = useState("");
  const [graphBusy, setGraphBusy] = useState(false);
  const [identificationDataset, setIdentificationDataset] = useState("");
  const [identificationGraphJson, setIdentificationGraphJson] = useState(`{
  "graph_type": "DAG",
  "nodes": [
    {
      "node_id": "acc_mean_magnitude",
      "variable_name": "acc_mean_magnitude",
      "role": "exposure",
      "temporal_role": "window t",
      "data_category": "smartphone_sensing",
      "is_observed": true
    },
    {
      "node_id": "label",
      "variable_name": "label",
      "role": "outcome",
      "temporal_role": "next observation window",
      "data_category": "ema_self_report",
      "is_observed": true
    },
    {
      "node_id": "time_of_day",
      "variable_name": "time_of_day",
      "role": "temporal_context_variable",
      "temporal_role": "window t",
      "data_category": "temporal_contextual",
      "is_observed": true
    },
    {
      "node_id": "day_of_week",
      "variable_name": "day_of_week",
      "role": "temporal_context_variable",
      "temporal_role": "window t",
      "data_category": "temporal_contextual",
      "is_observed": true
    },
    {
      "node_id": "avg_latitude",
      "variable_name": "avg_latitude",
      "role": "time_varying_covariate",
      "temporal_role": "window t",
      "data_category": "smartphone_sensing",
      "is_observed": true
    }
  ],
  "edges": [
    {
      "source": "acc_mean_magnitude",
      "target": "label",
      "edge_type": "directed",
      "confidence": "medium",
      "temporal_assumption": "window t precedes next observation label"
    },
    {
      "source": "time_of_day",
      "target": "acc_mean_magnitude",
      "edge_type": "directed",
      "confidence": "medium",
      "temporal_assumption": "same window context"
    },
    {
      "source": "day_of_week",
      "target": "acc_mean_magnitude",
      "edge_type": "directed",
      "confidence": "medium",
      "temporal_assumption": "same window context"
    },
    {
      "source": "day_of_week",
      "target": "label",
      "edge_type": "directed",
      "confidence": "low",
      "temporal_assumption": "calendar context may precede outcome"
    },
    {
      "source": "avg_latitude",
      "target": "acc_mean_magnitude",
      "edge_type": "directed",
      "confidence": "low",
      "temporal_assumption": "same window mobility context"
    },
    {
      "source": "avg_latitude",
      "target": "label",
      "edge_type": "directed",
      "confidence": "low",
      "temporal_assumption": "window t precedes next observation label"
    }
  ]
}`);
  const [adjustmentSetText, setAdjustmentSetText] = useState(
    "time_of_day, day_of_week, avg_latitude",
  );
  const [identificationResult, setIdentificationResult] =
    useState<IdentificationCheckResponse | null>(null);
  const [identificationMessage, setIdentificationMessage] = useState("");
  const [identificationError, setIdentificationError] = useState("");
  const [identificationBusy, setIdentificationBusy] = useState(false);

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
    if (!roleDataset && datasetList.datasets.length > 0) {
      setRoleDataset(datasetList.datasets[0].filename);
    }
    if (!graphDataset && datasetList.datasets.length > 0) {
      setGraphDataset(datasetList.datasets[0].filename);
    }
    if (!identificationDataset && datasetList.datasets.length > 0) {
      setIdentificationDataset(datasetList.datasets[0].filename);
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

  async function handleRoleValidation() {
    if (!roleDataset) {
      setRoleError("Select a dataset first.");
      return;
    }

    setRoleBusy(true);
    setRoleError("");
    setRoleMessage("");

    try {
      const selectedVariables = JSON.parse(selectedVariablesJson);
      if (!Array.isArray(selectedVariables) || selectedVariables.length === 0) {
        throw new Error("Selected variables must be a non-empty JSON array.");
      }

      const response = await recommendAndValidateRoles({
        confirmedQuestion,
        datasetFilename: roleDataset,
        selectedVariables,
        topKEvidence: topK,
      });
      setRoleRecommendations(response.role_recommendations);
      setRoleValidation(response.backend_validation);
      setRoleMessage(
        `Validated ${response.role_recommendations.length} role recommendations. Status: ${response.backend_validation.validation_status}.`,
      );
    } catch (error) {
      setRoleError((error as Error).message);
    } finally {
      setRoleBusy(false);
    }
  }

  async function handleGraphGeneration() {
    if (!graphDataset) {
      setGraphError("Select a dataset first.");
      return;
    }

    setGraphBusy(true);
    setGraphError("");
    setGraphMessage("");

    try {
      const selectedVariables = JSON.parse(selectedVariablesJson);
      const parsedRoleRecommendations = JSON.parse(roleRecommendationsJson);
      if (!Array.isArray(selectedVariables) || selectedVariables.length === 0) {
        throw new Error("Selected variables must be a non-empty JSON array.");
      }
      if (
        !Array.isArray(parsedRoleRecommendations) ||
        parsedRoleRecommendations.length === 0
      ) {
        throw new Error("Role recommendations must be a non-empty JSON array.");
      }

      const response = await generateAndValidateGraph({
        confirmedQuestion,
        datasetFilename: graphDataset,
        selectedVariables,
        roleRecommendations: parsedRoleRecommendations,
        topKEvidence: topK,
      });
      setGraphDraft(response.graph_draft);
      setGraphValidation(response.backend_validation);
      setGraphMessage(
        `Generated ${response.graph_draft.nodes.length} nodes and ${response.graph_draft.edges.length} edges. Status: ${response.backend_validation.graph_validation_status}.`,
      );
    } catch (error) {
      setGraphError((error as Error).message);
    } finally {
      setGraphBusy(false);
    }
  }

  async function handleIdentificationCheck() {
    if (!identificationDataset) {
      setIdentificationError("Select a dataset first.");
      return;
    }

    setIdentificationBusy(true);
    setIdentificationError("");
    setIdentificationMessage("");

    try {
      const graph = JSON.parse(identificationGraphJson);
      const roleRecommendations = JSON.parse(roleRecommendationsJson);
      const userAdjustmentSet = adjustmentSetText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const response = await runIdentificationCheck({
        confirmedQuestion,
        datasetFilename: identificationDataset,
        graph,
        roleRecommendations,
        userAdjustmentSet,
        topKEvidence: topK,
      });
      setIdentificationResult(response);
      setIdentificationMessage(
        `Identification status: ${response.identification_status}. Adjustment set: ${response.adjustment_set_status}.`,
      );
    } catch (error) {
      setIdentificationError((error as Error).message);
    } finally {
      setIdentificationBusy(false);
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

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Deterministic Validation</p>
                <h2>Causal Role Validation</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="role-question">
              Confirmed Question
            </label>
            <textarea
              id="role-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setRoleDataset(event.target.value)}
                value={roleDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={roleBusy}
                onClick={handleRoleValidation}
                type="button"
              >
                Recommend & Validate Roles
              </button>
            </div>

            <label className="field-label" htmlFor="selected-variables-json">
              Selected Variables JSON
            </label>
            <textarea
              className="code-textarea"
              id="selected-variables-json"
              onChange={(event) => setSelectedVariablesJson(event.target.value)}
              rows={12}
              value={selectedVariablesJson}
            />

            <StatusMessage error={roleError} message={roleMessage} />

            {roleValidation && (
              <section className="validation-summary">
                <div>
                  <strong>{roleValidation.validation_status}</strong>
                  <span>Validation Status</span>
                </div>
                <div>
                  <strong>
                    {roleValidation.safe_to_continue_to_graph ? "Yes" : "No"}
                  </strong>
                  <span>Safe To Continue</span>
                </div>
                <p>{roleValidation.recommended_next_action}</p>
              </section>
            )}

            {roleRecommendations.length > 0 && (
              <section className="role-section">
                <h3>LLM Role Recommendations</h3>
                <div className="candidate-list">
                  {roleRecommendations.map((recommendation) => (
                    <article
                      className="variable-card"
                      key={`${recommendation.variable_name}-${recommendation.primary_role}`}
                    >
                      <div className="candidate-header">
                        <strong>{recommendation.variable_name}</strong>
                        <span>{recommendation.confidence} confidence</span>
                      </div>
                      <dl>
                        <dt>Roles</dt>
                        <dd>{recommendation.recommended_roles.join(", ")}</dd>
                        <dt>Primary</dt>
                        <dd>{recommendation.primary_role}</dd>
                        <dt>Temporal</dt>
                        <dd>{recommendation.temporal_role}</dd>
                        <dt>Measurement</dt>
                        <dd>{recommendation.measurement_role}</dd>
                        <dt>Adjustment</dt>
                        <dd>{recommendation.adjustment_recommendation}</dd>
                        <dt>Rationale</dt>
                        <dd>{recommendation.rationale}</dd>
                        <dt>Uncertainty</dt>
                        <dd>{recommendation.uncertainty_notes}</dd>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {roleValidation && (
              <section className="role-section">
                <h3>Backend Validation Warnings</h3>
                <div className="issue-list">
                  {roleValidation.warnings.length === 0 ? (
                    <p>No warnings returned.</p>
                  ) : (
                    roleValidation.warnings.map((warning, index) => (
                      <article className="issue-card" key={`${warning.warning_type}-${index}`}>
                        <strong>
                          {warning.variable_name ?? "General"} -{" "}
                          {warning.severity}
                        </strong>
                        <p>{warning.message}</p>
                        <span>{warning.suggested_fix}</span>
                      </article>
                    ))
                  )}
                </div>

                <h3>Backend Validation Errors</h3>
                <div className="issue-list">
                  {roleValidation.errors.length === 0 ? (
                    <p>No errors returned.</p>
                  ) : (
                    roleValidation.errors.map((error, index) => (
                      <article className="issue-card issue-card--error" key={`${error.error_type}-${index}`}>
                        <strong>
                          {error.variable_name ?? "General"} - {error.severity}
                        </strong>
                        <p>{error.message}</p>
                        <span>{error.suggested_fix}</span>
                      </article>
                    ))
                  )}
                </div>
              </section>
            )}
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Graph Draft</p>
                <h2>Causal Graph Draft</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="graph-question">
              Confirmed Question
            </label>
            <textarea
              id="graph-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setGraphDataset(event.target.value)}
                value={graphDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={graphBusy}
                onClick={handleGraphGeneration}
                type="button"
              >
                Generate Graph Draft
              </button>
            </div>

            <label className="field-label" htmlFor="graph-selected-variables">
              Selected Variables JSON
            </label>
            <textarea
              className="code-textarea"
              id="graph-selected-variables"
              onChange={(event) => setSelectedVariablesJson(event.target.value)}
              rows={8}
              value={selectedVariablesJson}
            />

            <label className="field-label" htmlFor="graph-role-recommendations">
              Role Recommendations JSON
            </label>
            <textarea
              className="code-textarea"
              id="graph-role-recommendations"
              onChange={(event) => setRoleRecommendationsJson(event.target.value)}
              rows={10}
              value={roleRecommendationsJson}
            />

            <StatusMessage error={graphError} message={graphMessage} />

            {graphValidation && (
              <section className="validation-summary">
                <div>
                  <strong>{graphValidation.graph_validation_status}</strong>
                  <span>Graph Status</span>
                </div>
                <div>
                  <strong>
                    {graphValidation.safe_to_continue_to_identification
                      ? "Yes"
                      : "No"}
                  </strong>
                  <span>Safe To Identify</span>
                </div>
                <p>{graphValidation.suggested_graph_edits.join(" ")}</p>
              </section>
            )}

            {graphDraft && (
              <section className="graph-draft-grid">
                <div className="role-section">
                  <h3>Nodes</h3>
                  <div className="candidate-list">
                    {graphDraft.nodes.map((node) => (
                      <article className="variable-card" key={node.node_id}>
                        <div className="candidate-header">
                          <strong>{node.display_name || node.variable_name}</strong>
                          <span>{node.confidence} confidence</span>
                        </div>
                        <dl>
                          <dt>ID</dt>
                          <dd>{node.node_id}</dd>
                          <dt>Role</dt>
                          <dd>{node.role}</dd>
                          <dt>Temporal</dt>
                          <dd>{node.temporal_role}</dd>
                          <dt>Category</dt>
                          <dd>{node.data_category}</dd>
                        </dl>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="role-section">
                  <h3>Edges</h3>
                  <div className="candidate-list">
                    {graphDraft.edges.map((edge) => (
                      <article
                        className="variable-card"
                        key={`${edge.source}-${edge.target}`}
                      >
                        <div className="candidate-header">
                          <strong>
                            {`${edge.source} -> ${edge.target}`}
                          </strong>
                          <span>{edge.confidence} confidence</span>
                        </div>
                        <dl>
                          <dt>Type</dt>
                          <dd>{edge.edge_type}</dd>
                          <dt>Timing</dt>
                          <dd>{edge.temporal_assumption}</dd>
                          <dt>Rationale</dt>
                          <dd>{edge.rationale}</dd>
                          <dt>Evidence</dt>
                          <dd>{edge.supporting_evidence.join("; ")}</dd>
                        </dl>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {graphDraft && graphDraft.uncertain_edges.length > 0 && (
              <section className="role-section">
                <h3>Uncertain Edges</h3>
                <div className="issue-list">
                  {graphDraft.uncertain_edges.map((edge) => (
                    <article
                      className="issue-card"
                      key={`${edge.source}-${edge.target}-${edge.possible_direction}`}
                    >
                      <strong>
                        {edge.source} / {edge.target} - {edge.possible_direction}
                      </strong>
                      <p>{edge.uncertainty_reason}</p>
                      <span>{edge.recommended_user_review}</span>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {graphValidation && (
              <section className="role-section">
                <h3>Backend Graph Validation Warnings</h3>
                <div className="issue-list">
                  {graphValidation.warnings.length === 0 ? (
                    <p>No warnings returned.</p>
                  ) : (
                    graphValidation.warnings.map((warning, index) => (
                      <article className="issue-card" key={`${warning.warning_type}-${index}`}>
                        <strong>
                          {(warning.source ?? "General") +
                            (warning.target ? ` -> ${warning.target}` : "")}{" "}
                          - {warning.severity}
                        </strong>
                        <p>{warning.message}</p>
                        <span>{warning.suggested_fix}</span>
                      </article>
                    ))
                  )}
                </div>

                <h3>Backend Graph Validation Errors</h3>
                <div className="issue-list">
                  {graphValidation.errors.length === 0 ? (
                    <p>No errors returned.</p>
                  ) : (
                    graphValidation.errors.map((error, index) => (
                      <article className="issue-card issue-card--error" key={`${error.error_type}-${index}`}>
                        <strong>
                          {(error.source ?? "General") +
                            (error.target ? ` -> ${error.target}` : "")}{" "}
                          - {error.severity}
                        </strong>
                        <p>{error.message}</p>
                        <span>{error.suggested_fix}</span>
                      </article>
                    ))
                  )}
                </div>
              </section>
            )}
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Analysis Readiness</p>
                <h2>Identification Check</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="identification-question">
              Confirmed Question
            </label>
            <textarea
              id="identification-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setIdentificationDataset(event.target.value)}
                value={identificationDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={identificationBusy}
                onClick={handleIdentificationCheck}
                type="button"
              >
                Run Identification Check
              </button>
            </div>

            <label className="field-label" htmlFor="identification-graph-json">
              Graph JSON
            </label>
            <textarea
              className="code-textarea"
              id="identification-graph-json"
              onChange={(event) => setIdentificationGraphJson(event.target.value)}
              rows={12}
              value={identificationGraphJson}
            />

            <label className="field-label" htmlFor="identification-roles-json">
              Role Recommendations JSON
            </label>
            <textarea
              className="code-textarea"
              id="identification-roles-json"
              onChange={(event) => setRoleRecommendationsJson(event.target.value)}
              rows={8}
              value={roleRecommendationsJson}
            />

            <label className="field-label" htmlFor="adjustment-set">
              User Adjustment Set
            </label>
            <input
              id="adjustment-set"
              onChange={(event) => setAdjustmentSetText(event.target.value)}
              value={adjustmentSetText}
            />

            <StatusMessage
              error={identificationError}
              message={identificationMessage}
            />

            {identificationResult && (
              <section className="validation-summary">
                <div>
                  <strong>{identificationResult.identification_status}</strong>
                  <span>Identification Status</span>
                </div>
                <div>
                  <strong>
                    {identificationResult.safe_to_continue_to_analysis_strategy
                      ? "Yes"
                      : "No"}
                  </strong>
                  <span>Safe To Plan</span>
                </div>
                <p>{identificationResult.plain_language_summary}</p>
              </section>
            )}

            {identificationResult && (
              <section className="role-section">
                <h3>Adjustment Set</h3>
                <div className="schema-summary">
                  <div>
                    <strong>{identificationResult.exposure ?? "Unknown"}</strong>
                    <span>Exposure</span>
                  </div>
                  <div>
                    <strong>{identificationResult.outcome ?? "Unknown"}</strong>
                    <span>Outcome</span>
                  </div>
                  <div>
                    <strong>{identificationResult.adjustment_set_status}</strong>
                    <span>Adjustment Status</span>
                  </div>
                  <div>
                    <strong>
                      {identificationResult.proposed_adjustment_set.join(", ") ||
                        "None"}
                    </strong>
                    <span>Proposed Set</span>
                  </div>
                </div>
              </section>
            )}

            {identificationResult && (
              <section className="role-section">
                <h3>Warnings</h3>
                <div className="issue-list">
                  {identificationResult.warnings.length === 0 ? (
                    <p>No warnings returned.</p>
                  ) : (
                    identificationResult.warnings.map((warning, index) => (
                      <article className="issue-card" key={`${warning.issue_type}-${index}`}>
                        <strong>
                          {warning.variable_name ??
                            warning.source ??
                            "General"}{" "}
                          - {warning.severity}
                        </strong>
                        <p>{warning.message}</p>
                        <span>{warning.suggested_fix}</span>
                      </article>
                    ))
                  )}
                </div>

                <h3>Errors</h3>
                <div className="issue-list">
                  {identificationResult.errors.length === 0 ? (
                    <p>No errors returned.</p>
                  ) : (
                    identificationResult.errors.map((error, index) => (
                      <article className="issue-card issue-card--error" key={`${error.issue_type}-${index}`}>
                        <strong>
                          {error.variable_name ?? error.source ?? "General"} -{" "}
                          {error.severity}
                        </strong>
                        <p>{error.message}</p>
                        <span>{error.suggested_fix}</span>
                      </article>
                    ))
                  )}
                </div>

                <h3>Open Issues</h3>
                <div className="issue-list">
                  {identificationResult.open_issues.length === 0 ? (
                    <p>No open issues returned.</p>
                  ) : (
                    identificationResult.open_issues.map((issue, index) => (
                      <article className="issue-card" key={`${issue.issue_type}-${index}`}>
                        <strong>
                          {issue.variable_name ?? issue.source ?? "General"} -{" "}
                          {issue.severity}
                        </strong>
                        <p>{issue.message}</p>
                        <span>{issue.suggested_fix}</span>
                      </article>
                    ))
                  )}
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
