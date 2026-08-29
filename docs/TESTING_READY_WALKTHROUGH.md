# Causal Studio Testing-Ready Walkthrough

## Scope and safety boundary

This walkthrough tests the implemented nine-phase Causal Studio workflow using an uploaded dataset and supporting documents. It tests software behavior, workflow safeguards, and agreement with backend-produced outputs. It does **not** establish causal truth from the BDE data. Numerical results are produced only by the Python backend; LLM output is editable guidance and must not be treated as a numerical estimate or causal proof.

## Test materials

Use these repository files for a reproducible local test:

- Dataset: `validation/data/15_result_indexed_dataset_window1_distance1.csv`
- Data dictionary: `docs/BDE data description.docx`
- Optional protocol: `docs/BDE Data collection.pdf`
- Optional research evidence: `docs/BDE Research paper.pdf`

Before starting, run the frontend and FastAPI backend locally. Confirm the Project Setup badge reports **Backend connected**. The data dictionary and optional documents may be uploaded as `.docx` or `.pdf`; datasets must be `.csv`.

## Phase-by-phase readiness checklist

| Phase | Required inputs and frontend state | Backend endpoint(s) | Expected output / Next condition | Clear blocker and fallback behavior |
| --- | --- | --- | --- | --- |
| 1. Project Setup | Objective text; one parsed CSV; data dictionary. Protocol/evidence are optional. | `POST /datasets/upload`, `POST /documents/upload`, `GET /health` | Readiness rows update; Continue opens warning acknowledgement only for non-blocking warnings. | Missing objective, CSV, parsed dataset, or dictionary produces a toast naming the missing item. Unsupported dataset/document types return a safe API error. |
| 2. Data Foundation | Uploaded parsed dataset and dictionary; warnings reviewed. | `GET /datasets/{filename}/schema`, `POST /documents/validate-category` | **Backend schema loaded** shows schema, candidate ID/timestamp fields, missingness, and dictionary status. | If schema metadata is absent, show **unavailable** rather than estimated participant counts, sample schedules, or dictionary mismatches. |
| 3. Broad Exploration | Parsed dataset selected. | `POST /exploration/broad` | **Python-backed summary** shows returned structure and warnings. | Chart-ready arrays and pattern statistics are **not yet available** until returned by a matched Python endpoint; no seeded/demo values are shown. |
| 4. Questions and Variables | A selected/used or confirmed question; one exposure and one outcome; optional confounders. | `POST /questions/generate-candidates`, `POST /variables/recommend-candidates` | Editable question, role selections, and candidate recommendations. Phase 5 receives the selected fields and roles. | Missing question: “Please confirm or use a research question before continuing.” Missing exposure/outcome uses the required messages below. Deterministic candidates remain selectable if LLM assistance is unavailable. |
| 5. Targeted Exploration and Feasibility | Parsed dataset plus selected question, exposure, and outcome. | `POST /feasibility/check` | **not run / ready / marginal / requires revision / not feasible** Python feasibility status, diagnostics, missingness, overlap, timing/lag, and complete-case information. Continue to graph only when the backend permits it. | If selected variables are not dataset columns: “Feasibility cannot run yet because selected variables are missing from the parsed dataset.” Chart-ready details not supplied by the backend remain **unavailable**, not simulated. |
| 6. Causal Graph | Feasibility result; selected roles/variables. | `POST /causal-graph/generate`, `POST /causal-graph/validate` | Editable graph nodes/edges; validation and confirmation status. | A graph can be saved as a draft or validated/confirmed. Continue is blocked with an explanation until one of these occurs. Graph edges remain assumptions, not causal proof. |
| 7. Identification and Analysis Strategy | Saved/confirmed graph; question and selected variables. | `POST /analysis-strategy/generate`, `POST /analysis-strategy/validate` | Editable adjustment set, estimand, estimator plan, warnings, and confirmation. | Without a graph, display “Confirm a graph before running identification.” Before Phase 8, display the identification/validation/confirmation requirement. |
| 8. Estimation and Calculation | Parsed dataset; confirmed/validated strategy; explicit Run Estimation action. | `POST /estimation/validate-config`, `POST /estimation/run`, `POST /estimation/select-primary` | Backend/Python computes estimates, diagnostics, warnings, and run log; user selects a primary run before review. | Invalid/missing columns or invalid configuration show backend errors in the phase. LLM interpretation reads computed output only and never creates numbers. |
| 9. Review and Export | Any available prior-phase artifacts; primary estimation run is optional for page access. | `POST /reports/generate`, `POST /review-export/assemble`, `POST /review-export/claim-audit`, `POST /review-export/export` | Review preview includes question, variables, graph/strategy/feasibility state, estimates if present, warnings, limitations, and claim boundary. | Incomplete upstream phases appear as incomplete/not available, rather than preventing the review page from loading. Export errors are shown as safe unavailable messages. |

## Exact test path

1. In **Project Setup**, enter an objective, for example: “Assess whether accelerometer magnitude during an analysis window is associated with a later BDE label among participants in the uploaded study data.”
2. Upload the CSV listed above. Verify its filename, row/column count, and parse status appear.
3. Upload `BDE data description.docx` as the data dictionary. Optionally upload the protocol and research-paper PDFs, then ingest documents if you want RAG-backed explanations.
4. Click **Continue to data foundation**. If non-blocking dictionary warnings appear, read them and choose **Continue with warnings** only when appropriate.
5. In **Data Foundation**, verify variables, candidate participant/timestamp fields, and missingness are visible. Continue after reviewing warnings.
6. In **Broad Exploration**, run the Python-backed exploration control. Verify the returned structural summary and warnings. The additional chart/pattern area must say it is unavailable rather than show demo numbers; this is an expected safe limitation.
7. In **Questions and Variables**, select a deterministic candidate or use/edit a candidate. Set one variable to **Exposure** and one to **Outcome**. Adding a second role-marked exposure/outcome replaces the earlier same-role selection. Add optional confounders as needed.
8. Click **Feasibility check**, then **Run Feasibility Checks**. Confirm the returned status, diagnostics, missingness, timing/lag and support information. Verify that graph navigation remains disabled unless Python returns `safe_to_continue_to_graph`. Use **Revise Question** or **Revise Variables** if the backend flags a problem.
9. In **Causal Graph**, generate a first-pass graph or edit the visible nodes/edges manually. Validate and confirm it, or save it as a draft. Do not interpret the graph as causal proof.
10. In **Analysis Strategy**, run identification, edit/validate the adjustment set, review assumptions, and click **Confirm Analysis Strategy**.
11. In **Estimation**, validate the configuration. Click **Run Estimation** only after consciously reviewing the configuration. Confirm displayed numerical outputs are backend-produced, then select a primary run.
12. In **Review & Export**, generate the review package/preview. Verify warnings, limitations, incomplete-stage flags, and association-versus-causation boundary language are retained. Export if the service reports it is available.

## Required validation messages

- `Please select one outcome variable before continuing to Feasibility.`
- `Please select one exposure variable before continuing to Feasibility.`
- `Please confirm or use a research question before continuing.`
- `Feasibility cannot run yet because selected variables are missing from the parsed dataset.`
- `Something went wrong in this panel. Please refresh or go back to the previous step.`

## Pass, acceptable warning, and bug criteria

**Pass** means the phase renders, the action either succeeds with a structured response or displays a user-facing explanation, and the Next control does not silently bypass a required workflow condition.

**Acceptable warnings** include missingness, weak support/overlap, unresolved timing, a graph draft requiring review, unvalidated adjustment assumptions, or unavailable LLM assistance. These must remain visible downstream and must not be converted into causal conclusions.

**Report a bug** if a button appears to do nothing, a page goes blank, an API error is shown as `null`/`undefined`, a chart crashes on missing data, an LLM response supplies a numerical estimate, an LLM output is presented as confirmed without user action, a required prerequisite can be silently bypassed, or an estimate is generated without backend execution.

## LLM and backend fallback rules

- If OpenAI is unavailable, use deterministic candidate questions/graphs/strategy controls where available; maintain editable, draft status and show the backend/assistant message.
- If a deterministic backend call fails, stay on the current phase, preserve editable state, and surface its safe error response.
- Error boundaries protect the active workflow panel and assistant sidebar. Empty chart data uses an inline “No data yet” state.
- Do not treat generated drafts, graphs, or interpretations as causal evidence. Do not use LLM text as numerical output.

## Study-design compliance checks

During testing, record each visible state label (for example **draft**, **needs user review**, **not run**, **ready**, **marginal**, **requires revision**, **not feasible**, **validated**, **confirmed**, **computed**, or **unavailable**).

- Confirm no number, chart, p-value, correlation, prevalence, overlap statistic, sample size, or causal statement appears without a matching Python/backend source.
- Confirm that unavailable backend outputs are labeled unavailable, not replaced by demo values.
- Confirm generated questions, graphs, strategies, interpretations, and reports remain editable and visibly require user review or confirmation.
- Confirm warnings and incomplete states remain visible in later phases and in Review & Export.
- Capture screenshots of: Phase 2 schema/quality state; Phase 3 Python-backed summary and unavailable visualizations; Phase 4 editable draft; Phase 5 status and graph gate; Phase 6 graph validation; Phase 7 strategy confirmation; Phase 8 computed-run state or not-run state; Phase 9 claim-boundary/warning retention.
