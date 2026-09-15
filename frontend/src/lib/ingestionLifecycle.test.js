import test from 'node:test';
import assert from 'node:assert/strict';
import { followIngestion } from './ingestionLifecycle.js';

function harness(states, startResult = { status: 'running' }, initialStatus) {
  const updates = []; let posts = 0; let reads = 0;
  return {
    updates, counts: () => ({ posts, reads }),
    run: extra => followIngestion({
      start: async () => { posts++; if (startResult instanceof Error) throw startResult; return startResult; },
      readStatus: async () => { reads++; const value = states.shift(); if (value instanceof Error) throw value; return value; },
      onUpdate: s => updates.push(s), initialStatus, wait: async () => {}, ...extra,
    }),
  };
}
const idle = { status: 'idle' };
const done = { status: 'completed', stored_chunks: 233 };

test('POST timeout immediately polls running steps through completion without another POST', async () => {
  const h = harness([idle, ...['document_loading', 'chunking', 'embedding', 'vector_store'].map(step => ({ status: 'running', step })), done], new Error('Request timed out'));
  assert.deepEqual(await h.run(), done);
  assert.equal(h.counts().posts, 1);
  assert.deepEqual(h.updates.filter(s => s.step).map(s => s.step), ['document_loading', 'chunking', 'embedding', 'vector_store']);
  assert.ok(h.updates.every(s => s.status !== 'error'));
});
test('running POST response is followed by status polling', async () => {
  const h = harness([idle, done]);
  assert.deepEqual(await h.run(), done);
  assert.deepEqual(h.counts(), { posts: 1, reads: 2 });
});
test('existing server run and locally known run never send another POST', async () => {
  for (const local of [undefined, { status: 'running' }]) {
    const h = harness(local ? [done] : [{ status: 'running', step: 'embedding' }, done], undefined, local);
    await h.run(); assert.equal(h.counts().posts, 0);
  }
});
test('structured POST errors retain details and do not poll', async () => {
  const error = Object.assign(new Error('Model failed. Failed step: embedding.'), { payload: { status: 'error', failed_step: 'embedding' }, httpStatus: 503 });
  const h = harness([idle], error);
  await assert.rejects(h.run(), e => e === error);
  assert.equal(h.counts().reads, 1);
});
test('polling application error reports message, details and failed step', async () => {
  const h = harness([idle, { status: 'error', message: 'Write failed', details: 'Permission denied', failed_step: 'vector_store' }]);
  await assert.rejects(h.run(), /Write failed.*Permission denied.*vector_store/);
});
test('completed POST succeeds without a follow-up status dependency', async () => {
  const h = harness([idle], done);
  assert.deepEqual(await h.run(), done);
  assert.equal(h.counts().reads, 1);
});
test('transient poll failures recover; repeated unreachable polls fail without retrying POST', async () => {
  const h = harness([idle, new Error('offline'), done]);
  await h.run(); assert.equal(h.counts().posts, 1);
  const failed = harness([idle, ...Array.from({ length: 3 }, () => new Error('offline'))]);
  await assert.rejects(failed.run(), /3 consecutive polls/);
  assert.equal(failed.counts().posts, 1);
});
test('unknown status is retried and stale status stops immediately', async () => {
  const h = harness([idle, { status: 'unknown' }, done]); await h.run();
  const unknown = harness([idle, {}, {}, {}]);
  await assert.rejects(unknown.run(), /remains unknown/);
  const stale = harness([idle, { status: 'stale', message: 'Worker state expired' }]);
  await assert.rejects(stale.run(), /Worker state expired/);
});
test('409 conflict monitors the existing run', async () => {
  const h = harness([idle, done], Object.assign(new Error('Already running'), { httpStatus: 409, payload: { status: 'error' } }));
  await h.run(); assert.equal(h.counts().posts, 1);
});
test('unreachable preflight never starts ingestion', async () => {
  const h = harness(Array.from({ length: 3 }, () => new Error('offline')));
  await assert.rejects(h.run(), /offline/); assert.equal(h.counts().posts, 0);
});
test('aborting monitoring stops further status requests', async () => {
  const controller = new AbortController();
  const h = harness([idle, { status: 'running' }, done]);
  await assert.rejects(h.run({ signal: controller.signal, wait: async () => controller.abort() }), /monitoring stopped/);
  assert.equal(h.counts().reads, 2);
});
