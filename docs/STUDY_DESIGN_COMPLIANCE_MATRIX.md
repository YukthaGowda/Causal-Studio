# Study-Design Compliance Matrix

## Scope

This matrix translates `Visual_Causal_Analytics_Study_Design.docx.pdf` into implementation checks for the current nine-phase Causal Studio workflow. It evaluates workflow and software compliance; it does **not** establish causal truth from the BDE data. “Python-backed” means a backend response is derived from the uploaded data; LLM text remains an editable explanation or draft.

## Phase-by-phase matrix

| Phase | Study-design requirement | Current implementation / state label | Status | File or function | Minimal compliance action | Fallback and evidence to retain |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Project Setup | Collect objective, data, dictionary, optional protocol/evidence; do not make causal decisions. | **Draft / incomplete / ready** readiness checks, upload controls, and assistant explanation. | Partial | `CausalStudioApp.jsx` Phase 1 handlers; dataset/document API routes | No blocker found. | Missing items remain explicit; uploads and readiness state are retained. |
| 2. Data Foundation | Python derives schema, IDs, timestamps, missingness, units and quality warnings; no invented values. | **Backend schema loaded** when parsed; **unavailable** when schema data are absent. Seeded fallback counts, schedules, and dictionary mismatch example removed. | Partial | `DataFoundationView` | Completed critical safety fix: show only returned schema metadata and explicit unavailable states. | Parse CSV first; unknown measurement frequency or dictionary match remains a review item. |
| 3. Broad Exploration | Python generates descriptive summaries/charts; patterns are exploratory only, not causal claims. | **Python-backed summary** after `/exploration/broad`; **not yet available** for chart-ready arrays not returned by backend. | Partial | `ExploreView`, `POST /exploration/broad` | Completed critical safety fix: hide seeded charts and statistical pattern cards instead of presenting them as study results. | Continue using structural summary; add backend chart payloads later before re-enabling visual cards. |
| 4. Question & Variables | Generate editable candidate questions, roles, and derived features; user selects/edits/confirms; show draft state. | **AI-generated draft / needs user review / confirmed** labels; deterministic placeholders remain editable when LLM is unavailable. | Partial | `QuestionView`; question/variable API routes | No critical blocker found. | Preserve prompt/evidence/output/edit records; candidates are never treated as approved causal questions without user confirmation. |
| 5. Feasibility | Python checks outcome prevalence, missingness, timing/lag, overlap, support and analysis-ready sample before graph design. | **not run / ready / marginal / requires revision / not feasible** from targeted feasibility response. | Partial | `FeasibilityView`, `POST /feasibility/check` | Completed critical safety fix: hide seeded diagnostic cards and disable graph transition unless backend reports `safe_to_continue_to_graph`. | Keep backend warnings and revision suggestions; unavailable chart-ready statistics are explicitly labeled unavailable. |
| 6. Causal Graph | First-pass editable graph; validate, accept/edit/reject/regenerate; graph remains an assumption. | **Draft / validated / confirmed** graph workflow. | Partial | Graph view; graph generate/validate routes | No critical fake-result blocker found. | Graph is editable; validation/warnings retained; no causal proof claim. |
| 7. Identification & Strategy | Use graph plus deterministic identification to create an editable strategy; validate and confirm before estimation. | **Draft / validation required / confirmed** strategy states and prerequisite checks. | Partial | Strategy view; analysis-strategy routes | No critical blocker found. | Keep assumptions, adjustment warnings, and confirmation state. |
| 8. Estimation & Calculation | Explicit user action runs Python/R; numerical outputs never come from LLM; interpretation follows a computed result. | **Not run / validated / computed / primary selected** result workflow. Pre-run sample/exclusion rows now show backend feasibility data or **not computed**. | Partial | `EstimationView`; estimation API routes | Completed critical safety fix: remove seeded pre-run sample/exclusion/person-time values. No estimation was run. | Keep configuration, run log, outputs, warnings and primary-run selection. |
| 9. Review & Export | Create editable report with limitations, unresolved warnings and bounded claims; audit/export retains provenance. | **Incomplete / available / review required** downstream summary states. | Partial | Review/export view and API routes | No critical blocker found. | Reports must retain incomplete states and claim boundaries; do not manufacture unavailable outputs. |

## Cross-cutting compliance requirements

| Requirement | Status | Evidence / remaining work |
| --- | --- | --- |
| No fabricated data-derived numerical or causal output | Improved | Phase 2–5 seeded displays that looked data-derived are now unavailable. Python-backed summaries remain visible. |
| LLM output is structured, editable, and non-numerical | Partial | Existing draft/edit/confirm controls and warnings are present. Add formal prompt/output/source/latency/edit logs before a formal study. |
| Stable JSON/error behavior | Partial | Frontend uses safe fallbacks and panel error boundaries. Exercise every API error path in a test run before study execution. |
| User control over proactive artifacts | Partial | Editable/confirmable candidate, graph, strategy and report flows exist. Add explicit accept/reject/regenerate/compare controls consistently where missing. |
| Reproducibility/audit logging | Gap | Persist prompt version, evidence references, model/version, edits, validation results, timings, failures and export provenance before formal evaluation. |
| State labels | Partial | Core phases expose draft, review, feasibility and result states. The formal test sheet should record them at every transition. |

## Priorities

### A. Critical blockers addressed in this pass

1. Seeded Phase 2 data-quality values, example measurement schedules, and a fabricated dictionary inconsistency could be mistaken for uploaded-data results.
2. Seeded Phase 3 charts, participant missingness, correlations, and p-values could be mistaken for exploratory Python results.
3. Seeded Phase 5 feasibility statistics could be mistaken for feasibility results, and the graph transition could continue without a Python-safe feasibility result.
4. Seeded Phase 8 pre-run sample, exclusion, and person-time figures could be mistaken for calculated configuration output.

The UI now shows backend-derived data where available and otherwise states that the requested view is unavailable. This is safer than using placeholder numbers.

### B. Acceptable current limits for testing

- Phase 3 currently supplies Python-backed structural exploration, not full chart-ready exploratory arrays.
- Phase 5 currently supplies backend feasibility diagnostics, not every desired visualization.
- LLM availability may fail; deterministic or editable draft fallback remains permissible when visibly labeled as a draft.
- The dashboard supports workflow testing and software/configuration agreement; it does not prove causal truth.

### C. Future improvements before a formal study

- Add matched Python endpoints for Phase 3 distributions, time series, missingness-by-participant, and exploratory correlations.
- Add matched Python endpoints for every Phase 5 visualization and clear data provenance per card.
- Persist structured GenAI/audit logs: prompt/context version, retrieved sources, model, output, edits, validation, latency, error and user decision.
- Add explicit accept, edit, reject, regenerate, compare and validate controls consistently for proactive artifacts.
- Version dashboard state payloads, benchmark cases, reference outputs, scoring denominators and expert adjudication records.
