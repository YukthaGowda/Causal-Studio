// Semantic adapter for the existing Step 4A queue; it never sends API requests.
// Request identity and phase are captured once. finish() marks early guards as blocked,
// and terminal outcomes deduplicate catch/finally paths. Counts come only from results.
import { normalizePhase, summarizeAnalysis } from './studyEvents.js';
const TYPES = { feasibility_check: 'feasibility', graph_action: 'graph', identification_check: 'identification', estimation_action: 'estimation', report_export: 'report' };
export function safeUploadMetadata(files) {
    const extension = files?.[0]?.name?.split('.').pop()?.toLowerCase();
    return { file_count: files?.length || 0, file_type: ['csv', 'xls', 'xlsx', 'pdf', 'docx', 'txt'].includes(extension) ? extension : 'other' };
}
const noop = () => { };
const disabled = { capture: noop, fail: noop, success: noop, blocked: noop, finish: noop, running: noop, opened: noop, downloadInitiated: noop, request_id: null };
export function createDashboardEvents(log, uuid = () => crypto.randomUUID()) {
    const emit = event => { try {
        log?.(event);
    }
    catch { /* Telemetry cannot affect actions. */ } };
    const visited = new Set();
    let current;
    function enter(phase, source = 'workflow') {
        phase = normalizePhase(phase);
        if (phase === 'unknown' || phase === current)
            return;
        if (current)
            emit({ event_type: 'phase_change', event_label: 'phase_changed', phase, metadata: { from_phase: current, to_phase: phase, navigation_source: source } });
        current = phase;
        if (!visited.has(phase)) {
            visited.add(phase);
            emit({ event_type: 'page_view', event_label: `phase_${['setup', 'data-foundation', 'explore', 'question', 'feasibility', 'graph', 'strategy', 'estimation', 'review'].indexOf(phase) + 1}_opened`, phase });
        }
    }
    function begin(phase, type, label, metadata = {}) {
        try {
            const request_id = uuid();
            let done = false, summary, resultState, running = false;
            const base = { phase: normalizePhase(phase), metadata: { ...metadata, request_id } };
            emit({ ...base, event_type: 'button_click', event_label: `${label}_clicked`, ui_element: label, metadata: { ...base.metadata, action_status: 'attempted' } });
            if (type !== 'button_click')
                emit({ ...base, event_type: type, event_label: `${label}_attempted`, metadata: { ...base.metadata, action_status: 'attempted' } });
            function end(outcome, eventLabel = `${label}_${outcome}`) {
                if (done)
                    return;
                done = true;
                emit({ ...base, event_type: type, event_label: eventLabel, metadata: { ...base.metadata, action_status: outcome }, ...(summary ? { analysis_result_summary: summary } : {}) });
                if (outcome === 'failed')
                    emit({ ...base, event_type: 'error', event_label: `${label}_error`, metadata: { request_id, action_status: 'failed', error_category: 'action_failed' } });
            }
            return { request_id,
                capture(result) {
                    try {
                        const identification = result?.identification || result?.identification_result;
                        const r = type === 'identification_check' && identification ? { ...identification, requires_user_review: result.requires_user_review } : result;
                        if (TYPES[type])
                            summary = summarizeAnalysis(TYPES[type], r || {});
                        for (const [key, value] of Object.entries({ document_count: r?.files_processed ?? r?.document_count, chunk_count: r?.stored_chunks ?? r?.chunks_created }))
                            if (Number.isSafeInteger(value) && value >= 0)
                                base.metadata[key] = value;
                        const status = r?.status || r?.feasibility_status;
                        if (['error', 'failed', 'fail'].includes(status))
                            resultState = 'failed';
                        else if (['invalid', 'blocked', 'blocked_not_ready', 'not_runnable', 'not_identified'].includes(status) || r?.safe_to_run_estimation === false || r?.safe_to_continue_to_graph === false || r?.safe_to_continue_to_estimation === false)
                            resultState = 'blocked';
                    }
                    catch { /* Ignore malformed diagnostic artifacts. */ }
                },
                running() { if (!running) {
                    running = true;
                    emit({ ...base, event_type: type, event_label: `${label}_running`, metadata: { ...base.metadata, status: 'running' } });
                } },
                opened: () => end('succeeded', 'report_pdf_preview_opened'),
                downloadInitiated: () => end('succeeded', 'report_download_initiated'),
                fail: (step) => { if (['document_loading', 'chunking', 'embedding', 'vector_store'].includes(step))
                    base.metadata.failed_step = step; end('failed'); }, success: () => end(resultState || 'succeeded'), blocked: () => end(resultState || 'blocked'), finish: () => end(resultState || 'blocked'),
            };
        }
        catch {
            return disabled;
        }
    }
    function chat(phase, text, submitted = true) {
        let request_id;
        try {
            request_id = uuid();
        }
        catch {
            return { reply: noop, message: answer => ({role:'assistant',text:answer,studyReply:noop}) };
        }
        const origin = normalizePhase(phase);
        let replied = false;
        if (submitted) emit({ phase: origin, event_type: 'chat_user_message', event_label: 'chat_message_submitted', submitted: true, user_input_text: text, metadata: { request_id } });
        function responseSource(response = {}, source) {
            const used = response?.llm_used ?? response?.used_llm;
            return source || (used === true ? 'llm_response' : used === false && !response?.warning && response?.status !== 'fallback' ? 'deterministic_response' : 'fallback_response');
        }
        function reply(answer, response = {}, source) {
            try {
                if (replied) return;
                replied = true;
                // Only visible text is passed to the queue, never response/context objects.
                emit({ phase: origin, event_type: 'chat_assistant_response', event_label: 'chat_response_displayed',
                    displayed: true, assistant_output_text: answer,
                    metadata: { request_id, response_source: responseSource(response, source) } });
            } catch { /* Telemetry must not change displayed responses. */ }
        }
        return { reply, message(answer, response = {}, source) {
            // Retain only the classification, not retrieved chunks or hidden prompts.
            const classification = responseSource(response, source);
            return { role: 'assistant', text: answer, studyReply: (visibleText = answer) => reply(visibleText, {}, classification) };
        } };
    }
    const displayed = new WeakSet();
    function displayMessages(phase, messages = []) {
        // Called by a React effect after the active thread has committed to the DOM.
        // Messages in inactive threads wait until that thread is displayed.
        for (const message of messages) {
            if (message.role !== 'assistant' || displayed.has(message)) continue;
            displayed.add(message);
            try {
                const visibleText = message.warning ? `${message.text}\n${message.warning}` : message.text;
                if (message.studyReply) message.studyReply(visibleText);
                else chat(phase, null, false).reply(visibleText, {}, 'deterministic_response');
            } catch { /* Rendering and navigation must not depend on telemetry. */ }
        }
    }

    return { begin, enter, chat, displayMessages };
}
