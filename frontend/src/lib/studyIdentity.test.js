import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createStudyIdentityManager } from './studyIdentity.js';
import { createStudySession, PRE_SURVEY_FIELDS } from './studySession.js';
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; };
const environment = () => ({ localStorage: storage(), sessionStorage: storage(), crypto: webcrypto });
const answers = () => Object.fromEntries(PRE_SURVEY_FIELDS.map(([key,,choices]) => [key, choices[0]]));
const api = () => ({ checkStudyHealth: async () => ({ storage_available: true }), registerStudySession: async () => ({ status: 'ok' }), submitPreSurvey: async () => ({ status: 'ok' }) });

test('UUID formats, participant and session persist across manager recreation', () => {
  const env = environment();
  const a = createStudyIdentityManager(env).getIdentity();
  assert.match(a.participant_id, /^participant_[0-9a-f-]{36}$/);
  assert.match(a.session_id, /^session_[0-9a-f-]{36}$/);
  assert.deepEqual(createStudyIdentityManager(env).getIdentity(), a);
  const b = createStudyIdentityManager({ ...env, sessionStorage: storage() }).getIdentity();
  assert.equal(b.participant_id, a.participant_id);
  assert.notEqual(b.session_id, a.session_id);
});
test('blocked storage uses stable in-memory identity and marks limitation', () => {
  const env = { crypto: webcrypto, get localStorage() { throw Error(); }, get sessionStorage() { throw Error(); } };
  const manager = createStudyIdentityManager(env);
  assert.equal(manager.getIdentity(), manager.getIdentity());
  manager.markComplete();
  assert.equal(manager.isComplete(), true);
  assert.equal(manager.storageUnavailable(), true);
});
test('registration deduplicates concurrent Strict Mode calls', async () => {
  let count = 0;
  const mock = api(); mock.registerStudySession = async () => { count++; return { status: 'ok' }; };
  const c = createStudySession(createStudyIdentityManager(environment()), mock);
  await Promise.all([c.register(), c.register()]);
  assert.equal(count, 1);
  assert.equal(c.getSnapshot().status, 'survey');
});
test('registration failure stays gated and can retry', async () => {
  const mock = api(); mock.registerStudySession = async () => { throw Error('private backend detail'); };
  const c = createStudySession(createStudyIdentityManager(environment()), mock);
  await c.register();
  assert.equal(c.getSnapshot().status, 'registration_error');
  assert.ok(!c.getSnapshot().error.includes('private'));
  mock.registerStudySession = async () => ({ status: 'ok' });
  await c.register();
  assert.equal(c.getSnapshot().status, 'survey');
});
test('submission sends only anonymous identity and categorical answers; completion persists', async () => {
  const env = environment(); const manager = createStudyIdentityManager(env); const mock = api(); let payload;
  mock.submitPreSurvey = async p => { payload = p; return { status: 'ok' }; };
  const c = createStudySession(manager, mock); await c.register();
  await c.submit({ ...answers(), email: 'should-not-be-sent@example.com' });
  assert.equal(payload.participant_id, manager.getIdentity().participant_id);
  assert.equal(payload.session_id, manager.getIdentity().session_id);
  assert.ok(!('email' in payload));
  assert.equal(c.getSnapshot().status, 'complete');
  const restored = createStudySession(createStudyIdentityManager(env), mock); await restored.register();
  assert.equal(restored.getSnapshot().status, 'complete');
});
test('lost survey response keeps gate closed and retries identical payload after refresh', async () => {
  const env = environment(); const mock = api(); let first;
  mock.submitPreSurvey = async p => { first = p; throw Error(); };
  const c = createStudySession(createStudyIdentityManager(env), mock); await c.register(); await c.submit(answers());
  assert.equal(c.getSnapshot().status, 'survey');
  mock.submitPreSurvey = async p => { assert.deepEqual(p, first); return { status: 'ok' }; };
  const restored = createStudySession(createStudyIdentityManager(env), mock); await restored.register(); await restored.submit({});
  assert.equal(restored.getSnapshot().status, 'complete');
});
test('incomplete answers never submit', async () => {
  const mock = api(); mock.submitPreSurvey = async () => assert.fail('Unexpected submission');
  const c = createStudySession(createStudyIdentityManager(environment()), mock); await c.register(); await c.submit({});
  assert.equal(c.getSnapshot().status, 'survey');
});
