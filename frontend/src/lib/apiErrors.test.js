import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApiResponse } from './apiErrors.js';

test('preserves backend ingestion step and details', async () => {
  const body = { status: 'error', message: 'Embedding failed', details: 'Model unavailable', failed_step: 'embedding' };
  await assert.rejects(parseApiResponse(new Response(JSON.stringify(body), { status: 503 }), 'Failed'), error => {
    assert.match(error.message, /Embedding failed.*Model unavailable.*embedding/);
    assert.equal(error.payload.failed_step, 'embedding');
    return true;
  });
});
test('non-JSON gateway error includes HTTP status', async () => {
  await assert.rejects(parseApiResponse(new Response('<html>gateway</html>', { status: 502 }), 'Ingestion failed'), /HTTP 502 without a JSON/);
});
test('successful HTTP with failed ingestion is still an error', async () => {
  await assert.rejects(parseApiResponse(new Response(JSON.stringify({ status: 'failed', message: 'No documents' })), 'Failed', { rejectFailureStatus: true }), /No documents/);
});
test('successful response remains intact', async () => {
  assert.deepEqual(await parseApiResponse(new Response('{"chunks_created":3}'), 'Failed'), { chunks_created: 3 });
});

test('HTTP 200 validation errors retain their structured explanation for existing callers', async () => {
  const body = { status: 'error', summary: 'Uploaded document was not found.', warnings: ['Upload again.'] };
  assert.deepEqual(await parseApiResponse(new Response(JSON.stringify(body)), 'Validation failed'), body);
});
test('other successful HTTP application-status responses are not reinterpreted', async () => {
  const body = { status: 'failed', message: 'Caller handles this state' };
  assert.deepEqual(await parseApiResponse(new Response(JSON.stringify(body)), 'Failed'), body);
});
test('ingestion application error can use summary as its explanation', async () => {
  await assert.rejects(parseApiResponse(new Response(JSON.stringify({ status: 'error', summary: 'No readable documents.' })), 'Failed', { rejectFailureStatus: true }), /No readable documents/);
});
