import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDashboardEvents } from './dashboardEvents.js';
import { createStudyEventLogger, createStudyLifecycle } from './studyEvents.js';
import { createIndexedDBEventStore, QUEUE_TTL_MS, retryStudyEventsAfter } from './studyEventQueue.js';
import { createStudySession, PRE_SURVEY_FIELDS } from './studySession.js';
import { createPostSurvey, POST_RATINGS } from './postSurvey.js';

const uuid = () => webcrypto.randomUUID();
const identity = () => ({ participant_id: `participant_${uuid()}`, session_id: `session_${uuid()}`, study_version: 'synthetic-test-v1' });
const click = { event_type: 'button_click', event_label: 'synthetic_test_button', phase: 'review' };
const offline = async () => { throw Error('Mock outage'); };
const tick = () => new Promise(setImmediate);
const privacyFixtures = JSON.parse(readFileSync(new URL('../../../backend/tests/fixtures/study_text_privacy.json', import.meta.url), 'utf8'));
function mockStore() {
  const rows = new Map(), writes = [];
  return {
    rows, writes,
    load: async () => structuredClone([...rows.values()]),
    put: async (row, limit) => {
      if (rows.has(row.event_id)) return true;
      if (rows.size >= limit) return false;
      writes.push(structuredClone(row)); rows.set(row.event_id, structuredClone(row)); return true;
    },
    update: async row => { if (rows.has(row.event_id)) { writes.push(structuredClone(row)); rows.set(row.event_id, structuredClone(row)); } },
    remove: async ids => { for (const id of ids) rows.delete(id); },
  };
}
function fixture(options = {}) {
  const store = options.store || mockStore(), who = options.identity || identity(), sent = [], jobs = new Map();
  let time = Date.parse('2026-09-25T12:00:00Z'), sequence = 0;
  const logger = createStudyEventLogger({ getIdentity: () => who, uuid, store, now: () => new Date(time).toISOString(),
    schedule: (fn, delay) => { jobs.set(++sequence, { fn, delay }); return sequence; }, cancel: id => jobs.delete(id),
    send: async events => { sent.push(events); return { status: 'ok', inserted: events.length, duplicates: 0 }; }, ...options });
  return { logger, store, sent, jobs, who, advance: ms => { time += ms; } };
}

test('shared statistical/contact fixtures persist only sanitized text and replay unchanged', async () => {
  const sources=['llm_response','deterministic_response','fallback_response','error_response'];
  for(const sample of privacyFixtures) {
    for(const source of sources) {
      const original=fixture({send:offline});
      const tracker=createDashboardEvents(original.logger.log,uuid);
      const chat=tracker.chat('estimation',sample.text);
      const message=chat.message(sample.text,{system_prompt:'HIDDEN_PROMPT',retrieved_chunks:['HIDDEN_RAG'],backend_context:'HIDDEN_PAYLOAD'},source);
      assert.equal(message.text,sample.text,'privacy filtering must not change the displayed response');
      assert.equal(original.logger.getCounts().pending,1,'assistant text waits for display');
      tracker.displayMessages('review',[message]);
      await original.logger.flush();original.logger.stop();
      assert.equal(original.store.rows.size,2);
      for(const saved of original.store.writes) {
        const event=saved.event;
        assert.equal(event.user_input_text ?? event.assistant_output_text,sample.expected,`${sample.name}: sanitize before persistence`);
        assert.equal(event.metadata_json.text_sanitized===true,sample.text!==sample.expected);
        assert.equal(event.metadata_json.text_truncated,undefined);
        assert.equal(event.phase,'estimation');
        for(const key of ['participant_id','session_id','study_version']) assert.equal(event[key],original.who[key]);
      }
      const before=[...original.store.rows.values()].map(row=>row.event);
      assert.equal(before[0].metadata_json.request_id,before[1].metadata_json.request_id);
      assert.equal(before[1].metadata_json.source,source);
      assert.ok(!JSON.stringify(original.store.writes).includes('HIDDEN_'));
      const fresh=fixture({store:original.store}); // New identity must not replace restored identity.
      await fresh.logger.flush();fresh.logger.stop();
      assert.deepEqual(fresh.sent,[before],sample.name);
      assert.equal(original.store.rows.size,0);
    }
  }
});

test('replay preserves old redaction markers and the separate truncation marker', async () => {
  const oldText='Point estimate -2.[phone-like text removed]% CI; [email removed].';
  const original=fixture({send:offline});
  original.logger.log({...click,event_type:'chat_assistant_response',displayed:true,assistant_output_text:oldText,metadata:{text_sanitized:true,text_truncated:true,response_source:'deterministic_response'}});
  await original.logger.flush();original.logger.stop();
  const fresh=fixture({store:original.store});await fresh.logger.flush();fresh.logger.stop();
  assert.equal(fresh.sent[0][0].assistant_output_text,oldText);
  assert.equal(fresh.sent[0][0].metadata_json.text_sanitized,true);
  assert.equal(fresh.sent[0][0].metadata_json.text_truncated,true);
});

test('unsent sanitized event and retry bookkeeping are committed before network transmission', async () => {
  const store = mockStore(); let transmissions = 0;
  const { logger } = fixture({ store, send: async events => {
    transmissions++;
    assert.deepEqual(store.rows.get(events[0].event_id).event, events[0]);
    throw Error('Mock outage');
  } });
  const id = logger.log(click); await logger.flush();
  const row = store.rows.get(id);
  assert.equal(transmissions, 1); assert.equal(row.event_id, id);
  assert.equal(row.retry_count, 1); assert.equal(row.queued_at, '2026-09-25T12:00:00.000Z');
  assert.equal(row.last_attempt_at, row.queued_at); assert.equal(logger.getSnapshot(), 'unsaved_persisted'); logger.stop();
});
test('only bounded sanitized submitted/displayed text is ever handed to persistent storage', async () => {
  const { logger, store } = fixture({ send: offline });
  const raw = 'person@example.com https://secret.test/path input.csv ' + 'x'.repeat(5000);
  logger.log({ ...click, event_type: 'chat_user_message', submitted: true, user_input_text: raw });
  logger.log({ ...click, event_type: 'chat_assistant_response', displayed: true, assistant_output_text: raw, metadata: { response_source: 'llm_response' } });
  await logger.flush();
  assert.ok(store.writes.length >= 2);
  for (const row of store.writes) {
    const text = row.event.user_input_text ?? row.event.assistant_output_text;
    assert.ok(text.length <= 4000); assert.equal(row.event.metadata_json.text_sanitized, true);
    assert.equal(row.event.metadata_json.text_truncated, true);
  }
  assert.ok(!/person@example|secret.test|input.csv/.test(JSON.stringify(store.writes))); logger.stop();
});
test('drafts, hidden prompts, RAG payloads, documents, reports and backend context never enter storage', async () => {
  const { logger, store } = fixture({ send: offline });
  logger.log({ ...click, event_type: 'chat_user_message', user_input_text: 'HIDDEN_DRAFT' });
  logger.log({ ...click, event_type: 'chat_assistant_response', displayed: true, assistant_output_text: 'Visible evidence explanation.',
    system_prompt: 'HIDDEN_PROMPT', sources: ['HIDDEN_RAG'], backend_context: 'HIDDEN_CONTEXT',
    metadata: { filename: 'HIDDEN_FILENAME', report: 'HIDDEN_REPORT', dataset: ['HIDDEN_ROWS'], email: 'HIDDEN_EMAIL', api_key: 'HIDDEN_API_KEY', stack_trace: 'HIDDEN_TRACE', url: 'HIDDEN_URL', environment: 'HIDDEN_ENV' } });
  await logger.flush();
  assert.ok(!JSON.stringify(store.writes).includes('HIDDEN_'));
  assert.ok(JSON.stringify(store.writes).includes('Visible evidence explanation.'));
  assert.equal([...store.rows.values()][1].event.metadata_json.metadata_sanitized, true); logger.stop();
});
test('refresh restores and retries exactly the same events, IDs, phase, timestamps and pairing', async () => {
  const original = fixture({ send: offline }), request_id = uuid();
  original.logger.log({ ...click, event_type: 'chat_user_message', phase: 'question', submitted: true, user_input_text: 'Explain evidence.', metadata: { request_id } });
  original.logger.log({ ...click, event_type: 'chat_assistant_response', phase: 'question', displayed: true, assistant_output_text: 'A visible association.', metadata: { request_id, response_source: 'deterministic_response' } });
  for (let i = 0; i < 3; i++) await original.logger.flush();
  const before = [...original.store.rows.values()].map(r => r.event); original.logger.stop();
  const fresh = fixture({ store: original.store }); // Deliberately a NEW identity/session.
  fresh.logger.start(); await tick();
  const retry = [...fresh.jobs.values()].find(job => job.delay === 2000);
  assert.ok(retry, 'provider initialization schedules recovery without a new action');
  retry.fn(); await fresh.logger.flush();
  assert.deepEqual(fresh.sent, [before]); assert.equal(original.store.rows.size, 0);
  assert.equal(fresh.logger.getSnapshot(), 'all_saved'); fresh.logger.stop();
});
test('successful insertion and duplicate acknowledgements both delete persistent events', async () => {
  for (const duplicate of [false, true]) {
    const { logger, store } = fixture({ send: async events => ({ status: 'ok', inserted: duplicate ? 0 : events.length, duplicates: duplicate ? events.length : 0 }) });
    logger.log(click); assert.equal(await logger.flush(), true); assert.equal(store.rows.size, 0);
    assert.equal(logger.getSnapshot(), 'all_saved'); logger.stop();
  }
});
test('unconfirmed acknowledgements and acknowledgement cleanup failure retain stable pending events', async () => {
  const store = mockStore(), actualRemove = store.remove;
  let valid = false;
  const { logger } = fixture({ store, send: async () => ({ status: 'ok', inserted: valid ? 1 : 0, duplicates: 0 }) });
  const id = logger.log(click); assert.equal(await logger.flush(), false); assert.ok(store.rows.has(id));
  valid = true; store.remove = offline;
  assert.equal(await logger.flush(), false); assert.ok(store.rows.has(id)); assert.equal(logger.getSnapshot(), 'storage_unavailable');
  store.remove = actualRemove; await logger.retry(); assert.equal(store.rows.size, 0); logger.stop();
});
test('backend outage is non-blocking and later online-style retry has a bounded cooldown', async () => {
  let calls = 0;
  const { logger, advance, jobs } = fixture({ send: async () => { calls++; throw Error(); } });
  let actionCompleted = false;
  assert.ok(logger.log(click)); actionCompleted = true; assert.equal(actionCompleted, true);
  for (let i = 0; i < 8; i++) await logger.flush();
  assert.equal(calls, 3); assert.ok([...jobs.values()].every(job => job.delay >= QUEUE_TTL_MS));
  await logger.retry(); await logger.retry(); await logger.retry(); assert.equal(calls, 4);
  for (let i = 0; i < 8; i++) await logger.flush(); assert.equal(calls, 6);
  await logger.retry(); assert.equal(calls, 6);
  advance(30000); await logger.retry(); assert.equal(calls, 7); logger.stop();
});
test('new events do not reset exhausted old events', async () => {
  const sent = [], { logger } = fixture({ send: async events => { sent.push(events); throw Error(); } });
  const old = logger.log(click); for (let i = 0; i < 3; i++) await logger.flush();
  const fresh = logger.log(click); await logger.flush();
  assert.deepEqual(sent.at(-1).map(e => e.event_id), [fresh]);
  assert.equal(sent.flat().filter(e => e.event_id === old).length, 3); logger.stop();
});
test('100-event cap and ten-event batch limit remain enforced, including restore plus new arrivals', async () => {
  const a = fixture({ send: offline });
  for (let i = 0; i < 100; i++) assert.ok(a.logger.log(click));
  assert.equal(a.logger.log(click), false); await a.logger.flush(); assert.equal(a.store.rows.size, 100); a.logger.stop();
  const b = fixture({ store: a.store }); b.logger.log(click); await b.logger.flush();
  assert.equal(b.sent[0].length, 10); assert.equal(b.logger.getCounts().dropped, 1);
  assert.equal(b.store.rows.size, 90); b.logger.stop();
});
test('expired records are deleted on refresh without any transmission', async () => {
  const a = fixture({ send: offline }); a.logger.log(click); await a.logger.flush(); a.logger.stop();
  const b = fixture({ store: a.store }); b.advance(QUEUE_TTL_MS); b.logger.start(); await b.logger.flush();
  assert.equal(b.sent.length, 0); assert.equal(b.store.rows.size, 0); assert.equal(b.logger.getCounts().expired, 1);
  assert.equal(b.logger.getSnapshot(), 'error'); b.logger.stop();
});
test('expiry timer deletes abandoned records in an open tab after retries exhaust', async () => {
  const { logger, store, jobs, advance } = fixture({ send: offline });
  logger.log(click); for (let i = 0; i < 3; i++) await logger.flush();
  const expiry = [...jobs.values()].find(job => job.delay === QUEUE_TTL_MS); assert.ok(expiry);
  advance(QUEUE_TTL_MS); expiry.fn(); await tick();
  assert.equal(store.rows.size, 0); assert.equal(logger.getCounts().expired, 1); logger.stop();
});
test('original participant/session/version are preserved alongside new-session events', async () => {
  const a = fixture({ send: offline }); const old = a.logger.log(click); await a.logger.flush(); a.logger.stop();
  const b = fixture({ store: a.store }), recent = b.logger.log(click); await b.logger.flush();
  const sent = b.sent.flat();
  for (const key of ['participant_id', 'session_id', 'study_version']) {
    assert.equal(sent.find(e => e.event_id === old)[key], a.who[key]);
    assert.equal(sent.find(e => e.event_id === recent)[key], b.who[key]);
  }
  b.logger.stop();
});
test('unavailable IndexedDB falls back to bounded memory without claiming durable storage', async () => {
  const store = createIndexedDBEventStore({ getIndexedDB: () => undefined }); let fail = true;
  const { logger } = fixture({ store, send: async events => { if (fail) throw Error(); return { status: 'ok', inserted: events.length, duplicates: 0 }; } });
  assert.doesNotThrow(() => logger.log(click)); await logger.flush();
  assert.equal(logger.getSnapshot(), 'storage_unavailable'); assert.equal(logger.getCounts().pending, 1);
  fail = false; assert.equal(await logger.flush(), true); assert.equal(logger.getCounts().pending, 0); logger.stop();
});
test('blocked or hanging IndexedDB open rejects safely; a late connection is closed', async () => {
  let request, closed = false;
  const store = createIndexedDBEventStore({ timeoutMs: 5, getIndexedDB: () => ({ open: () => (request = {}) }) });
  const pending = store.load(); await assert.rejects(pending, /unavailable/);
  request.result = { close: () => { closed = true; } }; request.onsuccess(); assert.equal(closed, true);
  const blocked = store.load(); await tick(); request.onblocked(); await assert.rejects(blocked, /unavailable/);
});
test('storage write failure never blocks actions and does not claim persistence', async () => {
  const store = mockStore(); store.put = offline;
  const { logger } = fixture({ store, send: offline }); assert.ok(logger.log(click)); await logger.flush();
  assert.equal(logger.getSnapshot(), 'storage_unavailable'); assert.equal(logger.getCounts().pending, 1); logger.stop();
});
test('recovery of browser storage persists memory-only events before retry', async () => {
  const store = mockStore(), load = store.load; store.load = offline;
  const { logger } = fixture({ store, send: offline }); const id = logger.log(click); await logger.flush(); assert.equal(store.rows.size, 0);
  store.load = load; await logger.retry(); assert.ok(store.rows.has(id)); assert.equal(logger.getSnapshot(), 'unsaved_persisted'); logger.stop();
});
test('telemetry retries do not duplicate confirmed pre/post survey records or block dashboard access', async () => {
  const f = fixture({ send: offline }), lifecycle = createStudyLifecycle(f.logger);
  let preCalls = 0, postCalls = 0, complete = false, postComplete = false;
  const manager = { getIdentity: () => f.who, storageUnavailable: () => false, isComplete: () => complete, markComplete: () => { complete = true; }, readPending: () => null, savePending: () => {}, isPostComplete: () => postComplete, markPostComplete: () => { postComplete = true; } };
  const pre = createStudySession(manager, { checkStudyHealth: async () => ({ storage_available: true }), registerStudySession: async () => ({ status: 'ok' }),
    submitPreSurvey: retryStudyEventsAfter(async () => { preCalls++; return { status: 'ok' }; }, f.logger) }, id => lifecycle.confirmed('pre', id));
  const post = createPostSurvey(manager, retryStudyEventsAfter(async () => { postCalls++; return { status: 'ok' }; }, f.logger), id => lifecycle.confirmed('post', id));
  await pre.register(); await pre.submit(Object.fromEntries(PRE_SURVEY_FIELDS.map(([key, , choices]) => [key, choices[0]])));
  await post.submit(Object.fromEntries(POST_RATINGS.map(([key]) => [key, 3])));
  for (let i = 0; i < 6; i++) await f.logger.flush();
  assert.equal(pre.getSnapshot().status, 'complete'); assert.equal(post.getSnapshot().status, 'complete');
  const restored = fixture({ store: f.store }); await restored.logger.retry();
  assert.deepEqual(restored.sent.flat().map(e => e.event_type), ['pre_survey_submit', 'post_survey_submit']);
  assert.equal(preCalls, 1); assert.equal(postCalls, 1); f.logger.stop(); restored.logger.stop();
});
test('only later successful study interactions initiate telemetry recovery', async () => {
  let retries = 0, calls = 0;
  const logger = { retry: async () => { retries++; } };
  const api = retryStudyEventsAfter(async result => { calls++; return result; }, logger);
  await api({ status: 'error' }); assert.equal(retries, 0);
  await api({ status: 'ok' }); assert.equal(retries, 1); assert.equal(calls, 2);
  const broken = retryStudyEventsAfter(async () => ({ status: 'ok' }), { retry: () => { throw Error(); } });
  assert.deepEqual(await broken(), { status: 'ok' });
});
test('events created while another batch is in flight are durably saved immediately', async () => {
  let release;
  const { logger, store } = fixture({ send: events => new Promise(resolve => { release = () => resolve({ status: 'ok', inserted: events.length, duplicates: 0 }); }) });
  const first = logger.log(click), pending = logger.flush(); await tick();
  const second = logger.log(click); await tick();
  assert.ok(store.rows.has(second)); release(); await pending;
  assert.ok(!store.rows.has(first)); assert.ok(store.rows.has(second)); logger.stop();
});
test('restored records are re-sanitized and arbitrary stored fields cannot reach backend', async () => {
  const a = fixture({ send: offline }); const id = a.logger.log(click); await a.logger.flush(); a.logger.stop();
  const row = a.store.rows.get(id); row.event.hidden_prompt = 'HIDDEN_CONTENT'; row.event.metadata_json.filename = 'HIDDEN_FILENAME';
  const b = fixture({ store: a.store }); await b.logger.flush();
  assert.ok(!JSON.stringify(b.sent).includes('HIDDEN_')); assert.equal(b.sent[0][0].metadata_json.metadata_sanitized, true); b.logger.stop();
});
