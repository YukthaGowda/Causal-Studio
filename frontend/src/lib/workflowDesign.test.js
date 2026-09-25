import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createWorkflowState, updateWorkflowState, designKeys, currentDesign, runAlignment, reviewDesignState, DESIGN_CHANGED_MESSAGE } from './workflowDesign.js';
import { getReviewExportBlockers } from './reviewExport.js';

const update = (s, key, value) => updateWorkflowState(s, { key, value });
function fixture(adjustment = ['c']) {
  let s = createWorkflowState({
    datasets: [{ id: 'synthetic', savedFilename: 'synthetic.csv', schema: { column_names: ['x', 'y', 'c'] } }],
    questionFields: { question: 'Does x affect y?', population: 'Synthetic cohort', exposure: 'x', outcome: 'y', comparator: 'lower x', timeWindow: 'prior window', unitOfAnalysis: 'person-window', estimand: 'total effect' },
    variableRoles: { x: 'Exposure', y: 'Outcome', c: 'Confounder' },
    graphNodes: [...new Set(['x', 'y', 'c', ...adjustment])].map(id => ({ id })),
    graphEdges: [{ from: 'x', to: 'y', type: 'directed' }, { from: 'c', to: 'x', type: 'directed' }],
    analysisStrategyDraft: { estimand: { exposure: 'x', outcome: 'y' }, strategy: { estimator_family: 'test_only', adjustment_set: adjustment } },
    editableAdjustmentSet: adjustment,
  });
  s = update(s, 'confirmedQuestion', { fields: { ...s.questionFields }, designKey: designKeys(s).question });
  s = update(s, 'confirmedGraph', { nodes: s.graphNodes, edges: s.graphEdges, designKey: designKeys(s).graph });
  s = update(s, 'analysisStrategyConfirmed', { adjustmentSet: adjustment, draft: s.analysisStrategyDraft, designKey: designKeys(s).strategy });
  const run = { id: 'synthetic-run', designKey: currentDesign(s).key, config: { exposure: 'x', outcome: 'y', adjustmentSet: adjustment }, results: { warnings: [] } };
  return { ...s, primaryEstimationRun: run, latestEstimationRun: run, estimationRuns: [run],
    graphValidationResult: { status: 'valid' }, analysisStrategyValidation: { status: 'valid' },
    targetedFeasibilityResult: { status: 'feasible' }, studyReportDraft: { question: 'obsolete', content: 'old draft' } };
}
for (const field of ['exposure', 'outcome', 'comparator', 'timeWindow', 'unitOfAnalysis', 'question']) {
  test(`changing ${field} invalidates downstream artifacts without deleting runs`, () => {
    const old = fixture();
    const next = update(old, 'questionFields', { ...old.questionFields, [field]: 'new value' });
    for (const key of ['confirmedQuestion', 'targetedFeasibilityResult', 'confirmedGraph', 'graphValidationResult', 'analysisStrategyConfirmed', 'analysisStrategyValidation', 'primaryEstimationRun', 'studyReportDraft']) assert.equal(next[key], null, key);
    assert.equal(next.estimationRuns, old.estimationRuns);
    assert.equal(next.latestEstimationRun, old.latestEstimationRun);
    assert.ok(next.reviewRevision > old.reviewRevision);
    assert.equal(runAlignment(next, old.primaryEstimationRun).compatible, false);
  });
}
test('graph edits invalidate strategy and report; visual node movement does not invalidate design', () => {
  const old = fixture();
  const moved = update(old, 'graphNodes', old.graphNodes.map(n => ({ ...n, x: 200, y: 100 })));
  assert.equal(moved.primaryEstimationRun, old.primaryEstimationRun);
  const next = update(old, 'graphEdges', [{ from: 'y', to: 'x', type: 'directed' }]);
  assert.equal(next.analysisStrategyResult, null);
  assert.equal(next.analysisStrategyConfirmed, null);
  assert.equal(next.primaryEstimationRun, null);
  assert.equal(next.studyReportDraft, null);
  assert.equal(next.confirmedQuestion, old.confirmedQuestion);
  assert.equal(next.estimationRuns, old.estimationRuns);
});
test('adjustment edits invalidate selection, including removal of every covariate', () => {
  const old = fixture();
  const next = update(old, 'editableAdjustmentSet', []);
  assert.equal(next.primaryEstimationRun, null);
  assert.equal(next.analysisStrategyConfirmed, null);
  assert.equal(next.analysisStrategyValidation, null);
  assert.equal(next.confirmedGraph, old.confirmedGraph);
  assert.equal(next.studyReportDraft, null);
});
test('adjustment ordering is immaterial', () => {
  const old = fixture(['c', 'z']);
  const next = update(old, 'editableAdjustmentSet', ['z', 'c']);
  assert.equal(next.primaryEstimationRun, old.primaryEstimationRun);
});
test('strategy edits invalidate selection without triggering any API', () => {
  const old = fixture();
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Unexpected API call'); };
  try {
    const next = update(old, 'analysisStrategyDraft', { ...old.analysisStrategyDraft, strategy: { estimator_family: 'another_test_strategy' } });
    assert.equal(next.primaryEstimationRun, null);
    assert.equal(next.studyReportDraft, null);
    assert.equal(next.estimationRuns.length, 1);
  } finally { globalThis.fetch = original; }
});
test('Phase 9 uses confirmed current question and excludes old report draft values', () => {
  const s = fixture();
  const review = reviewDesignState(s);
  assert.equal(review.questionFields.exposure, 'x');
  assert.equal(review.questionFields.question, 'Does x affect y?');
  assert.equal(review.primaryEstimationRun.id, 'synthetic-run');
});
test('legacy or mismatched run is never silently current', () => {
  const s = fixture();
  for (const run of [{ ...s.primaryEstimationRun, designKey: undefined }, { ...s.primaryEstimationRun, config: { exposure: 'sleep-related features', outcome: 'label', adjustmentSet: ['c'] } }]) {
    assert.equal(runAlignment(s, run).compatible, false);
    assert.equal(reviewDesignState({ ...s, primaryEstimationRun: run }).primaryEstimationRun, null);
  }
});
test('matching variable names cannot conceal an old graph/design version', () => {
  const old = fixture();
  let next = update(old, 'graphVersionLabel', 'Version 2');
  next = update(next, 'confirmedGraph', { nodes: next.graphNodes, edges: next.graphEdges, designKey: designKeys(next).graph });
  next = update(next, 'analysisStrategyConfirmed', { adjustmentSet: ['c'], draft: next.analysisStrategyDraft, designKey: designKeys(next).strategy });
  assert.equal(runAlignment(next, old.primaryEstimationRun).compatible, false);
});
test('empty confirmed adjustment remains empty despite confounder roles', () => {
  const s = fixture([]);
  assert.deepEqual(currentDesign(s).adjustmentSet, []);
  assert.equal(runAlignment(s, s.primaryEstimationRun).compatible, true);
  const adjusted = { ...s.primaryEstimationRun, config: { ...s.primaryEstimationRun.config, adjustmentSet: ['c'] } };
  assert.equal(runAlignment(s, adjusted).compatible, false);
});
test('refresh starts unconfirmed; no workflow hydration from study storage or backend run', () => {
  const fresh = createWorkflowState();
  assert.equal(fresh.confirmedQuestion, null);
  assert.equal(fresh.primaryEstimationRun, null);
  assert.equal(fresh.confirmedGraph, null);
  assert.deepEqual(fresh.estimationRuns, []);
  const mixed = { ...fixture(), questionFields: { exposure: 'new', outcome: 'y' } };
  const review = reviewDesignState(mixed);
  assert.equal(review.currentDesign.questionConfirmed, false);
  assert.equal(review.primaryEstimationRun, null);
});
test('export still requires report, audit, and aligned confirmed design', () => {
  const s = fixture();
  const check = state => getReviewExportBlockers({ selectedRun: reviewDesignState(state).primaryEstimationRun,
    signoffBlockers: runAlignment(state, state.primaryEstimationRun).issues,
    reportDraft: { ready_for_export: true }, claimAudit: { status: 'pass', flagged_claims: [] }, backendConnected: true });
  assert.deepEqual(check(s), []);
  const changed = update(s, 'questionFields', { ...s.questionFields, exposure: 'new' });
  assert.ok(check(changed).some(x => x.includes(DESIGN_CHANGED_MESSAGE)));
});

test('actual report payload and configuration use one confirmed design, never stale draft/run fallbacks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'causal-alignment-test-'));
  try {
    const outfile = join(dir, 'component.mjs');
    await build({ entryPoints: [new URL('../components/CausalStudioApp.jsx', import.meta.url).pathname], bundle: true, outfile,
      platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
    const { activeReportConfiguration, reviewExportPayloadFromState } = await import(pathToFileURL(outfile));
    const state = { ...fixture(), papers: [], guidelines: [], questionCandidates: [], candidateVariables: [],
      derivedFeatureCandidates: [], promotedPatterns: [], graphAlternatives: [], sensitivityChecks: {} };
    const payload = reviewExportPayloadFromState(state);
    assert.equal(payload.phase_4_question_variables.confirmed_question.exposure, 'x');
    assert.equal(payload.phase_4_question_variables.confirmed_question.outcome, 'y');
    assert.deepEqual(payload.phase_7_strategy.adjustment_set, ['c']);
    assert.equal(payload.phase_8_estimation.selected_primary_run.id, 'synthetic-run');
    assert.deepEqual(payload.artifact_consistency.issues, []);
    const empty = { ...state, ...fixture([]) };
    assert.deepEqual(activeReportConfiguration(empty).adjustmentSet, []);
    const changed = update(state, 'questionFields', { ...state.questionFields, exposure: 'new_x', outcome: 'new_y' });
    const blocked = reviewExportPayloadFromState(changed);
    assert.equal(blocked.phase_4_question_variables.confirmed_question.exposure, 'new_x');
    assert.equal(blocked.phase_8_estimation.selected_primary_run, null);
    assert.deepEqual(blocked.phase_8_estimation.estimation_runs, []);
    assert.ok(blocked.artifact_consistency.issues.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// Exercise actual handlers with synthetic responses; no backend/model calls.
const { readFileSync } = await import('node:fs');
const { default: ts } = await import('typescript');
const componentSource = readFileSync(new URL('../components/CausalStudioApp.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.jsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function handler(name, context) {
  let text;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(text, name);
  return new Function(...Object.keys(context), `${text};return ${name}`)(...Object.values(context));
}
const noop = () => {};
const trace = () => ({ success: noop, fail: noop, finish: noop, capture: noop });

test('real primary selection refuses an old run without a selection API call', async () => {
  const old = fixture();
  const current = update(old, 'questionFields', { ...old.questionFields, outcome: 'new_y' });
  let selected = false, apiCalled = false, message;
  await handler('selectPrimaryRun', { actions: { beginStudyAction: trace, workflowRef: { current } },
    runAlignment, DESIGN_CHANGED_MESSAGE, showToast: value => { message = value; },
    setPrimaryEstimationRun: () => { selected = true; }, backendStatus: { connected: true },
    selectPrimaryEstimationRun: async () => { apiCalled = true; } })(old.primaryEstimationRun);
  assert.equal(selected, false);
  assert.equal(apiCalled, false);
  assert.equal(message, DESIGN_CHANGED_MESSAGE);
});
test('actual graph validation ignores a response after its graph changed', async () => {
  const ref = { current: fixture() };
  let resolve, stored = false;
  const response = new Promise(r => { resolve = r; });
  const pending = handler('validateCurrentGraph', { beginStudyAction: trace, backendStatus: { connected: true },
    graphBackendPayload: () => ({}), designKeys, workflowRef: ref, validateCausalGraph: () => response,
    setGraphValidationResult: () => { stored = true; }, setGraphActionStatus: noop, pushAssistantNote: noop,
    recordStudyEvent: noop, friendlyError: String })();
  ref.current = update(ref.current, 'graphEdges', []);
  resolve({ status: 'valid' });
  await pending;
  assert.equal(stored, false);
});
test('actual Generate Report blocks incompatible state without requesting a package', async () => {
  let notified = false, requested = false;
  await handler('handleGenerateReport', { actions: { beginStudyAction: trace }, hasAlignmentBlocker: true,
    notifyPreviewExportBlocked: () => { notified = true; }, assembleReviewPackage: async () => { requested = true; } })();
  assert.equal(notified, true);
  assert.equal(requested, false);
});
test('a late report response cannot restore stale report state', async () => {
  let current = true, resolve, saved = false;
  const response = new Promise(r => { resolve = r; });
  const pending = handler('handleGenerateReport', { actions: { beginStudyAction: trace }, hasAlignmentBlocker: false,
    setReportLoading: noop, state: {}, reviewExportPayloadFromState: () => ({}), backendStatus: { connected: true },
    assembleReviewPackage: () => response, reviewStillCurrent: () => current,
    setReportDraft: () => { saved = true; } })();
  current = false;
  resolve({ package_title: 'Old package' });
  await pending;
  assert.equal(saved, false);
});
test('actual Phase 8 payload uses selected variables, not BDE/schema defaults', () => {
  const state = fixture();
  const design = currentDesign(state);
  const dataset = { savedFilename: 'synthetic.csv', schema: { column_names: ['x', 'y', 'c', 'acc_mean_magnitude', 'label'] } };
  const payload = handler('buildEstimationPayload', { firstRealDataset: () => dataset, datasets: [dataset],
    estimationDataset: dataset, estimationExposure: design.question.exposure, estimationOutcome: design.question.outcome,
    design, phase7Estimand: design.strategy.estimand, phase7Strategy: design.strategy.strategy,
    phase7Adjustment: design.adjustmentSet, effectType: 'total', lagHours: 24,
    analysisStrategyConfirmed: state.analysisStrategyConfirmed, analysisStrategyValidation: {},
    confirmedGraph: state.confirmedGraph, sensitivityChecks: { reviewed: true } })();
  assert.equal(payload.exposure, 'x');
  assert.equal(payload.outcome, 'y');
  assert.deepEqual(payload.adjustment_set, ['c']);
  assert.equal(payload.confirmed_question, state.questionFields.question);
  assert.equal(payload.comparator.reference, state.questionFields.comparator);
  assert.equal(payload.time_window.exposure_window, state.questionFields.timeWindow);
  assert.equal(payload.time_window.lag, '24h');
  assert.equal(payload.time_window.outcome_window, null);
});
test('graph roles inconsistent with confirmed question prevent current selection', () => {
  const state = fixture();
  state.variableRoles = { x: 'Confounder', y: 'Outcome', c: 'Exposure' };
  assert.equal(runAlignment(state, state.primaryEstimationRun).compatible, false);
});

test('approved workspace constraint is preserved without variable substitution', () => {
  const s = fixture();
  s.studyMode = { active: true, frozen_drafts: { question: { exposure: 'approved_x', outcome: 'approved_y' } } };
  const alignment = runAlignment(s, s.primaryEstimationRun);
  assert.equal(alignment.compatible, false);
  assert.ok(alignment.issues.some(x => x.includes('approved study workspace')));
  assert.equal(alignment.design.question.exposure, 'x');
});

test('late Phase 4 suggestions do not overwrite the edited design', async () => {
  const ref = { current: fixture() };
  let resolve, saved = false;
  const pendingResponse = new Promise(r => { resolve = r; });
  const pending = handler('handleGenerateQuestionCandidates', { beginStudyAction: trace,
    backendStatus: { connected: true }, setPhase4Status: noop, pushAssistantNote: noop,
    designKeys, workflowRef: ref, phase4Feedback: '', buildPhase4Payload: () => ({}),
    generateQuestionCandidates: () => pendingResponse,
    setQuestionCandidates: () => { saved = true; }, friendlyError: String })();
  ref.current = update(ref.current, 'questionFields', { ...ref.current.questionFields, exposure: 'new_x' });
  resolve({ questions: [{ exposure: 'old_x' }] });
  await pending;
  assert.equal(saved, false);
});
test('late computed response is historical only and cannot select or overwrite current run', async () => {
  const s = fixture(), design = currentDesign(s), ref = { current: s };
  let resolve, history = [], madeCurrent = false;
  const response = new Promise(r => { resolve = r; });
  const pending = handler('runEstimation', { actions: { beginStudyAction: trace, workflowRef: ref },
    isRunning: false, backendStatus: { connected: true }, firstRealDataset: () => ({ savedFilename: 'synthetic.csv' }),
    datasets: [], canValidateEstimation: true, design, currentDesign, pushAssistantNote: noop, showToast: noop,
    setIsRunning: noop, setEstimationStatus: noop, setRunProgress: noop, setInterpretVersions: noop,
    setInterpretLockedIdx: noop, setInterval: () => 0, clearInterval: noop,
    buildEstimationPayload: () => ({ comparator: {}, estimand: {}, time_window: {}, adjustment_set: [], strategy: {} }),
    runBackendEstimation: () => response, recordStudyEvent: noop,
    backendEstimationToRun: () => ({ id: 'late-synthetic-run', config: {}, results: {} }),
    setRuns: fn => { history = fn(history); },
    setActiveRunId: () => { madeCurrent = true; }, setLatestEstimationRun: () => { madeCurrent = true; },
    setPrimaryEstimationRun: () => { madeCurrent = true; }, friendlyError: String })();
  ref.current = update(s, 'questionFields', { ...s.questionFields, outcome: 'new_y' });
  resolve({ status: 'completed' });
  await pending;
  assert.equal(history.length, 1);
  assert.equal(history[0].designKey, design.key);
  assert.equal(madeCurrent, false);
});
