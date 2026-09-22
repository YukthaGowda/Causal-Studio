import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreSurvey } from './PreSurvey.jsx';
import { StudyGate } from './StudyProvider.jsx';
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
