import { createStudyEventQueue } from './studyEventQueue.js';

// Explicit semantic events only: no DOM listeners, keystrokes, or API payload capture.
export const EVENT_TYPES = new Set('page_view phase_change button_click dataset_upload document_upload document_ingestion rag_search chat_user_message chat_assistant_response variable_selection graph_action feasibility_check identification_check estimation_action report_export pre_survey_submit post_survey_submit error'.split(' '));
const phases = ['setup', 'data-foundation', 'explore', 'question', 'feasibility', 'graph', 'strategy', 'estimation', 'review'];
const sources = ['llm_response', 'deterministic_response', 'fallback_response', 'error_response'];
const statuses = ['started', 'running', 'completed', 'success', 'error', 'failed', 'blocked', 'unknown', 'ready', 'requires_revision'];
const aliases = { action_status: 'status', response_source: 'source', result_status: 'status', estimation_status: 'status', export_format: 'format', graph_node_count: 'node_count', graph_edge_count: 'edge_count', variable_count: 'column_count', chunks_created: 'chunk_count' };
const outcomes = { attempted: 'started', succeeded: 'success', failed: 'failed', blocked: 'blocked' };
const counts = new Set(['column_count','row_count','document_count','chunk_count','warning_count','sample_size','node_count','edge_count','duration_ms']);
const extraEnums = {from_phase:phases,to_phase:phases,role:['exposure','outcome','confounder','mediator','collider','context','proxy','unassigned'],failed_step:['document_loading','chunking','embedding','vector_store','unknown'],error_category:['action_failed','unavailable','validation','blocked']};
export function normalizePhase(phase) {
  if (Number.isInteger(phase) && phase >= 1 && phase <= 9) return phases[phase - 1];
  return [...phases, 'pre_survey', 'post_survey'].includes(phase) ? phase : 'unknown';
}
export function sanitizeMetadata(metadata = {}) {
  const clean = {}; let removed = false;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return { metadata_sanitized: true };
  for (const [original, input] of Object.entries(metadata)) {
    const key = aliases[original] || original;
    const value = original === 'action_status' ? outcomes[input] : input;
    if ((['text_sanitized','text_truncated','metadata_sanitized'].includes(key) && value === true) || (key === 'request_id' && typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) || extraEnums[key]?.includes(value) || (key === 'status' && statuses.includes(value)) || (key === 'source' && sources.includes(value)) ||
        (key === 'format' && ['json','markdown','pdf'].includes(value)) ||
        (counts.has(key) && Number.isSafeInteger(value) && value >= 0 && value <= 1e12)) clean[key] = value;
    else if (original !== 'phase_number' || !Number.isInteger(input) || input < 1 || input > 9) removed = true;
  }
  if (removed) clean.metadata_sanitized = true;
  return clean;
}
function redactPhones(text) {
  // Keep these phone formats/boundaries in sync with study_privacy.py. Grouping
  // must be complete; decimal tails and exponent fragments are not phone tokens.
  const candidates = /(?:\+?[0-9]{1,3}[ -]?)?\([0-9]{2,4}\)[ -]?[0-9]{3,4}[ -]?[0-9]{3,4}|(?:\+?1[ .-]?)?[0-9]{3}([ .-])[0-9]{3}\1[0-9]{4}|\+[0-9]{1,3}(?:[ -][0-9]{1,6}){2,4}|\+[0-9]{1,3}[ -][0-9]{7,12}|\+?[0-9]{10,15}/g;
  return text.replace(candidates, (candidate, separator, offset) => {
    const before = text.slice(0, offset), after = text.slice(offset + candidate.length);
    if (/[A-Za-z0-9_.+-]$/.test(before) || /^(?:[A-Za-z0-9_]|[.+-][0-9])/.test(after)) return candidate;
    const digits = candidate.replace(/[^0-9]/g, '').length;
    if (digits < 10 || digits > 15) return candidate;
    // Exempt only an integer in an explicitly labeled statistical field or CI
    // bound. These anchored contexts never exempt contact text elsewhere.
    const count = /\b(?:n|sample[ _]size|sample[ _]count|observation[ _]count|row[ _]count)\s*[:=]\s*$/i;
    const scalar = /\b(?:point estimate|coefficient|standard error|se|p-value)\s*(?:[:=]\s*|\s+)$/i;
    const bound = /\b(?:ci(?: bounds)?|confidence interval)\s*:?\s*[([]?\s*(?:[+-]?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?(?:\s*,\s*|\s+))?$/i;
    if (/^\+?[0-9]+$/.test(candidate) && (count.test(before) || scalar.test(before) || bound.test(before))) return candidate;
    return '[phone-like text removed]';
  });
}
function safeText(text) {
  if (typeof text !== 'string') return '';
  if (/Traceback|\bat\s+\S+\s+\([^)]*:\d+|-----BEGIN|api[_ -]?key|authorization|password|secret/im.test(text)) return '[Content omitted]';
  return redactPhones(text.slice(0, 4000)
    .replace(/(?:[A-Za-z]:\\|(?:~|\.)?\/)(?:[^\s/\\]+[/\\])+[^\s]*/g, '[path removed]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[URL removed]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address removed]'))
    .replace(/\bsk-[\w-]+|Bearer\s+\S+/gi, '[credential removed]')
    .replace(/\b[^\s/\\]+\.(?:csv|xlsx?|pdf|docx?|txt|json)\b/gi, '[filename removed]').slice(0, 4000);
}
const summaryStatuses = [...statuses, 'marginal', 'valid', 'invalid', 'valid_with_warnings', 'completed_with_warnings', 'feasible_with_warnings', 'feasible_for_graph_design', 'not_ready', 'review_required', 'requires_review', 'not_identified', 'identified', 'blocked_not_ready', 'not_runnable', 'fallback', 'pass', 'fail', 'warning', 'ready_for_analysis_planning', 'not_identifiable_with_current_design', 'identifiable_only_under_additional_assumptions'];
export function summarizeAnalysis(kind, result = {}) {
  if (!['feasibility','graph','identification','estimation','report'].includes(kind)) return {};
  const raw = kind === 'identification' ? result.identification_status || result.status : kind === 'feasibility' ? result.feasibility_status || result.status : result.status;
  const summary = { status: summaryStatuses.includes(raw) ? raw : 'unknown' };
  const warnings = result.warnings || result.data_quality_warnings || result.unresolved_warnings;
  if (Array.isArray(warnings)) summary.warning_count = warnings.length;
  else if (Number.isSafeInteger(result.warning_count) && result.warning_count >= 0) summary.warning_count = result.warning_count;
  const safe = result.safe_to_continue ?? result.safe_to_continue_to_graph ?? result.safe_to_continue_to_estimation;
  if (typeof safe === 'boolean') summary.safe_to_continue = safe;
  if (kind === 'graph') {
    if (Array.isArray(result.nodes || result.normalized_nodes)) summary.node_count = (result.nodes || result.normalized_nodes).length;
    else if (Number.isSafeInteger(result.node_count) && result.node_count >= 0) summary.node_count = result.node_count;
    if (Array.isArray(result.edges || result.normalized_edges)) summary.edge_count = (result.edges || result.normalized_edges).length;
    else if (Number.isSafeInteger(result.edge_count) && result.edge_count >= 0) summary.edge_count = result.edge_count;
  }
  if (kind === 'estimation') {
    if (['statsmodels_logit','statsmodels_linear','logistic_regression','linear_regression','OLS','Logit'].includes(result.model_type)) summary.model_type = result.model_type;
    const n = result.primary_result?.sample_size ?? result.sample_size;
    if (Number.isSafeInteger(n) && n >= 0) summary.sample_size = n;
  }
  if (Array.isArray(result.errors)) summary.error_count = result.errors.length;
  if (Array.isArray(result.blocking_issues)) summary.blocking_issue_count = result.blocking_issues.length;
  else if (Array.isArray(warnings) && warnings.some(w => w?.severity)) summary.blocking_issue_count = warnings.filter(w => w?.severity === 'blocking').length;
  const adjustment = result.adjustment_set || result.recommended_adjustment_set || result.proposed_adjustment_set;
  if (kind === 'identification' && Array.isArray(adjustment)) summary.adjustment_variable_count = adjustment.length;
  const review = result.requires_review ?? result.requires_user_review;
  if (typeof review === 'boolean') summary.requires_review = review;
  for (const key of ['error_count','blocking_issue_count','adjustment_variable_count']) if (Number.isSafeInteger(result[key]) && result[key] >= 0) summary[key] = result[key];
  return summary;
}
export const summarizeFeasibility = result => summarizeAnalysis('feasibility', result);
export const summarizeGraph = result => summarizeAnalysis('graph', result);
export const summarizeIdentification = result => summarizeAnalysis('identification', result);
export const summarizeEstimation = result => summarizeAnalysis('estimation', result);
export const summarizeReportExport = result => summarizeAnalysis('report', result);

function buildEvent(input, identity, id, timestamp) {
  if (!Number.isFinite(Date.parse(timestamp)) || !/^[A-Za-z0-9_.:-]{1,80}$/.test(identity?.study_version || '')) return false;
  if (!EVENT_TYPES.has(input.event_type)) return false;
  const token = value => typeof value === 'string' && /^[a-z][a-z0-9_:-]{0,79}$/.test(value);
  if (!token(input.event_label) || (input.ui_element && !token(input.ui_element))) return false;
  if (!/^participant_[0-9a-f-]{36}$/i.test(identity?.participant_id) || !/^session_[0-9a-f-]{36}$/i.test(identity?.session_id)) return false;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return false;
  const event = { event_id: id, participant_id: identity.participant_id, session_id: identity.session_id, study_version: identity.study_version,
    client_timestamp: timestamp, phase: normalizePhase(input.phase ?? input.metadata?.phase_number), event_type: input.event_type, event_label: input.event_label,
    metadata_json: sanitizeMetadata(input.metadata) };
  if (input.ui_element) event.ui_element = input.ui_element;
  const textField = input.event_type === 'chat_user_message' && input.submitted === true ? 'user_input_text'
    : input.event_type === 'chat_assistant_response' && input.displayed === true ? 'assistant_output_text' : null;
  if (textField) {
    const original = input[textField];
    event[textField] = safeText(original);
    if (event[textField] !== original) event.metadata_json.text_sanitized = true;
    if (typeof original === 'string' && original.length > 4000) event.metadata_json.text_truncated = true;
  }
  const kind = { feasibility_check:'feasibility', graph_action:'graph', identification_check:'identification', estimation_action:'estimation', report_export:'report' }[input.event_type];
  if (kind && input.analysis_result_summary) event.analysis_result_summary = JSON.stringify(summarizeAnalysis(kind, input.analysis_result_summary));
  return event;
}

function restoreEvent(saved) {
  if (!saved || typeof saved !== 'object') return false;
  let summary;
  if (typeof saved.analysis_result_summary === 'string' && saved.analysis_result_summary.length <= 2000) {
    try { summary = JSON.parse(saved.analysis_result_summary); } catch { /* Invalid summary is omitted. */ }
  }
  // Explicit reconstruction excludes arbitrary storage keys and reuses the same
  // submitted/displayed text and metadata filters. Original identity is retained.
  return buildEvent({ event_type: saved.event_type, event_label: saved.event_label, phase: saved.phase,
    ui_element: saved.ui_element, metadata: saved.metadata_json,
    submitted: typeof saved.user_input_text === 'string', displayed: typeof saved.assistant_output_text === 'string', user_input_text: saved.user_input_text,
    assistant_output_text: saved.assistant_output_text, analysis_result_summary: summary },
  saved, saved.event_id, saved.client_timestamp);
}

export function createStudyEventLogger({ getIdentity, uuid = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString(), ...options }) {
  const queue = createStudyEventQueue({ ...options, now, sanitizeRestored: restoreEvent });
  const seen = new Set();
  function log(input = {}) {
    try {
      const id = input.event_id || uuid();
      if (seen.has(id)) return id;
      const event = buildEvent(input, getIdentity(), id, now());
      if (!event || !queue.enqueue(event)) return false;
      seen.add(id);
      // Backend deduplication remains the final authority, including across tabs.
      if (seen.size > 1000) seen.delete(seen.values().next().value);
      return id;
    } catch { return false; }
  }
  const { enqueue, ...controls } = queue;
  return { ...controls, log };
}

// Lifecycle effects may repeat under React Strict Mode. Confirmed callbacks alone
// emit survey events; restored completion markers never fabricate submissions.
export function createStudyLifecycle(logger) {
  const emitted = new Set();
  return {
    confirmed(kind, identity) {
      try {
        const key = `${identity.session_id}:${identity.study_version}:${kind}`;
        if (emitted.has(key)) return;
        const event_type = kind === 'dashboard' ? 'page_view' : kind === 'pre' ? 'pre_survey_submit' : 'post_survey_submit';
        const phase = kind === 'dashboard' ? 'setup' : kind === 'pre' ? 'pre_survey' : 'post_survey';
        if (logger.log({ event_type, event_label: kind === 'dashboard' ? 'dashboard_started' : event_type, phase, metadata: { action_status: 'succeeded' } })) emitted.add(key);
      } catch { /* Logging failure must not affect survey confirmation. */ }
    },
  };
}
