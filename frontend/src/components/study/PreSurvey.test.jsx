import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreSurvey } from './PreSurvey.jsx';
import { StudyGate, StudyLoggingNotice } from './StudyProvider.jsx';
import { PRIVACY_NOTE } from '../../lib/studySession.js';

test('pre-survey has privacy note and only six categorical fields', () => {
  const html = renderToStaticMarkup(<PreSurvey study={{status:'survey'}} onSubmit={() => {}} onRetry={() => {}} />);
  assert.ok(html.includes(PRIVACY_NOTE));
  assert.equal((html.match(/<select/g) || []).length, 6);
  assert.ok(!/<input|<textarea/.test(html));
  for (const field of ['name','email','age','gender','institution','phone','location']) assert.ok(!html.includes(`name="${field}"`));
});
test('dashboard is not rendered before completion, including failed registration', () => {
  function Dashboard() { throw Error('Dashboard mounted too early'); }
  for (const status of ['initializing','registration_error','survey','submitting']) {
    assert.doesNotThrow(() => renderToStaticMarkup(<StudyGate study={{status}} onSubmit={() => {}} onRetry={() => {}}><Dashboard /></StudyGate>));
  }
});
test('dashboard renders after confirmed completion', () => {
  assert.equal(renderToStaticMarkup(<StudyGate study={{status:'complete'}}><div>Dashboard</div></StudyGate>), '<div>Dashboard</div>');
});

test('logging notices distinguish pending browser storage, retry, unavailable storage and loss without gating dashboard', () => {
  assert.equal(renderToStaticMarkup(<StudyLoggingNotice status="all_saved" />), '');
  for (const status of ['unsaved_retrying', 'unsaved_persisted', 'storage_unavailable', 'error']) {
    const html = renderToStaticMarkup(<StudyLoggingNotice status={status} />);
    assert.match(html, /You can continue using Causal Studio/);
    assert.ok(!/IndexedDB|sqlite|stack|filesystem/.test(html));
    assert.match(renderToStaticMarkup(<StudyGate study={{status:'complete'}}><div>Dashboard</div></StudyGate>), /Dashboard/);
  }
  assert.match(renderToStaticMarkup(<StudyLoggingNotice status="unsaved_persisted" />), /up to 24 hours/);
  assert.match(renderToStaticMarkup(<StudyLoggingNotice status="storage_unavailable" />), /cannot keep pending records/);
});

test('study API helpers call only the three requested endpoints', async () => {
  const { checkStudyHealth, registerStudySession, submitPreSurvey } = await import('../../lib/api.js');
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ status: 'ok', storage_available: true }) }; };
  try {
    await checkStudyHealth();
    await registerStudySession({participant_id:'participant-test'});
    await submitPreSurvey({session_id:'session-test'});
    assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/study/health','/study/sessions','/study/surveys/pre']);
    assert.equal(calls[1].options.body, JSON.stringify({participant_id:'participant-test'}));
    assert.equal(calls[2].options.method, 'POST');
  } finally { globalThis.fetch = original; }
});

test('event batch helper uses existing study API with events envelope', async () => {
  const { submitStudyEventsBatch } = await import('../../lib/api.js');
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => { sent = { url, options }; return { ok: true, json: async () => ({ status: 'ok', inserted: 1, duplicates: 0 }) }; };
  try {
    const events = [{event_id:'test-event'}];
    await submitStudyEventsBatch(events);
    assert.equal(new URL(sent.url).pathname, '/study/events/batch');
    assert.deepEqual(JSON.parse(sent.options.body), {events});
  } finally { globalThis.fetch = original; }
});
