# Causal Design Agent

Causal Design Agent is a React + FastAPI causal-design support dashboard for observational behavioral, clinical, EMA, wearable, smartphone, and passive-sensing data related to substance-use research.

It helps researchers design and review a causal analysis plan before estimation. It is not a diagnostic tool, not a treatment-decision system, and does not claim causal effects are proven.

The app combines a React + Vite frontend, a FastAPI backend, RAG over uploaded documents, a local ChromaDB vector store, LLM-assisted recommendations, deterministic backend validation, and LangGraph workflow orchestration.

## What Causal Design Agent Does

Causal Design Agent helps researchers:

- Upload study documents, protocols, papers, guidelines, and data dictionaries.
- Ingest PDF/DOCX documents into a RAG knowledge base.
- Search uploaded research documents through ChromaDB-backed retrieval.
- Upload CSV datasets.
- Parse dataset schema.
- Understand observation units, timestamps, IDs, missingness, and data quality.
- Explore the dataset broadly before narrowing to causal variables.
- Generate candidate causal research questions.
- Recommend candidate variables and derived features.
- Run targeted feasibility checks on selected variables.
- Recommend provisional causal roles.
- Validate causal roles using deterministic backend rules.
- Generate and validate a draft causal graph.
- Run identification readiness checks.
- Create analysis strategy and estimation guidance.
- Review assumptions and sensitivity plans.
- Generate a causal design and analysis guidance report.
- Coordinate the full process through an 8-step LangGraph workflow.

## What Causal Design Agent Does Not Do

Causal Design Agent does not:

- Diagnose patients.
- Recommend treatment.
- Replace clinicians, statisticians, causal inference experts, or domain experts.
- Prove causal effects.
- Automatically produce causal conclusions.
- Run final causal estimation yet, unless that capability is explicitly added later.

Exploratory patterns do not establish causality. The report output is a causal design and analysis guidance report, not a causal results report.

## Core Project Rule

The LLM recommends, explains, and drafts. Deterministic Python backend validation checks causal roles, timing, graph structure, identification readiness, assumptions, and claims.

## Official 8-Step Workflow

Hansoo's updated workflow is:

1. Project Setup and Document Upload
2. Data Foundation and Understanding
3. Broad Data Exploration
4. Causal Question and Provisional Variable Design
5. Targeted Variable Data Exploration and Feasibility Check
6. Causal Graph and Final Role Validation
7. Identification and Estimation Strategy
8. Review and Export

### 1. Project Setup and Document Upload

- Define the project title, research objective, and study context.
- Upload project documents such as protocols, papers, guidelines, and data dictionaries.
- Ingest documents into the RAG knowledge base for later evidence retrieval.
- Confirm that uploaded material is used for design support, not proof of causal effects.

### 2. Data Foundation and Understanding

- Upload or select a CSV dataset.
- Parse schema details such as rows, columns, data types, IDs, timestamps, missingness, and sample values.
- Identify possible participant IDs, date/time columns, numeric variables, categorical variables, and warnings.
- This step establishes what data exist; it does not make causal claims.

### 3. Broad Data Exploration

- Explore the whole dataset before choosing final variables.
- Review missingness, low variation, participant-level structure, timestamp coverage, possible outcomes, feature groups, and broad correlations.
- Use this step to understand feasibility and data quality.
- Exploratory patterns do not establish causality.

### 4. Causal Question and Provisional Variable Design

- Generate candidate causal research questions from the objective, dataset schema, and RAG evidence.
- Confirm one question for the current design workflow.
- Recommend candidate variables and possible derived features.
- Variable roles are provisional until graph and final role validation.

### 5. Targeted Variable Data Exploration and Feasibility Check

- Inspect selected variables in detail.
- Check exposure, outcome, timing, participant availability, missingness, overlap, comparator clarity, and lag feasibility.
- Decide whether the selected variables are safe to carry into graph design.
- If feasibility is poor, return to Step 4 and revise the question or variable set.

### 6. Causal Graph and Final Role Validation

- Recommend final causal roles for selected variables.
- Validate roles deterministically in the backend.
- Generate a draft causal graph and validate graph structure, timing, and unsafe edges.
- The graph is a reviewed design object, not proven causal structure.

### 7. Identification and Estimation Strategy

- Check whether the proposed design is identification-ready.
- Review adjustment sets, missing variables, assumptions, and graph-related issues.
- Generate analysis strategy and estimation guidance without running final estimation.
- Review assumptions, sensitivity checks, and robustness checks.

### 8. Review and Export

- Generate a structured causal design and analysis guidance report.
- Review final question, variables, role table, graph summary, identification status, strategy, assumptions, limitations, and claim audit.
- Ensure report language does not present causal conclusions as proven.
- Export support is currently structured JSON; richer report export can be improved later.

## Current Features Implemented

Implemented in the current repository:

- FastAPI backend foundation.
- React + Vite + TypeScript frontend foundation.
- Frontend/backend health check.
- Document upload.
- Document listing.
- PDF/DOCX ingestion into a local ChromaDB vector store.
- Document ingestion status.
- RAG search over ingested chunks.
- CSV dataset upload.
- Dataset listing.
- Dataset schema parsing.
- Broad data exploration.
- Candidate causal question generation.
- Candidate variable recommendation.
- Targeted variable feasibility check.
- Causal role recommendation and deterministic validation.
- Causal graph generation and deterministic graph validation.
- Identification check.
- Analysis strategy guidance.
- Assumptions and sensitivity planning.
- Review/export report generation.
- LangGraph workflow orchestration.
- Guided frontend workflow with active-step navigation.

Planned or future work:

- React Flow graph canvas.
- Stronger persisted workflow storage.
- LangSmith tracing and evaluation.
- SQLite-backed persistence.
- LangChain integration if needed for future orchestration/RAG workflows.

## Tech Stack

### Frontend

- React
- Vite
- TypeScript
- CSS

### Backend

- FastAPI
- Python
- pandas
- ChromaDB
- Sentence Transformers
- pypdf
- python-docx
- OpenAI API / LLM provider through environment variables
- python-dotenv
- NetworkX
- LangGraph

Planned backend additions:

- SQLite persistence
- LangChain, if useful for future RAG/orchestration layers
- LangSmith tracing/testing

## Repository Structure

```text
causal-design-agent/
  backend/
    app/
      api/
      services/
      rag/
      orchestration/
      validation/
      reports/
    uploads/
      documents/
      datasets/
    chroma_db/
    requirements.txt
  frontend/
    src/
      app/
      api/
      components/
      pages/
      styles/
      types/
    package.json
  docs/
  data/
  README.md
```

The following are intentionally ignored by Git:

- `backend/.env`
- `backend/uploads/`
- `backend/chroma_db/`
- Python cache files such as `__pycache__/`
- `frontend/node_modules/`
- `frontend/dist/`
- temporary files and OS-specific files

## Local Setup

These instructions assume Windows PowerShell.

### Backend

Open a terminal:

```powershell
cd "<path-to-causal-design-agent>\backend"
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

Backend URL:

```text
http://127.0.0.1:8000
```

API docs:

```text
http://127.0.0.1:8000/docs
```

If port `8000` is blocked on Windows, use another port:

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

### Frontend

Open a second terminal:

```powershell
cd "<path-to-causal-design-agent>\frontend"
npm install
npm.cmd run dev
```

Frontend URL:

```text
http://127.0.0.1:5173
```

On Windows PowerShell, `npm.cmd` may be needed instead of `npm`.

## Environment Variables

Local environment variables belong in `backend/.env`. This file is local only and must not be committed.

Example:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=your_model_here
```

The backend currently expects:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

The default model in backend code is currently `gpt-4o-mini` if `OPENAI_MODEL` is not provided.

## API Overview

Main backend endpoints currently include:

- `GET /`
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
- `POST /identification/check`
- `POST /analysis-strategy/generate`
- `POST /assumptions/review`
- `POST /reports/generate`
- `POST /workflow/start`
- `GET /workflow/{workflow_id}/state`
- `POST /workflow/{workflow_id}/advance`
- `POST /workflow/{workflow_id}/confirm`
- `POST /workflow/{workflow_id}/revise`

Use the FastAPI docs at `/docs` for request and response shapes.

## Data and Privacy Notes

- Uploaded datasets and documents are stored locally in `backend/uploads/`.
- ChromaDB files are generated locally in `backend/chroma_db/`.
- These folders are ignored by Git.
- Do not upload identifiable patient data during development.
- Use de-identified, synthetic, or sample data for local testing.
- Do not commit uploaded documents, uploaded datasets, generated vector stores, or reports containing sensitive data.

## Development Rules

- Keep causal validation logic deterministic in the Python backend.
- Do not put causal validation logic in the frontend.
- Do not hardcode API keys.
- Do not commit `.env`.
- Do not commit uploaded datasets or documents.
- Do not commit ChromaDB files.
- Do not present causal conclusions as proven.
- Treat LLM outputs as recommendations, explanations, and drafts.
- Require backend validation for roles, timing, graph structure, identification readiness, assumptions, and claims.
- Report output should be a causal design and analysis guidance report, not a causal results report.

## Next Planned Work

- React Flow causal graph canvas.
- Stronger workflow persistence beyond in-memory state.
- LangSmith tracing and testing.
- Improved report export styling.
- Better evidence citation display.
- More complete broad exploration visualizations.
- User authentication later if needed.
