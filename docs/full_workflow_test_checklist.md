# Causal Design Agent Full Workflow Test Checklist

Use this checklist for a local 9-phase technical proof-of-concept demo pass.

## Local Setup

1. Start FastAPI from the repository root or from `backend`:

```powershell
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

If `python` opens the Microsoft Store alias, use:

```powershell
py -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

2. Start React:

```powershell
cd frontend
npm run dev
```

3. If the backend is on port `8010`, create `frontend/.env` locally:

```text
VITE_API_BASE_URL=http://127.0.0.1:8010
```

Do not commit `.env`.

## Backend Routes To Confirm

- `GET /health`
- `POST /documents/upload`
- `GET /documents`
- `POST /documents/validate-category`
- `POST /documents/ingest`
- `GET /documents/ingest/status`
- `POST /rag/search`
- `POST /datasets/upload`
- `GET /datasets`
- `GET /datasets/{filename}/schema`
- `POST /exploration/broad`
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
- `GET /debug/langsmith-status`
- `POST /debug/test-trace`

## Demo Inputs

- Objective: `I want to study temporal relationships between sleep, stress, and next-day alcohol use.`
- Dataset: `15_result_indexed_dataset_window1_distance1.csv`
- Expected schema highlights: `1106` rows, `74` columns, ID `pid`, timestamps including `time_of_day`, `day_of_week`, and `time_stamp`.
- Demo variables: `pid`, `label`, `time_stamp`, `time_of_day`, `day_of_week`, `acc_min_magnitude`, `acc_max_magnitude`, `acc_mean_magnitude`, `avg_latitude`.

## Phase 1 - Project Setup And Document Upload

- Confirm backend status changes to connected when FastAPI is running.
- Upload one CSV dataset.
- Confirm upload status and immediate schema parse.
- Upload a data dictionary, protocol, research paper, and guidance document where available.
- Confirm document category validation returns success, warning, or clarification status.
- Ingest documents.
- Check ingestion status and chunk count.
- Run RAG evidence check.
- Confirm any no-evidence result is explicit and not a crash.

## Phase 2 - Data Foundation And Understanding

- Open Data Foundation after dataset upload.
- Confirm real row and column counts appear.
- Confirm possible ID columns and timestamp/date columns appear.
- Confirm missingness and high-missingness warnings appear.
- Confirm duplicate row and participant-time duplicate summaries appear when available.
- Confirm labels are descriptive only: Identifier, Timestamp, Time-varying, EMA/self-report, Smartphone-derived, Wearable-derived, Derived feature, Needs clarification.
- Confirm the page does not assign final causal labels such as Exposure, Outcome, Confounder, or Mediator.

## Phase 3 - Broad Data Exploration

- Run broad exploration with backend connected.
- Confirm summaries are labeled Python-computed when backend results are returned.
- Confirm missingness, participant/time structure, correlation or numeric summaries, and warnings are shown when present.
- Save at least one exploration view.
- Use Compare Variables and confirm the assistant note is exploratory only.
- Promote one pattern.
- Confirm the page says exploratory patterns do not establish causality.
- Stop backend and confirm fallback/demo mode does not crash.

## Phase 4 - Causal Question And Provisional Variable Design

- Generate candidate causal questions from the objective and schema.
- Confirm each question is labeled candidate/provisional.
- Select or edit one question.
- Generate candidate variables.
- Confirm recommendations are provisional and require human review.
- Confirm variables can be accepted, modified, or excluded.
- Confirm no output says a causal relationship is proven.

## Phase 5 - Targeted Variable Exploration And Feasibility Check

- Choose a dataset-backed exposure and outcome.
- Run feasibility check.
- Confirm selected variables, participant ID, timestamp, lag, missingness, overlap, and warnings are visible.
- Confirm `avg_latitude` high missingness is flagged when present.
- Confirm the result is an analysis-readiness/feasibility check only.

## Phase 6 - Causal Graph And Final Role Validation

- Generate a draft graph after feasibility.
- Confirm graph appears in React Flow.
- Drag nodes and edit edges.
- Validate the edited graph with backend validation.
- Confirm warnings/errors are visible and clear.
- Confirm the graph is labeled a draft requiring user review.

## Phase 7 - Identification And Analysis Strategy

- Run identification check after graph confirmation.
- Generate analysis strategy guidance.
- Review assumptions and sensitivity planning.
- Confirm outputs are guidance only and not numerical estimates.
- Confirm the UI does not claim identification proves the effect.

## Phase 8 - Estimation And Calculation

- Validate estimation configuration.
- Run estimation only after prerequisites are complete.
- Confirm any numerical output comes from backend Python.
- Confirm proof-of-concept messaging is visible.
- Confirm estimates are described as conditional on the selected data, model, adjustment set, and assumptions.
- Confirm no fake point estimates, fake intervals, or fake p-values appear when backend data is missing.
- Select a primary run for Phase 9.

## Phase 9 - Review And Export

- Generate the review package.
- Confirm the selected Phase 8 run appears in the report.
- Run claim audit.
- Confirm unsafe causal, proven, predictive, diagnostic, or treatment-decision claims are blocked.
- Export JSON and Markdown.
- Use PDF preview only after export readiness checks pass.
- Confirm the report title and wording make clear this is a causal design and analysis guidance report.

## Assistant And Tracing

- Ask a simple setup question through the assistant.
- Click one interpretation/action button.
- Confirm `/assistant/action` is called when backend is available.
- Confirm fallback mode is clear when backend is unavailable.
- Check `/debug/langsmith-status`.
- Confirm API keys are not returned to the frontend.

## Safety Checks

- The app must never present causal conclusions as proven.
- The assistant recommends, explains, and drafts only.
- Deterministic Python/backend validation remains the source of truth for roles, timing, graph checks, assumptions, claims, and estimation readiness.
- Do not commit `.env`, API keys, uploaded data/documents, ChromaDB runtime files, generated reports, `node_modules`, `dist`, caches, or virtual environments.
