# User Study Deployment Checklist

## Fixed BDE task requirement

Use **Load approved BDE study workspace** from the **Project Setup** readiness card. The fixed BDE task is required for the user study; participants must not upload substitute files or depend on live OpenAI to complete the workflow.

Fixed task: assess whether smartphone-derived movement patterns (`acc_mean_magnitude`) during a prior analysis window are associated with later binge-drinking event risk among participants in the approved BDE study dataset. The task is observational. It does not establish causal truth from the BDE data.

## Approved fixed materials

- `backend/study_assets/15_result_indexed_dataset_window1_distance1.csv`
- `backend/study_assets/BDE data description.docx`
- `backend/study_assets/BDE Data collection.pdf`
- `backend/study_assets/BDE Research paper.pdf`

These materials were approved for the user-study deployment. Do not expose raw file contents outside the task. The Phase 8 binary outcome is computed by the backend as `binge_drinking_event = 1` when `label == "BD"`, otherwise `0`, and is visibly labeled **Backend-derived binary outcome from approved label field.**

## Expected Phase 1–9 participant path

1. **Project Setup:** click **Load approved BDE study workspace**; verify the fixed objective, approved dataset, document metadata, and **Prepared draft — editable, not yet confirmed.**
2. **Data Foundation:** verify the backend-loaded schema and participant/timestamp fields.
3. **Broad Exploration:** verify **Backend-computed study summary**: `acc_mean_magnitude` count/missingness/mean/SD/range, `label` distribution, key-variable missingness, and candidate-variable summaries. Missing output must read **Not yet available**, never a demo value.
4. **Question & Variables:** edit or confirm the frozen association question and variable roles. Confirm the question before continuing.
5. **Feasibility:** run backend diagnostics for `acc_mean_magnitude`, `label`, and available `time_of_day`/`day_of_week`; review complete-case, prevalence, support, missingness, and timing warnings.
6. **Causal Graph:** edit the preloaded graph; it is an **Assumption-based graph draft — not causal proof.** Save/validate/confirm it before Phase 7.
7. **Analysis Strategy:** edit the frozen adjustment/association/estimator draft; run identification, validate the adjustment set, and confirm it. Preserve repeated-measures, missing-data, residual-confounding, and temporal-assumption warnings.
8. **Estimation:** validate then run only the backend/Python path. The model uses `acc_mean_magnitude`, backend-derived `binge_drinking_event`, and available `time_of_day`/`day_of_week`. Select a primary run only after reviewing warnings and diagnostics.
9. **Review & Export:** inspect the editable frozen report draft, generate the backend report package, run claim audit, and export only when the existing blockers are resolved. Warnings, assumptions, incomplete states, limitations, and claim boundaries must remain visible.

## Session log and capture

Use **Export study session log** in Project Setup to download JSON. The log captures fixed-task start, phase changes, question/role actions, feasibility, graph and strategy actions, estimation validation/run/selection, report generation, and export attempts. Do not include API keys or other secrets in session material.

Capture screenshots of: Phase 1 fixed-task readiness; Phase 2 schema; Phase 3 backend summary; Phase 5 feasibility; Phase 6 graph validation; Phase 7 strategy confirmation; Phase 8 configuration/diagnostics/primary-run selection; and Phase 9 claim-audited report state.

## Facilitator pre-session checklist

- Confirm `GET /health` and `POST /study-mode/start` succeed.
- Confirm the four fixed files are present in the deployment image and the fixed task loads the approved dataset.
- Confirm the frontend displays **Backend connected**.
- Confirm no live OpenAI request is required for task completion; frozen drafts and deterministic backend outputs are sufficient.
- Confirm Phase 3 renders backend-computed rather than prototype values.
- Confirm Phase 8 configuration validates and the backend estimation route is reachable.
- Record any participant/session identifier outside the dashboard if the approved study protocol requires one.

## Session-blocking bugs

Block the session if: the fixed task cannot start; a required phase is inaccessible with valid fixed-task state; backend summaries/feasibility/estimation are absent or malformed; a numerical result appears without backend computation; graph or strategy cannot be validated/confirmed; report/export drops warnings or claim boundaries; or the UI crashes.

## Acceptable limitations

Frozen artifacts are editable drafts, not confirmed truth. The workflow uses complete-case preprocessing and has preliminary repeated-measures support; these limitations remain visible. No draft, exploration output, association, or estimate proves causality. Live GenAI is optional and may be unavailable without blocking the study task.
