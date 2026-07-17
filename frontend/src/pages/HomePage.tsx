import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  getIngestionStatus,
  ingestDocuments,
  listDocuments,
  uploadDocument,
} from "../api/documents";
import { getDatasetSchema, listDatasets, uploadDataset } from "../api/datasets";
import { runBroadExploration, runTargetedFeasibility } from "../api/exploration";
import { chatWithAssistant } from "../api/assistant";
import { searchRag } from "../api/rag";
import { generateCausalQuestions } from "../api/causalQuestions";
import { recommendCandidateVariables } from "../api/candidateVariables";
import { recommendAndValidateRoles } from "../api/causalRoles";
import { generateAndValidateGraph, validateEditedGraph } from "../api/causalGraph";
import { runIdentificationCheck } from "../api/identification";
import { generateAnalysisStrategy } from "../api/analysisStrategy";
import { reviewAssumptions } from "../api/assumptions";
import { generateReport } from "../api/reports";
import { CausalGraphCanvas } from "../components/CausalGraphCanvas";
import type {
  AnalysisStrategyResponse,
  AssumptionReviewResponse,
  BackendCausalGraphValidation,
  BackendCausalRoleValidation,
  BroadExplorationResponse,
  CandidateCausalQuestion,
  CandidateVariableRecommendation,
  CausalGraphDraft,
  CausalRoleRecommendation,
  DatasetSchemaResponse,
  IdentificationCheckResponse,
  IngestionStatusResponse,
  MissingnessItem,
  RagSearchResult,
  ReportGenerationResponse,
  SelectedCausalVariable,
  TargetedFeasibilityResponse,
  UploadedDataset,
  UploadedDocument,
} from "../types/api";

type PageId =
  | "home"
  | "data"
  | "explore"
  | "causal"
  | "temporal"
  | "review"
  | "clinician";

type AssistantMessage = {
  role: "assistant" | "user";
  text: string;
  sources?: string[];
};

type UploadStatus =
  | "Not uploaded"
  | "Uploading / reviewing"
  | "Uploaded & validated"
  | "Needs clarification"
  | "Incorrect file type";

type DocumentCategory = "data_dictionary" | "protocol" | "research_paper";

const demoObjective =
  "I want to study temporal relationships between sleep, stress, and next-day alcohol use.";

const demoQuestion =
  "Among adults in the uploaded EMA/passive sensing dataset, what is the effect of sleep-related features during window t on alcohol-use-related label during the next observation window?";

const demoVariables = [
  "pid",
  "label",
  "time_stamp",
  "time_of_day",
  "day_of_week",
  "acc_min_magnitude",
  "acc_max_magnitude",
  "acc_mean_magnitude",
  "avg_latitude",
];

const navItems: Array<{
  id: PageId;
  label: string;
  icon: string;
  disabled?: boolean;
}> = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "data", label: "Data Foundation", icon: "▤" },
  { id: "explore", label: "Explore", icon: "Ⅱ" },
  { id: "causal", label: "Causal Studio", icon: "⌁" },
  { id: "temporal", label: "Estimator", icon: "◷" },
  { id: "review", label: "Review & Report", icon: "▣" },
  { id: "clinician", label: "Clinician Reference", icon: "□", disabled: true },
];

const pageCopy: Record<PageId, { title: string; subtitle: string; assistant: string }> = {
  home: {
    title: "Project Setup",
    subtitle:
      "Upload your study documents below — each one has its own purpose, so they’re reviewed separately.",
    assistant:
      "Welcome to your Causal Design workspace. You’re on the Home page. Here’s a quick guide to what you’re looking at. The top timeline shows the workflow: Project Setup → Data Foundation → Explore → Causal Studio → Estimator → Review & Report. The left panel is navigation. The center panel is your active workspace. I’ll help check whether your study materials are complete enough to continue. Let’s start with your Study Dataset — upload the raw CSV, JSON, or TSV file from your study.",
  },
  data: {
    title: "Data Foundation",
    subtitle: "Upload datasets, define variables, and establish linking keys",
    assistant:
      "I see your dataset schema has been loaded. I’m checking ID fields, timestamps, variable types, missingness, and possible proxy variables before you move to broad exploration. Variable labels here are provisional. They help organize the dataset, but causal roles are not final until Causal Studio graph validation.",
  },
  explore: {
    title: "Explore",
    subtitle: "Broad data exploration before causal question finalization",
    assistant:
      "Explore mode helps you inspect broad patterns, missingness, coverage, temporal structure, and participant-level variation before finalizing a causal question. Select a dataset and run broad exploration. I will summarize data quality issues and possible patterns, but I will not treat them as causal evidence.",
  },
  causal: {
    title: "Causal Studio",
    subtitle: "Build your causal model — DAG construction, variable roles, assumption checking",
    assistant:
      "Build the causal model by refining the research question, selecting variables, validating roles, and generating a draft DAG.",
  },
  temporal: {
    title: "Temporal & Estimation Planner",
    subtitle: "Define time windows, verify temporal ordering, plan estimation strategy",
    assistant:
      "Temporal ordering is central. Confirm exposure timing, lag, outcome window, identification, and strategy guidance.",
  },
  review: {
    title: "Review & Export",
    subtitle: "Audit claims, verify evidence, and prepare for review",
    assistant:
      "Review the analysis story and claim auditor. Unsafe causal or predictive claims should be rewritten before export.",
  },
  clinician: {
    title: "Clinician Reference",
    subtitle: "Locked reference workspace for future guideline review",
    assistant: "This reference workspace is locked for now.",
  },
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDatasetBaseName(filename: string) {
  return filename.replace(/_\w{24,}(?=\.csv$)/, "");
}

function getIssueText(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

function pickColumns(schema: DatasetSchemaResponse | null) {
  if (!schema) return demoVariables;
  const preferred = demoVariables.filter((column) =>
    schema.column_names.includes(column),
  );
  return preferred.length > 0 ? preferred : schema.column_names.slice(0, 9);
}

function buildSelectedVariables(schema: DatasetSchemaResponse | null): SelectedCausalVariable[] {
  return pickColumns(schema).map((variable) => ({
    variable_name: variable,
    source_field: variable,
    data_category: variable.includes("time")
      ? "temporal_context"
      : variable === "pid"
        ? "participant_identifier"
        : variable.includes("acc")
          ? "passive_sensing"
          : "dataset_column",
    measurement_timing: variable.includes("time") ? "time/context field" : "observed",
  }));
}

function inferVariableRows(schema: DatasetSchemaResponse | null) {
  const demoMeanings: Record<string, { source: string; meaning: string; tag: string }> = {
    pid: {
      source: "All Datasets",
      meaning: "Unique participant ID",
      tag: "Linking Key",
    },
    time_stamp: {
      source: "All Datasets",
      meaning: "Observation timestamp",
      tag: "Linking Key / Timestamp",
    },
    time_of_day: {
      source: "Temporal",
      meaning: "Time of day indicator",
      tag: "Temporal",
    },
    day_of_week: {
      source: "Temporal",
      meaning: "Day of week indicator",
      tag: "Temporal",
    },
    label: {
      source: "Outcome-like field",
      meaning: "Label / candidate outcome",
      tag: "Outcome Candidate",
    },
    acc_min_magnitude: {
      source: "Passive Sensing / Actigraphy",
      meaning: "Minimum accelerometer magnitude",
      tag: "Sensor Feature",
    },
    acc_max_magnitude: {
      source: "Passive Sensing / Actigraphy",
      meaning: "Maximum accelerometer magnitude",
      tag: "Sensor Feature",
    },
    acc_mean_magnitude: {
      source: "Passive Sensing / Actigraphy",
      meaning: "Mean accelerometer magnitude",
      tag: "Sensor Feature",
    },
    avg_latitude: {
      source: "GPS / Mobility",
      meaning: "Average latitude",
      tag: "Proxy / Missingness Warning",
    },
  };
  const columns = schema
    ? [
        ...Object.keys(demoMeanings).filter((column) =>
          schema.column_names.includes(column),
        ),
        ...schema.column_names.filter((column) => !demoMeanings[column]).slice(0, 12),
      ]
    : Object.keys(demoMeanings);

  return columns.slice(0, 18).map((column) => {
    if (demoMeanings[column]) {
      return { variable: column, ...demoMeanings[column] };
    }
    const lower = column.toLowerCase();
    const tag = lower.includes("time") || lower.includes("day")
      ? "Temporal"
      : lower.includes("id") || lower === "pid"
        ? "Linking Key"
        : lower.includes("lat") || lower.includes("long") || lower.includes("gps")
          ? "Proxy"
          : lower.includes("acc") || lower.includes("magnitude")
            ? "Sensor Feature"
            : "Needs Review";
    return {
      variable: column,
      source: tag === "Needs Review" ? "Inferred" : "Dataset schema",
      meaning: schema?.pandas_data_types[column]
        ? `Inferred from column name and dtype ${schema.pandas_data_types[column]}`
        : "Inferred from column name",
      tag,
    };
  });
}

export function HomePage() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [datasets, setDatasets] = useState<UploadedDataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [dictionaryFile, setDictionaryFile] = useState<File | null>(null);
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [paperFiles, setPaperFiles] = useState<File[]>([]);
  const [datasetStatus, setDatasetStatus] = useState<UploadStatus>("Not uploaded");
  const [dictionaryStatus, setDictionaryStatus] =
    useState<UploadStatus>("Not uploaded");
  const [protocolStatus, setProtocolStatus] = useState<UploadStatus>("Not uploaded");
  const [papersStatus, setPapersStatus] = useState<UploadStatus>("Not uploaded");
  const [datasetSummary, setDatasetSummary] = useState("");
  const [dictionarySummary, setDictionarySummary] = useState("");
  const [protocolSummary, setProtocolSummary] = useState("");
  const [papersSummary, setPapersSummary] = useState("");
  const [dataFoundationRagSummary, setDataFoundationRagSummary] = useState("");
  const [documentCategories, setDocumentCategories] = useState<
    Record<string, DocumentCategory>
  >({});
  const [schema, setSchema] = useState<DatasetSchemaResponse | null>(null);
  const [ingestionStatus, setIngestionStatus] = useState<IngestionStatusResponse | null>(null);
  const [broadExploration, setBroadExploration] =
    useState<BroadExplorationResponse | null>(null);
  const [promotedPatterns, setPromotedPatterns] = useState<string[]>([]);
  const [exploreRagSummary, setExploreRagSummary] = useState("");
  const [targetedFeasibility, setTargetedFeasibility] =
    useState<TargetedFeasibilityResponse | null>(null);
  const [causalEvidenceSummary, setCausalEvidenceSummary] = useState("");
  const [temporalRagSummary, setTemporalRagSummary] = useState("");
  const [researchObjective, setResearchObjective] = useState(demoObjective);
  const [confirmedQuestion, setConfirmedQuestion] = useState(demoQuestion);
  const [candidateQuestions, setCandidateQuestions] = useState<CandidateCausalQuestion[]>([]);
  const [candidateVariables, setCandidateVariables] = useState<
    CandidateVariableRecommendation[]
  >([]);
  const [roleRecommendations, setRoleRecommendations] = useState<
    CausalRoleRecommendation[]
  >([]);
  const [roleValidation, setRoleValidation] =
    useState<BackendCausalRoleValidation | null>(null);
  const [graphDraft, setGraphDraft] = useState<CausalGraphDraft | null>(null);
  const [graphValidation, setGraphValidation] =
    useState<BackendCausalGraphValidation | null>(null);
  const [identification, setIdentification] =
    useState<IdentificationCheckResponse | null>(null);
  const [strategy, setStrategy] = useState<AnalysisStrategyResponse | null>(null);
  const [assumptions, setAssumptions] = useState<AssumptionReviewResponse | null>(null);
  const [report, setReport] = useState<ReportGenerationResponse | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [assistantQuery, setAssistantQuery] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    { role: "assistant", text: pageCopy.home.assistant },
    {
      role: "user",
      text: "What if I don’t have a formal data dictionary — can I just write it out in an email or a note?",
    },
    {
      role: "assistant",
      text: "Yes, that’s fine. A plain text file, Word document, or note is acceptable as long as it explains each column. At minimum, include variable name, meaning, data type, units or range, collection method, and measurement timing.",
    },
  ]);

  const selectedVariables = useMemo(() => buildSelectedVariables(schema), [schema]);
  const adjustmentSet = ["time_of_day", "day_of_week", "avg_latitude"].filter((item) =>
    selectedVariables.some((variable) => variable.variable_name === item),
  );

  useEffect(() => {
    void refreshProjectState();
  }, []);

  async function refreshProjectState() {
    try {
      const [documentResponse, datasetResponse, ingestResponse] = await Promise.all([
        listDocuments(),
        listDatasets(),
        getIngestionStatus(),
      ]);
      setDocuments(documentResponse.documents);
      setDatasets(datasetResponse.datasets);
      setIngestionStatus(ingestResponse);
      if (!selectedDataset && datasetResponse.datasets.length > 0) {
        setSelectedDataset(datasetResponse.datasets[0].filename);
      }
    } catch {
      // The dashboard still renders if the backend is not running.
    }
  }

  function switchPage(pageId: PageId) {
    setActivePage(pageId);
    setAssistantMessages((messages) => [
      ...messages,
      { role: "assistant", text: pageCopy[pageId].assistant },
    ]);
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(label);
    setNotice("");
    setError("");
    try {
      await action();
    } catch (caughtError) {
      setError(getIssueText(caughtError));
    } finally {
      setBusy("");
    }
  }

  function addAssistantMessage(message: AssistantMessage) {
    setAssistantMessages((messages) => [...messages, message]);
  }

  function summarizeSchemaForHome(parsedSchema: DatasetSchemaResponse) {
    const warnings = parsedSchema.warnings
      .slice(0, 3)
      .map((warning) =>
        warning.column
          ? `${warning.column} has ${warning.missing_percentage}% missingness`
          : warning.warning,
      )
      .join("; ");
    const idColumns = parsedSchema.possible_id_columns.join(", ") || "none detected";
    const timestampColumns =
      parsedSchema.possible_timestamp_date_columns.join(", ") || "none detected";

    return `Rows: ${parsedSchema.number_of_rows.toLocaleString()} | Columns: ${parsedSchema.number_of_columns} | Possible IDs: ${idColumns} | Timing fields: ${timestampColumns}${warnings ? ` | Missingness: ${warnings}` : ""}`;
  }

  function addSchemaAssistantSummary(parsedSchema: DatasetSchemaResponse) {
    const highMissingness = parsedSchema.warnings
      .slice(0, 4)
      .map((warning) =>
        warning.column
          ? `${warning.column} (${warning.missing_percentage}%)`
          : warning.warning,
      )
      .join(", ");
    const sensorColumns = parsedSchema.column_names
      .filter((column) => column.startsWith("acc_") || column.includes("latitude") || column.includes("longitude"))
      .slice(0, 6)
      .join(", ");
    addAssistantMessage({
      role: "assistant",
      text: `Schema summary: ${parsedSchema.number_of_rows.toLocaleString()} rows and ${parsedSchema.number_of_columns} columns. Possible ID columns: ${parsedSchema.possible_id_columns.join(", ") || "none detected"}. Possible timestamp fields: ${parsedSchema.possible_timestamp_date_columns.join(", ") || "none detected"}. High missingness warnings: ${highMissingness || "none detected"}. Possible proxy/sensor variables: ${sensorColumns || "none detected"}. Variable labels here are provisional; causal roles are confirmed later during graph validation.`,
    });
  }

  async function handleDatasetUpload() {
    if (!datasetFile) {
      setError("Choose a CSV dataset first.");
      setDatasetStatus("Needs clarification");
      return;
    }
    if (datasetFile.name.split(".").pop()?.toLowerCase() !== "csv") {
      setDatasetStatus("Incorrect file type");
      setError("Dataset upload currently supports CSV. JSON and TSV are planned formats.");
      return;
    }
    setDatasetStatus("Uploading / reviewing");
    addAssistantMessage({
      role: "assistant",
      text: "Checking this now — confirming it is a valid dataset file, scanning columns and row structure…",
    });
    await runAction("Uploading dataset", async () => {
      const uploaded = await uploadDataset(datasetFile);
      setSelectedDataset(uploaded.saved_filename);
      const parsed = await getDatasetSchema(uploaded.saved_filename);
      setSchema(parsed);
      setDatasetStatus("Uploaded & validated");
      setDatasetSummary(summarizeSchemaForHome(parsed));
      addSchemaAssistantSummary(parsed);
      const warnings =
        parsed.warnings
          .slice(0, 3)
          .map((warning) =>
            warning.column
              ? `${warning.column} has ${warning.missing_percentage}% missingness`
              : warning.warning,
          )
          .join("; ") || "none";
      addAssistantMessage({
        role: "assistant",
        text: `Uploaded and validated. This appears to be a valid dataset: ${parsed.number_of_rows.toLocaleString()} rows and ${parsed.number_of_columns} columns. I detected ${parsed.possible_id_columns.join(", ") || "no obvious ID columns"} as possible participant ID fields and ${parsed.possible_timestamp_date_columns.join(", ") || "no obvious timing fields"} as timing fields. Missingness warnings: ${warnings}.`,
      });
      setNotice(`Dataset uploaded and parsed: ${parsed.number_of_rows} rows, ${parsed.number_of_columns} columns.`);
      setDatasetFile(null);
      await refreshProjectState();
    });
  }

  async function handleSchemaParse() {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Parsing schema", async () => {
      const parsed = await getDatasetSchema(selectedDataset);
      setSchema(parsed);
      addSchemaAssistantSummary(parsed);
      setNotice(`Schema parsed: ${parsed.number_of_rows} rows and ${parsed.number_of_columns} columns.`);
    });
  }

  async function handleDataFoundationRagCheck() {
    await runAction("Checking dictionary evidence", async () => {
      const response = await searchRag(
        "data dictionary variable names units measurement timing participant ID timestamp data type possible values",
        5,
      );
      if (response.results.length === 0) {
        setDataFoundationRagSummary(
          "I could not find supporting schema details in the uploaded documents.",
        );
        addAssistantMessage({
          role: "assistant",
          text: "I could not find supporting schema details in the uploaded documents. Schema parsing and deterministic checks are still available.",
        });
        return;
      }
      const sources = response.results
        .map((result) => result.source_filename)
        .filter((value): value is string => Boolean(value));
      setDataFoundationRagSummary(
        `Found ${response.number_of_results} supporting RAG chunk(s): ${Array.from(new Set(sources)).slice(0, 3).join(", ") || "uploaded documents"}.`,
      );
      addAssistantMessage({
        role: "assistant",
        text: `RAG schema check found ${response.number_of_results} supporting evidence chunk(s). I will show retrieved sources, but I will not invent meanings if evidence is incomplete. LLM explanation is unavailable if the API key is not configured, but schema parsing and deterministic checks are still available.`,
        sources,
      });
    });
  }

  function handleDataFoundationPrompt(prompt: string) {
    if (!schema) {
      addAssistantMessage({
        role: "assistant",
        text: "Parse a dataset schema first, then I can summarize IDs, timestamps, missingness, and fields needing clarification.",
      });
      return;
    }
    if (prompt === "Suggest variable tags") {
      addAssistantMessage({
        role: "assistant",
        text: `Suggested provisional tags: ${inferVariableRows(schema).slice(0, 8).map((row) => `${row.variable}: ${row.tag}`).join("; ")}. These are for organization only, not final causal roles.`,
      });
    } else if (prompt === "Explain missingness") {
      addAssistantMessage({
        role: "assistant",
        text: `High-missingness fields need review before broad exploration: ${schema.warnings.slice(0, 5).map((warning) => warning.column ? `${warning.column} (${warning.missing_percentage}%)` : warning.warning).join(", ") || "none detected"}.`,
      });
    } else if (prompt === "What is a linking key?") {
      addAssistantMessage({
        role: "assistant",
        text: `A linking key connects records across files or time. In this schema, possible ID keys are ${schema.possible_id_columns.join(", ") || "not detected"}, and timing fields are ${schema.possible_timestamp_date_columns.join(", ") || "not detected"}.`,
      });
    } else {
      addAssistantMessage({
        role: "assistant",
        text: `Fields needing clarification include high-missingness columns, inferred proxy fields, and any variable without dictionary evidence. Start with: ${schema.warnings.slice(0, 4).map((warning) => warning.column || warning.warning).join(", ") || "no obvious warnings from schema parsing"}.`,
      });
    }
  }

  async function handleDocumentUpload() {
    if (!documentFile) {
      setError("Choose a PDF, DOCX, or TXT document first.");
      return;
    }
    await runAction("Uploading document", async () => {
      await uploadDocument(documentFile);
      setDocumentFile(null);
      await refreshProjectState();
      setNotice("Document uploaded. Run ingestion to add it to the RAG knowledge base.");
    });
  }

  async function handleHomeDocumentUpload(
    file: File | null,
    category: DocumentCategory,
    setStatus: (status: UploadStatus) => void,
    setSummary: (summary: string) => void,
  ) {
    if (!file) {
      setStatus("Needs clarification");
      setError("Choose a document first.");
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    const allowed =
      category === "research_paper"
        ? extension === "pdf"
        : extension === "pdf" || extension === "docx" || extension === "txt";
    if (!allowed) {
      setStatus("Incorrect file type");
      setError(
        category === "research_paper"
          ? "Related research papers currently accept PDF files."
          : "Project documents accept PDF, DOCX, or TXT files.",
      );
      return;
    }

    setStatus("Uploading / reviewing");
    await runAction("Uploading document", async () => {
      const uploaded = await uploadDocument(file);
      setDocumentCategories((categories) => ({
        ...categories,
        [uploaded.saved_filename]: category,
      }));
      const ingestion = await ingestDocuments();
      const ingestStatus = await getIngestionStatus();
      setIngestionStatus(ingestStatus);
      await refreshProjectState();

      if (category === "data_dictionary") {
        const ragCheck = await searchRag(
          "variable names data types units possible values ranges collection method measurement timing participant ID timestamp",
          5,
        );
        if (ragCheck.results.length > 0) {
          setStatus("Uploaded & validated");
          setSummary(
            `Uploaded, ingested, and checked with RAG. Found ${ragCheck.number_of_results} relevant evidence chunks. ChromaDB now stores ${ingestStatus.stored_chunks ?? ingestion.chunks_created} chunks.`,
          );
          addAssistantMessage({
            role: "assistant",
            text: "Uploaded and validated. I found supporting schema details in the ingested documents. Review the retrieved evidence before moving forward; I will not invent document details.",
            sources: ragCheck.results
              .map((result) => result.source_filename)
              .filter((value): value is string => Boolean(value)),
          });
        } else {
          setStatus("Needs clarification");
          setSummary("Uploaded and ingested, but the RAG check found no supporting schema details.");
          addAssistantMessage({
            role: "assistant",
            text: "I could not find supporting details in the uploaded documents. Please clarify variable names, data types, units/ranges, collection method, measurement timing, participant ID, and timestamp fields.",
          });
        }
      } else {
        setStatus("Uploaded & validated");
        setSummary(
          `Uploaded and ingested for later RAG use. ChromaDB stores ${ingestStatus.stored_chunks ?? ingestion.chunks_created} chunks.`,
        );
        addAssistantMessage({
          role: "assistant",
          text:
            category === "protocol"
              ? "Protocol uploaded and ingested. I’ll use it later for research goal, population, design context, assumptions, and report citations."
              : "Related paper uploaded and ingested. I’ll use it later as RAG evidence for candidate variables, graph rationale, assumptions, and report citations.",
        });
      }
    });
  }

  async function handleIngestDocuments() {
    await runAction("Ingesting documents", async () => {
      const result = await ingestDocuments();
      await refreshProjectState();
      setNotice(`Ingested ${result.files_processed} files into ${result.chunks_created} chunks.`);
    });
  }

  async function handleHomePapersUpload() {
    if (paperFiles.length === 0) {
      setPapersStatus("Needs clarification");
      setError("Choose at least one PDF research paper.");
      return;
    }
    setPapersStatus("Uploading / reviewing");
    for (const paper of paperFiles) {
      await handleHomeDocumentUpload(
        paper,
        "research_paper",
        setPapersStatus,
        setPapersSummary,
      );
    }
    setPaperFiles([]);
  }

  function handleSubmitProjectDetails() {
    const missing = [];
    if (datasetStatus !== "Uploaded & validated") {
      missing.push("Study Dataset");
      setDatasetStatus("Needs clarification");
    }
    if (dictionaryStatus !== "Uploaded & validated") {
      missing.push("Data Dictionary / Schema");
      setDictionaryStatus("Needs clarification");
    }
    if (missing.length > 0) {
      const message = `Missing required setup item${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
      setError(message);
      addAssistantMessage({
        role: "assistant",
        text: `${message} Upload these before moving to Data Foundation.`,
      });
      return;
    }
    if (!ingestionStatus?.chroma_exists || !ingestionStatus.stored_chunks) {
      const message = "Required files are uploaded, but documents need to be ingested before Data Foundation.";
      setError(message);
      addAssistantMessage({ role: "assistant", text: message });
      return;
    }
    setError("");
    setNotice("Project setup is ready for Data Foundation.");
    addAssistantMessage({
      role: "assistant",
      text: "Project setup is ready for Data Foundation. This setup stage checked file completeness and study context only; causal validity is checked later by deterministic backend validation.",
    });
  }

  async function handleBroadExplore() {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Running broad exploration", async () => {
      const result = await runBroadExploration({
        datasetFilename: selectedDataset,
        targetColumn: schema?.column_names.includes("label") ? "label" : undefined,
        participantIdColumn: schema?.possible_id_columns[0],
        timestampColumn: schema?.possible_timestamp_date_columns[0],
      });
      setBroadExploration(result);
      setNotice("Broad exploration complete. Treat findings as observational.");
      const missingness = result.high_missingness_columns
        .slice(0, 3)
        .map((item) => `${item.column} (${item.missing_percentage}%)`)
        .join(", ");
      addAssistantMessage({
        role: "assistant",
        text: `I found ${result.number_of_rows.toLocaleString()} rows and ${result.number_of_columns} columns. ${result.possible_id_columns.join(", ") || "No clear participant ID"} appears to identify participants, and ${result.possible_timestamp_columns.join(", ") || "no clear timestamp fields"} describe timing. ${missingness ? `${missingness} has substantial missingness, so related exploratory patterns need caution. ` : ""}These patterns are exploratory and do not establish causality.`,
      });
    });
  }

  function handlePromotePattern(pattern: string) {
    setPromotedPatterns((current) =>
      current.includes(pattern) ? current : [...current, pattern],
    );
    setNotice("Promoted to Causal Studio as a hypothesis candidate, not as causal evidence.");
    addAssistantMessage({
      role: "assistant",
      text: "Promoted to Causal Studio as a hypothesis candidate, not as causal evidence. This still needs later causal question design, role review, graph validation, and assumption checking.",
    });
  }

  function handleExplorePrompt(prompt: string) {
    if (!broadExploration) {
      addAssistantMessage({
        role: "assistant",
        text: "Run broad exploration first. I can then summarize missingness, detected timing fields, participant-level structure, and safe-to-promote descriptive patterns.",
      });
      return;
    }

    if (prompt === "Explain missingness") {
      const missing = broadExploration.high_missingness_columns
        .slice(0, 5)
        .map((item) => `${item.column}: ${item.missing_percentage}%`)
        .join("; ");
      addAssistantMessage({
        role: "assistant",
        text: missing
          ? `High missingness means those variables may have incomplete coverage. In this dataset: ${missing}. Review whether missingness is systematic before using those variables in later causal design.`
          : "I do not see major high-missingness fields in the broad exploration result, but this still does not establish causality.",
      });
    } else if (prompt === "What patterns are safe to promote?") {
      addAssistantMessage({
        role: "assistant",
        text: "Safe patterns to promote are descriptive hypotheses, such as repeated missingness, time-of-day structure, participant-level variation, or associations worth reviewing. Do not promote them as causal evidence.",
      });
    } else if (prompt === "Why is this not causal?") {
      addAssistantMessage({
        role: "assistant",
        text: "This page summarizes observational patterns only. Without a finalized causal question, temporal ordering, graph assumptions, adjustment strategy, and deterministic validation, these patterns cannot prove an effect.",
      });
    } else {
      const groups = Object.entries(broadExploration.sensor_or_feature_groups)
        .filter(([, columns]) => columns.length > 0)
        .slice(0, 4)
        .map(([group, columns]) => `${group}: ${columns.slice(0, 3).join(", ")}`)
        .join("; ");
      addAssistantMessage({
        role: "assistant",
        text: groups
          ? `Useful domains to inspect next include ${groups}. Treat these as broad data domains, not final causal roles.`
          : "Start by inspecting ID fields, timestamps, outcome-like labels, missingness-heavy fields, and sensor feature groups.",
      });
    }
  }

  async function handleExploreRagCaution() {
    await runAction("Searching RAG evidence", async () => {
      const response = await searchRag(
        "exploratory data analysis observational patterns do not establish causality missingness wearable EMA passive sensing",
        5,
      );
      if (response.results.length === 0) {
        setExploreRagSummary("I could not find supporting details in uploaded documents.");
        addAssistantMessage({
          role: "assistant",
          text: "I could not find supporting details in uploaded documents. Explore remains descriptive only, and schema/broad exploration checks are still available.",
        });
        return;
      }
      const sources = response.results
        .map((result) => result.source_filename)
        .filter((value): value is string => Boolean(value));
      setExploreRagSummary(
        `Found ${response.number_of_results} RAG chunk(s) about exploration caution from ${Array.from(new Set(sources)).slice(0, 3).join(", ") || "uploaded documents"}.`,
      );
      addAssistantMessage({
        role: "assistant",
        text: `RAG found ${response.number_of_results} supporting chunk(s) about exploratory caution. I will use these as evidence snippets only and will not invent causal claims from them.`,
        sources,
      });
    });
  }

  async function handleGenerateQuestions() {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Generating questions", async () => {
      const result = await generateCausalQuestions({
        researchObjective,
        datasetFilename: selectedDataset,
        topKEvidence: 5,
      });
      setCandidateQuestions(result.candidates);
      setConfirmedQuestion(result.candidates[0]?.question_text ?? confirmedQuestion);
      setNotice(`Generated ${result.candidates.length} candidate questions.`);
    });
  }

  async function handleRecommendVariables() {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Recommending variables", async () => {
      const result = await recommendCandidateVariables({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        topKEvidence: 5,
      });
      const variables = Object.values(result.variable_groups).flat();
      setCandidateVariables(variables);
      setNotice(`Recommended ${variables.length} candidate variables.`);
    });
  }

  async function handleTargetedFeasibility({
    exposure,
    outcome,
    timeWindow,
  }: {
    exposure?: string;
    outcome?: string;
    timeWindow?: string;
  }) {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Checking targeted feasibility", async () => {
      const result = await runTargetedFeasibility({
        datasetFilename: selectedDataset,
        confirmedQuestion,
        selectedVariables,
        exposure,
        outcome,
        participantIdColumn: schema?.possible_id_columns[0],
        timestampColumn: schema?.possible_timestamp_date_columns[0],
        timeWindow,
        lagDefinition: timeWindow,
        topKEvidence: 5,
      });
      setTargetedFeasibility(result);
      setNotice(`Feasibility check complete: ${result.feasibility_status}.`);
      addAssistantMessage({
        role: "assistant",
        text: `Targeted feasibility status: ${result.feasibility_status}. Selected variables are checked for missingness, participant structure, timing, and overlap. This is design guidance only, not an effect estimate.`,
      });
    });
  }

  async function handleValidateRoles() {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Validating roles", async () => {
      const roleResult = await recommendAndValidateRoles({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        selectedVariables,
        topKEvidence: 5,
      });
      setRoleRecommendations(roleResult.role_recommendations);
      setRoleValidation(roleResult.backend_validation);
      setNotice(`Role validation: ${roleResult.backend_validation.validation_status}.`);
      addAssistantMessage({
        role: "assistant",
        text: `Role validation finished with status ${roleResult.backend_validation.validation_status}. Variables such as participant IDs should support grouping, not be treated as causal exposures or outcomes.`,
      });
    });
  }

  async function handleValidateRolesAndGraph() {
    if (!selectedDataset) {
      setError("Select a dataset first.");
      return;
    }
    await runAction("Validating roles and graph", async () => {
      const roleResult = await recommendAndValidateRoles({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        selectedVariables,
        topKEvidence: 5,
      });
      setRoleRecommendations(roleResult.role_recommendations);
      setRoleValidation(roleResult.backend_validation);

      const graphResult = await generateAndValidateGraph({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        selectedVariables,
        roleRecommendations: roleResult.role_recommendations,
        topKEvidence: 5,
      });
      setGraphDraft(graphResult.graph_draft);
      setGraphValidation(graphResult.backend_validation);
      setNotice("Draft graph generated. Review edges as assumptions, not proven effects.");
    });
  }

  async function handleValidateEditedGraph() {
    if (!selectedDataset || !graphDraft) {
      setError("Generate a graph first.");
      return;
    }
    await runAction("Validating edited graph", async () => {
      const graphResult = await validateEditedGraph({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graphDraft,
        selectedVariables,
        roleRecommendations,
      });
      setGraphDraft(graphResult.graph_draft);
      setGraphValidation(graphResult.backend_validation);
      setNotice(`Graph validation: ${graphResult.backend_validation.graph_validation_status}.`);
      addAssistantMessage({
        role: "assistant",
        text: `Edited graph validation returned ${graphResult.backend_validation.graph_validation_status}. Edges remain assumptions and must be reviewed before identification or analysis planning.`,
      });
    });
  }

  async function handleCausalRagEvidence({
    exposure,
    outcome,
  }: {
    exposure?: string;
    outcome?: string;
  }) {
    await runAction("Retrieving causal design evidence", async () => {
      const query = [
        confirmedQuestion,
        exposure,
        outcome,
        selectedVariables.map((variable) => variable.variable_name).join(" "),
        "causal graph variable role exposure outcome mediator confounder proxy temporal ordering",
      ]
        .filter(Boolean)
        .join(" ");
      const response = await searchRag(query, 5);
      if (response.results.length === 0) {
        setCausalEvidenceSummary("I could not find supporting evidence in the uploaded documents.");
        addAssistantMessage({
          role: "assistant",
          text: "I could not find supporting evidence in the uploaded documents. Do not infer evidence for candidate roles or edges.",
        });
        return;
      }
      const sources = response.results
        .map((result) => result.source_filename)
        .filter((value): value is string => Boolean(value));
      setCausalEvidenceSummary(
        `Retrieved ${response.number_of_results} evidence chunk(s) from ${Array.from(new Set(sources)).slice(0, 3).join(", ") || "uploaded documents"}. Evidence can support design discussion, not causal proof.`,
      );
      addAssistantMessage({
        role: "assistant",
        text: `Retrieved ${response.number_of_results} RAG chunk(s). Use them as references for candidate variables or assumptions only; they do not prove graph edges are causal.`,
        sources,
      });
    });
  }

  function handleCausalPrompt(prompt: string) {
    const responses: Record<string, string> = {
      "What is the exposure?":
        "The exposure is the variable or construct whose effect you want to study. On this page it is provisional until role validation checks timing, measurement, and whether it is not an ID or pure context field.",
      "What could be a confounder?":
        "A confounder is a prior variable that may influence both exposure and outcome. It should usually occur before the exposure and should not be caused by the exposure.",
      "Is this a mediator or collider?":
        "A mediator lies on a possible pathway from exposure to outcome. A collider is caused by two variables and should usually not be adjusted for without careful justification.",
      "Why does graph validation matter?":
        "Graph validation checks for design problems such as ID variables used as causal nodes, timing conflicts, cycles, missing outcomes, and unsafe claims. It does not prove the graph is true.",
    };
    addAssistantMessage({
      role: "assistant",
      text: responses[prompt] ?? "This page designs a causal model. It does not estimate effects or prove causal relationships.",
    });
  }

  async function handleStrategy() {
    if (!selectedDataset || !graphDraft || roleRecommendations.length === 0) {
      setError("Generate the graph and role recommendations first.");
      return;
    }
    await runAction("Checking strategy", async () => {
      const idResult = await runIdentificationCheck({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graph: graphDraft,
        roleRecommendations,
        userAdjustmentSet: adjustmentSet,
      });
      setIdentification(idResult);
      const strategyResult = await generateAnalysisStrategy({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graph: graphDraft,
        roleRecommendations,
        identificationResult: idResult,
        exposure: "acc_mean_magnitude",
        outcome: "label",
        adjustmentSet,
      });
      setStrategy(strategyResult);
      const assumptionResult = await reviewAssumptions({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graph: graphDraft,
        roleRecommendations,
        identificationResult: idResult,
        analysisStrategy: strategyResult.strategy_plan,
        exposure: "acc_mean_magnitude",
        outcome: "label",
        adjustmentSet,
      });
      setAssumptions(assumptionResult);
      setNotice("Identification, strategy, and assumptions guidance generated.");
    });
  }

  async function handleIdentificationCheck() {
    if (!selectedDataset || !graphDraft || roleRecommendations.length === 0) {
      setError("Generate and validate a graph with role recommendations before identification.");
      return;
    }
    await runAction("Checking identification", async () => {
      const idResult = await runIdentificationCheck({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graph: graphDraft,
        roleRecommendations,
        userAdjustmentSet: adjustmentSet,
      });
      setIdentification(idResult);
      setNotice(`Identification status: ${idResult.identification_status}.`);
      addAssistantMessage({
        role: "assistant",
        text: `Identification check returned ${idResult.identification_status}. This reviews adjustment and assumptions; it does not estimate a causal effect.`,
      });
    });
  }

  async function handleAnalysisStrategy({
    exposure,
    outcome,
    estimandType,
  }: {
    exposure?: string;
    outcome?: string;
    estimandType?: string;
  }) {
    if (!selectedDataset || !graphDraft || roleRecommendations.length === 0) {
      setError("Generate the graph and role recommendations first.");
      return;
    }
    await runAction("Generating analysis strategy", async () => {
      const idResult =
        identification ??
        (await runIdentificationCheck({
          confirmedQuestion,
          datasetFilename: selectedDataset,
          graph: graphDraft,
          roleRecommendations,
          userAdjustmentSet: adjustmentSet,
          estimandType,
        }));
      setIdentification(idResult);
      const strategyResult = await generateAnalysisStrategy({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graph: graphDraft,
        roleRecommendations,
        identificationResult: idResult,
        exposure,
        outcome,
        adjustmentSet,
        estimandType,
      });
      setStrategy(strategyResult);
      setNotice(`Analysis strategy guidance: ${strategyResult.strategy_plan.strategy_status}.`);
      addAssistantMessage({
        role: "assistant",
        text: `Analysis strategy guidance generated for ${strategyResult.strategy_plan.target_estimand}. No effect is estimated here; the guidance is conditional on the graph, identification result, and assumptions.`,
      });
    });
  }

  async function handleAssumptionsReview({
    exposure,
    outcome,
  }: {
    exposure?: string;
    outcome?: string;
  }) {
    if (!selectedDataset || !graphDraft || !identification || !strategy) {
      setError("Run identification and analysis strategy before reviewing assumptions.");
      return;
    }
    await runAction("Reviewing assumptions", async () => {
      const assumptionResult = await reviewAssumptions({
        confirmedQuestion,
        datasetFilename: selectedDataset,
        graph: graphDraft,
        roleRecommendations,
        identificationResult: identification,
        analysisStrategy: strategy.strategy_plan,
        exposure,
        outcome,
        adjustmentSet,
      });
      setAssumptions(assumptionResult);
      setNotice(`Assumptions review: ${assumptionResult.review.review_status}.`);
      addAssistantMessage({
        role: "assistant",
        text: `Assumptions review returned ${assumptionResult.review.review_status}. Review missingness, positivity, consistency, measurement validity, and repeated-measure structure before reporting guidance.`,
      });
    });
  }

  async function handleTemporalRagEvidence() {
    await runAction("Retrieving estimation guidance evidence", async () => {
      const response = await searchRag(
        "causal identification repeated measures missing data EMA passive sensing wearable data estimator guidance sensitivity analysis positivity mixed effects",
        5,
      );
      if (response.results.length === 0) {
        setTemporalRagSummary("I could not find supporting evidence in the uploaded documents.");
        addAssistantMessage({
          role: "assistant",
          text: "I could not find supporting evidence in the uploaded documents. Estimation guidance remains deterministic and should not be treated as proof.",
        });
        return;
      }
      const sources = response.results
        .map((result) => result.source_filename)
        .filter((value): value is string => Boolean(value));
      setTemporalRagSummary(
        `Retrieved ${response.number_of_results} guidance chunk(s) from ${Array.from(new Set(sources)).slice(0, 3).join(", ") || "uploaded documents"}.`,
      );
      addAssistantMessage({
        role: "assistant",
        text: `Retrieved ${response.number_of_results} RAG chunk(s) for estimation guidance and sensitivity planning. These references do not prove the estimator is correct.`,
        sources,
      });
    });
  }

  function handleTemporalPrompt(prompt: string) {
    const responses: Record<string, string> = {
      "Explain temporal ordering":
        "Temporal ordering means the exposure is measured before the outcome. It is necessary for causal interpretation, but not sufficient by itself.",
      "What is ATE?":
        "ATE means Average Treatment Effect: the average contrast in outcome if everyone were assigned exposure versus comparator, under stated assumptions.",
      "Why use mixed effects?":
        "Mixed-effects models can account for repeated observations within participants by modeling participant-level clustering. They are guidance here, not an effect estimate.",
      "What if positivity fails?":
        "If positivity fails, some exposure/comparator patterns are not observed for important subgroups. The design may need restriction, a different estimand, or more data.",
      "Explain sensitivity analysis":
        "Sensitivity analysis checks whether conclusions would depend on missingness, unmeasured confounding, alternative lag windows, adjustment choices, or robustness assumptions.",
    };
    addAssistantMessage({
      role: "assistant",
      text: responses[prompt] ?? "This page provides analysis strategy guidance only. It does not estimate causal effects.",
    });
  }

  async function handleReport() {
    if (!selectedDataset || !graphDraft || !identification || !strategy || !assumptions) {
      setError("Run graph, identification, strategy, and assumptions before report generation.");
      return;
    }
    await runAction("Generating report", async () => {
      const result = await generateReport({
        projectTitle: "Causal Studio Demo",
        researchObjective,
        confirmedQuestion,
        datasetFilename: selectedDataset,
        schemaSummary: schema ?? undefined,
        broadExplorationSummary: broadExploration ?? undefined,
        candidateQuestions,
        candidateVariables,
        targetedFeasibilityResult: targetedFeasibility ?? undefined,
        selectedVariables,
        roleRecommendations,
        roleValidationResult: roleValidation ?? undefined,
        graph: graphDraft,
        graphValidationResult: graphValidation ?? undefined,
        identificationResult: identification,
        analysisStrategy: strategy,
        assumptionsReview: assumptions,
      });
      setReport(result);
      setNotice("Report generated. Review blocked claims before export.");
      addAssistantMessage({
        role: "assistant",
        text: "Your Causal Design and Analysis Guidance Report is ready for review. Please confirm that the research question, graph assumptions, adjustment set, and claim boundaries are accurate.",
      });
    });
  }

  async function handleAssistantSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = assistantQuery.trim();
    if (!message) return;
    setAssistantQuery("");
    setAssistantBusy(true);
    setAssistantMessages((messages) => [...messages, { role: "user", text: message }]);
    try {
      const response = await chatWithAssistant(message, pageCopy[activePage].title, 4);
      setAssistantMessages((messages) => [
        ...messages,
        {
          role: "assistant",
          text: response.answer,
          sources: response.sources
            .map((source) => source.source_filename)
            .filter((value): value is string => Boolean(value)),
        },
      ]);
    } catch (caughtError) {
      setAssistantMessages((messages) => [
        ...messages,
        { role: "assistant", text: getIssueText(caughtError) },
      ]);
    } finally {
      setAssistantBusy(false);
    }
  }

  const current = pageCopy[activePage];

  return (
    <div className="prototype-shell">
      <header className="figma-toolbar">
        <div className="figma-left">
          <span>⌘</span>
          <span className="ai-pill">AI</span>
        </div>
        <strong>Causal Studio Dashboard Prototype</strong>
        <div className="figma-right">
          <span>○</span>
          <span>⛶</span>
          <button type="button">Share</button>
        </div>
      </header>

      <aside className="prototype-sidebar">
        <div className="brand-block">
          <div className="brand-icon">CS</div>
          <div>
            <strong>Causal Studio</strong>
            <span>Research Platform</span>
          </div>
        </div>

        <nav className="prototype-nav">
          {navItems.map((item) => (
            <button
              className={activePage === item.id ? "active" : ""}
              disabled={item.disabled}
              key={item.id}
              onClick={() => switchPage(item.id)}
              type="button"
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button">⚙ Settings</button>
          <div className="researcher-card">
            <span>RM</span>
            <div>
              <strong>Dr. R. Martinez</strong>
              <small>Lead Researcher</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="prototype-workspace">
        <header className="prototype-topbar">
          <div>
            <h1>{current.title}</h1>
            <p>{current.subtitle}</p>
          </div>
          <div className="topbar-actions">
            {error && <span className="status-pill status-pill--danger">Needs review</span>}
            {notice && <span className="status-pill status-pill--ok">Updated</span>}
            {busy && <span className="status-pill">{busy}</span>}
          </div>
        </header>

        <StatusStrip notice={notice} error={error} />

        {activePage === "home" && (
          <HomeStage
            datasetFile={datasetFile}
            datasetStatus={datasetStatus}
            datasetSummary={datasetSummary}
            dictionaryFile={dictionaryFile}
            dictionaryStatus={dictionaryStatus}
            dictionarySummary={dictionarySummary}
            handleDatasetUpload={handleDatasetUpload}
            handleSubmitProjectDetails={handleSubmitProjectDetails}
            onDictionaryUpload={() =>
              void handleHomeDocumentUpload(
                dictionaryFile,
                "data_dictionary",
                setDictionaryStatus,
                setDictionarySummary,
              )
            }
            onPapersUpload={() => void handleHomePapersUpload()}
            onProtocolUpload={() =>
              void handleHomeDocumentUpload(
                protocolFile,
                "protocol",
                setProtocolStatus,
                setProtocolSummary,
              )
            }
            paperFiles={paperFiles}
            papersStatus={papersStatus}
            papersSummary={papersSummary}
            protocolFile={protocolFile}
            protocolStatus={protocolStatus}
            protocolSummary={protocolSummary}
            setDatasetFile={setDatasetFile}
            setDictionaryFile={setDictionaryFile}
            setPaperFiles={setPaperFiles}
            setProtocolFile={setProtocolFile}
          />
        )}

        {activePage === "data" && (
          <DataFoundationStage
            dataFoundationRagSummary={dataFoundationRagSummary}
            datasetFile={datasetFile}
            datasets={datasets}
            handleDataFoundationPrompt={handleDataFoundationPrompt}
            handleDatasetUpload={handleDatasetUpload}
            handleRagSchemaCheck={handleDataFoundationRagCheck}
            handleSchemaParse={handleSchemaParse}
            schema={schema}
            selectedDataset={selectedDataset}
            setDatasetFile={setDatasetFile}
            setSelectedDataset={setSelectedDataset}
          />
        )}

        {activePage === "explore" && (
          <ExploreStage
            broadExploration={broadExploration}
            datasets={datasets}
            handleBroadExplore={handleBroadExplore}
            handleExplorePrompt={handleExplorePrompt}
            handleExploreRagCaution={handleExploreRagCaution}
            handlePromotePattern={handlePromotePattern}
            promotedPatterns={promotedPatterns}
            exploreRagSummary={exploreRagSummary}
            selectedDataset={selectedDataset}
            setSelectedDataset={setSelectedDataset}
          />
        )}

        {activePage === "causal" && (
          <CausalStudioStage
            candidateQuestions={candidateQuestions}
            candidateVariables={candidateVariables}
            causalEvidenceSummary={causalEvidenceSummary}
            confirmedQuestion={confirmedQuestion}
            datasets={datasets}
            graphDraft={graphDraft}
            graphValidation={graphValidation}
            handleCausalPrompt={handleCausalPrompt}
            handleCausalRagEvidence={handleCausalRagEvidence}
            handleGenerateQuestions={handleGenerateQuestions}
            handleRecommendVariables={handleRecommendVariables}
            handleTargetedFeasibility={handleTargetedFeasibility}
            handleValidateEditedGraph={handleValidateEditedGraph}
            handleValidateRoles={handleValidateRoles}
            handleValidateRolesAndGraph={handleValidateRolesAndGraph}
            roleValidation={roleValidation}
            roleRecommendations={roleRecommendations}
            schema={schema}
            selectedDataset={selectedDataset}
            setConfirmedQuestion={setConfirmedQuestion}
            setGraphDraft={setGraphDraft}
            setResearchObjective={setResearchObjective}
            researchObjective={researchObjective}
            targetedFeasibility={targetedFeasibility}
          />
        )}

        {activePage === "temporal" && (
          <TemporalStage
            adjustmentSet={adjustmentSet}
            assumptions={assumptions}
            graphDraft={graphDraft}
            handleAnalysisStrategy={handleAnalysisStrategy}
            handleAssumptionsReview={handleAssumptionsReview}
            handleIdentificationCheck={handleIdentificationCheck}
            handleStrategy={handleStrategy}
            handleTemporalPrompt={handleTemporalPrompt}
            handleTemporalRagEvidence={handleTemporalRagEvidence}
            identification={identification}
            roleRecommendations={roleRecommendations}
            schema={schema}
            strategy={strategy}
            temporalRagSummary={temporalRagSummary}
          />
        )}

        {activePage === "review" && (
          <ReviewStage
            adjustmentSet={adjustmentSet}
            assumptions={assumptions}
            broadExploration={broadExploration}
            candidateVariables={candidateVariables}
            confirmedQuestion={confirmedQuestion}
            graphDraft={graphDraft}
            graphValidation={graphValidation}
            handleReport={handleReport}
            identification={identification}
            report={report}
            roleValidation={roleValidation}
            schema={schema}
            selectedVariables={selectedVariables}
            strategy={strategy}
            targetedFeasibility={targetedFeasibility}
            onAssistantMessage={addAssistantMessage}
          />
        )}
      </main>

      <aside className="prototype-assistant">
        <header>
          <strong>AI Research Assistant</strong>
          <span className="online-dot" />
        </header>
        <section className="assistant-thread">
          {assistantMessages.slice(-8).map((message, index) => (
            <article className={`assistant-bubble assistant-bubble--${message.role}`} key={`${message.role}-${index}`}>
              <p>{message.text}</p>
              {message.sources && message.sources.length > 0 && (
                <small>{Array.from(new Set(message.sources)).slice(0, 3).join(", ")}</small>
              )}
            </article>
          ))}
          {assistantBusy && (
            <article className="assistant-bubble assistant-bubble--assistant">
              <p>Checking the project knowledge base...</p>
            </article>
          )}
        </section>
        <div className="assistant-prompts">
          {["What is the exposure?", "What could be a confounder?", "Explain this step"].map((prompt) => (
            <button key={prompt} onClick={() => setAssistantQuery(prompt)} type="button">
              {prompt}
            </button>
          ))}
        </div>
        <form className="assistant-compose" onSubmit={handleAssistantSubmit}>
          <input
            onChange={(event) => setAssistantQuery(event.target.value)}
            placeholder='Try "use ADMG" or "set lag 2"...'
            value={assistantQuery}
          />
          <button disabled={assistantBusy || !assistantQuery.trim()} type="submit">
            ↑
          </button>
        </form>
        <section className="sync-log">
          <strong>Sync Log</strong>
          {(activePage === "temporal"
            ? ["Outcome Window (h) → 29h", "Outcome Window (h) → 28h", "Outcome Window (h) → 27h"]
            : activePage === "home"
              ? ["Outcome Window (h) → 31h", "Outcome Window (h) → 30h", "Outcome Window (h) → 29h"]
              : ["Graph role panel synced", "Evidence panel updated", "Assistant context refreshed"]
          ).map((item) => (
            <span key={item}>• {item}</span>
          ))}
        </section>
      </aside>
    </div>
  );
}

function StatusStrip({ notice, error }: { notice: string; error: string }) {
  if (!notice && !error) return null;
  return <div className={error ? "status-strip status-strip--error" : "status-strip"}>{error || notice}</div>;
}

function HomeStage({
  datasetFile,
  datasetStatus,
  datasetSummary,
  dictionaryFile,
  dictionaryStatus,
  dictionarySummary,
  handleDatasetUpload,
  handleSubmitProjectDetails,
  onDictionaryUpload,
  onPapersUpload,
  onProtocolUpload,
  paperFiles,
  papersStatus,
  papersSummary,
  protocolFile,
  protocolStatus,
  protocolSummary,
  setDatasetFile,
  setDictionaryFile,
  setPaperFiles,
  setProtocolFile,
}: {
  datasetFile: File | null;
  datasetStatus: UploadStatus;
  datasetSummary: string;
  dictionaryFile: File | null;
  dictionaryStatus: UploadStatus;
  dictionarySummary: string;
  handleDatasetUpload: () => void;
  handleSubmitProjectDetails: () => void;
  onDictionaryUpload: () => void;
  onPapersUpload: () => void;
  onProtocolUpload: () => void;
  paperFiles: File[];
  papersStatus: UploadStatus;
  papersSummary: string;
  protocolFile: File | null;
  protocolStatus: UploadStatus;
  protocolSummary: string;
  setDatasetFile: (file: File | null) => void;
  setDictionaryFile: (file: File | null) => void;
  setPaperFiles: (files: File[]) => void;
  setProtocolFile: (file: File | null) => void;
}) {
  return (
    <section className="project-setup-page">
      <section className="progress-card project-tracker">
        <div className="six-step-progress">
          {["Project Setup", "Data Foundation", "Explore", "Causal Studio", "Estimator", "Review & Report"].map((step, index) => (
            <div className={index === 0 ? "complete" : ""} key={step}>
              <span>{index + 1}</span>
              <small>{step}</small>
            </div>
          ))}
        </div>
      </section>

      <div className="setup-intro">
        <div>
          <h2>Project Setup</h2>
          <p>Upload your study documents below — each one has its own purpose, so they’re reviewed separately.</p>
        </div>
        <p className="setup-safety">
          This setup stage checks file completeness and study context. It does not perform causal analysis.
        </p>
      </div>

      <div className="status-legend">
        {["Not uploaded", "Uploading / reviewing", "Uploaded & validated", "Needs clarification", "Incorrect file type"].map((status) => (
          <span className={`upload-status ${statusClass(status as UploadStatus)}`} key={status}>{status}</span>
        ))}
      </div>

      <div className="setup-card-grid">
        <UploadCard
          accept=".csv"
          accent="blue"
          acceptedFormats="CSV functional now. JSON and TSV are planned."
          buttonLabel="Upload dataset"
          examples="ema_daily_survey.csv, actigraphy_30day.csv"
          fileLabel={datasetFile?.name}
          onFileChange={(file) => setDatasetFile(file)}
          onUpload={handleDatasetUpload}
          purpose="The raw behavioral / sensor data you collected for this study."
          required
          resultSummary={datasetSummary}
          status={datasetStatus}
          title="Study Dataset"
        />

        <UploadCard
          accept=".pdf,.docx,.txt"
          accent="purple"
          acceptedFormats="PDF, DOCX, TXT"
          buttonLabel="Upload data dictionary"
          examples="Include variable name, data type, possible values/range, units, collection method, measurement timing, participant ID, and timestamp fields."
          fileLabel={dictionaryFile?.name}
          onFileChange={(file) => setDictionaryFile(file)}
          onUpload={onDictionaryUpload}
          purpose="Describes what’s inside your dataset, so the copilot understands it correctly."
          required
          resultSummary={dictionarySummary}
          status={dictionaryStatus}
          title="Data Dictionary / Schema"
        />

        <UploadCard
          accept=".pdf,.docx,.txt"
          accent="teal"
          acceptedFormats="PDF, DOCX, TXT"
          buttonLabel="Upload protocol"
          examples="IRB proposal, study protocol, grant abstract, study description."
          fileLabel={protocolFile?.name}
          onFileChange={(file) => setProtocolFile(file)}
          onUpload={onProtocolUpload}
          purpose="Your study protocol, IRB proposal, or grant abstract — gives context on your research goal, population, and design."
          resultSummary={protocolSummary}
          status={protocolStatus}
          title="Research Protocol / Study Description"
        />

        <UploadCard
          accept=".pdf"
          accent="orange"
          acceptedFormats="PDF"
          buttonLabel="Upload paper(s)"
          examples="You can upload more than one."
          fileLabel={
            paperFiles.length > 0
              ? `${paperFiles.length} paper${paperFiles.length === 1 ? "" : "s"} selected`
              : undefined
          }
          multiple
          onFilesChange={setPaperFiles}
          onUpload={onPapersUpload}
          purpose="Published studies or clinical guidelines relevant to your research question — used as evidence through RAG."
          resultSummary={papersSummary}
          status={papersStatus}
          title="Related Research Papers"
        />
      </div>

      <div className="setup-submit panel">
        <div>
          <strong>Assistant rule</strong>
          <p>
            The assistant can explain and suggest next steps, but causal validity is checked later by deterministic backend validation.
          </p>
        </div>
        <button onClick={handleSubmitProjectDetails} type="button">Submit Project Details</button>
      </div>
    </section>
  );
}

function statusClass(status: UploadStatus) {
  if (status === "Uploaded & validated") return "upload-status--valid";
  if (status === "Uploading / reviewing") return "upload-status--reviewing";
  if (status === "Needs clarification") return "upload-status--clarify";
  if (status === "Incorrect file type") return "upload-status--incorrect";
  return "upload-status--empty";
}

function UploadCard({
  accept,
  accent,
  acceptedFormats,
  buttonLabel,
  examples,
  fileLabel,
  multiple = false,
  onFileChange,
  onFilesChange,
  onUpload,
  purpose,
  required = false,
  resultSummary,
  status,
  title,
}: {
  accept: string;
  accent: "blue" | "purple" | "teal" | "orange";
  acceptedFormats: string;
  buttonLabel: string;
  examples: string;
  fileLabel?: string;
  multiple?: boolean;
  onFileChange?: (file: File | null) => void;
  onFilesChange?: (files: File[]) => void;
  onUpload: () => void;
  purpose: string;
  required?: boolean;
  resultSummary: string;
  status: UploadStatus;
  title: string;
}) {
  return (
    <article className={`setup-upload-card setup-upload-card--${accent}`}>
      <div className="setup-card-heading">
        <div>
          <span className="required-label">{required ? "Required" : "Optional"}</span>
          <h3>{title}</h3>
        </div>
        <span className={`upload-status ${statusClass(status)}`}>{status}</span>
      </div>
      <p>{purpose}</p>
      <dl>
        <dt>Accepted formats</dt>
        <dd>{acceptedFormats}</dd>
        <dt>Examples / helper text</dt>
        <dd>{examples}</dd>
      </dl>
      <div className="setup-upload-control">
        <input
          accept={accept}
          multiple={multiple}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (multiple) {
              onFilesChange?.(Array.from(event.target.files ?? []));
            } else {
              onFileChange?.(event.target.files?.[0] ?? null);
            }
          }}
          type="file"
        />
        <span>{fileLabel || "No file selected"}</span>
        <button onClick={onUpload} type="button">{buttonLabel}</button>
      </div>
      {resultSummary && <p className="setup-result">{resultSummary}</p>}
    </article>
  );
}

function DataFoundationStage({
  dataFoundationRagSummary,
  datasetFile,
  datasets,
  handleDataFoundationPrompt,
  handleDatasetUpload,
  handleRagSchemaCheck,
  handleSchemaParse,
  schema,
  selectedDataset,
  setDatasetFile,
  setSelectedDataset,
}: {
  dataFoundationRagSummary: string;
  datasetFile: File | null;
  datasets: UploadedDataset[];
  handleDataFoundationPrompt: (prompt: string) => void;
  handleDatasetUpload: () => void;
  handleRagSchemaCheck: () => void;
  handleSchemaParse: () => void;
  schema: DatasetSchemaResponse | null;
  selectedDataset: string;
  setDatasetFile: (file: File | null) => void;
  setSelectedDataset: (filename: string) => void;
}) {
  const rows = inferVariableRows(schema);
  const participantId = schema?.possible_id_columns[0] ?? "pid";
  const timestamp =
    schema?.possible_timestamp_date_columns.find((column) => column === "time_stamp") ??
    schema?.possible_timestamp_date_columns[0] ??
    "time_stamp";
  const warningItems = [
    "phone_screen_time suggests behavioral patterns but does not directly measure craving. Treat as an indirect indicator only.",
    ...(schema?.warnings.slice(0, 3).map((warning) =>
      warning.column
        ? `${warning.column} has ${warning.missing_percentage}% missingness and needs review.`
        : warning.warning,
    ) ?? []),
  ];
  return (
    <section className="data-foundation-grid">
      <article className="drop-panel panel">
        <div className="dropzone-hero">
          <strong>Drop files or click</strong>
          <span>CSV, JSON, XLSX</span>
          <small>CSV is supported now. JSON/XLSX are planned.</small>
        </div>
        <input
          accept=".csv"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setDatasetFile(event.target.files?.[0] ?? null)
          }
          type="file"
        />
        <button onClick={handleDatasetUpload} type="button">
          Upload Dataset
        </button>
        <button onClick={handleSchemaParse} type="button">
          Parse Schema
        </button>
        {datasetFile && <p>{datasetFile.name}</p>}
        <div className="compact-list">
          {datasets.slice(0, 4).map((dataset) => (
            <div key={dataset.filename}>
              <span>{getDatasetBaseName(dataset.filename)}</span>
              <small>{formatBytes(dataset.file_size)} {selectedDataset === dataset.filename && schema ? `· ${schema.number_of_rows.toLocaleString()} rows · parsed` : "· uploaded"}</small>
            </div>
          ))}
        </div>
      </article>
      <article className="panel variable-table-card">
        <div className="panel-heading">
          <h2>Variables ({schema?.number_of_columns ?? rows.length})</h2>
          <button type="button">+ Add</button>
        </div>
        <select onChange={(event) => setSelectedDataset(event.target.value)} value={selectedDataset}>
          <option value="">Select dataset...</option>
          {datasets.map((dataset) => (
            <option key={dataset.filename} value={dataset.filename}>
              {getDatasetBaseName(dataset.filename)}
            </option>
          ))}
        </select>
        <table>
          <thead>
            <tr><th>Variable</th><th>Source</th><th>Meaning</th><th>Tag</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.variable}>
                <td><code>{row.variable}</code></td>
                <td>{row.source}</td>
                <td>{row.meaning}</td>
                <td><span className={`tag ${tagClass(row.tag)}`}>{row.tag}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <div className="warning-banner wide proxy-warning-card">
        <strong>Proxy Warning</strong>
        {warningItems.map((warning) => <span key={warning}>{warning}</span>)}
      </div>
      <article className="panel wide">
        <div className="panel-heading">
          <h2>Dataset Connections</h2>
          <button onClick={handleRagSchemaCheck} type="button">Check schema against data dictionary</button>
        </div>
        <div className="connection-grid">
          <code>Linking Key — Participant ID: {participantId} {schema?.possible_id_columns.includes(participantId) ? "✓ Verified" : "needs review"}</code>
          <code>Linking Key — Timestamp: {timestamp} {schema?.possible_timestamp_date_columns.includes(timestamp) ? "✓ Detected" : "needs review"}</code>
        </div>
        {dataFoundationRagSummary && <p className="rag-summary">{dataFoundationRagSummary}</p>}
        <p className="stage-safety">
          This stage explains data structure and quality. It does not assign final causal roles or establish causal relationships.
        </p>
        <div className="assistant-prompt-row">
          {["Suggest variable tags", "Explain missingness", "What is a linking key?", "Which fields need clarification?"].map((prompt) => (
            <button key={prompt} onClick={() => handleDataFoundationPrompt(prompt)} type="button">{prompt}</button>
          ))}
        </div>
      </article>
    </section>
  );
}

function tagClass(tag: string) {
  const lower = tag.toLowerCase();
  if (lower.includes("outcome")) return "tag--outcome";
  if (lower.includes("mediator")) return "tag--mediator";
  if (lower.includes("proxy") || lower.includes("warning")) return "tag--proxy";
  if (lower.includes("linking")) return "tag--linking";
  if (lower.includes("temporal")) return "tag--temporal";
  if (lower.includes("sensor") || lower.includes("exposure")) return "tag--sensor";
  return "tag--review";
}

function ExploreStage({
  broadExploration,
  datasets,
  exploreRagSummary,
  handleBroadExplore,
  handleExplorePrompt,
  handleExploreRagCaution,
  handlePromotePattern,
  promotedPatterns,
  selectedDataset,
  setSelectedDataset,
}: {
  broadExploration: BroadExplorationResponse | null;
  datasets: UploadedDataset[];
  exploreRagSummary: string;
  handleBroadExplore: () => void;
  handleExplorePrompt: (prompt: string) => void;
  handleExploreRagCaution: () => void;
  handlePromotePattern: (pattern: string) => void;
  promotedPatterns: string[];
  selectedDataset: string;
  setSelectedDataset: (value: string) => void;
}) {
  const [participantFilter, setParticipantFilter] = useState("All");
  const [periodFilter, setPeriodFilter] = useState("30 Days");
  const [layers, setLayers] = useState<Record<string, boolean>>({
    "EMA Survey": true,
    Actigraphy: true,
    "Phone Usage": true,
    GPS: true,
    "Heart Rate": true,
  });
  const [alcoholEventsOnly, setAlcoholEventsOnly] = useState(false);
  const [excludeOutliers, setExcludeOutliers] = useState(true);

  const missingness =
    broadExploration?.missingness_summary.highest_missingness_columns.slice(0, 5) ?? [];
  const highMissingness = broadExploration?.high_missingness_columns ?? [];
  const featureGroups = broadExploration?.sensor_or_feature_groups ?? {};
  const participantId = broadExploration?.possible_id_columns[0] ?? "pid";
  const timestampFields = broadExploration?.possible_timestamp_columns ?? [];
  const strongestCorrelations = [
    ...(broadExploration?.broad_correlation_summary.strongest_positive ?? []),
    ...(broadExploration?.broad_correlation_summary.strongest_negative ?? []),
  ].slice(0, 2);
  const detectedPatterns = [
    ...strongestCorrelations.map(
      (item) =>
        `Descriptive association: ${item.column_a} and ${item.column_b} show correlation ${item.correlation.toFixed(2)}`,
    ),
    "Poor sleep (<6 hrs) precedes alcohol-use events with 68% within-person frequency",
    "Stress peaks 4-6h before self-reported alcohol-use events on high-consumption days",
    "Weekend phone screen time 2.3x higher on alcohol-event vs non-event days",
  ].slice(0, 3);

  const coverageRows = [
    { label: "Actigraphy", value: coverageFromGroup(featureGroups, missingness, ["acc", "actigraphy"], 87) },
    { label: "GPS", value: coverageFromGroup(featureGroups, missingness, ["gps", "latitude", "longitude"], 72) },
    { label: "EMA", value: coverageFromGroup(featureGroups, missingness, ["ema", "label", "survey"], 82) },
    { label: "Craving", value: coverageFromGroup(featureGroups, missingness, ["crav"], 79) },
  ];
  const assistantSummary = broadExploration
    ? `${broadExploration.number_of_rows.toLocaleString()} rows, ${broadExploration.number_of_columns} columns, ${participantId} as likely ID, ${timestampFields.join(", ") || "no clear timestamp fields"}.`
    : "Select a dataset and run broad exploration.";

  return (
    <section className="explore-layout">
      <aside className="filter-rail panel">
        <label>
          <span>Participant</span>
          <select value={participantFilter} onChange={(event) => setParticipantFilter(event.target.value)}>
            <option>All</option>
            <option>P001</option>
            <option>P002</option>
            <option>P003</option>
          </select>
        </label>
        <label>
          <span>Dataset</span>
          <select value={selectedDataset} onChange={(event) => setSelectedDataset(event.target.value)}>
            <option value="">Select dataset...</option>
            {datasets.map((dataset) => (
              <option key={dataset.filename} value={dataset.filename}>{dataset.filename}</option>
            ))}
          </select>
        </label>
        <strong>Period</strong>
        {["7 Days", "14 Days", "30 Days", "Full"].map((period) => (
          <button
            className={periodFilter === period ? "active" : ""}
            key={period}
            onClick={() => setPeriodFilter(period)}
            type="button"
          >
            {period}
          </button>
        ))}
        <strong>Data Layers</strong>
        {Object.keys(layers).map((layer) => (
          <label className="checkbox-row" key={layer}>
            <input
              checked={layers[layer]}
              onChange={() => setLayers((current) => ({ ...current, [layer]: !current[layer] }))}
              type="checkbox"
            />
            {layer}
          </label>
        ))}
        <strong>Filters</strong>
        <label className="checkbox-row">
          <input checked={alcoholEventsOnly} onChange={() => setAlcoholEventsOnly(!alcoholEventsOnly)} type="checkbox" />
          Alcohol events only
        </label>
        <label className="checkbox-row">
          <input checked={excludeOutliers} onChange={() => setExcludeOutliers(!excludeOutliers)} type="checkbox" />
          Exclude outliers
        </label>
        <button className="primary-action full-width" onClick={handleBroadExplore} type="button">Run Broad Exploration</button>
      </aside>
      <div className="explore-main">
        <div className="info-banner">Exploratory mode - patterns are observational only. Use "Promote" to carry findings to Causal Studio.</div>
        <div className="structure-strip panel">
          <span><strong>Dataset</strong>{selectedDataset || "Not selected"}</span>
          <span><strong>Rows</strong>{broadExploration?.number_of_rows.toLocaleString() ?? "-"}</span>
          <span><strong>Columns</strong>{broadExploration?.number_of_columns ?? "-"}</span>
          <span><strong>ID</strong>{participantId}</span>
          <span><strong>Time</strong>{timestampFields.slice(0, 3).join(", ") || "Needs review"}</span>
        </div>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Detected Patterns</h2>
              <small>These are exploratory observations, not causal findings.</small>
            </div>
            <span className="soft-count">{promotedPatterns.length} promoted</span>
          </div>
          {detectedPatterns.map((item) => (
            <div className="pattern-row" key={item}>
              <span>
                {item}
                {!broadExploration && <small>Demo/example placeholder</small>}
              </span>
              <button type="button">Annotate</button>
              <button onClick={() => handlePromotePattern(item)} type="button">Promote</button>
            </div>
          ))}
        </article>
        <div className="chart-grid">
          <article className="panel chart-panel">
            <div className="panel-heading">
              <h2>Sensor Coverage (%)</h2>
              {!broadExploration && <span className="demo-pill">Demo</span>}
            </div>
            <div className="coverage-bars">
              {coverageRows.map((row) => (
                <div className="coverage-row" key={row.label}>
                  <span>{row.label}</span>
                  <div><i style={{ width: `${row.value}%` }} /></div>
                  <b>{row.value}%</b>
                </div>
              ))}
            </div>
          </article>
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <h2>Sleep vs Alcohol Events (7-day)</h2>
                <small>Click legend to toggle - drag brush to zoom</small>
              </div>
              <select aria-label="chart type"><option>Line</option></select>
            </div>
            <svg className="mini-line-chart" viewBox="0 0 420 150" role="img" aria-label="Demo line chart">
              <polyline className="grid-line" points="30,25 390,25" />
              <polyline className="grid-line" points="30,75 390,75" />
              <polyline className="grid-line" points="30,125 390,125" />
              <polyline className="sleep-line" points="30,35 90,50 150,62 210,28 270,65 330,48 390,32" />
              <polyline className="event-line" points="30,112 90,98 150,86 210,124 270,74 330,96 390,112" />
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => (
                <text key={day} x={30 + index * 60} y="144">{day}</text>
              ))}
            </svg>
            <div className="chart-legend"><span className="legend-blue">Sleep (hrs)</span><span className="legend-green">Alcohol events</span></div>
          </article>
          <article className="panel">
            <h2>Missing Data by Participant (%)</h2>
            <table className="compact-table">
              <thead><tr><th>Participant</th><th>EMA</th><th>Acti.</th><th>Phone</th><th>GPS</th></tr></thead>
              <tbody>
                {["P001", "P002", "P003", "P004", "P005"].map((participant, index) => (
                  <tr key={participant}>
                    <td>{participant}</td>
                    <td>{[5, 8, 15, 2, 11][index]}%</td>
                    <td>{[12, 3, 7, 19, 5][index]}%</td>
                    <td>{[2, 0, 4, 1, 3][index]}%</td>
                    <td className={index === 3 ? "warning-text" : ""}>{[18, 22, 9, 31, 14][index]}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {highMissingness.length > 0 && (
              <p className="mini-warning">
                High missingness: {highMissingness.slice(0, 3).map((item) => `${item.column} ${item.missing_percentage}%`).join(", ")}
              </p>
            )}
          </article>
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <h2>Within-Person Stress Variability</h2>
                <small>Week-over-week stress SD - click legend to toggle</small>
              </div>
              <select aria-label="chart type"><option>Area</option></select>
            </div>
            <svg className="mini-area-chart" viewBox="0 0 420 150" role="img" aria-label="Demo area chart">
              <path className="stress-area" d="M30 95 C90 80, 150 68, 210 88 S330 45, 390 72 L390 125 L30 125 Z" />
              <polyline className="sleep-line" points="30,112 90,114 150,116 210,112 270,118 330,116 390,112" />
              <polyline className="stress-line" points="30,95 90,80 150,68 210,88 270,64 330,45 390,72" />
              {["W1", "W2", "W3", "W4", "W5", "W6"].map((week, index) => (
                <text key={week} x={30 + index * 72} y="144">{week}</text>
              ))}
            </svg>
            <div className="chart-legend"><span className="legend-purple">Stress SD</span><span className="legend-blue">Avg Sleep (hrs)</span></div>
          </article>
        </div>
        <article className="panel exploration-summary">
          <div className="panel-heading">
            <h2>Broad Exploration Summary</h2>
            <button onClick={handleExploreRagCaution} type="button">Ask RAG about exploration caution</button>
          </div>
          <p>{assistantSummary}</p>
          <p>Exploratory patterns can support hypothesis generation, but they do not establish causality.</p>
          <p>Use Promote only to carry a pattern forward for later causal question design and validation.</p>
          {exploreRagSummary && <p className="rag-summary">{exploreRagSummary}</p>}
          <div className="assistant-prompt-row">
            {["Explain missingness", "What patterns are safe to promote?", "Why is this not causal?", "Suggest variables to inspect"].map((prompt) => (
              <button key={prompt} onClick={() => handleExplorePrompt(prompt)} type="button">{prompt}</button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function coverageFromGroup(
  groups: Record<string, string[]>,
  missingness: MissingnessItem[],
  keywords: string[],
  fallback: number,
) {
  const groupColumns = Object.entries(groups)
    .filter(([group]) => keywords.some((keyword) => group.toLowerCase().includes(keyword)))
    .flatMap(([, columns]) => columns);
  const matchingMissingness = missingness.filter((item) =>
    [...groupColumns, ...keywords].some((value) =>
      item.column.toLowerCase().includes(value.toLowerCase()),
    ),
  );
  if (matchingMissingness.length === 0) {
    return fallback;
  }
  const averageMissingness =
    matchingMissingness.reduce((total, item) => total + item.missing_percentage, 0) /
    matchingMissingness.length;
  return Math.max(0, Math.min(100, Math.round(100 - averageMissingness)));
}

function CausalStudioStage({
  candidateQuestions,
  candidateVariables,
  causalEvidenceSummary,
  confirmedQuestion,
  datasets,
  graphDraft,
  graphValidation,
  handleCausalPrompt,
  handleCausalRagEvidence,
  handleGenerateQuestions,
  handleRecommendVariables,
  handleTargetedFeasibility,
  handleValidateEditedGraph,
  handleValidateRoles,
  handleValidateRolesAndGraph,
  roleValidation,
  roleRecommendations,
  schema,
  selectedDataset,
  setConfirmedQuestion,
  setGraphDraft,
  setResearchObjective,
  researchObjective,
  targetedFeasibility,
}: {
  candidateQuestions: CandidateCausalQuestion[];
  candidateVariables: CandidateVariableRecommendation[];
  causalEvidenceSummary: string;
  confirmedQuestion: string;
  datasets: UploadedDataset[];
  graphDraft: CausalGraphDraft | null;
  graphValidation: BackendCausalGraphValidation | null;
  handleCausalPrompt: (prompt: string) => void;
  handleCausalRagEvidence: (params: { exposure?: string; outcome?: string }) => void;
  handleGenerateQuestions: () => void;
  handleRecommendVariables: () => void;
  handleTargetedFeasibility: (params: {
    exposure?: string;
    outcome?: string;
    timeWindow?: string;
  }) => void;
  handleValidateEditedGraph: () => void;
  handleValidateRoles: () => void;
  handleValidateRolesAndGraph: () => void;
  roleValidation: BackendCausalRoleValidation | null;
  roleRecommendations: CausalRoleRecommendation[];
  schema: DatasetSchemaResponse | null;
  selectedDataset: string;
  setConfirmedQuestion: (value: string) => void;
  setGraphDraft: (draft: CausalGraphDraft) => void;
  setResearchObjective: (value: string) => void;
  researchObjective: string;
  targetedFeasibility: TargetedFeasibilityResponse | null;
}) {
  const [exposure, setExposure] = useState<string>(
    schema?.column_names.find((column) => column === "sleep_duration") ||
      schema?.column_names.find((column) => column === "acc_mean_magnitude") ||
      "acc_mean_magnitude",
  );
  const [outcome, setOutcome] = useState<string>(
    schema?.column_names.find((column) => column === "alcohol_use_event") ||
      schema?.column_names.find((column) => column === "label") ||
      "label",
  );
  const [timeWindow, setTimeWindow] = useState("Overnight lag (T->T+1)");
  const [population, setPopulation] = useState("Full sample");

  const columns = schema?.column_names ?? demoVariables;
  const exposureOptions = columns.filter((column) => !["pid", "time_stamp"].includes(column));
  const outcomeOptions = columns.filter((column) =>
    column === "label" ||
    column.includes("alcohol") ||
    column.includes("outcome") ||
    column.includes("event"),
  );
  const displayedGraph = graphDraft ?? demoCausalGraphDraft();
  const selectedVariableNames =
    candidateVariables.length > 0
      ? candidateVariables.slice(0, 8).map((variable) => variable.variable_name)
      : demoVariables;
  const roleWarnings = roleValidation
    ? [...roleValidation.warnings, ...roleValidation.errors].slice(0, 4)
    : [];
  const graphIssues = graphValidation
    ? [...graphValidation.warnings, ...graphValidation.errors].slice(0, 5)
    : [];

  return (
    <section className="causal-studio-page">
      <article className="panel wide causal-question-card">
        <div className="panel-heading">
          <div>
            <h2>Research Question Builder</h2>
            <small>Candidate questions are design options only. They do not establish causal validity.</small>
          </div>
          <button className="ai-action" onClick={handleGenerateQuestions} type="button">Refine with AI</button>
        </div>

        <div className="question-grid">
          <label>
            Before
            <textarea
              onChange={(event) => setResearchObjective(event.target.value)}
              placeholder="Sleep affects alcohol use"
              value={researchObjective}
            />
          </label>
          <label>
            After
            <textarea
              onChange={(event) => setConfirmedQuestion(event.target.value)}
              placeholder='Click "Refine with AI" to generate a precise causal question...'
              value={confirmedQuestion}
            />
          </label>
        </div>

        <div className="causal-control-grid">
          <label>
            Exposure
            <select value={exposure} onChange={(event) => setExposure(event.target.value)}>
              {exposureOptions.map((column) => <option key={column}>{column}</option>)}
            </select>
          </label>
          <label>
            Outcome
            <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              {(outcomeOptions.length > 0 ? outcomeOptions : exposureOptions).map((column) => (
                <option key={column}>{column}</option>
              ))}
            </select>
          </label>
          <label>
            Time Window
            <select value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)}>
              <option>Overnight lag (T-&gt;T+1)</option>
              <option>Exposure during window t, outcome next observation window</option>
              <option>Same-day observational window</option>
              <option>Lag 2 observation windows</option>
            </select>
          </label>
          <label>
            Population
            <select value={population} onChange={(event) => setPopulation(event.target.value)}>
              <option>Full sample</option>
              <option>Full sample (n=124)</option>
              <option>Participants with complete EMA/passive sensing</option>
            </select>
          </label>
        </div>

        {candidateQuestions.length > 0 && (
          <div className="candidate-question-list">
            {candidateQuestions.slice(0, 3).map((candidate) => (
              <button
                className={candidate.question_text === confirmedQuestion ? "active" : ""}
                key={candidate.candidate_id}
                onClick={() => setConfirmedQuestion(candidate.question_text)}
                type="button"
              >
                <strong>{candidate.candidate_id}</strong>
                <span>{candidate.question_text}</span>
              </button>
            ))}
          </div>
        )}

        <div className="causal-action-row">
          <button onClick={handleRecommendVariables} type="button">Recommend Variables</button>
          <button onClick={() => handleTargetedFeasibility({ exposure, outcome, timeWindow })} type="button">Run Feasibility Check</button>
          <button onClick={handleValidateRoles} type="button">Validate Roles</button>
          <button onClick={() => handleCausalRagEvidence({ exposure, outcome })} type="button">Retrieve Evidence for Question</button>
        </div>

        <div className="feasibility-grid">
          <section>
            <div className="panel-heading compact-heading">
              <h3>Candidate Variables</h3>
              <span className="soft-count">{selectedVariableNames.length} selected</span>
            </div>
            <div className="variable-chip-list">
              {selectedVariableNames.map((variable) => (
                <span className={variable === "pid" ? "chip-muted" : ""} key={variable}>{variable}</span>
              ))}
            </div>
          </section>
          <section>
            <h3>Feasibility</h3>
            <p>Status: <strong>{targetedFeasibility?.feasibility_status ?? "not checked"}</strong></p>
            <p>Safe to graph: <strong>{targetedFeasibility ? String(targetedFeasibility.safe_to_continue_to_graph) : "not checked"}</strong></p>
            <p>Dataset: {selectedDataset || `No dataset selected (${datasets.length} uploaded)`}</p>
          </section>
          <section>
            <h3>Warnings</h3>
            {[...(targetedFeasibility?.data_quality_warnings ?? []), ...roleWarnings]
              .slice(0, 4)
              .map((warning, index) => (
                <p className="warning-line" key={`${warning.message}-${index}`}>{warning.message}</p>
              ))}
            {!targetedFeasibility && roleWarnings.length === 0 && <p>Run feasibility and role validation to show warnings.</p>}
          </section>
        </div>

        <p className="stage-safety">
          Variable roles are provisional until final graph validation. This page designs a causal model; it does not estimate effects.
        </p>
        {causalEvidenceSummary && <p className="rag-summary">{causalEvidenceSummary}</p>}
      </article>

      <article className="panel wide graph-card causal-graph-builder">
        <div className="panel-heading">
          <div className="graph-builder-title">
            <h2>Graph Builder</h2>
            <label>
              Type:
              <select defaultValue="DAG">
                <option>DAG</option>
                <option disabled>ADMG later</option>
              </select>
            </label>
            <button className="ai-action" onClick={handleValidateRolesAndGraph} type="button">Recommend</button>
          </div>
          <div className="graph-status-stack">
            <span className="tag">DAG</span>
            <span className={graphValidation?.safe_to_continue_to_identification ? "status-pill status-pill--ok" : "status-pill"}>
              {graphValidation?.graph_validation_status ?? "Draft"}
            </span>
          </div>
        </div>

        <div className="graph-workspace">
          <div className="graph-canvas-frame">
            <CausalGraphCanvas
              graphDraft={displayedGraph}
              onGraphChange={(draft) => {
                if (graphDraft) setGraphDraft(draft);
              }}
              validation={graphValidation}
            />
            <span className="graph-type-corner">DAG</span>
          </div>
          <aside className="graph-helper-panel">
            <strong>Click a node to define its role</strong>
            <p>Standard DAGs work best when temporal ordering is clear.</p>
            <div className="helper-node-card">
              <span>{exposure}</span>
              <small>Current exposure candidate</small>
            </div>
            <div className="helper-node-card helper-node-card--outcome">
              <span>{outcome}</span>
              <small>Current outcome candidate</small>
            </div>
            <dl>
              <dt>Chain</dt><dd>A -&gt; B -&gt; C</dd>
              <dt>Fork</dt><dd>A &lt;- B -&gt; C</dd>
              <dt>Collider</dt><dd>A -&gt; B &lt;- C</dd>
              <dt>DAG</dt><dd>Directed acyclic graph</dd>
            </dl>
            <p className="mini-warning">Edges represent assumptions, not proven causal relationships.</p>
          </aside>
        </div>

        <div className="causal-action-row">
          <button onClick={handleValidateRolesAndGraph} type="button">Generate Graph</button>
          <button onClick={handleValidateEditedGraph} type="button">Validate Edited Graph</button>
          <button onClick={() => handleCausalPrompt("Why does graph validation matter?")} type="button">Why validate?</button>
        </div>

        {graphIssues.length > 0 && (
          <div className="validation-list">
            {graphIssues.map((issue, index) => (
              <p className={issue.severity === "blocking" || issue.severity === "high" ? "warning-line" : ""} key={`${issue.message}-${index}`}>
                {issue.message}
              </p>
            ))}
          </div>
        )}
      </article>

      <article className="panel wide causal-assistant-prompts">
        <div>
          <h2>Assistant Guidance</h2>
          <p>Try commands like: "use ADMG", "set lag 2", or "use ATE".</p>
        </div>
        <div className="assistant-prompt-row">
          {["What is the exposure?", "What could be a confounder?", "Is this a mediator or collider?", "Why does graph validation matter?"].map((prompt) => (
            <button key={prompt} onClick={() => handleCausalPrompt(prompt)} type="button">{prompt}</button>
          ))}
        </div>
      </article>
    </section>
  );
}

function demoCausalGraphDraft(): CausalGraphDraft {
  return {
    graph_type: "DAG",
    nodes: [
      {
        node_id: "sleep_quality",
        variable_name: "sleep_quality",
        display_name: "Sleep Quality",
        role: "exposure",
        temporal_role: "prior_window",
        data_category: "EMA / sleep",
        is_observed: true,
        confidence: "demo",
      },
      {
        node_id: "alcohol_use",
        variable_name: "alcohol_use",
        display_name: "Alcohol Use",
        role: "outcome",
        temporal_role: "next_window",
        data_category: "EMA label",
        is_observed: true,
        confidence: "demo",
      },
      {
        node_id: "exercise",
        variable_name: "exercise",
        display_name: "Exercise",
        role: "confounder",
        temporal_role: "prior_context",
        data_category: "Actigraphy",
        is_observed: true,
        confidence: "demo",
      },
      {
        node_id: "stress_level",
        variable_name: "stress_level",
        display_name: "Stress Level",
        role: "mediator",
        temporal_role: "intermediate",
        data_category: "EMA",
        is_observed: true,
        confidence: "demo",
      },
      {
        node_id: "phone_use",
        variable_name: "phone_use",
        display_name: "Phone Use",
        role: "proxy",
        temporal_role: "contextual_proxy",
        data_category: "Passive sensing",
        is_observed: true,
        confidence: "demo",
      },
    ],
    edges: [
      {
        source: "exercise",
        target: "sleep_quality",
        edge_type: "directed",
        rationale: "Demo assumption for review.",
        supporting_evidence: [],
        confidence: "demo",
        temporal_assumption: "Exercise precedes sleep.",
        user_editable: true,
      },
      {
        source: "exercise",
        target: "stress_level",
        edge_type: "directed",
        rationale: "Demo assumption for review.",
        supporting_evidence: [],
        confidence: "demo",
        temporal_assumption: "Exercise and activity context precede stress report.",
        user_editable: true,
      },
      {
        source: "sleep_quality",
        target: "stress_level",
        edge_type: "directed",
        rationale: "Demo assumption for review.",
        supporting_evidence: [],
        confidence: "demo",
        temporal_assumption: "Sleep quality precedes later stress.",
        user_editable: true,
      },
      {
        source: "sleep_quality",
        target: "phone_use",
        edge_type: "directed",
        rationale: "Demo assumption for review.",
        supporting_evidence: [],
        confidence: "demo",
        temporal_assumption: "Sleep context may precede phone-use proxy.",
        user_editable: true,
      },
      {
        source: "stress_level",
        target: "alcohol_use",
        edge_type: "directed",
        rationale: "Demo assumption for review.",
        supporting_evidence: [],
        confidence: "demo",
        temporal_assumption: "Stress precedes outcome window.",
        user_editable: true,
      },
      {
        source: "phone_use",
        target: "alcohol_use",
        edge_type: "directed",
        rationale: "Demo assumption for review.",
        supporting_evidence: [],
        confidence: "demo",
        temporal_assumption: "Phone-use proxy precedes outcome window.",
        user_editable: true,
      },
    ],
    uncertain_edges: [],
    omitted_variables: [],
    latent_confounder_warnings: [
      "Demo graph only. Review whether unmeasured confounding is plausible.",
    ],
    graph_rationale:
      "Demo graph for interactive causal-design review. Replace with backend graph generation when ready.",
    evidence_summary: "No evidence is implied by the demo graph.",
    limitations: [
      "Edges are assumptions, not proven causal relationships.",
      "This page does not estimate effects.",
    ],
  };
}

function PrototypeDag() {
  return (
    <div className="prototype-dag">
      <div className="dag-node dag-node--sleep">Sleep Quality<span>exposure</span></div>
      <div className="dag-node dag-node--exercise">Exercise<span>confounder</span></div>
      <div className="dag-node dag-node--stress">Stress Level<span>mediator</span></div>
      <div className="dag-node dag-node--phone">Phone Use<span>proxy</span></div>
      <div className="dag-node dag-node--alcohol">Alcohol Use<span>outcome</span></div>
      <svg viewBox="0 0 1000 420" aria-hidden="true">
        <defs>
          <marker id="arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#94a3b8" />
          </marker>
        </defs>
        <path d="M220 235 L390 135" />
        <path d="M220 255 L390 330" />
        <path d="M470 160 L560 225" />
        <path d="M470 310 L725 250" />
        <path d="M640 240 L725 240" />
      </svg>
      <aside>
        <strong>Click a node to define its role</strong>
        <p>Standard for most observational causal analyses where time ordering is clear.</p>
      </aside>
    </div>
  );
}

function TemporalStage({
  adjustmentSet,
  assumptions,
  graphDraft,
  handleAnalysisStrategy,
  handleAssumptionsReview,
  handleIdentificationCheck,
  handleStrategy,
  handleTemporalPrompt,
  handleTemporalRagEvidence,
  identification,
  roleRecommendations,
  schema,
  strategy,
  temporalRagSummary,
}: {
  adjustmentSet: string[];
  assumptions: AssumptionReviewResponse | null;
  graphDraft: CausalGraphDraft | null;
  handleAnalysisStrategy: (params: {
    exposure?: string;
    outcome?: string;
    estimandType?: string;
  }) => void;
  handleAssumptionsReview: (params: { exposure?: string; outcome?: string }) => void;
  handleIdentificationCheck: () => void;
  handleStrategy: () => void;
  handleTemporalPrompt: (prompt: string) => void;
  handleTemporalRagEvidence: () => void;
  identification: IdentificationCheckResponse | null;
  roleRecommendations: CausalRoleRecommendation[];
  schema: DatasetSchemaResponse | null;
  strategy: AnalysisStrategyResponse | null;
  temporalRagSummary: string;
}) {
  const [lagDays, setLagDays] = useState(1);
  const [exposureWindow, setExposureWindow] = useState(8);
  const [outcomeWindow, setOutcomeWindow] = useState(24);
  const [targetEstimand, setTargetEstimand] = useState("average_treatment_effect");
  const [candidateEstimator, setCandidateEstimator] = useState("Mixed-effects regression");
  const [sensitivityChecks, setSensitivityChecks] = useState<Record<string, boolean>>({
    "Missing data": true,
    "Positivity assumption": true,
    "Consistency / SUTVA": true,
    "Unmeasured confounding sensitivity": false,
    "Exclusion restriction": false,
    "Alternative lag windows": false,
    "Alternative adjustment sets": false,
    "Complete-case vs imputed analysis": false,
    "Participant-level robustness": false,
  });
  const timestampFields = schema?.possible_timestamp_date_columns ?? [];
  const idField = schema?.possible_id_columns[0] ?? null;
  const timingIsReady = Boolean(idField && timestampFields.length > 0 && lagDays >= 0);
  const strategyPlan = strategy?.strategy_plan;
  const completedRequired = Object.entries(sensitivityChecks)
    .slice(0, 5)
    .filter(([, checked]) => checked).length;
  const statusClass =
    identification?.identification_status === "ready_for_analysis_planning"
      ? "status-pill status-pill--ok"
      : identification?.identification_status === "not_identifiable_with_current_design"
        ? "status-pill status-pill--danger"
        : "status-pill status-pill--warn";
  const exposure = "acc_mean_magnitude";
  const outcome = "label";

  return (
    <section className="temporal-planner-page">
      <div className="temporal-status-row">
        <span className={timingIsReady ? "status-pill status-pill--ok" : "status-pill status-pill--warn"}>
          {timingIsReady ? "Exposure before outcome ✓" : "Temporal order needs review"}
        </span>
        <span>This page provides analysis strategy guidance only. No causal effect is estimated here.</span>
      </div>

      <article className="panel wide temporal-window-card">
        <div className="panel-heading">
          <div>
            <h2>Temporal Window Visualization</h2>
            <small>Temporal order is necessary but not sufficient for causal interpretation.</small>
          </div>
          <button onClick={handleTemporalRagEvidence} type="button">Retrieve evidence for estimation guidance</button>
        </div>
        <div className="timeline-scale">
          <div className="timeline-bars temporal-bars">
            <span className="exposure-bar" style={{ flex: exposureWindow }}>Exposure ({exposureWindow}h)</span>
            <span className="lag-bar" style={{ flex: Math.max(lagDays * 4, 2) }}>Lag {lagDays}d</span>
            <span className="outcome-bar" style={{ flex: outcomeWindow }}>Outcome ({outcomeWindow}h)</span>
          </div>
          <div className="timeline-ticks">
            <span>Night</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+24h</span><span>+30h</span>
          </div>
        </div>
        <div className="slider-grid">
          <label>
            Lag days <strong>{lagDays}d</strong>
            <input max={7} min={0} onChange={(event) => setLagDays(Number(event.target.value))} type="range" value={lagDays} />
          </label>
          <label>
            Exposure Window <strong>{exposureWindow}h</strong>
            <input max={24} min={1} onChange={(event) => setExposureWindow(Number(event.target.value))} step={1} type="range" value={exposureWindow} />
          </label>
          <label>
            Outcome Window <strong>{outcomeWindow}h</strong>
            <input max={24} min={1} onChange={(event) => setOutcomeWindow(Number(event.target.value))} step={1} type="range" value={outcomeWindow} />
          </label>
        </div>
        <div className="detected-timing-grid">
          <span><strong>Participant ID</strong>{idField ?? "Needs review"}</span>
          <span><strong>Timestamp fields</strong>{timestampFields.join(", ") || "Needs review"}</span>
          <span><strong>Current graph</strong>{graphDraft ? `${graphDraft.nodes.length} nodes, ${graphDraft.edges.length} edges` : "Generate graph first"}</span>
          <span><strong>Role recommendations</strong>{roleRecommendations.length || "Not run"}</span>
        </div>
        {!timingIsReady && (
          <p className="mini-warning">Lag structure cannot be fully verified without a reliable timestamp and participant ID.</p>
        )}
        <p className="stage-safety">
          Exposure is measured before the outcome. This supports temporal ordering, but does not by itself prove causality.
        </p>
        {temporalRagSummary && <p className="rag-summary">{temporalRagSummary}</p>}
      </article>

      <article className="panel identification-card">
        <div className="panel-heading">
          <h2>Identification Readiness</h2>
          <span className={statusClass}>{identification?.identification_status ?? "not checked"}</span>
        </div>
        <button onClick={handleIdentificationCheck} type="button">Run Identification Check</button>
        <InfoList
          items={[
            ["Exposure", identification?.exposure ?? exposure],
            ["Outcome", identification?.outcome ?? outcome],
            ["Adjustment set", (identification?.proposed_adjustment_set ?? adjustmentSet).join(", ") || "none"],
            ["Safe for strategy", identification ? String(identification.safe_to_continue_to_analysis_strategy) : "not checked"],
          ]}
        />
        {[...(identification?.warnings ?? []), ...(identification?.errors ?? [])].slice(0, 4).map((issue) => (
          <p className="warning-line" key={issue.message}>{issue.message}</p>
        ))}
      </article>

      <article className="panel estimator-card">
        <h2>Estimand & Estimator</h2>
        <label>
          Target Estimand
          <select value={targetEstimand} onChange={(event) => setTargetEstimand(event.target.value)}>
            <option value="average_treatment_effect">Average Treatment Effect</option>
            <option value="average_treatment_effect_on_treated">Average Treatment Effect on the Treated</option>
            <option value="conditional_average_treatment_effect">Conditional Average Treatment Effect</option>
            <option value="within_person_effect">Within-Person Effect</option>
            <option value="direct_effect">Direct Effect</option>
            <option value="total_effect">Total Effect</option>
          </select>
        </label>
        <label>
          Candidate Estimator
          <select value={candidateEstimator} onChange={(event) => setCandidateEstimator(event.target.value)}>
            <option>Mixed-effects regression</option>
            <option>Generalized estimating equations</option>
            <option>Inverse probability weighting</option>
            <option>Doubly robust estimator</option>
            <option>Fixed effects / within-person model</option>
            <option>Marginal structural model</option>
            <option>Not recommended with current design</option>
          </select>
        </label>
        <button onClick={() => handleAnalysisStrategy({ exposure, outcome, estimandType: targetEstimand })} type="button">
          Generate Analysis Strategy
        </button>
        {strategyPlan ? (
          <div className="strategy-summary">
            <InfoList
              items={[
                ["Status", strategyPlan.strategy_status],
                ["Estimand", strategyPlan.target_estimand],
                ["Exposure", strategyPlan.exposure_definition],
                ["Outcome", strategyPlan.outcome_definition],
                ["Time window", strategyPlan.time_window],
                ["Unit", strategyPlan.unit_of_analysis],
                ["Missing data", strategyPlan.missing_data_strategy],
                ["Repeated measures", strategyPlan.repeated_measures_handling],
              ]}
            />
            <p><strong>Estimator family:</strong> {strategyPlan.recommended_estimator_family.join(", ") || candidateEstimator}</p>
            <p><strong>Can claim:</strong> {strategyPlan.what_can_be_claimed}</p>
            <p><strong>Cannot claim:</strong> {strategyPlan.what_cannot_be_claimed}</p>
          </div>
        ) : (
          <p className="info-banner">Estimator guidance is conditional on the graph, identification result, and assumptions. No effect is estimated on this page.</p>
        )}
      </article>

      <article className="panel sensitivity-card">
        <div className="panel-heading">
          <h2>Sensitivity Plan</h2>
          <span className="soft-count">{completedRequired}/5 Required Checks Complete</span>
        </div>
        <div className="sensitivity-list">
          {Object.entries(sensitivityChecks).map(([item, checked]) => (
            <label key={item}>
              <input
                checked={checked}
                onChange={() => setSensitivityChecks((current) => ({ ...current, [item]: !current[item] }))}
                type="checkbox"
              />
              {item}
            </label>
          ))}
        </div>
        <button onClick={() => handleAssumptionsReview({ exposure, outcome })} type="button">Review Assumptions</button>
        {assumptions ? (
          <div className="assumption-list">
            {assumptions.review.assumptions.slice(0, 6).map((assumption) => (
              <article className={`assumption-item assumption-item--${assumption.status}`} key={assumption.assumption_name}>
                <strong>{assumption.assumption_name}</strong>
                <span>{assumption.status}</span>
                <p>{assumption.rationale}</p>
                <small>{assumption.recommended_check}</small>
              </article>
            ))}
          </div>
        ) : (
          <p>Review assumptions after identification and strategy guidance are generated.</p>
        )}
      </article>

      <article className="panel wide temporal-guidance-card">
        <div>
          <h2>Assistant Guidance</h2>
          <p>Your current design uses a {lagDays}-day lag. I will check whether the dataset has participant IDs and timestamps needed to support this timing.</p>
          <p>Estimator choice does not prove causality.</p>
        </div>
        <div className="assistant-prompt-row">
          {["Explain temporal ordering", "What is ATE?", "Why use mixed effects?", "What if positivity fails?", "Explain sensitivity analysis"].map((prompt) => (
            <button key={prompt} onClick={() => handleTemporalPrompt(prompt)} type="button">{prompt}</button>
          ))}
        </div>
        <button onClick={handleStrategy} type="button">Run Full Guidance Sequence</button>
      </article>
    </section>
  );
}

function ReviewStage({
  adjustmentSet,
  assumptions,
  broadExploration,
  candidateVariables,
  confirmedQuestion,
  graphDraft,
  graphValidation,
  handleReport,
  identification,
  onAssistantMessage,
  report,
  roleValidation,
  schema,
  selectedVariables,
  strategy,
  targetedFeasibility,
}: {
  adjustmentSet: string[];
  assumptions: AssumptionReviewResponse | null;
  broadExploration: BroadExplorationResponse | null;
  candidateVariables: CandidateVariableRecommendation[];
  confirmedQuestion: string;
  graphDraft: CausalGraphDraft | null;
  graphValidation: BackendCausalGraphValidation | null;
  handleReport: () => void;
  identification: IdentificationCheckResponse | null;
  onAssistantMessage: (message: AssistantMessage) => void;
  report: ReportGenerationResponse | null;
  roleValidation: BackendCausalRoleValidation | null;
  schema: DatasetSchemaResponse | null;
  selectedVariables: SelectedCausalVariable[];
  strategy: AnalysisStrategyResponse | null;
  targetedFeasibility: TargetedFeasibilityResponse | null;
}) {
  type ReviewClaim = {
    id: string;
    text: string;
    status: "linked" | "needs_review" | "blocked";
    reason: string;
    saferRewrite?: string;
  };

  const [selectedClaim, setSelectedClaim] = useState<ReviewClaim | null>(null);
  const [evidenceResults, setEvidenceResults] = useState<RagSearchResult[]>([]);
  const [evidenceMessage, setEvidenceMessage] = useState("Select a claim to see its sources.");
  const [approvalMessage, setApprovalMessage] = useState("");

  const linkedClaims: ReviewClaim[] = [
    {
      id: "linked-1",
      text: "The proposed design evaluates an association under a specified causal model.",
      status: "linked",
      reason: "This wording stays within design guidance and stated assumptions.",
    },
    {
      id: "linked-2",
      text: "The selected adjustment set is based on the current DAG assumptions.",
      status: "linked",
      reason: "It links the adjustment set to the graph rather than claiming truth.",
    },
    {
      id: "linked-3",
      text: "Temporal ordering is supported if exposure is measured before outcome.",
      status: "linked",
      reason: "This treats timing as necessary support, not causal proof.",
    },
    {
      id: "linked-4",
      text: "Results, if estimated later, should be interpreted under stated assumptions.",
      status: "linked",
      reason: "This preserves the boundary between design guidance and future results.",
    },
  ];
  const reviewClaims: ReviewClaim[] = [
    {
      id: "review-1",
      text: "Sleep-related passive sensing features may help characterize next-window alcohol-use risk.",
      status: "needs_review",
      reason: "Needs careful wording because this is not a treatment, diagnosis, or validated prediction claim.",
      saferRewrite:
        "Sleep-related passive sensing features are candidate variables for later design review and validation.",
    },
  ];
  const blockedClaims: ReviewClaim[] = [
    {
      id: "blocked-1",
      text: "Stress causes alcohol use.",
      status: "blocked",
      reason: "Overstates causality without completed estimation and assumptions.",
      saferRewrite:
        "Stress patterns were explored as candidate variables of interest, but this design does not prove that stress causes alcohol use.",
    },
    {
      id: "blocked-2",
      text: "Participants will relapse if sleep falls below 5 hours.",
      status: "blocked",
      reason: "Diagnostic/predictive clinical claim outside project scope.",
      saferRewrite:
        "Short sleep may be reviewed as a candidate risk-related signal, but this tool does not predict relapse.",
    },
    {
      id: "blocked-3",
      text: "This graph proves that poor sleep causes alcohol use.",
      status: "blocked",
      reason: "Graph edges are assumptions, not proven causal relationships.",
      saferRewrite:
        "This graph represents assumptions to be reviewed before any later causal analysis.",
    },
    ...(report?.claim_audit.unsafe_claims_found.map((finding, index) => ({
      id: `backend-blocked-${index}`,
      text: finding.unsafe_language,
      status: "blocked" as const,
      reason: `Backend claim audit severity: ${finding.severity}.`,
      saferRewrite: finding.suggested_safe_alternative,
    })) ?? []),
  ];
  const allClaims = [...linkedClaims, ...reviewClaims, ...blockedClaims];
  const missingSections = [
    !confirmedQuestion && "No confirmed research question yet",
    !graphValidation && "No graph validation result yet",
    !identification && "No identification result yet",
    !strategy && "No analysis strategy yet",
    !assumptions && "No assumptions review yet",
  ].filter((item): item is string => Boolean(item));
  const graphNodes = graphDraft?.nodes.length ?? 0;
  const graphEdges = graphDraft?.edges.length ?? 0;
  const exposure =
    strategy?.exposure ||
    graphDraft?.nodes.find((node) => node.role.toLowerCase().includes("exposure"))?.variable_name ||
    "acc_mean_magnitude";
  const outcome =
    strategy?.outcome ||
    graphDraft?.nodes.find((node) => node.role.toLowerCase().includes("outcome"))?.variable_name ||
    "label";
  const mediators =
    graphDraft?.nodes
      .filter((node) => node.role.toLowerCase().includes("mediator"))
      .map((node) => node.display_name || node.variable_name)
      .join(", ") || "Needs review";
  const proxies =
    graphDraft?.nodes
      .filter((node) => node.role.toLowerCase().includes("proxy"))
      .map((node) => node.display_name || node.variable_name)
      .join(", ") || "Needs review";

  async function verifyClaimEvidence(claim: ReviewClaim) {
    setSelectedClaim(claim);
    setEvidenceResults([]);
    setEvidenceMessage("Searching uploaded documents...");
    try {
      const response = await searchRag(
        `${claim.text} ${confirmedQuestion} ${exposure} ${outcome} measurement timing assumptions estimator guidance`,
        5,
      );
      setEvidenceResults(response.results);
      if (response.results.length === 0) {
        setEvidenceMessage("I could not find supporting details in the uploaded documents.");
      } else {
        setEvidenceMessage(`Found ${response.number_of_results} evidence snippet(s). Evidence snippets are references for design justification; they do not prove causal effects.`);
      }
    } catch (caughtError) {
      setEvidenceMessage(getIssueText(caughtError));
    }
  }

  async function verifyEvidenceLinks() {
    setEvidenceResults([]);
    setEvidenceMessage("Checking important report statements against uploaded documents...");
    try {
      const response = await searchRag(
        `${confirmedQuestion} ${exposure} ${outcome} measurement timing assumptions adjustment set estimator guidance sensitivity plan EMA passive sensing`,
        8,
      );
      setEvidenceResults(response.results);
      setEvidenceMessage(
        response.results.length > 0
          ? `Found ${response.number_of_results} supporting snippet(s) for report-level evidence links. Do not treat snippets as causal proof.`
          : "I could not find supporting details in the uploaded documents.",
      );
      onAssistantMessage({
        role: "assistant",
        text:
          response.results.length > 0
            ? "I found evidence snippets for report review. They can support design justification, but they do not prove causal effects."
            : "I could not find supporting details in the uploaded documents.",
        sources: response.results
          .map((result) => result.source_filename)
          .filter((value): value is string => Boolean(value)),
      });
    } catch (caughtError) {
      setEvidenceMessage(getIssueText(caughtError));
    }
  }

  function exportJson() {
    const payload = report ?? buildLocalReportPreview();
    downloadText(
      `causal_design_guidance_report_${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }

  function exportMarkdown() {
    downloadText(
      `causal_design_guidance_report_${new Date().toISOString().slice(0, 10)}.md`,
      buildMarkdownReport(),
      "text/markdown",
    );
  }

  function downloadText(filename: string, text: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleApprove() {
    if (missingSections.length > 0) {
      setApprovalMessage(`Cannot approve yet: ${missingSections.join("; ")}.`);
      return;
    }
    if (blockedClaims.length > 0) {
      setApprovalMessage("Cannot approve while blocked claims remain. Rewrite or remove blocked claims first.");
      onAssistantMessage({
        role: "assistant",
        text: "I found blocked claims. They imply causal proof or clinical prediction beyond the current design. Use the safer rewrites before approving.",
      });
      return;
    }
    setApprovalMessage("Design artifact approved for review/export.");
  }

  function buildLocalReportPreview() {
    return {
      report_type: "Causal Design and Analysis Guidance Report",
      project_summary: "Causal Studio causal-design support artifact",
      confirmed_question: confirmedQuestion || demoQuestion,
      dataset_summary: schema
        ? { rows: schema.number_of_rows, columns: schema.number_of_columns }
        : "Schema not parsed",
      broad_exploration_summary: broadExploration,
      selected_variables: selectedVariables.map((variable) => variable.variable_name),
      targeted_feasibility: targetedFeasibility,
      graph_summary: { nodes: graphNodes, edges: graphEdges, validation: graphValidation?.graph_validation_status },
      identification_status: identification?.identification_status ?? "not checked",
      analysis_strategy: strategy?.strategy_plan ?? "not generated",
      assumptions_review: assumptions?.review ?? "not reviewed",
      claim_audit: { linked: linkedClaims.length, needs_review: reviewClaims.length, blocked: blockedClaims.length },
      what_cannot_be_claimed:
        "No causal effect is estimated here. Clinical prediction, diagnosis, or treatment recommendations are outside scope.",
    };
  }

  function buildMarkdownReport() {
    const plan = strategy?.strategy_plan;
    return `# Causal Design and Analysis Guidance Report

## Project Summary
Causal Studio causal-design support artifact. This is not a causal results report.

## Confirmed Causal Question
${confirmedQuestion || demoQuestion}

## Dataset and Schema Summary
${schema ? `${schema.number_of_rows.toLocaleString()} rows and ${schema.number_of_columns} columns.` : "Schema not parsed."}

## Variable Definitions and Roles
Exposure: ${exposure}
Outcome: ${outcome}
Adjustment set: ${adjustmentSet.join(", ") || "Needs review"}

## Causal Graph Summary
Nodes: ${graphNodes}
Edges: ${graphEdges}
Validation: ${graphValidation?.graph_validation_status ?? "not run"}

## Identification Review
${identification?.plain_language_summary ?? "Identification has not been checked."}

## Analysis Strategy Guidance
${plan ? `${plan.target_estimand}. ${plan.recommended_estimator_family.join(", ")}. ${plan.what_can_be_claimed}` : "Analysis strategy has not been generated."}

## Assumptions and Sensitivity Plan
${assumptions?.review.sensitivity_checks.join("\n") ?? "Assumptions have not been reviewed."}

## Claim Safety Audit
Blocked claims: ${blockedClaims.length}
Needs review: ${reviewClaims.length}
Linked claims: ${linkedClaims.length}

## What Cannot Be Claimed
No causal effect is estimated here. Do not make clinical prediction, diagnosis, treatment recommendation, or causal proof claims.
`;
  }

  function handleReviewPrompt(prompt: string) {
    const responses: Record<string, string> = {
      "Explain blocked claims":
        `Blocked claims include causal proof, diagnosis, treatment, relapse prediction, or unsupported claims. Current blocked count: ${blockedClaims.length}.`,
      "What can I safely claim?":
        "You can safely describe the proposed causal design, variables, graph assumptions, adjustment rationale, data limitations, and analysis guidance under stated assumptions.",
      "Show missing sections":
        missingSections.length > 0 ? missingSections.join("; ") : "All required review sections are present.",
      "Summarize report":
        `This is a Causal Design and Analysis Guidance Report for: ${confirmedQuestion || demoQuestion}. It does not report estimated causal effects.`,
      "Check evidence links":
        "Use Verify Evidence Links or select a claim. I will retrieve uploaded document snippets without inventing citations or claiming proof.",
    };
    onAssistantMessage({
      role: "assistant",
      text: responses[prompt] ?? "This page audits design completeness, evidence links, and unsafe claims.",
    });
  }

  return (
    <section className="review-export-page">
      <div className="review-top-actions">
        <div className="status-pill status-pill--warn">
          {blockedClaims.length} blocked claims
        </div>
        <button onClick={exportMarkdown} type="button">Export Report</button>
        <button className="primary-action" onClick={handleApprove} type="button">Approve & Sign Off</button>
      </div>

      <article className="panel analysis-story">
        <div className="panel-heading">
          <div>
            <h2>Analysis Story</h2>
            <small>Assembled from prior workflow stages.</small>
          </div>
          <span className="tag">Guidance Report</span>
        </div>
        <h3>Research Question</h3>
        <p>{confirmedQuestion || demoQuestion}</p>
        <h3>DAG Summary</h3>
        <InfoList
          items={[
            ["Exposure", exposure],
            ["Outcome", outcome],
            ["Adjustment set", adjustmentSet.join(", ") || "Needs review"],
            ["Mediators", mediators],
            ["Proxies", proxies],
            ["Graph validation", graphValidation?.graph_validation_status ?? "No graph validation result yet"],
            ["Nodes / Edges", `${graphNodes} nodes / ${graphEdges} edges`],
          ]}
        />
        <h3>Assumptions</h3>
        <ul className="review-bullet-list">
          {(assumptions?.review.assumptions.map((assumption) => `${assumption.assumption_name}: ${assumption.status}`) ?? [
            "Temporal ordering: needs review",
            "No unmeasured confounding / exchangeability: needs review",
            "Positivity: needs review",
            "Consistency: needs review",
            "SUTVA / no interference: needs review",
            "Measurement validity: needs review",
            "Missingness assumptions: needs review",
          ]).slice(0, 8).map((item) => <li key={item}>{item}</li>)}
        </ul>
        <h3>Timing</h3>
        <InfoList
          items={[
            ["Exposure window", strategy?.strategy_plan.time_window ?? "Window t / needs review"],
            ["Lag", "1 day / next observation window"],
            ["Outcome window", "Next observation window"],
            ["Timestamp field", schema?.possible_timestamp_date_columns[0] ?? "No timestamp detected"],
            ["Participant ID", schema?.possible_id_columns[0] ?? "No participant ID detected"],
          ]}
        />
        <h3>Sensitivity</h3>
        <ul className="review-bullet-list">
          {(assumptions?.review.sensitivity_checks ?? [
            "Missing data sensitivity",
            "Alternative lag windows",
            "Alternative adjustment sets",
            "Unmeasured confounding sensitivity",
            "Complete-case vs imputed analysis",
            "Participant-level robustness",
          ]).map((item) => <li key={item}>{item}</li>)}
        </ul>
        {missingSections.length > 0 && (
          <div className="incomplete-list">
            {missingSections.map((item) => <span key={item}>{item}</span>)}
          </div>
        )}
        <p className="stage-safety">This report describes a causal design and analysis guidance plan. It does not report estimated causal effects.</p>
      </article>

      <article className="panel claim-auditor">
        <div className="panel-heading">
          <div>
            <h2>Claim Auditor</h2>
            <small>{blockedClaims.length} blocked claims · {linkedClaims.length} linked claims · {reviewClaims.length} needs review</small>
          </div>
          <button onClick={handleReport} type="button">Generate Report</button>
        </div>
        <div className="claim-stack">
          {allClaims.map((claim) => (
            <button
              className={`claim-card claim-card--${claim.status}`}
              key={claim.id}
              onClick={() => verifyClaimEvidence(claim)}
              type="button"
            >
              <strong>{claim.text}</strong>
              <span>{claim.status.replace("_", " ")}</span>
              <p>{claim.reason}</p>
              {claim.saferRewrite && <small>Safer rewrite: {claim.saferRewrite}</small>}
            </button>
          ))}
        </div>
      </article>

      <article className="panel evidence-card">
        <div className="panel-heading">
          <div>
            <h2>Evidence Source Verification</h2>
            <small>Evidence snippets are references for design justification. They do not prove causal effects.</small>
          </div>
          <button onClick={verifyEvidenceLinks} type="button">Verify Evidence Links</button>
        </div>
        <p>{selectedClaim ? `Selected claim: ${selectedClaim.text}` : evidenceMessage}</p>
        {selectedClaim && <p>{evidenceMessage}</p>}
        <div className="evidence-snippet-list">
          {evidenceResults.slice(0, 5).map((result, index) => (
            <article key={`${result.source_filename}-${result.chunk_index}-${index}`}>
              <strong>{result.source_filename || "Uploaded document"}</strong>
              <small>
                {result.file_extension || "document"} · chunk {result.chunk_index ?? "?"}
                {typeof result.distance === "number" ? ` · distance ${result.distance.toFixed(3)}` : ""}
              </small>
              <p>{result.chunk_text}</p>
            </article>
          ))}
        </div>
      </article>

      <article className="panel report-export-card">
        <div className="panel-heading">
          <div>
            <h2>Causal Design and Analysis Guidance Report</h2>
            <small>This is a design and analysis guidance report, not a causal results report.</small>
          </div>
          <div className="export-actions">
            <button onClick={handleReport} type="button">Generate Report</button>
            <button onClick={exportJson} type="button">Export JSON</button>
            <button onClick={exportMarkdown} type="button">Export Markdown</button>
            <button disabled type="button">Export PDF planned</button>
          </div>
        </div>
        <div className="report-preview">
          <h3>Project Summary</h3>
          <p>{report?.project_summary ? JSON.stringify(report.project_summary) : "Causal Studio causal-design support artifact."}</p>
          <h3>Confirmed Causal Question</h3>
          <p>{report?.final_research_question ?? confirmedQuestion ?? demoQuestion}</p>
          <h3>Variable Definitions and Roles</h3>
          <p>{selectedVariables.map((variable) => variable.variable_name).join(", ") || "No variables selected."}</p>
          <h3>Identification Review</h3>
          <p>{identification?.plain_language_summary ?? "Identification review has not been run."}</p>
          <h3>Analysis Strategy Guidance</h3>
          <p>{strategy?.strategy_plan.estimator_rationale ?? "Analysis strategy has not been generated."}</p>
          <h3>What Can and Cannot Be Claimed</h3>
          <p>{report?.what_can_be_claimed ?? "You can describe the design, assumptions, and planned analysis guidance."}</p>
          <p>{report?.what_cannot_be_claimed ?? "You cannot claim causal proof, clinical prediction, diagnosis, treatment recommendations, or estimated effects from this page."}</p>
        </div>
        {approvalMessage && <p className={approvalMessage.startsWith("Design artifact approved") ? "status-strip" : "status-strip status-strip--error"}>{approvalMessage}</p>}
      </article>

      <article className="panel wide review-assistant-actions">
        <div>
          <h2>Assistant Review</h2>
          <p>I am reviewing the Analysis Story for completeness, evidence links, unsafe claims, and missing assumptions.</p>
        </div>
        <div className="assistant-prompt-row">
          {["Explain blocked claims", "What can I safely claim?", "Show missing sections", "Summarize report", "Check evidence links"].map((prompt) => (
            <button key={prompt} onClick={() => handleReviewPrompt(prompt)} type="button">{prompt}</button>
          ))}
        </div>
      </article>
    </section>
  );
}

function InfoList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="info-list">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChartCard({ title, variant }: { title: string; variant?: "line" | "area" }) {
  return (
    <article className="panel chart-card">
      <h2>{title}</h2>
      <div className={`fake-chart fake-chart--${variant ?? "bar"}`}>
        <span /><span /><span /><span /><span />
      </div>
    </article>
  );
}
