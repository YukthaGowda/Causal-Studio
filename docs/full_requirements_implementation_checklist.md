# Causal Design Agent Full Requirements Implementation Checklist

This checklist maps the current implementation to the UI and User Journey Revision Guide. It is written for the technical proof of concept, so every item is marked as implemented, partial, intentionally deferred, or not applicable.

## Overall Status

The app implements a 9-phase causal-design support workflow with a React frontend, FastAPI backend, document/RAG support, dataset schema parsing, deterministic validation services, assistant actions, graph editing, estimation proof-of-concept support, and review/export safety checks.

The app remains a causal-design support tool. It does not make diagnostic decisions, treatment decisions, or claim that causal effects are proven.

## Phase 1 - Project Setup And Document Upload

| Requirement | Status | Notes |
| --- | --- | --- |
| Research objective entry | Implemented | Frontend collects a draft objective and stores it in local workflow state. |
| Separate upload zones for dataset, dictionary, protocol, papers, and guidance | Implemented | Frontend separates document purposes and calls backend upload routes. |
| CSV dataset upload | Implemented | Backend accepts CSV datasets and parses schema. |
| Excel dataset upload | Partial | UI may mention Excel in guidance, but backend currently supports CSV only. Excel parsing is deferred. |
| Document upload format rules | Implemented | Backend accepts PDF, DOCX, and TXT for documents. Research paper guidance can restrict to PDF in the UI. |
| Data dictionary completeness check | Partial | Backend validates dictionary-like content and checks for dataset column names, but does not perform full semantic dictionary reconciliation. |
| Protocol and evidence categorization | Partial | Backend performs keyword-based deterministic category validation, not LLM-based document classification. |
| RAG ingestion | Implemented | Uploaded documents can be ingested into local ChromaDB. |
| RAG evidence check | Implemented | Frontend can call backend RAG search and show snippets or clear no-evidence messages. |

## Phase 2 - Data Foundation And Understanding

| Requirement | Status | Notes |
| --- | --- | --- |
| Real schema display after dataset upload | Implemented | Rows, columns, data types, missingness, IDs, timestamps, samples, and warnings come from backend pandas parsing. |
| Descriptive labels only | Implemented | Frontend uses descriptive labels such as Identifier, Timestamp, EMA/self-report, Smartphone-derived, Wearable-derived, Derived feature, and Needs clarification. |
| No final causal roles in Phase 2 | Implemented | Phase 2 avoids Exposure, Outcome, Confounder, and Mediator labels. |
| Missingness and coverage summaries | Implemented | Backend returns missing counts/percentages and coverage percentages. |
| ID and timestamp detection | Implemented | Backend detects likely ID and timestamp/date columns. |
| Duplicate participant-time checks | Implemented | Backend reports duplicate rows and participant-time duplicate records when IDs and timestamps exist. |
| Timestamp ranges and parseability | Implemented | Backend returns timestamp ranges and warnings for poorly parsed timestamp columns. |
| Impossible-value checks | Partial | Backend performs deterministic numeric range checks for common patterns such as latitude/longitude/percentage/nonnegative values. Domain-specific impossible values are deferred. |
| Dictionary consistency | Partial | Backend includes a compact placeholder and exact-name dictionary coverage check, but not full ontology-level consistency. |

## Phase 3 - Broad Data Exploration

| Requirement | Status | Notes |
| --- | --- | --- |
| Backend-computed broad exploration | Implemented where backend route is available | Frontend calls backend broad exploration and labels results as Python-computed. |
| Clear fallback mode | Implemented | If backend is unavailable, frontend shows demo/fallback mode rather than crashing. |
| Missingness, participant, temporal, and correlation summaries | Implemented/partial | Backend summaries are displayed when returned; frontend fallback is clearly labeled. |
| Save exploration views | Implemented | Current session can save exploration views as hypothesis-generating context. |
| Compare selected variables | Implemented as assistant-guided note | Frontend provides a lightweight comparison action; full statistical comparison workflow is deferred. |
| Promote patterns to later phases | Implemented | Promoted patterns seed Phase 4 context. |
| Caution that exploration does not establish causality | Implemented | Frontend and assistant messaging preserve this warning. |

## Phase 4 - Causal Question And Provisional Variable Design

| Requirement | Status | Notes |
| --- | --- | --- |
| Candidate causal question generation | Implemented | Backend/assistant can generate candidate questions from objective, schema, and evidence context. |
| Candidate variable recommendation | Implemented | Backend recommends provisional variables using schema and objective/question context. |
| Provisional wording | Implemented | Outputs are labeled candidate/provisional and require user review. |
| User can accept/edit/reject suggestions | Implemented | Frontend supports user decisions and role updates. |
| Versioned question comparison | Partial | Generated candidates have versions, but full compare/restore history is deferred. |
| Derived feature suggestions | Implemented/partial | Derived feature options exist and can be selected; backend-derived feature generation remains limited. |

## Phase 5 - Targeted Variable Exploration And Feasibility Check

| Requirement | Status | Notes |
| --- | --- | --- |
| Dataset-backed exposure/outcome checks | Implemented | Frontend blocks checks until dataset-backed variables exist. |
| Missingness, overlap, timing, and feasibility warnings | Implemented | Backend feasibility results and frontend warnings are displayed. |
| Actionable statuses | Implemented | Results show feasible/requires revision/not feasible style messages. |
| Participant ID and timestamp awareness | Implemented | Frontend/backend carry ID and timestamp fields into feasibility checks. |
| No causal conclusion from feasibility | Implemented | Feasibility checks are diagnostic only. |

## Phase 6 - Causal Graph And Final Role Validation

| Requirement | Status | Notes |
| --- | --- | --- |
| First-pass graph generation | Implemented | Backend creates a draft graph from selected variables/context. |
| Editable causal graph canvas | Implemented | React Flow canvas supports node/edge interaction and editing. |
| Backend graph validation | Implemented | Backend validates graph structure and returns warnings/errors. |
| Clear graph warnings/errors | Implemented | Frontend shows validation output and draft/review language. |
| CPDAG/PAG/MAG semantics | Intentionally deferred | The proof of concept focuses on DAG-style validation. Full mixed graph semantics are not implemented. |
| Human review requirement | Implemented | UI labels generated graphs as drafts requiring user review. |

## Phase 7 - Identification And Analysis Strategy

| Requirement | Status | Notes |
| --- | --- | --- |
| Identification check | Implemented | Backend checks graph/exposure/outcome/adjustment inputs and reports status. |
| Analysis strategy guidance | Implemented | Backend produces method guidance and assumptions to review. |
| Assumptions and sensitivity planning | Implemented | Frontend and backend support assumption checklist and sensitivity planning. |
| No effect estimation in Phase 7 | Implemented | Phase 7 remains guidance only. |
| Full do-calculus/ID algorithm | Intentionally deferred | Current checks are deterministic proof-of-concept rules, not a complete formal ID engine. |

## Phase 8 - Estimation And Calculation

| Requirement | Status | Notes |
| --- | --- | --- |
| Phase 8 added between strategy and review | Implemented | Frontend includes Estimation & Calculation as Phase 8. |
| Backend Python estimation run | Implemented as proof of concept | Estimation run support exists, with safety messaging. |
| No fake estimates | Implemented | UI should show computed backend runs only or an empty/blocked state. |
| Estimation safety messaging | Implemented | Output is labeled conditional on data, model, and assumptions; not causal proof. |
| Full estimator library and refutation methods | Intentionally deferred | Current estimator support is limited for technical proof-of-concept demonstration. |

## Phase 9 - Review And Export

| Requirement | Status | Notes |
| --- | --- | --- |
| Review & Export is Phase 9 | Implemented | Navigation and workflow place review after Phase 8. |
| Include selected Phase 8 run | Implemented | Review package carries the selected primary estimation run. |
| Claim audit | Implemented | Unsafe causal, predictive, diagnostic, or treatment-decision wording is flagged/blocking. |
| JSON and Markdown export | Implemented | Export supports structured runtime package generation. |
| PDF export | Partial | Browser print-preview PDF is available; full backend PDF generation is deferred. |
| Evidence verification with RAG | Implemented/partial | RAG evidence snippets can be attached; full source-level audit workflow remains limited. |

## Cross-Cutting Requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| State-aware assistant actions | Implemented | Frontend calls `/assistant/action` where intended and falls back cleanly when backend is unavailable. |
| Assistant does not replace validation | Implemented | Assistant explains and drafts; deterministic backend checks remain authoritative. |
| LangGraph workflow orchestration | Implemented/scaffolded | Backend orchestration support exists for workflow state transitions. |
| LangSmith tracing | Implemented | Debug endpoints and environment-variable support are present; secrets are never returned. |
| Secret safety | Implemented | `.env` is ignored and `.env.example` uses placeholders only. |
| Uploaded/runtime file safety | Implemented | Uploads, ChromaDB, generated reports, node_modules, dist, caches, and venvs are ignored. |

## Remaining Proof-Of-Concept Limitations

- Excel dataset upload is not implemented; CSV is the supported data format.
- Full data dictionary semantic reconciliation is not implemented.
- Full CPDAG/PAG/MAG causal graph semantics are not implemented.
- Full formal identification algorithms are not implemented.
- Full sensitivity/refutation estimation methods are not implemented.
- Browser PDF preview is available, but server-generated PDF export is not implemented.
- Authentication, multi-user persistence, deployment hardening, and PHI-grade security controls are not implemented.
