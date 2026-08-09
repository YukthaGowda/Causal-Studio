# Dashboard validation scope and capability inventory

This note captures the current dashboard validation scope for the Causal Studio proof of concept. It is intentionally conservative and aligned to the stabilized workflow in the UI: no new causal methods, no redesign, and no expansion of the nine-phase structure.

## What the dashboard is currently designed to do

The UI is a guided nine-phase causal-design workflow that supports:

1. Project setup and document handling
2. Data foundation and schema understanding
3. Broad exploratory analysis
4. Causal question and provisional variable design
5. Targeted feasibility checks
6. Causal graph drafting and validation
7. Identification and analysis strategy guidance
8. Estimation execution and primary-run selection
9. Review/export package assembly

## Supported vs demo-only behavior

### Phase 1 — Project setup and documents
- Supported: upload CSV datasets, upload PDF/DOCX documents, list uploaded files, and show backend availability state.
- Backend-computed: file listing and upload metadata come from the backend routes.
- LLM-generated: assistant guidance and narrative help can be supplied when an API key is configured; otherwise the UI should fall back to deterministic messaging.
- Demo/fallback: the UI can still present a local draft experience when backend routes are unavailable, but this should be clearly labeled as fallback rather than a verified backend result.

### Phase 2 — Data foundation
- Supported: schema parsing, row/column summaries, likely ID/timestamp fields, and missingness summaries.
- Backend-computed: schema parsing and summary structure are expected to come from the backend.
- LLM-generated: explanatory narrative is optional and should not replace backend-computed structure.
- Demo/fallback: the page should avoid implying that causal roles are finalized at this stage.

### Phase 3 — Broad exploration
- Supported: exploratory summaries, variable comparison hints, and promotion of notable patterns.
- Backend-computed: broad exploration results should be produced by the backend when available.
- LLM-generated: assistant interpretation is optional and should be clearly framed as exploratory.
- Demo/fallback: the UI should clearly state that such patterns do not establish causality.

### Phase 4 — Causal question and provisional variable design
- Supported: question drafting, candidate question generation, variable recommendation, and provisional selection/editing.
- Backend-computed: deterministic or backend-backed recommendations can be used when available.
- LLM-generated: question and variable phrasing may come from the LLM when configured.
- Demo/fallback: the UI should keep these as provisional and require human review before later phases rely on them.

### Phase 5 — Targeted feasibility
- Supported: feasibility checks around selected exposure/outcome, participant ID, timestamp handling, lag timing, missingness, and overlap.
- Backend-computed: feasibility checks and warnings should come from the backend or deterministic logic.
- LLM-generated: any narrative should be secondary to the structural feasibility output.
- Demo/fallback: no claim of causal validity should appear here.

### Phase 6 — Causal graph and role validation
- Supported: draft graph creation, node editing, edge editing, and backend validation of the edited graph.
- Backend-computed: graph validation and role/timing warnings are expected to be backend-driven.
- LLM-generated: assistant commentary is optional and should not override deterministic validation.
- Demo/fallback: the graph remains a draft and must be treated as requiring human review.

### Phase 7 — Identification and analysis strategy
- Supported: identification checks, adjustment-set review, and analysis strategy guidance.
- Backend-computed: identification and validation logic should be deterministic and backend-backed when available.
- LLM-generated: narrative is supplementary guidance only.
- Demo/fallback: the UI should never present this as proof of causal effect.

### Phase 8 — Estimation
- Supported: estimation configuration validation, backend-driven numerical estimation, warnings, diagnostics, and primary-run selection.
- Backend-computed: the numerical estimate and associated diagnostics are backend-computed Python outputs.
- LLM-generated: the assistant can explain results, but it cannot fabricate estimates.
- Demo/fallback: if the backend is unavailable, the UI should show a blocked or unavailable state and should not fake numbers.

### Phase 9 — Review and export
- Supported: review package assembly, claim audit, export readiness checks, markdown/JSON export scaffolding, and safer wording guidance.
- Backend-computed: package assembly and claim-audit logic should be treated as backend- or deterministic-state truth.
- LLM-generated: assistant wording can help rewrite claims but should not override blocking logic.
- Demo/fallback: export should be blocked until prerequisites are met; the UI should not present incomplete packages as final validated outputs.

## What should be included in manual validation

Use the current dashboard as a workflow prototype and validate:
- whether each phase transitions correctly when prerequisites are missing,
- whether the UI clearly distinguishes backend-computed results from draft/LLM guidance,
- whether the review/export path blocks unsafe or incomplete outputs,
- whether the assistant messaging stays within the documented safe framing.

## What should be excluded from manual validation

The following are out of scope for this stabilization pass and should not be treated as required capabilities for the current dashboard comparison:
- unsupported advanced causal methods beyond the existing nine-phase workflow,
- any new UI redesign or phase additions,
- any claim that the system proves causality or recommends treatment decisions without explicit human review,
- any fake numerical estimates when the backend is unavailable.

## Verified project status

The following checks were verified in this session:
- Frontend build: succeeded via `npm run build` in the frontend workspace.
- Backend import: succeeded inside the project virtual environment using the backend venv interpreter.
- Backend health endpoint: responded successfully at `http://127.0.0.1:8010/health`.
- Representative backend routes: responded successfully for `/documents`, `/datasets`, and `/debug/langsmith-status`.

## Remaining limitations to keep in mind

- The backend is only available once the local server is running.
- Some capabilities remain dependent on an OpenAI API key and will degrade gracefully to deterministic fallback behavior when absent.
- The dashboard is a guided workflow prototype rather than a full end-to-end causal-inference engine.
