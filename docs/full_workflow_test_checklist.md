# Causal Design Agent Full Workflow Test Checklist

Use this checklist for the 9-phase technical proof-of-concept demo pass.

## Local Setup

1. Start FastAPI:

```powershell
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

2. Start React:

```powershell
cd frontend
npm run dev
```

3. If the backend is on port `8010`, set `frontend/.env` locally:

```text
VITE_API_BASE_URL=http://127.0.0.1:8010
```

Do not commit `.env`.

## Backend Routes To Confirm

- `POST /assistant/action`
- `POST /questions/generate-candidates`
- `POST /variables/recommend-candidates`
- `POST /feasibility/check`
- `POST /causal-graph/generate`
- `POST /causal-graph/validate`
- `POST /analysis-strategy/generate`
- `POST /analysis-strategy/validate`
- `POST /estimation/validate-config`
- `POST /estimation/run`
- `GET /estimation/runs`
- `POST /estimation/select-primary`
- `POST /review-export/assemble`
- `POST /review-export/claim-audit`
- `POST /review-export/export`

## Demo Inputs

- Objective: `I want to study temporal relationships between passive sensing features and next-window alcohol-related labels.`
- Dataset: `15_result_indexed_dataset_window1_distance1.csv`
- Expected schema highlights: `1106` rows, `74` columns, ID `pid`, timestamps including `time_of_day`, `day_of_week`, and `time_stamp`.

## Phase Tests

### Phase 1 - Project Setup and Document Upload

- Backend status should show connected when FastAPI is running.
- CSV upload should save and parse the dataset.
- PDF/DOCX upload should save documents.
- Document ingestion should update ChromaDB status.
- RAG evidence check should return snippets or a clear no-evidence message.

### Phase 2 - Data Foundation and Understanding

- Real schema values should appear after parsing.
- Labels must be descriptive only, not final causal roles.
- Use labels such as Identifier, Timestamp, Time-varying, Smartphone-derived, Wearable-derived, Derived feature, and Needs clarification.

### Phase 3 - Broad Data Exploration

- Broad exploration should call the backend when available.
- Summaries should include missingness, participant/time structure, and exploratory warnings.
- Page must state exploratory patterns do not establish causality.

### Phase 4 - Causal Question and Provisional Variable Design

- Candidate question generation requires an uploaded and parsed dataset.
- Candidate variable recommendation requires a dataset and a draft/confirmed question.
- Outputs must use candidate/provisional wording, not proven causal wording.

### Phase 5 - Targeted Variable Exploration and Feasibility Check

- Feasibility checks are disabled until a question, dataset-backed exposure, and dataset-backed outcome exist.
- The page should show: `Confirm a question and variables before running feasibility checks.`
- Backend output should show selected variables, missingness, timing, and feasibility status.

### Phase 6 - Causal Graph and Final Role Validation

- Graph generation and validation are disabled until feasibility has run.
- The page should show: `Run feasibility checks before generating a graph.`
- Generated graph remains a draft and requires user review.
- Backend validation warnings/errors must be visible.

### Phase 7 - Identification and Analysis Strategy

- Identification buttons are disabled until a graph is confirmed.
- The page should show: `Confirm a graph before running identification.`
- Phase 7 should generate strategy guidance only, not numerical estimates.

### Phase 8 - Estimation and Calculation

- Config validation and estimation are disabled until an analysis strategy is confirmed.
- The page should show: `Confirm an analysis strategy before running estimation.`
- All numerical estimates must come from backend Python.
- Do not show fake point estimates, fake p-values, fake intervals, or fake diagnostics.
- If no backend run exists, show an empty state.

### Phase 9 - Review and Export

- Export is disabled until a primary Phase 8 run is selected, a report is generated, and claim audit has run.
- The page should show: `Select a primary estimation run before exporting the complete design and analysis package.`
- Claim audit must flag unsafe causal/proven/treatment-decision language.
- Report wording must say results are conditional on the selected model, data, and assumptions.

## Safety Checks

- The app must never present causal conclusions as proven.
- The LLM/assistant recommends, explains, and drafts only.
- Deterministic Python/backend validation remains the source of truth for roles, timing, graph checks, assumptions, claims, and estimation readiness.
- Do not log or export secrets, API keys, uploaded raw datasets, ChromaDB runtime files, or generated runtime reports.
