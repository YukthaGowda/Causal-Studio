# Final Technical POC Checklist

Causal Design Agent is a causal-design support tool. It helps organize study context, evidence, data structure, graph assumptions, estimation configuration, and review/export workflows. It is not a diagnostic tool, treatment-decision system, or causal proof engine.

## 9-Phase Workflow

1. Phase 1 - Project Setup and Document Upload
   - Upload CSV datasets and supporting PDF/DOCX documents.
   - Store uploads locally in ignored upload folders.
   - Ingest documents into local ChromaDB for retrieval.

2. Phase 2 - Data Foundation and Understanding
   - Parse CSV schema through FastAPI and pandas.
   - Show rows, columns, data types, missingness, possible IDs, timestamps, and sample values.
   - Use descriptive labels only: Identifier, Timestamp, Time-varying, Smartphone-derived, Wearable-derived, Derived feature, Needs clarification.
   - Do not assign final causal roles in this phase.

3. Phase 3 - Broad Data Exploration
   - Run Python backend summaries for missingness, participant structure, temporal fields, and correlations.
   - Treat patterns as exploratory and hypothesis-generating only.

4. Phase 4 - Causal Question and Provisional Variable Design
   - Generate or manually enter candidate causal questions.
   - Select provisional exposure, comparator, outcome, time window, and unit of analysis.
   - Candidate wording is provisional and requires user confirmation.

5. Phase 5 - Targeted Variable Exploration and Feasibility Check
   - Review selected variables, missingness, timestamps, participant structure, lag assumptions, and feasibility warnings.
   - Allow progression with warnings only when limitations are explicit.

6. Phase 6 - Causal Graph and Final Role Validation
   - Build or edit a DAG-like graph.
   - Backend validation checks graph structure, timing, cycles, self-loops, unknown nodes, invalid adjustment choices, and misuse of IDs/timestamps.
   - Graphs are design assumptions, not proof of causal structure.

7. Phase 7 - Identification and Analysis Strategy
   - Review adjustment set and identification guidance.
   - Generate analysis strategy and assumptions/sensitivity plan.
   - No effect estimation is performed in Phase 7.

8. Phase 8 - Estimation and Calculation
   - Run a technical proof-of-concept estimation in Python with statsmodels.
   - Return computed point estimate, standard error, confidence interval, p-value, sample size, diagnostics, warnings, and reproducibility metadata.
   - The LLM may interpret computed output but must not generate or modify numerical estimates.

9. Phase 9 - Review and Export
   - Review the complete causal design and selected primary Phase 8 estimation run.
   - Run deterministic claim audit.
   - Generate a Causal Design, Estimation, and Evidence Report.
   - Export JSON and Markdown from the frontend. Backend PDF export remains planned.

## Backend-Connected Areas

- Health check: `GET /health`
- Dataset upload/list/schema: `POST /datasets/upload`, `GET /datasets`, `GET /datasets/{filename}/schema`
- Document upload/list/ingestion/status: `POST /documents/upload`, `GET /documents`, `POST /documents/ingest`, `GET /documents/ingest/status`
- RAG search: `POST /rag/search`
- Broad exploration: `POST /exploration/broad`
- Targeted feasibility: `POST /exploration/targeted-feasibility`
- Assistant actions: `POST /assistant/action`
- Causal question generation: `POST /causal-questions/generate`
- Candidate variable recommendation: `POST /candidate-variables/recommend`
- Causal role recommendation/validation: `POST /causal-roles/recommend-and-validate`
- Causal graph generation/validation: `POST /causal-graph/generate-and-validate`, `POST /causal-graph/validate`, `POST /causal-graph/validate-edited`
- Identification: `POST /identification/check`
- Analysis strategy: `POST /analysis-strategy/generate`
- Assumptions review: `POST /assumptions/review`
- Phase 8 estimation: `POST /estimation/run`, `GET /estimation/runs`, `POST /estimation/interpret`
- Review/export: `POST /reports/generate`, `POST /reports/audit-claims`
- LangGraph workflow: `POST /workflow/start`, `GET /workflow/{workflow_id}/state`, `POST /workflow/{workflow_id}/advance`, `POST /workflow/{workflow_id}/confirm`, `POST /workflow/{workflow_id}/revise`
- LangSmith debug: `GET /debug/langsmith-status`, `POST /debug/test-trace`

## Partial or Demo Areas

- Some frontend phases still include static/demo UI affordances for the approved prototype look.
- Advanced causal estimators, refutation tests, multiple imputation, E-values, and full robustness workflows are placeholders unless explicitly computed by the backend.
- Backend PDF export is planned. Current PDF-like behavior is browser print preview.
- LLM-backed features require valid `OPENAI_API_KEY` and a model available to the configured project. Without this, deterministic fallback or helpful error messaging should appear.
- LangSmith tracing requires local LangSmith environment variables and must not expose keys.

## Python/R and GenAI Responsibilities

- Python backend is responsible for deterministic validation, schema parsing, RAG retrieval, graph checks, estimation calculations, diagnostics, reproducibility, and claim-audit rules.
- GenAI may recommend, explain, draft, and revise wording.
- GenAI must not invent numerical estimates, override deterministic validation, make treatment recommendations, diagnose, or present causal conclusions as proven.
- R is not currently part of the implemented backend; the proof of concept uses Python, pandas, ChromaDB, sentence-transformers, NetworkX, LangGraph, and statsmodels.

## RAG Usage

- Uploaded PDF/DOCX documents are stored in `backend/uploads/documents/`.
- Ingestion extracts text, chunks it, embeds chunks, and stores them in `backend/chroma_db/`.
- Search returns relevant snippets with source metadata.
- Retrieved evidence supports design review and limitations, not causal proof.

## Assistant Action Behavior

- `/assistant/action` receives phase, action, page state, selected item, user feedback, and optional RAG evidence.
- It should provide state-aware explanations.
- If the LLM request fails or keys/model access are unavailable, the frontend/backend should return a clear fallback message.
- Assistant output must preserve safety boundaries and should not generate computed numeric results.

## Graph Validation Behavior

- Graph validation checks graph shape and causal-design constraints.
- It should flag cycles, self-loops, unknown nodes, outcome-in-adjustment errors, ID misuse, timestamp/context misuse, and unresolved warnings.
- Valid graphs remain reviewed assumptions, not confirmed causal truth.

## Phase 8 Estimation Behavior

Test payload:

```json
{
  "dataset_filename": "15_result_indexed_dataset_window1_distance1_9883a800bb674a88a5b5dc47da45d854.csv",
  "confirmed_question": "Among adults in the uploaded EMA/passive sensing dataset, what is the association between accelerometer magnitude and label under the specified model?",
  "estimand": "ATE",
  "exposure": "acc_mean_magnitude",
  "comparator": {
    "type": "continuous_unit_change",
    "reference": "one-unit lower",
    "treatment": "one-unit higher"
  },
  "outcome": "label",
  "adjustment_set": ["time_of_day", "day_of_week"],
  "participant_id": "pid",
  "timestamp": "time_stamp",
  "time_window": {
    "exposure_window": "8h",
    "lag": "1d",
    "outcome_window": "24h"
  },
  "estimator": "statsmodels_linear",
  "missing_data_strategy": "complete_case",
  "cluster_or_repeated_measures": "cluster_by_participant",
  "random_seed": 42,
  "identification_confirmed": true,
  "graph_confirmed": true,
  "assumptions_reviewed": true,
  "allow_unconfirmed_analysis": true
}
```

Expected POC behavior:

- Returns backend-computed estimate, uncertainty, sample size, diagnostics, warnings, and reproducibility metadata.
- If the outcome is categorical, the backend encodes it for this proof of concept and returns a warning requiring confirmation before interpretation.
- Output is an estimate under specified assumptions, not causal proof.

## Phase 9 Claim Audit and Export

Claim audit should block or flag:

- Proof language.
- Unbounded causal language.
- Treatment or diagnosis language.
- Relapse prediction or participant-level forecasting.
- Claims inconsistent with estimand, assumptions, diagnostics, evidence, or selected estimation run.

Report title:

- `Causal Design, Estimation, and Evidence Report`

Avoid labels that imply the report proves causal effects or is a final treatment/clinical decision document.

Exports:

- JSON: enabled in frontend.
- Markdown: enabled in frontend.
- PDF: backend PDF export planned; browser print preview can be used as a temporary aid.

## Run Backend

```powershell
cd "D:\Causal Studio\backend"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

If port `8010` is blocked, use another port such as `8030` and update `frontend/.env`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8030
```

## Run Frontend

```powershell
cd "D:\Causal Studio\frontend"
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

## Full Workflow Test

1. Start FastAPI.
2. Start Vite.
3. Confirm backend status is connected.
4. Upload or select the demo CSV.
5. Confirm schema values: 1106 rows, 74 columns, ID `pid`, timestamps `time_of_day`, `day_of_week`, `time_stamp`, and high `avg_latitude` missingness around 40.69%.
6. Upload documents or confirm existing documents.
7. Ingest documents and run RAG search.
8. Run broad exploration.
9. Confirm/enter the causal question and variables.
10. Review targeted feasibility warnings.
11. Generate and validate the editable graph.
12. Review identification and analysis strategy.
13. Run Phase 8 estimation and select the run as primary.
14. Go to Phase 9, run claim audit, generate report, and export JSON/Markdown.

## Known Limitations

- Phase 8 is a technical proof of concept, not a full causal inference engine.
- Categorical outcome encoding is allowed for the current POC but must be reviewed before interpretation.
- Advanced sensitivity analyses are planned rather than computed.
- Report PDF export is not implemented as a backend endpoint.
- Some prototype UI components are static where backend integration is not yet required.
- LLM calls depend on local API key/model access and may fall back when unavailable.
- Uploaded files, ChromaDB files, generated reports, estimation run outputs, caches, and secrets must remain uncommitted.

## Files That Must Not Be Committed

- `.env` files.
- API keys and LangSmith keys.
- Uploaded datasets in `backend/uploads/datasets/`.
- Uploaded documents in `backend/uploads/documents/`.
- ChromaDB files in `backend/chroma_db/`.
- Estimation run outputs in `backend/runtime/`.
- Generated reports.
- `node_modules/`.
- `frontend/dist/`.
- `backend/**/__pycache__/`.
- `.pytest_cache/`.
- Temporary files.
