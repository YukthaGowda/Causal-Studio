// In-memory workflow only. Browser study identity is never a design snapshot.
export const DESIGN_CHANGED_MESSAGE = 'Current causal design has changed since the selected estimation run. Review Phase 8 and select or run an estimation aligned with the current design.';
export const PREVIOUS_RUN_LABEL = 'Previous run — not aligned with current design';

export function stableKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableKey(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export function variableSet(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map(v => String(v).trim()).filter(v => v && v !== '(none)'))].sort();
}
function graphShape(nodes = [], edges = [], roles = {}) {
  return {
    nodes: nodes.map(n => ({ id: n.id, role: String(roles[n.id] || n.role || 'unassigned').toLowerCase(),
      temporalRole: n.temporalRole || n.temporal_role || '', measurementRole: n.measurementRole || n.measurement_role || '' })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.map(e => ({ from: e.from || e.source, to: e.to || e.target, type: e.edgeType || e.edge_type || e.type || 'directed' })).sort((a,b) => stableKey(a).localeCompare(stableKey(b))),
  };
}
export function designKeys(state) {
  const question = stableKey({ question: state.questionFields,
    datasets: (state.datasets || []).map(d => ({ id: d.id, filename: d.savedFilename, columns: d.schema?.column_names })),
    lag: state.lagHours, threshold: state.exposureThreshold, derived: state.derivedFeatures });
  const graph = stableKey({ question, roles: state.variableRoles, graph: graphShape(state.graphNodes, state.graphEdges, state.variableRoles), type: state.graphType, version: state.graphVersionLabel });
  const strategy = stableKey({ graph, draft: state.analysisStrategyDraft, adjustment: variableSet(state.editableAdjustmentSet),
    effect: state.effectType, estimator: state.estimatorFamily, repeated: state.repeatedMeasuresChecks });
  return { question, graph, strategy };
}
export function createWorkflowState(initial = {}) {
  // Deliberately do not hydrate downstream artifacts from local/session storage.
  return { datasets: [], variableRoles: {}, questionFields: null, confirmedQuestion: null,
    lagHours: 24, exposureThreshold: 30, derivedFeatures: [], targetedFeasibilityResult: null,
    graphNodes: [], graphEdges: [], graphAlternatives: [], graphType: 'DAG', graphVersionLabel: 'Version 0', confirmedGraph: null, graphValidationResult: null,
    effectType: 'total', estimatorFamily: 'mixed_logistic', repeatedMeasuresChecks: { randomIntercept: true, multipleImputation: false, robustSE: false },
    analysisStrategyResult: null, analysisStrategyDraft: null, editableAdjustmentSet: [], analysisStrategyValidation: null, analysisStrategyConfirmed: null,
    primaryEstimationRun: null, latestEstimationRun: null, estimationRuns: [], studyReportDraft: null, reviewRevision: 0, ...initial };
}
export function updateWorkflowState(state, { key, value }) {
  const next = { ...state, [key]: typeof value === 'function' ? value(state[key]) : value };
  const before = designKeys(state), after = designKeys(next);
  const questionChanged = before.question !== after.question;
  const graphChanged = before.graph !== after.graph;
  const strategyChanged = before.strategy !== after.strategy;
  if (questionChanged) {
    next.confirmedQuestion = null;
    next.targetedFeasibilityResult = null;
    next.graphAlternatives = [];
  }
  if (graphChanged) {
    next.confirmedGraph = null;
    next.graphValidationResult = null;
    next.analysisStrategyResult = null;
    next.analysisStrategyDraft = null;
    next.editableAdjustmentSet = [];
  }
  if (strategyChanged || (key === 'confirmedGraph' && !next.confirmedGraph)) {
    next.analysisStrategyConfirmed = null;
    next.analysisStrategyValidation = null;
    next.primaryEstimationRun = null;
  }
  if (strategyChanged || ['confirmedQuestion', 'confirmedGraph', 'analysisStrategyConfirmed', 'primaryEstimationRun', 'graphValidationResult', 'analysisStrategyValidation'].includes(key)) {
    next.studyReportDraft = null;
    next.reviewRevision = state.reviewRevision + 1;
  }
  // Historical results are never removed by invalidation. Selection is separate.
  if (next.primaryEstimationRun && !runAlignment(next, next.primaryEstimationRun).compatible) next.primaryEstimationRun = null;
  return next;
}
export function currentDesign(state) {
  const keys = designKeys(state);
  const questionConfirmed = Boolean(state.confirmedQuestion && state.confirmedQuestion.designKey === keys.question);
  const graphConfirmed = Boolean(questionConfirmed && state.confirmedGraph?.designKey === keys.graph);
  const strategyConfirmed = Boolean(graphConfirmed && state.analysisStrategyConfirmed?.designKey === keys.strategy);
  return { question: questionConfirmed ? state.confirmedQuestion.fields : state.questionFields || {},
    questionConfirmed, graphConfirmed, strategyConfirmed,
    graph: graphConfirmed ? state.confirmedGraph : null,
    adjustmentSet: strategyConfirmed ? variableSet(state.analysisStrategyConfirmed.adjustmentSet) : [],
    strategy: strategyConfirmed ? state.analysisStrategyConfirmed.draft || {} : {}, key: keys.strategy, keys };
}
export function runAlignment(state, run) {
  const design = currentDesign(state);
  const issues = [];
  if (!design.questionConfirmed) issues.push('Confirm the current research question in Phase 4.');
  if (!design.graphConfirmed) issues.push('Confirm the current graph in Phase 6.');
  if (!design.strategyConfirmed) issues.push('Confirm the current adjustment set and strategy in Phase 7.');
  if (state.graphValidationResult?.status === 'invalid') issues.push('Resolve the current graph validation errors.');
  if (state.analysisStrategyValidation?.status === 'invalid') issues.push('Resolve the current strategy validation errors.');
  // Preserve the approved-workspace constraint using its supplied question,
  // never schema guesses or hard-coded BDE variable substitutions.
  if (state.studyMode?.active) {
    const approved = state.studyMode.frozen_drafts?.question;
    if (!approved?.exposure || !approved?.outcome || approved.exposure !== design.question.exposure || approved.outcome !== design.question.outcome) {
      issues.push('The current question does not match the approved study workspace design. Review the workspace and Phase 4.');
    }
  }
  if (!run) issues.push(DESIGN_CHANGED_MESSAGE);
  else {
    const exposure = run.results?.exposure || run.config?.exposure;
    const outcome = run.results?.outcome || run.config?.outcome;
    if (exposure !== design.question.exposure) issues.push('Selected estimation exposure does not match the current question.');
    if (outcome !== design.question.outcome) issues.push('Selected estimation outcome does not match the current question.');
    if (stableKey(variableSet(run.config?.adjustmentSet ?? run.config?.adjustment_set)) !== stableKey(design.adjustmentSet)) issues.push('Selected estimation adjustment set does not match the confirmed Phase 7 set.');
    if (run.designKey !== design.key) issues.push('Selected estimation run belongs to a previous or unverified design version.');
    const nodes = design.graph?.nodes || [];
    for (const name of [design.question.exposure, design.question.outcome, ...design.adjustmentSet]) {
      if (!nodes.some(n => n.id === name)) issues.push(`Confirmed graph is missing ${name || 'a selected variable'}.`);
    }
    for (const [role, name] of [['exposure', design.question.exposure], ['outcome', design.question.outcome]]) {
      const node = nodes.find(n => n.id === name);
      if (String(state.variableRoles?.[name] || node?.role || '').toLowerCase() !== role) issues.push(`Confirmed graph ${role} role does not match the current question.`);
    }
  }
  return { compatible: issues.length === 0, issues, design };
}
export function reviewDesignState(state) {
  const alignment = runAlignment(state, state.primaryEstimationRun);
  return { ...state, questionFields: alignment.design.question,
    primaryEstimationRun: alignment.compatible ? state.primaryEstimationRun : null,
    confirmedGraph: alignment.design.graph, graphNodes: alignment.design.graph?.nodes || [], graphEdges: alignment.design.graph?.edges || [],
    currentDesign: alignment.design, designIssues: alignment.issues };
}
