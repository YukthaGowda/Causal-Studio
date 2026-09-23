// Explicit semantic events only: no DOM listeners, keystrokes, or API payload capture.
export const EVENT_TYPES = new Set('page_view phase_change button_click dataset_upload document_upload document_ingestion rag_search chat_user_message chat_assistant_response variable_selection graph_action feasibility_check identification_check estimation_action report_export pre_survey_submit post_survey_submit error'.split(' '));
const phases = ['setup', 'data-foundation', 'explore', 'question', 'feasibility', 'graph', 'strategy', 'estimation', 'review'];
const sources = ['llm_response', 'deterministic_response', 'fallback_response', 'error_response'];
const statuses = ['started', 'running', 'completed', 'success', 'error', 'failed', 'blocked', 'unknown', 'ready', 'requires_revision'];
const aliases = { action_status: 'status', response_source: 'source', result_status: 'status', estimation_status: 'status', export_format: 'format', graph_node_count: 'node_count', graph_edge_count: 'edge_count', variable_count: 'column_count' };
const outcomes = { attempted: 'started', succeeded: 'success', failed: 'failed', blocked: 'blocked' };
const counts = new Set(['column_count','row_count','document_count','chunk_count','warning_count','sample_size','node_count','edge_count','duration_ms']);
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
    if ((key === 'status' && statuses.includes(value)) || (key === 'source' && sources.includes(value)) ||
        (key === 'format' && ['json','markdown','pdf'].includes(value)) ||
        (counts.has(key) && Number.isSafeInteger(value) && value >= 0 && value <= 1e12)) clean[key] = value;
    else if (original !== 'phase_number' || !Number.isInteger(input) || input < 1 || input > 9) removed = true;
  }
  if (removed) clean.metadata_sanitized = true;
  return clean;
}
function safeText(text) {
  if (typeof text !== 'string') return '';
  if (/Traceback|\bat\s+\S+\s+\([^)]*:\d+|-----BEGIN|api[_ -]?key|authorization|password|secret|```|^\s*[\[{]|^\s*#{1,6}\s|^\s*\|/im.test(text)) return '[Content omitted]';
  return text.slice(0, 4000)
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[URL removed]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[address removed]')
    .replace(/\+?\d[\d ()-]{8,}\d/g, '[phone-like text removed]')
    .replace(/\bsk-[\w-]+|Bearer\s+\S+/gi, '[credential removed]')
    .replace(/\b[^\s/\\]+\.(?:csv|xlsx?|pdf|docx?|txt|json)\b/gi, '[filename removed]').slice(0, 4000);
}
const summaryStatuses = [...statuses, 'marginal', 'valid', 'invalid', 'valid_with_warnings', 'completed_with_warnings', 'feasible_with_warnings', 'feasible_for_graph_design', 'not_ready', 'review_required', 'ready_for_analysis_planning', 'not_identifiable_with_current_design', 'identifiable_only_under_additional_assumptions'];
export function summarizeAnalysis(kind, result = {}) {
  if (!['feasibility','graph','identification','estimation','report'].includes(kind)) return {};
  const raw = result.status || result.feasibility_status || result.identification_status;
  const summary = { status: summaryStatuses.includes(raw) ? raw : 'unknown' };
  const warnings = result.warnings || result.data_quality_warnings;
  if (Array.isArray(warnings)) summary.warning_count = warnings.length;
  else if (Number.isSafeInteger(result.warning_count) && result.warning_count >= 0) summary.warning_count = result.warning_count;
  const safe = result.safe_to_continue ?? result.safe_to_continue_to_graph;
  if (typeof safe === 'boolean') summary.safe_to_continue = safe;
  if (kind === 'graph') {
    if (Array.isArray(result.nodes)) summary.node_count = result.nodes.length;
    else if (Number.isSafeInteger(result.node_count) && result.node_count >= 0) summary.node_count = result.node_count;
    if (Array.isArray(result.edges)) summary.edge_count = result.edges.length;
    else if (Number.isSafeInteger(result.edge_count) && result.edge_count >= 0) summary.edge_count = result.edge_count;
  }
  if (kind === 'estimation') {
    if (['statsmodels_logit','statsmodels_linear','logistic_regression','linear_regression','OLS','Logit'].includes(result.model_type)) summary.model_type = result.model_type;
    const n = result.primary_result?.sample_size ?? result.sample_size;
    if (Number.isSafeInteger(n) && n >= 0) summary.sample_size = n;
  }
  return summary;
}
export const summarizeFeasibility = result => summarizeAnalysis('feasibility', result);
export const summarizeGraph = result => summarizeAnalysis('graph', result);
export const summarizeIdentification = result => summarizeAnalysis('identification', result);
export const summarizeEstimation = result => summarizeAnalysis('estimation', result);
export const summarizeReportExport = result => summarizeAnalysis('report', result);

export function createStudyEventLogger({ getIdentity, send, uuid = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString(), schedule = setTimeout, cancel = clearTimeout, maxQueue = 100, batchSize = 10, maxAttempts = 3, delayMs = 2000 }) {
  const queue = []; const seen = new Set(); const listeners = new Set();
  let status = 'ready', timer, inFlight, dropped = false, paused = false;
  const publish = value => { status = value; for (const fn of listeners) { try { fn(); } catch { /* Logging never interrupts callers. */ } } };
  function scheduleFlush(delay = delayMs) {
    if (!paused && !timer && queue.some(item => item.attempts < maxAttempts)) timer = schedule(() => { timer = null; void flush(); }, delay);
  }
  function log(input = {}) {
    try {
      if (!EVENT_TYPES.has(input.event_type)) return false;
      const token = value => typeof value === 'string' && /^[a-z][a-z0-9_:-]{0,79}$/.test(value);
      if (!token(input.event_label) || (input.ui_element && !token(input.ui_element))) return false;
      const identity = getIdentity();
      if (!/^participant_[0-9a-f-]{36}$/i.test(identity?.participant_id) || !/^session_[0-9a-f-]{36}$/i.test(identity?.session_id)) return false;
      const id = input.event_id || uuid();
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return false;
      if (seen.has(id)) return id;
      if (queue.length >= maxQueue) { dropped = true; publish('error'); return false; }
      const event = { event_id: id, participant_id: identity.participant_id, session_id: identity.session_id, study_version: identity.study_version,
        client_timestamp: now(), phase: normalizePhase(input.phase ?? input.metadata?.phase_number), event_type: input.event_type, event_label: input.event_label,
        metadata_json: sanitizeMetadata(input.metadata) };
      if (input.ui_element) event.ui_element = input.ui_element;
      if (input.event_type === 'chat_user_message' && input.submitted === true) event.user_input_text = safeText(input.user_input_text);
      if (input.event_type === 'chat_assistant_response' && input.displayed === true) event.assistant_output_text = safeText(input.assistant_output_text);
      const kind = { feasibility_check:'feasibility', graph_action:'graph', identification_check:'identification', estimation_action:'estimation', report_export:'report' }[input.event_type];
      if (kind && input.analysis_result_summary) event.analysis_result_summary = JSON.stringify(summarizeAnalysis(kind, input.analysis_result_summary));
      queue.push({ event, attempts: 0 }); seen.add(id);
      // Bound session dedup memory. Backend event IDs remain the final dedup authority.
      if (seen.size > 1000) seen.delete(seen.values().next().value);
      if (!inFlight) publish(dropped ? 'error' : 'unsaved');
      scheduleFlush(); return id;
    } catch { publish('error'); return false; }
  }
  function flush() {
    if (inFlight) return inFlight;
    if (timer) { cancel(timer); timer = null; }
    const batch = queue.filter(item => item.attempts < maxAttempts).slice(0, Math.min(batchSize, 10));
    if (!batch.length) { publish(dropped ? 'error' : queue.length ? 'unsaved' : 'ready'); return Promise.resolve(false); }
    batch.forEach(item => item.attempts++);
    publish('sending');
    inFlight = Promise.resolve().then(() => send(batch.map(item => structuredClone(item.event)))).then(result => {
      if (result?.status !== 'ok' || !Number.isInteger(result.inserted) || !Number.isInteger(result.duplicates) || result.inserted < 0 || result.duplicates < 0 || result.inserted + result.duplicates !== batch.length) throw Error('Unconfirmed batch');
      for (const item of batch) queue.splice(queue.indexOf(item), 1);
      publish(dropped ? 'error' : queue.length ? 'unsaved' : 'ready'); return true;
    }).catch(() => { publish('unsaved'); return false; }).finally(() => {
      inFlight = null; scheduleFlush(delayMs * 2 ** Math.max(...batch.map(item => item.attempts - 1)));
    });
    return inFlight;
  }
  return { log, flush, getSnapshot: () => status, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, start: () => { paused = false; scheduleFlush(); }, stop: () => { paused = true; if (timer) cancel(timer); timer = null; } };
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
