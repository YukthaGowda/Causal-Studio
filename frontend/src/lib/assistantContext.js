// Typed chat uses snapshots only. Building this context never changes workflow state.
function variableList(value) {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? value.split(',').map(v => v.trim()).filter(v => v && v !== '(none)') : [];
}

export function buildChatContext(state, phase, { checks = {}, alignment = {}, review = null } = {}) {
  const dataset = state.datasets?.find((item) => item.savedFilename) || state.datasets?.[0];
  const schema = dataset?.schema || {};
  const selected = state.primaryEstimationRun;
  const raw = selected?.raw || {};
  const question = state.questionFields || {};
  const warnings = [];
  const addWarnings = (source, items, severity = 'warning') => {
    for (const item of items || []) {
      const text = typeof item === 'string' ? item : item.message || item.explanation || item.warning || JSON.stringify(item);
      warnings.push({ source, severity: item?.severity || severity, text });
    }
  };
  addWarnings('dataset quality', schema.warnings);
  addWarnings('exploration', state.broadExploration?.data_quality_warnings);
  addWarnings('feasibility', state.targetedFeasibilityResult?.warnings);
  addWarnings('feasibility', state.targetedFeasibilityResult?.blocking_issues, 'blocking');
  addWarnings('graph', state.graphValidationResult?.warnings);
  addWarnings('graph', state.graphValidationResult?.errors, 'blocking');
  addWarnings('strategy', state.analysisStrategyValidation?.warnings);
  addWarnings('strategy', state.analysisStrategyValidation?.errors, 'blocking');
  addWarnings('estimation', raw.warnings || selected?.results?.warnings);
  addWarnings('estimation diagnostics', raw.diagnostics?.model_warnings || selected?.results?.diagnostics?.model_warnings);
  addWarnings('estimation data', raw.diagnostics?.data_warnings || selected?.results?.diagnostics?.data_warnings);
  addWarnings('estimation readiness', raw.readiness?.warnings);
  addWarnings('report', review?.unresolved_warnings);
  addWarnings('claim audit', review?.claim_audit?.flagged_claims);
  const proposed = variableList(state.editableAdjustmentSet);
  const confirmed = variableList(state.analysisStrategyConfirmed?.adjustmentSet);
  const nextBlockers = [];
  if (phase === 'setup') {
    for (const [key, message] of [
      ['objectiveAdded', 'Add your research objective in Project Setup.'],
      ['datasetUploaded', 'Upload a CSV or Excel dataset in Project Setup.'],
      ['datasetParsed', 'Resolve the dataset parsing issue in Project Setup.'],
      ['blockingResolved', 'Resolve blocking dataset issues in Project Setup.'],
      ['dictionaryUploaded', 'Upload a data dictionary in Project Setup.'],
    ]) if (checks[key] === false) nextBlockers.push(message);
  }
  if (phase === 'question') {
    if (!question.question || (!state.selectedQuestionId && state.phase4Status?.kind !== 'success')) nextBlockers.push('Confirm or use a research question in Question & Variables.');
    if (!question.exposure) nextBlockers.push('Select an exposure in Question & Variables.');
    if (!question.outcome) nextBlockers.push('Select an outcome in Question & Variables.');
  }
  if (phase === 'feasibility' && !state.targetedFeasibilityResult?.safe_to_continue_to_graph) nextBlockers.push('Run feasibility checks and review the blocking issues before continuing to Causal Graph.');
  if (phase === 'graph' && !state.confirmedGraph && !state.graphAlternatives?.length) nextBlockers.push('Validate and confirm the graph, or save it as a draft, before continuing to Analysis Strategy.');
  if (phase === 'strategy' && !state.analysisStrategyConfirmed) nextBlockers.push('Run identification, validate the adjustment set, and confirm the analysis strategy.');
  if (phase === 'estimation' && !selected) nextBlockers.push('Run backend estimation and select a primary result before continuing to Review & Export.');
  const documents = [state.dictionary, state.protocol, ...(state.papers || []), ...(state.guidelines || [])].filter(Boolean);
  return {
    context_version: 1,
    current_phase: phase,
    backend_connected: Boolean(state.backendStatus?.connected),
    research_objective: state.objective || '',
    dataset: {
      filename: dataset?.savedFilename || dataset?.name || null,
      selection_basis: 'first saved dataset, otherwise first dataset (same as workflow)',
      columns: schema.column_names || [],
      numeric_columns: schema.possible_numeric_columns || [],
      categorical_columns: schema.possible_categorical_columns || [],
      rows: schema.number_of_rows ?? dataset?.rows ?? null,
      id_columns: schema.possible_id_columns || [],
      timestamp_columns: schema.possible_timestamp_date_columns || [],
    },
    bde_workspace_active: Boolean(dataset?.studyMode && (state.studyMode?.active || state.studyMode?.status === 'ready')),
    selected_question: question,
    variable_roles: state.variableRoles || {},
    adjustment: { proposed, confirmed, estimation_covariates: variableList(selected?.config?.adjustmentSet || selected?.config?.adjustment_set) },
    graph: { status: state.confirmedGraph ? 'confirmed' : 'draft', validation: state.graphValidationResult || null, nodes: (state.graphNodes || []).map(n => ({ id: n.id, role: n.role || state.variableRoles?.[n.id] })), edges: state.graphEdges || [] },
    strategy: { status: state.analysisStrategyConfirmed ? 'confirmed' : 'draft', validation: state.analysisStrategyValidation || null, identification: state.analysisStrategyResult?.identification || null },
    feasibility: state.targetedFeasibilityResult || null,
    // Never promote the latest unselected run to the selected result in chat.
    selected_estimation: selected ? { id: selected.id, backend_computed: raw.primary_result?.point_estimate != null, dataset_filename: raw.dataset_filename || raw.provenance?.dataset_filename || raw.reproducibility?.dataset_filename || selected.config?.datasetFilename || null, config: selected.config, primary_result: raw.primary_result || null, diagnostics: raw.diagnostics || selected.results?.diagnostics, warnings: raw.warnings || selected.results?.warnings, status: raw.status, model_type: raw.model_type, provenance: raw.provenance || raw.reproducibility } : null,
    latest_unselected_run_available: Boolean(state.latestEstimationRun && state.latestEstimationRun.id !== selected?.id),
    report: { ...review, context_available: Boolean(review), alignment_issues: alignment.issues || [], report_adjustment_set: alignment.reportAdjustmentSet || [], estimation_covariates: alignment.estimationCovariates || [], selected_run_id: selected?.id || null },
    next_step_blockers: phase === 'review' ? [...(alignment.issues || []), ...(review?.export_blockers || [])] : nextBlockers,
    warnings,
    evidence: { ingestion: state.ingestionInfo || null, summary: state.ragSummary || '', documents: documents.map(d => ({ filename: d.savedFilename || d.name || d.title })), chunks: [] },
  };
}

export function recentChatHistory(messages) {
  return messages.filter(m => ['user', 'assistant'].includes(m.role)).slice(-12).map(m => ({ role: m.role, content: String(m.content || m.text || '').slice(0, 4000) }));
}
