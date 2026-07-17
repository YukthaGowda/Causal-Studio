# Causal Design Agent Testing Checklist

This checklist is for local demo testing. Causal Design Agent is a causal-design support tool. It does not estimate causal effects, prove causal conclusions, provide diagnosis, or provide treatment guidance.

## Local Setup

Backend:

```powershell
cd "<path-to-causal-design-agent>\backend"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

Frontend:

```powershell
cd "<path-to-causal-design-agent>\frontend"
npm install
npm run dev
```

Open the app at `http://localhost:5173`. If the backend is on port `8010`, make sure `frontend/src/api/health.ts` points to `http://127.0.0.1:8010`.

## Environment Variables

Keep real secrets only in `backend/.env`. Do not commit that file.

Useful variables:

```text
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=your_model_here
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_langsmith_api_key_here
LANGCHAIN_PROJECT=causal-design-agent
```

If `OPENAI_API_KEY` is missing, LLM explanation is unavailable because the API key is not configured, but deterministic checks still work.

## Demo Dataset

Use `15_result_indexed_dataset_window1_distance1.csv`.

Expected schema facts:

- Rows: `1106`
- Columns: `74`
- Possible ID column: `pid`
- Possible timestamp/date columns: `time_of_day`, `day_of_week`, `time_stamp`
- Missingness example: `avg_latitude` around `40.69%`

Demo objective:

```text
I want to study temporal relationships between sleep, stress, and next-day alcohol use.
```

Demo question:

```text
Among adults in the uploaded EMA/passive sensing dataset, what is the effect of sleep-related features during window t on alcohol-use-related label during the next observation window?
```

Demo variables:

- `pid`
- `label`
- `time_stamp`
- `time_of_day`
- `day_of_week`
- `acc_min_magnitude`
- `acc_max_magnitude`
- `acc_mean_magnitude`
- `avg_latitude`

## Page Checklist

Home / Project Setup:

- Upload a CSV dataset.
- Upload PDF or DOCX project documents.
- List uploaded documents.
- Ingest documents.
- Run a RAG check.
- Submit project details.
- Confirm missing dataset/document warnings are friendly.

Data Foundation:

- Confirm uploaded datasets appear.
- Parse schema.
- Confirm variables populate.
- Confirm ID and timestamp fields appear.
- Confirm missingness warnings appear.
- Run schema evidence check if RAG documents are ingested.

Explore:

- Select the dataset.
- Run broad exploration.
- Confirm row/column summary appears.
- Confirm detected ID/timestamp fields appear.
- Confirm missingness, coverage, participant, temporal, and correlation summaries appear.
- Confirm promoted patterns work.
- Confirm wording says exploratory patterns do not establish causality.

Causal Design Agent:

- Enter the demo objective.
- Generate candidate questions if an API key is available.
- Manually enter the demo question if no API key is configured.
- Select exposure `acc_mean_magnitude`.
- Select outcome `label`.
- Select the demo variables.
- Run candidate variable recommendation.
- Run targeted feasibility.
- Run role recommendation and deterministic validation.
- Generate graph.
- Drag graph nodes in React Flow.
- Validate edited graph.
- Confirm warnings are shown for ID variables, high missingness, and temporal/context variables.
- Confirm graph edges are framed as assumptions.

Temporal & Estimation:

- Confirm exposure, outcome, and selected variables are recoverable from current frontend state.
- Set lag days to `1`.
- Set exposure window to `8h`.
- Set outcome window to `24h`.
- Run identification check.
- Generate analysis strategy.
- Review assumptions and sensitivity planning.
- Retrieve RAG evidence if documents are ingested.
- Confirm no effect estimate, p-value, or proven causal result is produced.

Review & Export:

- Confirm Analysis Story uses prior workflow state when available.
- Confirm incomplete prior sections show clear warnings.
- Confirm Claim Auditor blocks unsafe claims such as:
  - `Stress causes alcohol use.`
  - `Participants will relapse if sleep falls below 5 hours.`
  - `This graph proves that poor sleep causes alcohol use.`
- Confirm safer rewrites are shown.
- Confirm Evidence Source Verification can use RAG.
- Generate the report.
- Confirm report title is `Causal Design and Analysis Guidance Report`.
- Confirm PDF export is disabled if not implemented.
- Confirm sign-off is blocked if unsafe claims remain.

## Backend Endpoint Smoke Tests

Use FastAPI docs at `http://127.0.0.1:8010/docs`.

Key endpoints:

- `GET /health`
- `POST /documents/upload`
- `GET /documents`
- `POST /documents/ingest`
- `GET /documents/ingest/status`
- `POST /rag/search`
- `POST /datasets/upload`
- `GET /datasets`
- `GET /datasets/{filename}/schema`
- `POST /exploration/broad`
- `POST /exploration/targeted-feasibility`
- `POST /causal-questions/generate`
- `POST /candidate-variables/recommend`
- `POST /causal-roles/recommend-and-validate`
- `POST /causal-graph/generate-and-validate`
- `POST /causal-graph/validate-edited`
- `POST /identification/check`
- `POST /analysis-strategy/generate`
- `POST /assumptions/review`
- `POST /reports/generate`
- `POST /assistant/chat`
- `GET /debug/langsmith-status`

## Deterministic Features

These should work without an OpenAI API key:

- Backend health check
- Document upload/list
- Dataset upload/list
- Schema parsing
- Broad exploration
- Targeted feasibility checks
- Deterministic role validation
- Deterministic graph validation
- Identification rule checks
- Claim auditing
- Report structure generation where implemented without LLM narrative

## API-Key-Dependent Features

These may use the OpenAI API when configured, with deterministic fallbacks or friendly errors when missing:

- Candidate causal question generation
- Candidate variable recommendation narrative
- Role recommendation narrative
- Graph recommendation narrative
- Analysis strategy narrative
- Assumptions review narrative
- Assistant chat responses
- Report narrative drafting

## RAG Requirements

RAG search requires:

- Uploaded documents in `backend/uploads/documents/`
- Successful ingestion into `backend/chroma_db/`
- Matching embedding dependencies installed from `backend/requirements.txt`

If no documents are ingested, the UI should show:

```text
No ingested documents are available yet. Upload and ingest documents before running evidence search.
```

## Known Limitations

- Workflow state is primarily held in frontend state. Refreshing the page can require rerunning earlier steps.
- The app provides analysis guidance only. It does not estimate causal effects.
- PDF export is disabled unless explicitly implemented.
- Uploaded files, local ChromaDB data, generated reports, local virtual environments, and build outputs are intentionally ignored by Git.
- On Windows, the `python` command may resolve to the Microsoft Store alias. If backend startup fails, install Python normally, disable the Windows App Execution Alias for Python, or run the project through the backend `.venv` interpreter.

## Files That Should Not Be Committed

- `backend/.env`
- `backend/uploads/documents/`
- `backend/uploads/datasets/`
- `backend/chroma_db/`
- `backend/reports/generated/`
- `frontend/node_modules/`
- `frontend/dist/`
- Python `__pycache__/`
- Local temp files and generated demo artifacts
