import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the real API helper without Vite, a server, or any network request.
const source = (await readFile(new URL('./api.js', import.meta.url), 'utf8'))
  .replaceAll('import.meta.env', JSON.stringify({ PROD: true, VITE_API_BASE_URL: 'https://test.invalid' }))
  .replace('"./apiErrors.js"', JSON.stringify(new URL('./apiErrors.js', import.meta.url).href))
  .replace('"./ragReadiness.js"', JSON.stringify(new URL('./ragReadiness.js', import.meta.url).href));
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('blocked ingestion states never call the search endpoint', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  for (const [status, message] of [['running', /still being ingested/], ['error', /ingestion failed/], ['failed', /ingestion failed/], ['unknown', /not been ingested yet/], ['idle', /not been ingested yet/], [undefined, /not been ingested yet/]]) {
    await assert.rejects(api.searchRag('evidence?', 3, { status, stored_chunks: 10 }), message);
  }
  await assert.rejects(api.searchRag('evidence?'), /not been ingested yet/);
  assert.equal(fetch.mock.callCount(), 0);
});
test('completed and ready ingestion permit a mocked search request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{"results":[]}'));
  for (const status of ['completed', 'ready']) {
    assert.deepEqual(await api.searchRag('evidence?', 3, { status }), { results: [] });
  }
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(fetch.mock.calls[0].arguments[0], 'https://test.invalid/rag/search');
});
test('validation API preserves HTTP 200 error details; ingestion still throws them', async t => {
  const body = { status: 'error', summary: 'Uploaded document was not found.' };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
  assert.deepEqual(await api.validateDocumentCategory('missing.txt', 'data_dictionary'), body);
  await assert.rejects(api.ingestDocuments(), /Uploaded document was not found/);
});
