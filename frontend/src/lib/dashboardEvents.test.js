import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createDashboardEvents, safeUploadMetadata } from './dashboardEvents.js';
import { createStudyEventLogger } from './studyEvents.js';
import { createWorkflowState, designKeys } from './workflowDesign.js';
const uuid = () => webcrypto.randomUUID();
function fixture() { const events = []; return { events, tracker: createDashboardEvents(e => events.push(e), uuid) }; }
const source = readFileSync('src/components/CausalStudioApp.jsx', 'utf8');
const ast = ts.createSourceFile('app.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function handler(name, context) { let text; function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name)
    text = n.getText(ast); ts.forEachChild(n, visit); } visit(ast); assert.ok(text, name); return new Function(...Object.keys(context), `${text};return ${name}`)(...Object.values(context)); }
const noop = () => { };
test('phase transitions and first visits deduplicate rerenders', () => { const { tracker, events } = fixture(); tracker.enter('setup'); tracker.enter('setup'); tracker.enter('graph', 'sidebar'); tracker.enter('setup'); assert.deepEqual(events.map(e => e.event_type), ['page_view', 'phase_change', 'page_view', 'phase_change']); assert.equal(events[1].metadata.from_phase, 'setup'); assert.equal(events[1].metadata.to_phase, 'graph'); });
test('click, success, failure, blocked and sanitized errors share action ID', () => { const { tracker, events } = fixture(); const a = tracker.begin('setup', 'dataset_upload', 'dataset_upload'); a.success(); a.finish(); const b = tracker.begin('setup', 'dataset_upload', 'dataset_upload'); b.fail(); const c = tracker.begin('graph', 'graph_action', 'graph_validation'); c.finish(); assert.equal(events.filter(e => e.event_label === 'dataset_upload_succeeded').length, 1); assert.equal(events[0].metadata.request_id, events[2].metadata.request_id); assert.equal(events.find(e => e.event_type === 'error').metadata.error_category, 'action_failed'); assert.ok(events.some(e => e.event_label === 'graph_validation_blocked')); });
test('compact analysis outcomes exclude raw model/report payloads', () => { const { tracker, events } = fixture(); for (const type of ['feasibility_check', 'graph_action', 'identification_check', 'estimation_action', 'report_export']) {
    const t = tracker.begin('review', type, 'result');
    t.capture({ status: 'completed', warnings: ['private warning'], nodes: [{}], edges: [], model_type: 'statsmodels_logit', primary_result: { sample_size: 17, point_estimate: 999 }, content: 'secret report', filename: 'private.csv' });
    t.success();
} const text = JSON.stringify(events); for (const secret of ['private warning', 'secret report', 'private.csv', 'point_estimate', '999'])
    assert.ok(!text.includes(secret)); assert.ok(text.includes('sample_size')); });
test('chat request and response preserve origin phase and source', () => { const { tracker, events } = fixture(); for (const source of ['llm_response', 'deterministic_response', 'fallback_response', 'error_response']) {
    const t = tracker.chat('question', 'Submitted question');
    tracker.enter('graph');
    t.reply('Displayed answer', {}, source);
    t.reply('duplicate');
} const chat = events.filter(e => e.event_type.startsWith('chat_')); assert.equal(chat.length, 8); for (let i = 0; i < chat.length; i += 2) {
    assert.equal(chat[i].metadata.request_id, chat[i + 1].metadata.request_id);
    assert.equal(chat[i + 1].phase, 'question');
} assert.deepEqual(chat.filter(e => e.displayed).map(e => e.metadata.response_source), ['llm_response', 'deterministic_response', 'fallback_response', 'error_response']); });
test('visible evidence-bearing chat text retained', () => { const { tracker, events } = fixture(); tracker.chat('question', 'Explain evidence').reply('private document excerpt', { llm_used: false, evidence_chunks_used: 1 }); assert.equal(events.at(-1).assistant_output_text, 'private document excerpt'); });
test('actual submitted-chat handler does nothing for draft/empty or pending input', async () => { let count = 0; for (const params of [{ assistantInput: '', typedChatPending: { current: false } }, { assistantInput: 'draft', typedChatPending: { current: true } }]) {
    await handler('submitAssistantInput', { ...params, assistantThinking: false, dashboardEvents: { chat: () => { count++; } } })();
} assert.equal(count, 0); });
test('actual dataset upload handler emits attempt and success without filenames', async () => {
    const { tracker, events } = fixture();
    const context = { safeUploadMetadata, beginStudyAction: (...a) => tracker.begin('setup', ...a), pushAssistantNote: noop, setAction: noop, datasets: [], seedFromName: () => 0, genDatasetDetail: () => ({}), uploadDataset: async () => ({ saved_filename: 'secret.csv' }), getDatasetSchema: async () => ({}), schemaToDataset: () => ({ status: 'ready', schema: { column_names: [] } }), setBackendStatus: noop, buildRealSchemaAssistantMessage: () => '', dictionary: {}, formatList: () => '', advanceGuidance: noop, DERIVED_FEATURE_OPTIONS: [] };
    for (const name of ['setDatasets', 'setStudyMode', 'setBroadExploration', 'setPromotedPatterns', 'setSavedExploreViews', 'setVariableRoles', 'setSelectedQuestionId', 'setQuestionFields', 'setQuestionCandidates', 'setCandidateVariables', 'setDerivedFeatureCandidates', 'setPhase4Status', 'setDerivedFeatures', 'setGraphNodes', 'setGraphEdges', 'setGraphValidationResult', 'setGraphAlternatives', 'setConfirmedGraph', 'setEditableAdjustmentSet', 'setAnalysisStrategyResult', 'setAnalysisStrategyValidation', 'setAnalysisStrategyDraft', 'setAnalysisStrategyConfirmed', 'setLatestEstimationRun', 'setPrimaryEstimationRun', 'setStudyReportDraft', 'setRagSummary'])
        context[name] = noop;
    await handler('addDatasets', context)([{ name: 'secret.csv', size: 1 }]);
    assert.ok(events.some(e => e.event_label === 'dataset_upload_succeeded'));
    assert.ok(!JSON.stringify(events).includes('secret.csv'));
    context.uploadDataset = async () => { throw Error('secret/path'); };
    context.friendlyError = () => '';
    await handler('addDatasets', context)([{ name: 'secret.csv' }]);
    assert.ok(events.some(e => e.event_label === 'dataset_upload_failed'));
});
test('actual ingestion handler logs running and outcome with mocked lifecycle only', async () => { for (const fail of [false, true]) {
    const { tracker, events } = fixture();
    const context = { safeUploadMetadata, beginStudyAction: (...a) => tracker.begin('setup', ...a), ingestionMonitor: { current: null }, AbortController, setAction: noop, ingestDocuments: noop, getIngestionStatus: noop, ingestionInfo: {}, setIngestionInfo: noop, setBackendStatus: noop, pushAssistantNote: noop, friendlyError: () => '', followIngestion: async ({ onUpdate }) => { onUpdate({ status: 'running' }); if (fail)
            throw Error(); return { status: 'completed', chunks_created: 5 }; } };
    await handler('handleDocumentIngestion', context)();
    assert.ok(events.some(e => e.event_label === 'document_ingestion_running'));
    assert.ok(events.some(e => e.event_label === `document_ingestion_${fail ? 'failed' : 'succeeded'}`));
} });
test('actual estimation action records blocked attempt without fitting', async () => { const { tracker, events } = fixture(); await handler('runEstimation', { actions: { beginStudyAction: (...a) => tracker.begin('estimation', ...a) }, isRunning: false, firstRealDataset: () => null, datasets: [], backendStatus: { connected: false }, pushAssistantNote: noop, showToast: noop })(); assert.ok(events.some(e => e.event_label === 'estimation_run_blocked')); });
test('actual role selection action omits variable identifier', () => { const { tracker, events } = fixture(); handler('setNodeRole', { beginStudyAction: (...a) => tracker.begin('graph', ...a), setGraphNodes: noop, setVariableRole: noop })('private_variable', 'Confounder'); assert.ok(!JSON.stringify(events).includes('private_variable')); assert.equal(events[0].metadata.role, 'confounder'); });
test('telemetry failure cannot prevent handler action', () => { let applied = false; const tracker = createDashboardEvents(() => { throw Error(); }, uuid); handler('setNodeRole', { beginStudyAction: (...a) => tracker.begin('graph', ...a), setGraphNodes: noop, setVariableRole: () => { applied = true; } })('x', 'Outcome'); assert.equal(applied, true); });
test('wire logger permits pairing and navigation metadata while stripping content', async () => { let batch; const logger = createStudyEventLogger({ getIdentity: () => ({ participant_id: 'participant_' + uuid(), session_id: 'session_' + uuid(), study_version: 'pilot' }), uuid, send: async (e) => { batch = e; return { status: 'ok', inserted: e.length, duplicates: 0 }; }, schedule: () => 1, cancel: noop }); const tracker = createDashboardEvents(logger.log, uuid); tracker.enter('setup'); tracker.enter('graph', 'sidebar'); const t = tracker.begin('review', 'report_export', 'report_export', { export_format: 'pdf', filename: 'private.pdf' }); t.success(); await logger.flush(); assert.ok(batch.some(e => e.metadata_json.request_id)); assert.ok(batch.some(e => e.metadata_json.from_phase === 'setup')); assert.ok(!JSON.stringify(batch).includes('private.pdf')); });
test('actual async chat response stays with initiating phase and pairs request ID', async () => {
    const { tracker, events } = fixture();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let threads = {question: []};
    const context = { assistantInput: 'Explain my result', typedChatPending: { current: false }, assistantThinking: false, page: 'question', dashboardEvents: tracker, state: {}, checks: {}, activeReportConfiguration: () => ({}), primaryEstimationRun: null, reviewContextRef: { current: null }, buildChatContext: () => ({ dataset: { filename: 'private.csv' } }), typedChatHistory: { current: [] }, typedChatDataset: { current: null }, recentChatHistory: x => x, setAssistantInput: noop, setAssistantThinking: noop, setAssistantThinkingMessage: noop, setAssistantThreads: fn => { threads = fn(threads); }, assistantChat: () => pending, assistantMessageFromResponse: r => r.answer, friendlyError: () => '' };
    const promise = handler('submitAssistantInput', context)();
    tracker.enter('review');
    release({ answer: 'A cautious association.', llm_used: false });
    await promise;
    assert.equal(events.filter(e => e.event_type === 'chat_assistant_response').length, 0);
    tracker.displayMessages('review', threads.review);
    assert.equal(events.filter(e => e.event_type === 'chat_assistant_response').length, 0);
    tracker.displayMessages('question', threads.question);
    tracker.displayMessages('question', threads.question); // Strict Mode/revisit deduplication.
    const chat = events.filter(e => e.event_type.startsWith('chat_'));
    assert.equal(chat.length, 2);
    assert.equal(chat[1].phase, 'question');
    assert.equal(chat[0].metadata.request_id, chat[1].metadata.request_id);
    assert.equal(chat[1].metadata.response_source, 'deterministic_response');
    assert.ok(!JSON.stringify(events).includes('private.csv'));
});
test('native feasibility, graph and identification summaries survive wire filtering', async () => {
    let sent;
    const logger = createStudyEventLogger({ getIdentity: () => ({ participant_id: 'participant_' + uuid(), session_id: 'session_' + uuid(), study_version: 'pilot' }), uuid, send: async (events) => { sent = events; return { status: 'ok', inserted: events.length, duplicates: 0 }; }, schedule: () => 1, cancel: noop });
    const tracker = createDashboardEvents(logger.log, uuid);
    const fixtures = [
        ['feasibility_check', { feasibility_status: 'feasible_with_warnings', data_quality_warnings: [{ severity: 'blocking', message: 'private' }], safe_to_continue_to_graph: false }, { status: 'feasible_with_warnings', warning_count: 1, safe_to_continue: false, blocking_issue_count: 1 }],
        ['graph_action', { status: 'invalid', normalized_nodes: [{ id: 'private' }], normalized_edges: [], errors: ['private'], warnings: [], safe_to_continue: false }, { status: 'invalid', warning_count: 0, safe_to_continue: false, node_count: 1, edge_count: 0, error_count: 1 }],
        ['identification_check', { status: 'completed', requires_user_review: true, identification: { status: 'requires_review', recommended_adjustment_set: ['private'], warnings: ['private'] } }, { status: 'requires_review', warning_count: 1, adjustment_variable_count: 1, requires_review: true }],
    ];
    for (const [type, result] of fixtures) {
        const t = tracker.begin('graph', type, 'result');
        t.capture(result);
        t.success();
    }
    await logger.flush();
    const outcomes = sent.filter(e => e.analysis_result_summary);
    assert.equal(outcomes.length, 3);
    for (let i = 0; i < fixtures.length; i++)
        assert.deepEqual(JSON.parse(outcomes[i].analysis_result_summary), fixtures[i][2]);
    assert.equal(outcomes[0].metadata_json.status, 'blocked');
    assert.equal(outcomes[1].metadata_json.status, 'blocked');
    assert.ok(!JSON.stringify(sent).includes('private'));
});
test('actual graph validation handler logs only returned compact summary', async () => {
    const { tracker, events } = fixture();
    const context = { beginStudyAction: (...a) => tracker.begin('graph', ...a), backendStatus: { connected: true }, setGraphActionStatus: noop, graphBackendPayload: () => ({}), validateCausalGraph: async () => ({ status: 'valid', normalized_nodes: [{}, {}], normalized_edges: [{}], warnings: [], errors: [], safe_to_continue: true }), setGraphValidationResult: noop, recordStudyEvent: noop, pushAssistantNote: noop, friendlyError: () => '' };
    await handler('validateCurrentGraph', { ...context, designKeys, workflowRef: { current: createWorkflowState() } })();
    assert.deepEqual(events.at(-1).analysis_result_summary, { status: 'valid', node_count: 2, edge_count: 1, warning_count: 0, error_count: 0, safe_to_continue: true });
});
test('actual report export observes blockers and PDF popup result, never requests estimation', async () => {
    for (const [ready, opened, outcome] of [[false, false, 'blocked'], [true, false, 'blocked'], [true, true, 'opened']]) {
        const { tracker, events } = fixture();
        let downloads = 0;
        await handler('handleExportReviewPackage', { actions: { beginStudyAction: (...a) => tracker.begin('review', ...a) }, exportReady: ready, notifyPreviewExportBlocked: noop, state: {}, reportDraft: {}, downloadPDFReport: () => { downloads++; return opened; }, showToast: noop, pushAssistantNote: noop })('pdf');
        assert.equal(downloads, ready ? 1 : 0);
        assert.equal(events.at(-1).event_label, `report_pdf_preview_${outcome}`);
        assert.equal(events.at(-1).metadata.export_format, 'pdf');
    }
});
test('response source is inferred from actual backend flags without treating fallback as LLM', () => {
    const { tracker, events } = fixture();
    for (const response of [{ llm_used: true }, { llm_used: false }, { llm_used: false, warning: 'generation unavailable' }, { used_llm: false, status: 'fallback' }])
        tracker.chat('graph', 'Help').reply('Answer', response);
    assert.deepEqual(events.filter(e => e.displayed).map(e => e.metadata.response_source), ['llm_response', 'deterministic_response', 'fallback_response', 'fallback_response']);
});
test('wire privacy filters content from submitted/displayed chat and keeps events bounded', async () => {
    let sent;
    const logger = createStudyEventLogger({ getIdentity: () => ({ participant_id: 'participant_' + uuid(), session_id: 'session_' + uuid(), study_version: 'pilot' }), uuid, send: async (events) => { sent = events; return { status: 'ok', inserted: events.length, duplicates: 0 }; }, schedule: () => 1, cancel: noop });
    const tracker = createDashboardEvents(logger.log, uuid);
    tracker.chat('question', 'My file /Users/alice/data/private.csv and https://example.com/token and person@example.com').reply('x'.repeat(5000), { llm_used: true });
    await logger.flush();
    for (const value of ['alice', 'private.csv', 'example.com', 'person@'])
        assert.ok(!JSON.stringify(sent).includes(value));
    assert.equal(sent[1].assistant_output_text.length, 4000);
});

// assistant/actions uses used_rag while typed chat uses evidence_chunks_used/sources.
test('action-assistant visible RAG output is retained too', () => {
    const { tracker, events } = fixture();
    tracker.chat('graph', 'Review evidence').reply('Private retrieved passage', { used_llm: true, used_rag: true });
    assert.equal(events.at(-1).assistant_output_text, 'Private retrieved passage');
});

test('displayed RAG conversation reaches study batch without hidden prompts or chunks', async () => {
    let stored;
    const logger = createStudyEventLogger({ getIdentity: () => ({participant_id:'participant_'+uuid(),session_id:'session_'+uuid(),study_version:'pilot'}), uuid,
        send: async events => { stored=events; return {status:'ok',inserted:events.length,duplicates:0}; }, schedule:()=>1,cancel:noop });
    const tracker=createDashboardEvents(logger.log,uuid);
    const turn=tracker.chat('question','What does the cited evidence mean?');
    const visible='## Evidence review\n[1] The study reports an association. This does not prove causality.';
    const message=turn.message(visible,{llm_used:true,used_rag:true,evidence_chunks_used:1,sources:[{chunk_text:'HIDDEN_CHUNK'}],system_prompt:'HIDDEN_PROMPT',context:{data:'HIDDEN_CONTEXT'}});
    tracker.enter('graph');
    tracker.displayMessages('graph',[]);
    tracker.displayMessages('question',[message]);
    tracker.displayMessages('question',[message]);
    await logger.flush();
    const chat=stored.filter(e=>e.event_type.startsWith('chat_'));
    assert.equal(chat.length,2);
    assert.equal(chat[0].user_input_text,'What does the cited evidence mean?');
    assert.equal(chat[1].assistant_output_text,visible);
    assert.equal(chat[1].metadata_json.source,'llm_response');
    assert.equal(chat[1].metadata_json.request_id,chat[0].metadata_json.request_id);
    assert.equal(chat[1].phase,'question');
    assert.ok(!JSON.stringify(stored).includes('HIDDEN_'));
});
test('sanitized and truncated displayed responses retain explicit markers', async () => {
    let stored;
    const logger=createStudyEventLogger({getIdentity:()=>({participant_id:'participant_'+uuid(),session_id:'session_'+uuid(),study_version:'pilot'}),uuid,
        send:async events=>{stored=events;return {status:'ok',inserted:events.length,duplicates:0};},schedule:()=>1,cancel:noop});
    const tracker=createDashboardEvents(logger.log,uuid);
    tracker.displayMessages('review',[tracker.chat('review','Help').message('Visible reply to person@example.com '+ 'a'.repeat(5000),{},'fallback_response')]);
    await logger.flush();
    const reply=stored.find(e=>e.event_type==='chat_assistant_response');
    assert.ok(reply.assistant_output_text.startsWith('Visible reply to [email removed]'));
    assert.equal(reply.metadata_json.text_sanitized,true);
    assert.equal(reply.metadata_json.text_truncated,true);
    assert.ok(reply.assistant_output_text.length <= 4000);
});
test('visible deterministic notices and displayed warnings log once without fabricated user input', () => {
    const {tracker,events}=fixture();
    const note={role:'assistant',text:'Review the current design.'};
    const response=tracker.chat('question','Help').message('Displayed answer.',{llm_used:false});
    response.warning='Visible availability notice.';
    tracker.displayMessages('question',[note,response]);
    tracker.displayMessages('question',[note,response]);
    const answers=events.filter(e=>e.event_type==='chat_assistant_response');
    assert.equal(answers.length,2);
    assert.equal(answers[0].metadata.response_source,'deterministic_response');
    assert.equal(answers[1].assistant_output_text,'Displayed answer.\nVisible availability notice.');
    assert.equal(events.filter(e=>e.event_type==='chat_user_message').length,1);
    assert.match(source,/useEffect\(\(\) => \{\s*dashboardEvents\.displayMessages\(page, assistantThreads\[page\]\)/);
});
test('download event describes initiation and never completed disk save', () => {
    const {tracker,events}=fixture();
    const action=tracker.begin('review','report_export','report_export',{export_format:'json'});
    action.downloadInitiated();action.success();action.finish();
    assert.equal(events.at(-1).event_label,'report_download_initiated');
    assert.ok(!events.some(e=>/saved|completed|report_export_succeeded/.test(e.event_label)));
});

test('actual chat failure logs the displayed error, after display, with original pairing', async () => {
    const {tracker,events}=fixture();let threads={question:[]};
    const context={assistantInput:'Explain the warning',typedChatPending:{current:false},assistantThinking:false,page:'question',dashboardEvents:tracker,state:{},checks:{},activeReportConfiguration:()=>({}),primaryEstimationRun:null,reviewContextRef:{current:null},buildChatContext:()=>({dataset:{filename:'private.csv'}}),typedChatHistory:{current:[]},typedChatDataset:{current:null},recentChatHistory:x=>x,setAssistantInput:noop,setAssistantThinking:noop,setAssistantThinkingMessage:noop,setAssistantThreads:fn=>{threads=fn(threads);},assistantChat:async()=>{throw Error('test');},assistantMessageFromResponse:r=>r.answer,friendlyError:()=> 'Service unavailable.'};
    await handler('submitAssistantInput',context)();
    assert.equal(events.length,1);
    tracker.displayMessages('question',threads.question);
    assert.equal(events[1].assistant_output_text,threads.question[1].text);
    assert.equal(events[1].metadata.response_source,'error_response');
    assert.equal(events[1].metadata.request_id,events[0].metadata.request_id);
});
