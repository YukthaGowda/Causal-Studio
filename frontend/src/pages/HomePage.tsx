import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  getIngestionStatus,
  ingestDocuments,
  listDocuments,
  uploadDocument,
} from "../api/documents";
import { getDatasetSchema, listDatasets, uploadDataset } from "../api/datasets";
import {
  runBroadExploration,
  runTargetedFeasibility,
} from "../api/exploration";
import { generateReport } from "../api/reports";
import {
  advanceWorkflow,
  confirmWorkflow,
  reviseWorkflow,
  startWorkflow,
} from "../api/workflow";
import { searchRag } from "../api/rag";
import { generateCausalQuestions } from "../api/causalQuestions";
import { recommendCandidateVariables } from "../api/candidateVariables";
import { recommendAndValidateRoles } from "../api/causalRoles";
import { generateAndValidateGraph, validateEditedGraph } from "../api/causalGraph";
import { runIdentificationCheck } from "../api/identification";
import { generateAnalysisStrategy } from "../api/analysisStrategy";
import { reviewAssumptions } from "../api/assumptions";
import { BackendStatus } from "../components/BackendStatus";
import { CausalGraphCanvas } from "../components/CausalGraphCanvas";
import type {
  AssumptionReviewResponse,
  AnalysisStrategyResponse,
  BroadExplorationResponse,
  TargetedFeasibilityResponse,
  ReportGenerationResponse,
  WorkflowState,
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

const workflowSteps = [
  {
    shortLabel: "Setup",
    label: "Project Setup and Document Upload",
    navLabel: "Project Setup",
  },
  {
    shortLabel: "Foundation",
    label: "Data Foundation and Understanding",
    navLabel: "Data Foundation",
  },
  {
    shortLabel: "Broad Explore",
    label: "Broad Data Exploration",
    navLabel: "Broad Exploration",
  },
  {
    shortLabel: "Question Design",
    label: "Causal Question and Provisional Variable Design",
    navLabel: "Question & Variables",
  },
  {
    shortLabel: "Feasibility",
    label: "Targeted Variable Data Exploration and Feasibility Check",
    navLabel: "Targeted Feasibility",
  },
  {
    shortLabel: "Graph",
    label: "Causal Graph and Final Role Validation",
    navLabel: "Graph Validation",
  },
  {
    shortLabel: "Strategy",
    label: "Identification and Estimation Strategy",
    navLabel: "Strategy",
  },
  {
    shortLabel: "Export",
    label: "Review and Export",
    navLabel: "Review & Export",
  },
];

const warnings = [
  "GPS missing for some participants",
  "phone_screen_time is a proxy and does not directly measure craving",
  "Aim type unconfirmed - causal language may be premature",
  "Exploratory patterns do not establish causality",
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
  const [activeStep, setActiveStep] = useState(1);
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
  const [broadDataset, setBroadDataset] = useState("");
  const [broadTargetColumn, setBroadTargetColumn] = useState("");
  const [broadParticipantColumn, setBroadParticipantColumn] = useState("");
  const [broadTimestampColumn, setBroadTimestampColumn] = useState("");
  const [broadExploration, setBroadExploration] =
    useState<BroadExplorationResponse | null>(null);
  const [broadMessage, setBroadMessage] = useState("");
  const [broadError, setBroadError] = useState("");
  const [broadBusy, setBroadBusy] = useState(false);

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
  const [targetedDataset, setTargetedDataset] = useState("");
  const [targetedVariablesText, setTargetedVariablesText] = useState(
    "pid\nlabel\ntime_stamp\ntime_of_day\nday_of_week\nacc_min_magnitude\nacc_max_magnitude\nacc_mean_magnitude\navg_latitude",
  );
  const [targetedExposure, setTargetedExposure] = useState("acc_mean_magnitude");
  const [targetedOutcome, setTargetedOutcome] = useState("label");
  const [targetedComparator, setTargetedComparator] = useState("");
  const [targetedParticipantId, setTargetedParticipantId] = useState("pid");
  const [targetedTimestamp, setTargetedTimestamp] = useState("time_stamp");
  const [targetedTimeWindow, setTargetedTimeWindow] = useState(
    "window t exposure and next observation window outcome",
  );
  const [targetedLagDefinition, setTargetedLagDefinition] = useState(
    "exposure during window t, outcome during next observation window",
  );
  const [targetedFeasibility, setTargetedFeasibility] =
    useState<TargetedFeasibilityResponse | null>(null);
  const [targetedMessage, setTargetedMessage] = useState("");
  const [targetedError, setTargetedError] = useState("");
  const [targetedBusy, setTargetedBusy] = useState(false);
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
  const [editedGraphDraft, setEditedGraphDraft] =
    useState<CausalGraphDraft | null>(null);
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
  const [strategyDataset, setStrategyDataset] = useState("");
  const [identificationResultJson, setIdentificationResultJson] = useState(`{
  "identification_status": "identifiable_only_under_additional_assumptions",
  "exposure": "acc_mean_magnitude",
  "outcome": "label",
  "proposed_adjustment_set": ["time_of_day", "day_of_week", "avg_latitude"],
  "adjustment_set_status": "needs_review",
  "open_issues": [],
  "warnings": [
    {
      "issue_type": "high_missingness_adjustment_variable",
      "variable_name": "avg_latitude",
      "message": "avg_latitude has 40.69% missingness in the uploaded dataset.",
      "severity": "warning",
      "suggested_fix": "Review missing-data handling before using this adjustment variable."
    }
  ],
  "errors": [],
  "assumptions_required": [
    "The graph draft is accepted by the user as a planning graph, not as proven causal truth.",
    "Weak or uncertain edges are reviewed before analysis strategy planning."
  ],
  "missing_variables": [],
  "recommended_next_action": "Review high-priority issues and document assumptions before analysis strategy planning.",
  "safe_to_continue_to_analysis_strategy": true,
  "plain_language_summary": "No causal effect has been estimated or proven.",
  "evidence_chunks_used": 5
}`);
  const [strategyResult, setStrategyResult] =
    useState<AnalysisStrategyResponse | null>(null);
  const [strategyResultJson, setStrategyResultJson] = useState(`{
  "strategy_status": "ready_only_under_additional_assumptions",
  "target_estimand": "total effect guidance only; no effect estimated",
  "exposure_definition": "acc_mean_magnitude during window t",
  "comparator_definition": "higher versus lower acc_mean_magnitude after user review",
  "outcome_definition": "label during the next observation window",
  "time_window": "window t exposure preceding next observation window outcome",
  "unit_of_analysis": "participant-window",
  "adjustment_set": ["time_of_day", "day_of_week", "avg_latitude"],
  "repeated_measures_handling": "Use participant-level clustering, GEE, or mixed effects because pid exists.",
  "missing_data_strategy": "Review or impute high-missingness variables such as avg_latitude; include sensitivity checks.",
  "recommended_estimator_family": ["GEE", "mixed effects", "regression adjustment"],
  "estimator_rationale": "Guidance only; no estimation performed.",
  "data_requirements": ["confirmed timing", "reviewed adjustment set", "missing-data plan"],
  "sensitivity_checks": ["exclude avg_latitude", "alternative lag windows"],
  "robustness_checks": ["compare repeated-measures model families"],
  "limitations": ["Assumptions are not proven."],
  "assumptions_needed": ["No unmeasured confounding", "correct temporal ordering"],
  "what_can_be_claimed": "A planned analysis may estimate contrasts only under reviewed assumptions.",
  "what_cannot_be_claimed": "Do not claim proven causal effects or treatment decisions.",
  "recommended_next_action": "Review assumptions and sensitivity checks before estimation.",
  "confidence": "medium"
}`);
  const [strategyMessage, setStrategyMessage] = useState("");
  const [strategyError, setStrategyError] = useState("");
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [assumptionsDataset, setAssumptionsDataset] = useState("");
  const [assumptionReview, setAssumptionReview] =
    useState<AssumptionReviewResponse | null>(null);
  const [assumptionReviewJson, setAssumptionReviewJson] = useState(`{
  "review_status": "needs_additional_user_review",
  "assumptions": [
    {
      "assumption_name": "temporal_ordering",
      "status": "uncertain",
      "rationale": "Window timing requires user review.",
      "evidence_summary": "Timing is a design requirement, not proven.",
      "dataset_support": "time_stamp, time_of_day, and day_of_week are available.",
      "risk_if_violated": "Exposure and outcome order may be invalid.",
      "recommended_check": "Confirm window t and next observation label construction.",
      "recommended_revision_if_needed": "Revise lag/window definitions.",
      "severity": "high"
    },
    {
      "assumption_name": "missingness_assumptions",
      "status": "uncertain",
      "rationale": "avg_latitude has high missingness.",
      "evidence_summary": "High missingness requires sensitivity planning.",
      "dataset_support": "avg_latitude is available but incomplete.",
      "risk_if_violated": "Missing-data bias may affect interpretation.",
      "recommended_check": "Compare plans with and without avg_latitude.",
      "recommended_revision_if_needed": "Use a more complete variable or missing-data plan.",
      "severity": "high"
    }
  ],
  "sensitivity_checks": ["exclude avg_latitude", "alternative lag windows"],
  "robustness_checks": ["compare repeated-measures model families"],
  "causal_interpretation_limits": [
    "The current design does not prove a causal effect.",
    "Exploratory patterns do not establish causality."
  ],
  "recommended_next_action": "Review assumptions before report export.",
  "plain_language_summary": "The design remains assumption-dependent.",
  "confidence": "medium"
}`);
  const [assumptionMessage, setAssumptionMessage] = useState("");
  const [assumptionError, setAssumptionError] = useState("");
  const [assumptionBusy, setAssumptionBusy] = useState(false);
  const [reportDataset, setReportDataset] = useState("");
  const [reportTitle, setReportTitle] = useState(
    "AWARE-2023 Sleep, Activity, and Alcohol Use Causal Design",
  );
  const [reportUserNotes, setReportUserNotes] = useState("");
  const [reportResult, setReportResult] =
    useState<ReportGenerationResponse | null>(null);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [workflowState, setWorkflowState] = useState<WorkflowState | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowError, setWorkflowError] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowReviseStep, setWorkflowReviseStep] = useState(4);

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
    if (!broadDataset && datasetList.datasets.length > 0) {
      setBroadDataset(datasetList.datasets[0].filename);
    }
    if (!candidateDataset && datasetList.datasets.length > 0) {
      setCandidateDataset(datasetList.datasets[0].filename);
    }
    if (!variableDataset && datasetList.datasets.length > 0) {
      setVariableDataset(datasetList.datasets[0].filename);
    }
    if (!targetedDataset && datasetList.datasets.length > 0) {
      setTargetedDataset(datasetList.datasets[0].filename);
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
    if (!strategyDataset && datasetList.datasets.length > 0) {
      setStrategyDataset(datasetList.datasets[0].filename);
    }
    if (!assumptionsDataset && datasetList.datasets.length > 0) {
      setAssumptionsDataset(datasetList.datasets[0].filename);
    }
    if (!reportDataset && datasetList.datasets.length > 0) {
      setReportDataset(datasetList.datasets[0].filename);
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

  async function handleBroadExploration() {
    if (!broadDataset) {
      setBroadError("Select a dataset first.");
      return;
    }

    setBroadBusy(true);
    setBroadError("");
    setBroadMessage("");

    try {
      const response = await runBroadExploration({
        datasetFilename: broadDataset,
        targetColumn: broadTargetColumn,
        participantIdColumn: broadParticipantColumn,
        timestampColumn: broadTimestampColumn,
      });
      setBroadExploration(response);
      setBroadMessage(
        `Explored ${response.number_of_rows} rows and ${response.number_of_columns} columns. Exploratory patterns do not establish causality.`,
      );
    } catch (error) {
      setBroadError((error as Error).message);
    } finally {
      setBroadBusy(false);
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

  async function handleTargetedFeasibility() {
    if (!targetedDataset) {
      setTargetedError("Select a dataset first.");
      return;
    }

    setTargetedBusy(true);
    setTargetedError("");
    setTargetedMessage("");

    try {
      const selectedVariables = targetedVariablesText
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
      const response = await runTargetedFeasibility({
        datasetFilename: targetedDataset,
        confirmedQuestion,
        selectedVariables,
        exposure: targetedExposure,
        outcome: targetedOutcome,
        comparator: targetedComparator,
        participantIdColumn: targetedParticipantId,
        timestampColumn: targetedTimestamp,
        timeWindow: targetedTimeWindow,
        lagDefinition: targetedLagDefinition,
        topKEvidence: topK,
      });
      setTargetedFeasibility(response);
      setTargetedMessage(
        `Feasibility status: ${response.feasibility_status}. Score: ${response.feasibility_score}.`,
      );
    } catch (error) {
      setTargetedError((error as Error).message);
    } finally {
      setTargetedBusy(false);
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
      setEditedGraphDraft(response.graph_draft);
      setGraphValidation(response.backend_validation);
      setIdentificationGraphJson(JSON.stringify(response.graph_draft, null, 2));
      setGraphMessage(
        `Generated ${response.graph_draft.nodes.length} nodes and ${response.graph_draft.edges.length} edges. Status: ${response.backend_validation.graph_validation_status}.`,
      );
    } catch (error) {
      setGraphError((error as Error).message);
    } finally {
      setGraphBusy(false);
    }
  }

  async function handleEditedGraphValidation() {
    if (!graphDataset) {
      setGraphError("Select a dataset first.");
      return;
    }
    if (!editedGraphDraft) {
      setGraphError("Generate or edit a graph draft first.");
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

      const response = await validateEditedGraph({
        confirmedQuestion,
        datasetFilename: graphDataset,
        graphDraft: editedGraphDraft,
        selectedVariables,
        roleRecommendations: parsedRoleRecommendations,
      });
      setGraphDraft(response.graph_draft);
      setEditedGraphDraft(response.graph_draft);
      setGraphValidation(response.backend_validation);
      setIdentificationGraphJson(JSON.stringify(response.graph_draft, null, 2));
      setGraphMessage(
        `Validated edited graph. Status: ${response.backend_validation.graph_validation_status}. Safe to identify: ${response.backend_validation.safe_to_continue_to_identification ? "yes" : "no"}.`,
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
      setIdentificationResultJson(JSON.stringify(response, null, 2));
      setIdentificationMessage(
        `Identification status: ${response.identification_status}. Adjustment set: ${response.adjustment_set_status}.`,
      );
    } catch (error) {
      setIdentificationError((error as Error).message);
    } finally {
      setIdentificationBusy(false);
    }
  }

  async function handleAnalysisStrategy() {
    if (!strategyDataset) {
      setStrategyError("Select a dataset first.");
      return;
    }

    setStrategyBusy(true);
    setStrategyError("");
    setStrategyMessage("");

    try {
      const graph = JSON.parse(identificationGraphJson);
      const roleRecommendations = JSON.parse(roleRecommendationsJson);
      const identificationPayload = JSON.parse(identificationResultJson);
      const adjustmentSet = adjustmentSetText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const response = await generateAnalysisStrategy({
        confirmedQuestion,
        datasetFilename: strategyDataset,
        graph,
        roleRecommendations,
        identificationResult: identificationPayload,
        exposure: identificationPayload.exposure,
        outcome: identificationPayload.outcome,
        adjustmentSet,
        topKEvidence: topK,
      });
      setStrategyResult(response);
      setStrategyResultJson(JSON.stringify(response.strategy_plan, null, 2));
      setStrategyMessage(
        `Strategy status: ${response.strategy_plan.strategy_status}. Estimator family guidance ready for review.`,
      );
    } catch (error) {
      setStrategyError((error as Error).message);
    } finally {
      setStrategyBusy(false);
    }
  }

  async function handleAssumptionReview() {
    if (!assumptionsDataset) {
      setAssumptionError("Select a dataset first.");
      return;
    }

    setAssumptionBusy(true);
    setAssumptionError("");
    setAssumptionMessage("");

    try {
      const graph = JSON.parse(identificationGraphJson);
      const roleRecommendations = JSON.parse(roleRecommendationsJson);
      const identificationPayload = JSON.parse(identificationResultJson);
      const analysisStrategyPayload = JSON.parse(strategyResultJson);
      const adjustmentSet = adjustmentSetText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const response = await reviewAssumptions({
        confirmedQuestion,
        datasetFilename: assumptionsDataset,
        graph,
        roleRecommendations,
        identificationResult: identificationPayload,
        analysisStrategy: analysisStrategyPayload,
        exposure: identificationPayload.exposure,
        outcome: identificationPayload.outcome,
        adjustmentSet,
        topKEvidence: topK,
      });
      setAssumptionReview(response);
      setAssumptionReviewJson(JSON.stringify(response.review, null, 2));
      setAssumptionMessage(
        `Assumption review status: ${response.review.review_status}. ${response.evidence_chunks_used} evidence chunks used.`,
      );
    } catch (error) {
      setAssumptionError((error as Error).message);
    } finally {
      setAssumptionBusy(false);
    }
  }

  async function handleReportGeneration() {
    if (!reportDataset) {
      setReportError("Select a dataset first.");
      return;
    }

    setReportBusy(true);
    setReportError("");
    setReportMessage("");

    try {
      const selectedVariables = JSON.parse(selectedVariablesJson);
      const roleRecommendations = JSON.parse(roleRecommendationsJson);
      const graph = JSON.parse(identificationGraphJson);
      const identificationPayload = JSON.parse(identificationResultJson);
      const analysisStrategyPayload = JSON.parse(strategyResultJson);
      const assumptionsPayload = JSON.parse(assumptionReviewJson);
      const response = await generateReport({
        projectTitle: reportTitle,
        researchObjective,
        confirmedQuestion,
        datasetFilename: reportDataset,
        schemaSummary: datasetSchema ?? undefined,
        broadExplorationSummary: broadExploration ?? undefined,
        candidateQuestions,
        candidateVariables: Object.values(variableGroups).flat(),
        targetedFeasibilityResult: targetedFeasibility ?? undefined,
        selectedVariables,
        roleRecommendations,
        roleValidationResult: roleValidation ?? undefined,
        graph,
        graphValidationResult: graphValidation ?? undefined,
        identificationResult: identificationPayload,
        analysisStrategy: analysisStrategyPayload,
        assumptionsReview: assumptionsPayload,
        evidenceSummary: ragResults,
        userNotes: reportUserNotes,
      });
      setReportResult(response);
      setReportMessage(
        `${response.report_type} generated. ${response.pdf_export_message}`,
      );
    } catch (error) {
      setReportError((error as Error).message);
    } finally {
      setReportBusy(false);
    }
  }

  function collectWorkflowInputs() {
    let selectedVariables: unknown[] = [];
    let roleRecommendationsPayload: Array<Record<string, unknown>> = [];
    let graphPayload: Record<string, unknown> | null = null;
    let identificationPayload: Record<string, unknown> | null = null;
    let strategyPayload: Record<string, unknown> | null = null;
    let assumptionsPayload: Record<string, unknown> | null = null;

    try {
      selectedVariables = JSON.parse(selectedVariablesJson);
    } catch {
      selectedVariables = targetedVariablesText
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    try {
      roleRecommendationsPayload = JSON.parse(roleRecommendationsJson);
    } catch {
      roleRecommendationsPayload = [];
    }
    graphPayload = editedGraphDraft as unknown as Record<string, unknown> | null;
    if (!graphPayload) {
      try {
        graphPayload = JSON.parse(identificationGraphJson);
      } catch {
        graphPayload = null;
      }
    }
    try {
      identificationPayload = JSON.parse(identificationResultJson);
    } catch {
      identificationPayload = null;
    }
    try {
      strategyPayload = JSON.parse(strategyResultJson);
    } catch {
      strategyPayload = null;
    }
    try {
      assumptionsPayload = JSON.parse(assumptionReviewJson);
    } catch {
      assumptionsPayload = null;
    }

    return {
      project_title: reportTitle,
      research_objective: researchObjective,
      dataset_filename: reportDataset || selectedDataset || targetedDataset,
      schema_summary: datasetSchema,
      broad_exploration_summary: broadExploration,
      candidate_questions: candidateQuestions,
      selected_candidate_question: confirmedQuestion,
      candidate_variables: Object.values(variableGroups).flat(),
      selected_variables: selectedVariables,
      targeted_feasibility_result: targetedFeasibility,
      role_recommendations: roleRecommendationsPayload,
      role_validation_result: roleValidation,
      graph: graphPayload,
      graph_validation_result: graphValidation,
      identification_result: identificationPayload,
      analysis_strategy: strategyPayload,
      assumptions_review: assumptionsPayload,
      report: reportResult,
      exposure: targetedExposure,
      outcome: targetedOutcome,
      participant_id_column: targetedParticipantId,
      timestamp_column: targetedTimestamp,
      lag_definition: targetedLagDefinition,
    };
  }

  async function handleWorkflowStart() {
    setWorkflowBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const state = await startWorkflow({
        projectTitle: reportTitle,
        researchObjective,
        datasetFilename: reportDataset || selectedDataset || targetedDataset,
      });
      setWorkflowState(state);
      setWorkflowMessage("Workflow started. State is stored in memory.");
    } catch (error) {
      setWorkflowError((error as Error).message);
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleWorkflowAdvance() {
    if (!workflowState) {
      setWorkflowError("Start a workflow first.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const state = await advanceWorkflow(
        workflowState.workflow_id,
        collectWorkflowInputs(),
      );
      setWorkflowState(state);
      setWorkflowMessage(`Workflow advanced/checkpointed at Step ${state.current_step}.`);
    } catch (error) {
      setWorkflowError((error as Error).message);
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleWorkflowConfirm() {
    if (!workflowState) {
      setWorkflowError("Start a workflow first.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const state = await confirmWorkflow(
        workflowState.workflow_id,
        collectWorkflowInputs(),
      );
      setWorkflowState(state);
      setWorkflowMessage(`Confirmed Step ${state.current_step}.`);
    } catch (error) {
      setWorkflowError((error as Error).message);
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleWorkflowRevise() {
    if (!workflowState) {
      setWorkflowError("Start a workflow first.");
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError("");
    setWorkflowMessage("");
    try {
      const state = await reviseWorkflow(
        workflowState.workflow_id,
        workflowReviseStep,
        "User requested revision from workflow control.",
      );
      setWorkflowState(state);
      setWorkflowMessage(`Workflow moved back to Step ${state.current_step}.`);
    } catch (error) {
      setWorkflowError((error as Error).message);
    } finally {
      setWorkflowBusy(false);
    }
  }

  const selectedVariablesCount = targetedVariablesText
    .split(/\r?\n|,/)
    .map((variable) => variable.trim())
    .filter(Boolean).length;
  const graphStatus =
    graphValidation?.graph_validation_status ?? "not reviewed";
  const identificationStatus =
    identificationResult?.identification_status ?? "not checked";
  const reportStatus = reportResult ? "generated" : "not generated";
  const activeWorkflowStep = workflowState?.current_step ?? activeStep;
  const progressStages = workflowSteps.map((step, index) => {
    const stepNumber = index + 1;
    const completedByWorkflow =
      workflowState?.completed_steps.includes(stepNumber) ?? false;
    const state =
      stepNumber === activeStep
        ? "active"
        : completedByWorkflow || stepNumber < activeWorkflowStep
          ? "done"
          : stepNumber > activeWorkflowStep + 1
            ? "locked"
            : "pending";
    return { ...step, state };
  });

  const stepGuidance = [
    {
      purpose: "Define the project and prepare the document knowledge base.",
      action: "Enter the research objective, upload PDF/DOCX documents, and ingest them when ready.",
      caution: "RAG evidence supports design decisions, but it does not prove causal claims.",
      requirement: "Proceed after the objective is clear and documents are uploaded or intentionally skipped.",
    },
    {
      purpose: "Understand the uploaded CSV before causal design begins.",
      action: "Upload/select a dataset and inspect rows, columns, IDs, timestamps, missingness, and types.",
      caution: "Dataset schema describes available variables only; it is not analysis evidence.",
      requirement: "Proceed after a dataset is selected and schema is reviewed.",
    },
    {
      purpose: "Explore broad data quality and structure before narrowing variables.",
      action: "Run broad exploration and review missingness, temporal structure, and possible outcomes.",
      caution: "Exploratory patterns do not establish causality.",
      requirement: "Proceed after broad warnings are reviewed.",
    },
    {
      purpose: "Draft candidate causal questions and provisional variables.",
      action: "Generate questions, confirm one question, then recommend candidate variables.",
      caution: "Variable roles are provisional until graph and final validation.",
      requirement: "Proceed after a question and selected variables are available.",
    },
    {
      purpose: "Check whether the selected variables can support graph design.",
      action: "Run targeted feasibility for exposure, outcome, timing, coverage, and missingness.",
      caution: "Feasibility checks implementation readiness, not causal effects.",
      requirement: "Proceed when safe_to_continue_to_graph is true, or continue with an explicit warning.",
    },
    {
      purpose: "Validate final roles and draft a causal graph.",
      action: "Run role validation, generate the draft graph, and inspect graph warnings.",
      caution: "The graph is a user-reviewed design object, not proven causal structure.",
      requirement: "Proceed after graph validation returns a usable result.",
    },
    {
      purpose: "Check identification and plan estimation guidance.",
      action: "Run identification, generate strategy guidance, and review assumptions/sensitivity.",
      caution: "No causal estimation is run here.",
      requirement: "Proceed after assumptions and sensitivity planning are reviewed.",
    },
    {
      purpose: "Generate the final causal design and analysis guidance report.",
      action: "Review carried-forward state and generate the structured JSON report.",
      caution: "The report is not a causal results report and must not claim proven effects.",
      requirement: "Report generation should include assumptions review or show missing-section warnings.",
    },
  ][activeStep - 1];

  const stepProceedStatus = [
    Boolean(researchObjective.trim()),
    Boolean(selectedDataset && datasetSchema),
    Boolean(broadExploration),
    Boolean(confirmedQuestion.trim() && selectedVariablesCount > 0),
    Boolean(targetedFeasibility?.safe_to_continue_to_graph),
    Boolean(graphValidation),
    Boolean(identificationResult && strategyResult && assumptionReview),
    Boolean(assumptionReview),
  ];
  const canContinue = stepProceedStatus[activeStep - 1];

  function goToStep(step: number) {
    setActiveStep(Math.min(Math.max(step, 1), workflowSteps.length));
  }

  function goToPreviousStep() {
    goToStep(activeStep - 1);
  }

  function goToNextStep() {
    goToStep(activeStep + 1);
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
          {workflowSteps.map((step, index) => (
            <button
              className={`nav-item ${
                activeStep === index + 1 ? "nav-item--active" : ""
              }`}
              key={step.label}
              onClick={() => goToStep(index + 1)}
              type="button"
            >
              <span className="nav-icon" aria-hidden="true">
                {index + 1}
              </span>
              {step.navLabel}
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
            <span className="pill pill--warning">4 Warnings</span>
            <span className="pill">Stage {activeStep}/8</span>
          </div>
        </header>

        <section className="progress-card panel">
          <p className="section-label">Analysis Progress</p>
          <div className="progress-steps">
            {progressStages.map((stage, index) => (
              <button
                className="progress-step"
                key={stage.label}
                onClick={() => goToStep(index + 1)}
                type="button"
              >
                <span className={`step-node step-node--${stage.state}`}>
                  {getStageSymbol(stage.state) || index + 1}
                </span>
                <span>{stage.shortLabel}</span>
              </button>
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
          <strong>4 Analysis Warnings</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>

        <section className="panel workflow-overview">
          <div className="panel-heading">
            <div>
              <p className="section-label">Guided Workflow</p>
              <h2>
                Step {activeStep}: {workflowSteps[activeStep - 1].label}
              </h2>
            </div>
            <div className="step-controls">
              <button
                disabled={activeStep === 1}
                onClick={goToPreviousStep}
                type="button"
              >
                Return to Previous Step
              </button>
              <button
                disabled={activeStep === workflowSteps.length || !canContinue}
                onClick={goToNextStep}
                type="button"
              >
                Continue to Next Step
              </button>
            </div>
          </div>

          <div className="overview-grid">
            <article>
              <strong>Current Design State</strong>
              <dl>
                <dt>Dataset</dt>
                <dd>{selectedDataset || candidateDataset || targetedDataset || "Not selected"}</dd>
                <dt>Confirmed Question</dt>
                <dd>{confirmedQuestion ? "Available" : "Not confirmed"}</dd>
                <dt>Selected Variables</dt>
                <dd>{selectedVariablesCount}</dd>
                <dt>Graph Status</dt>
                <dd>{graphStatus}</dd>
                <dt>Identification</dt>
                <dd>{identificationStatus}</dd>
                <dt>Report</dt>
                <dd>{reportStatus}</dd>
              </dl>
            </article>
            <article>
              <strong>Proceed Condition</strong>
              <p>{stepGuidance.requirement}</p>
              {!canContinue && (
                <p className="inline-warning">
                  This step can still be explored, but the next-step button is
                  disabled until the required state is available.
                </p>
              )}
            </article>
            {workflowState && (
              <article>
                <strong>LangGraph State</strong>
                <dl>
                  <dt>Workflow ID</dt>
                  <dd>{workflowState.workflow_id.slice(0, 8)}</dd>
                  <dt>Current Step</dt>
                  <dd>
                    {workflowState.current_step}: {workflowState.current_step_name}
                  </dd>
                  <dt>Completed</dt>
                  <dd>
                    {workflowState.completed_steps.length > 0
                      ? workflowState.completed_steps.join(", ")
                      : "None yet"}
                  </dd>
                </dl>
              </article>
            )}
          </div>

          <div className="safety-banner">
            <span>Not diagnostic or treatment-decision support.</span>
            <span>The LLM recommends and explains; backend validation checks.</span>
            <span>Do not present causal conclusions as proven.</span>
          </div>
        </section>

        <section className={`feature-grid feature-grid--step-${activeStep}`}>
          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">LangGraph Orchestration</p>
                <h2>Workflow Control</h2>
              </div>
            </div>

            <div className="control-row">
              <button
                disabled={workflowBusy}
                onClick={handleWorkflowStart}
                type="button"
              >
                Start Workflow
              </button>
              <button
                disabled={workflowBusy || !workflowState}
                onClick={handleWorkflowAdvance}
                type="button"
              >
                Advance
              </button>
              <button
                disabled={workflowBusy || !workflowState}
                onClick={handleWorkflowConfirm}
                type="button"
              >
                Confirm Current Step
              </button>
            </div>

            <div className="control-row">
              <select
                onChange={(event) => setWorkflowReviseStep(Number(event.target.value))}
                value={workflowReviseStep}
              >
                {workflowSteps.map((stage, index) => (
                  <option key={stage.label} value={index + 1}>
                    Step {index + 1}: {stage.shortLabel}
                  </option>
                ))}
              </select>
              <button
                disabled={workflowBusy || !workflowState}
                onClick={handleWorkflowRevise}
                type="button"
              >
                Revise To Step
              </button>
            </div>

            <StatusMessage error={workflowError} message={workflowMessage} />

            {workflowState && (
              <section className="validation-summary">
                <div>
                  <strong>{workflowState.workflow_id.slice(0, 8)}</strong>
                  <span>Workflow ID</span>
                </div>
                <div>
                  <strong>
                    Step {workflowState.current_step}:{" "}
                    {workflowState.current_step_name}
                  </strong>
                  <span>Current Step</span>
                </div>
                <p>{workflowState.next_required_user_action}</p>
              </section>
            )}

            {workflowState && (
              <section className="role-section">
                <h3>Completed Steps</h3>
                <p>
                  {workflowState.completed_steps.length > 0
                    ? workflowState.completed_steps.join(", ")
                    : "No completed steps yet."}
                </p>

                <h3>Workflow Warnings / Errors</h3>
                <div className="issue-list">
                  {[...workflowState.warnings, ...workflowState.errors].length === 0 ? (
                    <p>No workflow warnings or errors.</p>
                  ) : (
                    [...workflowState.warnings, ...workflowState.errors].map(
                      (message, index) => (
                        <article
                          className={
                            message.severity === "blocking"
                              ? "issue-card issue-card--error"
                              : "issue-card"
                          }
                          key={`${message.message}-${index}`}
                        >
                          <strong>{message.severity}</strong>
                          <p>{message.message}</p>
                        </article>
                      ),
                    )
                  )}
                </div>
              </section>
            )}
          </article>

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 1</p>
            <h2>Project Setup and Document Upload</h2>
            <p>
              Define the research objective and upload project documents before
              moving into data foundation work.
            </p>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Project Setup</p>
                <h2>Research Objective</h2>
              </div>
            </div>
            <textarea
              id="setup-research-objective"
              onChange={(event) => setResearchObjective(event.target.value)}
              rows={3}
              value={researchObjective}
            />
          </article>

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

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 2</p>
            <h2>Data Foundation and Understanding</h2>
            <p>
              Upload datasets, inspect schema, confirm observation units, ID
              columns, timestamp columns, missingness, and data quality warnings.
            </p>
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

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 3</p>
            <h2>Broad Data Exploration</h2>
            <p>
              Explore the whole dataset before narrowing to causal variables.
              Exploratory patterns do not establish causality.
            </p>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Deterministic Dataset Exploration</p>
                <h2>Broad Dataset Exploration</h2>
              </div>
            </div>

            <div className="control-row">
              <select
                onChange={(event) => setBroadDataset(event.target.value)}
                value={broadDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={broadBusy}
                onClick={handleBroadExploration}
                type="button"
              >
                Run Broad Exploration
              </button>
            </div>

            <div className="placeholder-grid">
              <input
                onChange={(event) => setBroadTargetColumn(event.target.value)}
                placeholder="Optional target/outcome column"
                value={broadTargetColumn}
              />
              <input
                onChange={(event) =>
                  setBroadParticipantColumn(event.target.value)
                }
                placeholder="Optional participant ID column"
                value={broadParticipantColumn}
              />
              <input
                onChange={(event) => setBroadTimestampColumn(event.target.value)}
                placeholder="Optional timestamp column"
                value={broadTimestampColumn}
              />
            </div>
            <p className="stage-note">
              Exploratory patterns can support hypothesis generation, but they
              do not establish causality.
            </p>

            <StatusMessage error={broadError} message={broadMessage} />

            {broadExploration && (
              <section className="schema-summary">
                <div>
                  <strong>{broadExploration.number_of_rows}</strong>
                  <span>Rows</span>
                </div>
                <div>
                  <strong>{broadExploration.number_of_columns}</strong>
                  <span>Columns</span>
                </div>
                <div>
                  <strong>
                    {broadExploration.participant_summary
                      ?.number_of_unique_participants ?? "None"}
                  </strong>
                  <span>Participants</span>
                </div>
                <div>
                  <strong>
                    {broadExploration.temporal_summary.detected_timestamp_columns
                      .length || "None"}
                  </strong>
                  <span>Time Fields</span>
                </div>
              </section>
            )}

            {broadExploration && (
              <section className="role-section">
                <h3>Missingness Summary</h3>
                <div className="issue-list">
                  {broadExploration.missingness_summary.highest_missingness_columns
                    .slice(0, 6)
                    .map((item) => (
                      <article className="issue-card" key={item.column}>
                        <strong>
                          {item.column} - {item.missing_percentage}%
                        </strong>
                        <p>
                          Severity: {item.severity}. Columns above 30% need
                          missingness review before causal design decisions.
                        </p>
                      </article>
                    ))}
                </div>
              </section>
            )}

            {broadExploration && (
              <section className="role-section">
                <h3>Participant Variation</h3>
                {broadExploration.participant_summary ? (
                  <div className="schema-summary">
                    <div>
                      <strong>
                        {
                          broadExploration.participant_summary
                            .participant_id_column
                        }
                      </strong>
                      <span>ID Column</span>
                    </div>
                    <div>
                      <strong>
                        {
                          broadExploration.participant_summary
                            .rows_per_participant.min
                        }
                      </strong>
                      <span>Min Rows</span>
                    </div>
                    <div>
                      <strong>
                        {
                          broadExploration.participant_summary
                            .rows_per_participant.max
                        }
                      </strong>
                      <span>Max Rows</span>
                    </div>
                    <div>
                      <strong>
                        {
                          broadExploration.participant_summary
                            .rows_per_participant.average
                        }
                      </strong>
                      <span>Avg Rows</span>
                    </div>
                  </div>
                ) : (
                  <p>No participant ID column detected.</p>
                )}
              </section>
            )}

            {broadExploration && (
              <section className="role-section">
                <h3>Temporal Summary</h3>
                <div className="variable-card">
                  <dl>
                    <dt>Detected Fields</dt>
                    <dd>
                      {broadExploration.temporal_summary.detected_timestamp_columns.join(
                        ", ",
                      ) || "None"}
                    </dd>
                    <dt>Common Time Fields</dt>
                    <dd>
                      {broadExploration.temporal_summary.common_time_fields.join(
                        ", ",
                      ) || "None"}
                    </dd>
                    <dt>Parsed Range</dt>
                    <dd>
                      {broadExploration.temporal_summary.parsed_timestamp_summary
                        ? `${broadExploration.temporal_summary.parsed_timestamp_summary.min_timestamp} to ${broadExploration.temporal_summary.parsed_timestamp_summary.max_timestamp}`
                        : "No parseable timestamp range detected"}
                    </dd>
                  </dl>
                </div>
              </section>
            )}

            {broadExploration && (
              <section className="role-section">
                <h3>Feature Groups</h3>
                <div className="placeholder-grid">
                  {Object.entries(broadExploration.sensor_or_feature_groups).map(
                    ([group, columns]) => (
                      <span key={group}>
                        <strong>{group.replaceAll("_", " ")}</strong>
                        <br />
                        {columns.slice(0, 6).join(", ")}
                      </span>
                    ),
                  )}
                </div>
              </section>
            )}

            {broadExploration && (
              <section className="role-section">
                <h3>Broad Correlation / Association Summary</h3>
                <p className="stage-note">
                  {broadExploration.broad_correlation_summary.warning}
                </p>
                <div className="graph-draft-grid">
                  <div className="issue-list">
                    <h3>Strongest Positive</h3>
                    {broadExploration.broad_correlation_summary.strongest_positive
                      .slice(0, 5)
                      .map((item) => (
                        <article
                          className="variable-card"
                          key={`${item.column_a}-${item.column_b}-positive`}
                        >
                          <strong>
                            {item.column_a} / {item.column_b}
                          </strong>
                          <p>{item.correlation}</p>
                        </article>
                      ))}
                  </div>
                  <div className="issue-list">
                    <h3>Strongest Negative</h3>
                    {broadExploration.broad_correlation_summary.strongest_negative
                      .slice(0, 5)
                      .map((item) => (
                        <article
                          className="variable-card"
                          key={`${item.column_a}-${item.column_b}-negative`}
                        >
                          <strong>
                            {item.column_a} / {item.column_b}
                          </strong>
                          <p>{item.correlation}</p>
                        </article>
                      ))}
                  </div>
                </div>
              </section>
            )}

            {broadExploration && (
              <section className="role-section">
                <h3>Data Quality Warnings</h3>
                <div className="issue-list">
                  {broadExploration.data_quality_warnings.map((warning, index) => (
                    <article
                      className="issue-card"
                      key={`${warning.warning_type}-${index}`}
                    >
                      <strong>
                        {warning.column ?? warning.warning_type} -{" "}
                        {warning.severity}
                      </strong>
                      <p>{warning.message}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
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

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 4</p>
            <h2>Causal Question and Provisional Variable Design</h2>
            <p>
              Generate candidate questions, recommend variables, and draft
              provisional role hints. Roles are not final until Step 6 graph and
              role validation.
            </p>
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

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 5</p>
            <h2>Targeted Variable Data Exploration and Feasibility Check</h2>
            <p>
              Inspect selected variables in detail before graph finalization. If
              exposure, outcome, timing, overlap, or person-time are infeasible,
              return to Step 4 and revise the question or variables.
            </p>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Implementation Feasibility</p>
                <h2>Selected Variable Feasibility</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="targeted-question">
              Confirmed Question
            </label>
            <textarea
              id="targeted-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setTargetedDataset(event.target.value)}
                value={targetedDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={targetedBusy}
                onClick={handleTargetedFeasibility}
                type="button"
              >
                Run Feasibility Check
              </button>
            </div>

            <label className="field-label" htmlFor="targeted-variables">
              Selected Variables
            </label>
            <textarea
              className="code-textarea"
              id="targeted-variables"
              onChange={(event) => setTargetedVariablesText(event.target.value)}
              rows={7}
              value={targetedVariablesText}
            />

            <div className="placeholder-grid">
              <input
                onChange={(event) => setTargetedExposure(event.target.value)}
                placeholder="Exposure"
                value={targetedExposure}
              />
              <input
                onChange={(event) => setTargetedOutcome(event.target.value)}
                placeholder="Outcome"
                value={targetedOutcome}
              />
              <input
                onChange={(event) => setTargetedComparator(event.target.value)}
                placeholder="Comparator, optional"
                value={targetedComparator}
              />
              <input
                onChange={(event) => setTargetedParticipantId(event.target.value)}
                placeholder="Participant ID"
                value={targetedParticipantId}
              />
              <input
                onChange={(event) => setTargetedTimestamp(event.target.value)}
                placeholder="Timestamp column"
                value={targetedTimestamp}
              />
              <input
                onChange={(event) => setTargetedTimeWindow(event.target.value)}
                placeholder="Time window"
                value={targetedTimeWindow}
              />
            </div>

            <label className="field-label" htmlFor="targeted-lag">
              Lag Definition
            </label>
            <input
              id="targeted-lag"
              onChange={(event) => setTargetedLagDefinition(event.target.value)}
              value={targetedLagDefinition}
            />

            <p className="stage-note">
              If this check is infeasible, return to Step 4 and revise the
              causal question, variable set, or timing window.
            </p>
            <p className="stage-note">
              Targeted exploration checks implementation feasibility. It does
              not establish causality.
            </p>

            <StatusMessage error={targetedError} message={targetedMessage} />

            {targetedFeasibility && (
              <section className="validation-summary">
                <div>
                  <strong>{targetedFeasibility.feasibility_status}</strong>
                  <span>Feasibility</span>
                </div>
                <div>
                  <strong>
                    {targetedFeasibility.safe_to_continue_to_graph ? "Yes" : "No"}
                  </strong>
                  <span>Safe To Graph</span>
                </div>
                <p>{targetedFeasibility.exploration_warning}</p>
              </section>
            )}

            {targetedFeasibility && (
              <section className="schema-summary">
                <div>
                  <strong>{targetedFeasibility.feasibility_score}</strong>
                  <span>Score</span>
                </div>
                <div>
                  <strong>
                    {targetedFeasibility.missing_selected_variables.length}
                  </strong>
                  <span>Missing Variables</span>
                </div>
                <div>
                  <strong>
                    {
                      targetedFeasibility.analysis_ready_sample_summary
                        .complete_case_rows_for_selected_variables
                    }
                  </strong>
                  <span>Complete Cases</span>
                </div>
                <div>
                  <strong>
                    {String(
                      targetedFeasibility.participant_level_availability
                        .number_of_participants ?? "Unknown",
                    )}
                  </strong>
                  <span>Participants</span>
                </div>
              </section>
            )}

            {targetedFeasibility && (
              <section className="role-section">
                <h3>Variable Summaries</h3>
                <div className="candidate-list">
                  {targetedFeasibility.variable_summaries.map((summary) => (
                    <article className="variable-card" key={summary.variable_name}>
                      <div className="candidate-header">
                        <strong>{summary.variable_name}</strong>
                        <span>
                          {summary.exists_in_dataset ? "found" : "missing"}
                        </span>
                      </div>
                      <dl>
                        <dt>Type</dt>
                        <dd>{summary.data_type ?? "n/a"}</dd>
                        <dt>Missing</dt>
                        <dd>
                          {summary.missing_percentage ?? "n/a"}% (
                          {summary.missing_count ?? "n/a"} rows)
                        </dd>
                        <dt>Unique</dt>
                        <dd>{summary.unique_values ?? "n/a"}</dd>
                        <dt>Samples</dt>
                        <dd>{summary.sample_values.join(", ") || "None"}</dd>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {targetedFeasibility && (
              <section className="role-section">
                <h3>Exposure, Outcome, Lag, and Overlap</h3>
                <div className="graph-draft-grid">
                  <article className="variable-card">
                    <strong>Exposure</strong>
                    <p>{targetedFeasibility.exposure_feasibility.status}</p>
                    <span>
                      Variation:{" "}
                      {String(targetedFeasibility.exposure_feasibility.has_variation)}
                    </span>
                  </article>
                  <article className="variable-card">
                    <strong>Outcome</strong>
                    <p>{targetedFeasibility.outcome_feasibility.status}</p>
                    <span>
                      Variation:{" "}
                      {String(targetedFeasibility.outcome_feasibility.has_variation)}
                    </span>
                  </article>
                  <article className="variable-card">
                    <strong>Lag Feasibility</strong>
                    <p>{String(targetedFeasibility.lag_feasibility.status)}</p>
                    <span>
                      {String(
                        targetedFeasibility.lag_feasibility
                          .detected_time_variables ?? "",
                      )}
                    </span>
                  </article>
                  <article className="variable-card">
                    <strong>Overlap / Comparator</strong>
                    <p>{targetedFeasibility.overlap_or_comparator_summary.status}</p>
                    <span>
                      Comparator: {targetedComparator || "unclear"}
                    </span>
                  </article>
                </div>
              </section>
            )}

            {targetedFeasibility && (
              <section className="role-section">
                <h3>Warnings and Revision Actions</h3>
                <div className="issue-list">
                  {targetedFeasibility.data_quality_warnings.map((warning, index) => (
                    <article
                      className="issue-card"
                      key={`${warning.warning_type}-${index}`}
                    >
                      <strong>
                        {warning.variable ?? warning.warning_type} -{" "}
                        {warning.severity}
                      </strong>
                      <p>{warning.message}</p>
                    </article>
                  ))}
                </div>
                <h3>Recommended Revisions</h3>
                <ul className="warning-list">
                  {targetedFeasibility.recommended_revision_actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
                <h3>Redundancy / Correlation</h3>
                <p className="stage-note">
                  {targetedFeasibility.redundancy_or_correlation_summary.warning}
                </p>
              </section>
            )}
          </article>

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 6</p>
            <h2>Causal Graph and Final Role Validation</h2>
            <p>
              Use provisional roles to draft the graph, inspect chains, forks,
              and colliders, and validate final roles before identification.
              Graph types may include DAG, CPDAG, PAG, or MAG.
            </p>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Final Role Review</p>
                <h2>Final Causal Role Validation</h2>
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

            <div className="placeholder-grid">
              <span>Chain review</span>
              <span>Fork review</span>
              <span>Collider review</span>
              <span>DAG / CPDAG / PAG / MAG explanation</span>
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

            <section className="warning-card graph-safety-card">
              <strong>Graph Safety Notes</strong>
              <ul>
                <li>This graph is a draft causal structure and requires user review.</li>
                <li>Edges are assumptions, not proven causal relationships.</li>
                <li>
                  Backend validation checks graph structure, timing, and role
                  conflicts.
                </li>
              </ul>
            </section>

            <section className="graph-education-grid">
              <article>
                <strong>Chain</strong>
                <span>{"A -> B -> C"}</span>
              </article>
              <article>
                <strong>Fork</strong>
                <span>{"A <- B -> C"}</span>
              </article>
              <article>
                <strong>Collider</strong>
                <span>{"A -> B <- C"}</span>
              </article>
              <article>
                <strong>DAG</strong>
                <span>Directed acyclic graph</span>
              </article>
            </section>

            <CausalGraphCanvas
              graphDraft={graphDraft}
              onGraphChange={setEditedGraphDraft}
              validation={graphValidation}
            />

            <div className="action-row">
              <button
                disabled={graphBusy || !editedGraphDraft}
                onClick={handleEditedGraphValidation}
                type="button"
              >
                Validate Edited Graph
              </button>
              <span className="status-line">
                {editedGraphDraft
                  ? `${editedGraphDraft.nodes.length} nodes / ${editedGraphDraft.edges.length} edges ready for validation`
                  : "No edited graph yet"}
              </span>
            </div>

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

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 7</p>
            <h2>Identification and Estimation Strategy</h2>
            <p>
              Review adjustment sets, identification status, repeated-measures
              handling, missing-data strategy, positivity, overlap, and
              sensitivity/robustness planning. No causal estimation is run here.
            </p>
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

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">Estimation Guidance</p>
                <h2>Analysis Strategy</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="strategy-question">
              Confirmed Question
            </label>
            <textarea
              id="strategy-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setStrategyDataset(event.target.value)}
                value={strategyDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={strategyBusy}
                onClick={handleAnalysisStrategy}
                type="button"
              >
                Generate Strategy
              </button>
            </div>

            <label className="field-label" htmlFor="strategy-identification-json">
              Identification Result JSON
            </label>
            <textarea
              className="code-textarea"
              id="strategy-identification-json"
              onChange={(event) => setIdentificationResultJson(event.target.value)}
              rows={10}
              value={identificationResultJson}
            />

            <StatusMessage error={strategyError} message={strategyMessage} />

            {strategyResult && (
              <section className="validation-summary">
                <div>
                  <strong>{strategyResult.strategy_plan.strategy_status}</strong>
                  <span>Strategy Status</span>
                </div>
                <div>
                  <strong>{strategyResult.strategy_plan.confidence}</strong>
                  <span>Confidence</span>
                </div>
                <p>{strategyResult.strategy_plan.recommended_next_action}</p>
              </section>
            )}

            {strategyResult && (
              <section className="role-section">
                <h3>Plan Summary</h3>
                <div className="schema-summary">
                  <div>
                    <strong>{strategyResult.exposure ?? "Unknown"}</strong>
                    <span>Exposure</span>
                  </div>
                  <div>
                    <strong>{strategyResult.outcome ?? "Unknown"}</strong>
                    <span>Outcome</span>
                  </div>
                  <div>
                    <strong>
                      {strategyResult.strategy_plan.unit_of_analysis}
                    </strong>
                    <span>Unit</span>
                  </div>
                  <div>
                    <strong>
                      {strategyResult.adjustment_set.join(", ") || "None"}
                    </strong>
                    <span>Adjustment</span>
                  </div>
                </div>

                <div className="variable-card">
                  <dl>
                    <dt>Estimand</dt>
                    <dd>{strategyResult.strategy_plan.target_estimand}</dd>
                    <dt>Comparator</dt>
                    <dd>{strategyResult.strategy_plan.comparator_definition}</dd>
                    <dt>Time Window</dt>
                    <dd>{strategyResult.strategy_plan.time_window}</dd>
                    <dt>Estimator Family</dt>
                    <dd>
                      {strategyResult.strategy_plan.recommended_estimator_family.join(
                        ", ",
                      )}
                    </dd>
                    <dt>Repeated Measures</dt>
                    <dd>
                      {strategyResult.strategy_plan.repeated_measures_handling}
                    </dd>
                    <dt>Missing Data</dt>
                    <dd>{strategyResult.strategy_plan.missing_data_strategy}</dd>
                    <dt>Cannot Claim</dt>
                    <dd>{strategyResult.strategy_plan.what_cannot_be_claimed}</dd>
                  </dl>
                </div>
              </section>
            )}

            {strategyResult && (
              <section className="role-section">
                <h3>Deterministic Strategy Warnings</h3>
                <div className="issue-list">
                  {strategyResult.deterministic_warnings.length === 0 ? (
                    <p>No warnings returned.</p>
                  ) : (
                    strategyResult.deterministic_warnings.map((warning, index) => (
                      <article className="issue-card" key={`${warning.issue_type}-${index}`}>
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

                <h3>Deterministic Strategy Errors</h3>
                <div className="issue-list">
                  {strategyResult.deterministic_errors.length === 0 ? (
                    <p>No errors returned.</p>
                  ) : (
                    strategyResult.deterministic_errors.map((error, index) => (
                      <article className="issue-card issue-card--error" key={`${error.issue_type}-${index}`}>
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
                <p className="section-label">Assumption Review</p>
                <h2>Assumptions & Sensitivity</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="assumptions-question">
              Confirmed Question
            </label>
            <textarea
              id="assumptions-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setAssumptionsDataset(event.target.value)}
                value={assumptionsDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={assumptionBusy}
                onClick={handleAssumptionReview}
                type="button"
              >
                Review Assumptions
              </button>
            </div>

            <label className="field-label" htmlFor="assumptions-graph-json">
              Graph JSON
            </label>
            <textarea
              className="code-textarea"
              id="assumptions-graph-json"
              onChange={(event) => setIdentificationGraphJson(event.target.value)}
              rows={8}
              value={identificationGraphJson}
            />

            <label className="field-label" htmlFor="assumptions-roles-json">
              Role Recommendations JSON
            </label>
            <textarea
              className="code-textarea"
              id="assumptions-roles-json"
              onChange={(event) => setRoleRecommendationsJson(event.target.value)}
              rows={8}
              value={roleRecommendationsJson}
            />

            <label className="field-label" htmlFor="assumptions-identification-json">
              Identification Result JSON
            </label>
            <textarea
              className="code-textarea"
              id="assumptions-identification-json"
              onChange={(event) => setIdentificationResultJson(event.target.value)}
              rows={8}
              value={identificationResultJson}
            />

            <label className="field-label" htmlFor="assumptions-strategy-json">
              Analysis Strategy JSON
            </label>
            <textarea
              className="code-textarea"
              id="assumptions-strategy-json"
              onChange={(event) => setStrategyResultJson(event.target.value)}
              rows={10}
              value={strategyResultJson}
            />

            <StatusMessage error={assumptionError} message={assumptionMessage} />

            {assumptionReview && (
              <section className="validation-summary">
                <div>
                  <strong>{assumptionReview.review.review_status}</strong>
                  <span>Review Status</span>
                </div>
                <div>
                  <strong>{assumptionReview.review.confidence}</strong>
                  <span>Confidence</span>
                </div>
                <p>{assumptionReview.review.plain_language_summary}</p>
              </section>
            )}

            {assumptionReview && (
              <section className="role-section">
                <h3>Assumption Checklist</h3>
                <div className="issue-list">
                  {assumptionReview.review.assumptions.map((assumption) => (
                    <article
                      className="issue-card"
                      key={assumption.assumption_name}
                    >
                      <strong>
                        {assumption.assumption_name} - {assumption.status}
                      </strong>
                      <p>{assumption.rationale}</p>
                      <span>{assumption.recommended_check}</span>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {assumptionReview && (
              <section className="role-section">
                <h3>Sensitivity Checks</h3>
                <ul className="warning-list">
                  {assumptionReview.review.sensitivity_checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>

                <h3>Robustness Checks</h3>
                <ul className="warning-list">
                  {assumptionReview.review.robustness_checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>

                <h3>Deterministic Assumption Warnings</h3>
                <div className="issue-list">
                  {assumptionReview.deterministic_warnings.length === 0 ? (
                    <p>No deterministic warnings returned.</p>
                  ) : (
                    assumptionReview.deterministic_warnings.map((warning, index) => (
                      <article
                        className="issue-card"
                        key={`${warning.issue_type}-${index}`}
                      >
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

                <h3>What Remains Uncertain</h3>
                <ul className="warning-list">
                  {assumptionReview.review.causal_interpretation_limits.map(
                    (limit) => (
                      <li key={limit}>{limit}</li>
                    ),
                  )}
                </ul>
              </section>
            )}
          </article>

          <article className="workflow-stage-card feature-panel--wide">
            <p className="section-label">Step 8</p>
            <h2>Review and Export</h2>
            <p>
              Generate the final Causal Design and Analysis Guidance Report.
              This is not a causal-results report and does not prove a causal
              effect.
            </p>
          </article>

          <article className="panel feature-panel feature-panel--wide">
            <div className="panel-heading">
              <div>
                <p className="section-label">JSON Report Export</p>
                <h2>Review & Export Report</h2>
              </div>
            </div>

            <label className="field-label" htmlFor="report-title">
              Project Title
            </label>
            <input
              id="report-title"
              onChange={(event) => setReportTitle(event.target.value)}
              value={reportTitle}
            />

            <label className="field-label" htmlFor="report-objective">
              Research Objective
            </label>
            <textarea
              id="report-objective"
              onChange={(event) => setResearchObjective(event.target.value)}
              rows={3}
              value={researchObjective}
            />

            <label className="field-label" htmlFor="report-question">
              Confirmed Question
            </label>
            <textarea
              id="report-question"
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              rows={3}
              value={confirmedQuestion}
            />

            <div className="control-row">
              <select
                onChange={(event) => setReportDataset(event.target.value)}
                value={reportDataset}
              >
                <option value="">Select dataset...</option>
                {datasets.map((dataset) => (
                  <option key={dataset.filename} value={dataset.filename}>
                    {dataset.filename}
                  </option>
                ))}
              </select>
              <button
                disabled={reportBusy}
                onClick={handleReportGeneration}
                type="button"
              >
                Generate Report
              </button>
            </div>

            <label className="field-label" htmlFor="report-selected-variables">
              Selected Variables JSON
            </label>
            <textarea
              className="code-textarea"
              id="report-selected-variables"
              onChange={(event) => setSelectedVariablesJson(event.target.value)}
              rows={6}
              value={selectedVariablesJson}
            />

            <label className="field-label" htmlFor="report-roles-json">
              Role Recommendations JSON
            </label>
            <textarea
              className="code-textarea"
              id="report-roles-json"
              onChange={(event) => setRoleRecommendationsJson(event.target.value)}
              rows={6}
              value={roleRecommendationsJson}
            />

            <label className="field-label" htmlFor="report-graph-json">
              Graph JSON
            </label>
            <textarea
              className="code-textarea"
              id="report-graph-json"
              onChange={(event) => setIdentificationGraphJson(event.target.value)}
              rows={7}
              value={identificationGraphJson}
            />

            <label className="field-label" htmlFor="report-identification-json">
              Identification Result JSON
            </label>
            <textarea
              className="code-textarea"
              id="report-identification-json"
              onChange={(event) => setIdentificationResultJson(event.target.value)}
              rows={7}
              value={identificationResultJson}
            />

            <label className="field-label" htmlFor="report-strategy-json">
              Analysis Strategy JSON
            </label>
            <textarea
              className="code-textarea"
              id="report-strategy-json"
              onChange={(event) => setStrategyResultJson(event.target.value)}
              rows={7}
              value={strategyResultJson}
            />

            <label className="field-label" htmlFor="report-assumptions-json">
              Assumptions Review JSON
            </label>
            <textarea
              className="code-textarea"
              id="report-assumptions-json"
              onChange={(event) => setAssumptionReviewJson(event.target.value)}
              rows={7}
              value={assumptionReviewJson}
            />

            <label className="field-label" htmlFor="report-notes">
              User Notes
            </label>
            <textarea
              id="report-notes"
              onChange={(event) => setReportUserNotes(event.target.value)}
              rows={3}
              value={reportUserNotes}
            />

            <p className="stage-note">
              PDF export will be added later. This version generates a
              structured JSON report.
            </p>

            <StatusMessage error={reportError} message={reportMessage} />

            {reportResult && (
              <section className="validation-summary">
                <div>
                  <strong>{reportResult.report_type}</strong>
                  <span>Report Type</span>
                </div>
                <div>
                  <strong>{reportResult.claim_audit.status}</strong>
                  <span>Claim Audit</span>
                </div>
                <p>{reportResult.what_cannot_be_claimed}</p>
              </section>
            )}

            {reportResult && (
              <section className="role-section">
                <h3>{reportResult.report_title}</h3>
                <div className="variable-card">
                  <dl>
                    <dt>Final Question</dt>
                    <dd>{reportResult.final_research_question}</dd>
                    <dt>Exposure</dt>
                    <dd>{reportResult.exposure ?? "Not specified"}</dd>
                    <dt>Outcome</dt>
                    <dd>{reportResult.outcome ?? "Not specified"}</dd>
                    <dt>Time Window</dt>
                    <dd>{reportResult.time_window}</dd>
                    <dt>Unit</dt>
                    <dd>{reportResult.unit_of_analysis}</dd>
                    <dt>Adjustment</dt>
                    <dd>{reportResult.adjustment_set.join(", ") || "None"}</dd>
                  </dl>
                </div>
              </section>
            )}

            {reportResult && (
              <section className="role-section">
                <h3>Dataset and Feasibility</h3>
                <div className="schema-summary">
                  <div>
                    <strong>
                      {String(reportResult.dataset_summary.number_of_rows ?? "n/a")}
                    </strong>
                    <span>Rows</span>
                  </div>
                  <div>
                    <strong>
                      {String(reportResult.dataset_summary.number_of_columns ?? "n/a")}
                    </strong>
                    <span>Columns</span>
                  </div>
                  <div>
                    <strong>
                      {String(
                        reportResult.data_feasibility_summary
                          ?.feasibility_status ?? "not provided",
                      )}
                    </strong>
                    <span>Feasibility</span>
                  </div>
                  <div>
                    <strong>
                      {String(
                        reportResult.data_feasibility_summary
                          ?.safe_to_continue_to_graph ?? "not provided",
                      )}
                    </strong>
                    <span>Safe To Graph</span>
                  </div>
                </div>
              </section>
            )}

            {reportResult && (
              <section className="role-section">
                <h3>Causal Role Table</h3>
                <div className="candidate-list">
                  {reportResult.causal_role_table.map((role, index) => (
                    <article className="variable-card" key={`report-role-${index}`}>
                      <strong>{String(role.variable_name ?? "Variable")}</strong>
                      <p>{String(role.primary_role ?? "Role not specified")}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {reportResult && (
              <section className="role-section">
                <h3>Identification, Strategy, and Assumptions</h3>
                <div className="graph-draft-grid">
                  <article className="variable-card">
                    <strong>Identification</strong>
                    <p>
                      {String(
                        reportResult.identification_assessment
                          .identification_status ?? "not specified",
                      )}
                    </p>
                  </article>
                  <article className="variable-card">
                    <strong>Graph</strong>
                    <p>
                      {String(
                        reportResult.final_causal_graph_summary.validation_status ??
                          "not provided",
                      )}
                    </p>
                  </article>
                  <article className="variable-card">
                    <strong>Sensitivity Plan</strong>
                    <p>{reportResult.sensitivity_plan.join("; ")}</p>
                  </article>
                  <article className="variable-card">
                    <strong>Robustness Plan</strong>
                    <p>{reportResult.robustness_plan.join("; ")}</p>
                  </article>
                </div>
              </section>
            )}

            {reportResult && (
              <section className="role-section">
                <h3>Limitations</h3>
                <ul className="warning-list">
                  {reportResult.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>

                <h3>What Can Be Claimed</h3>
                <p className="stage-note">{reportResult.what_can_be_claimed}</p>

                <h3>What Cannot Be Claimed</h3>
                <p className="stage-note">{reportResult.what_cannot_be_claimed}</p>
              </section>
            )}

            {reportResult && (
              <section className="role-section">
                <h3>Claim Audit Warnings</h3>
                <div className="issue-list">
                  {reportResult.claim_audit.unsafe_claims_found.length === 0 ? (
                    <p>No unsafe claim patterns found.</p>
                  ) : (
                    reportResult.claim_audit.unsafe_claims_found.map(
                      (finding) => (
                        <article
                          className="issue-card"
                          key={finding.unsafe_language}
                        >
                          <strong>{finding.unsafe_language}</strong>
                          <p>{finding.suggested_safe_alternative}</p>
                        </article>
                      ),
                    )
                  )}
                </div>

                <h3>Recommended Next Steps</h3>
                <ul className="warning-list">
                  {reportResult.recommended_next_steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
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
          <strong>Step {activeStep}: {workflowSteps[activeStep - 1].shortLabel}</strong>
          <p>{stepGuidance.purpose}</p>
        </div>

        <div className="assistant-message">
          <strong>What to do</strong>
          <p>{stepGuidance.action}</p>
          <strong>Key caution</strong>
          <p>{stepGuidance.caution}</p>
          <strong>Required to proceed</strong>
          <p>{stepGuidance.requirement}</p>
        </div>

        <div className="chip-row">
          <button type="button">Data First</button>
          <button type="button">Human Review</button>
          <button type="button">No Proven Effects</button>
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
