import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostSurvey, POST_RATINGS } from './postSurvey.js';
const answers = () => ({ ...Object.fromEntries(POST_RATINGS.map(([key]) => [key, 4])), open_feedback: '' });
const identity = { participant_id: 'participant-test', session_id: 'session-test', study_version: 'pilot' };
function manager() { let complete = false; return { getIdentity: () => identity, isPostComplete: () => complete, markPostComplete: () => { complete = true; } }; }
test('post payload contains only anonymous IDs, ratings, timestamp and feedback', async () => {
  let payload;
  const c = createPostSurvey(manager(), async p => { payload=p; return {status:'ok'}; });
  await c.submit({...answers(), report:'not sent', email:'not sent'});
  assert.equal(payload.participant_id, identity.participant_id);
  assert.equal(payload.session_id, identity.session_id);
  assert.deepEqual(Object.keys(payload).sort(), [...Object.keys(identity), 'submitted_at', ...POST_RATINGS.map(([k])=>k), 'open_feedback'].sort());
  assert.equal(c.getSnapshot().status, 'complete');
});
test('ratings and feedback length validated', async () => {
  let sent = 0; const c = createPostSurvey(manager(), async () => {sent++;});
  for (const rating of [0,6,1.5,'4',null]) await c.submit({...answers(),overall_usability:rating});
  await c.submit({...answers(),open_feedback:'x'.repeat(4001)});
  assert.equal(sent,0);
});
test('duplicate submissions are prevented and completion restored', async () => {
  let sent=0; const m=manager(); const c=createPostSurvey(m,async()=>{sent++;return {status:'ok'};});
  await Promise.all([c.submit(answers()),c.submit(answers())]); await c.submit(answers());
  assert.equal(sent,1);
  const restored=createPostSurvey(m,async()=>assert.fail());restored.initialize();
  assert.equal(restored.getSnapshot().status,'complete');
});
test('failure allows identical retry without false success',async()=>{
  let payload; let calls=0;
  const c=createPostSurvey(manager(),async p=>{ calls++; if(calls===1){payload=p;throw Error();} assert.deepEqual(p,payload);return {status:'ok'};});
  await c.submit(answers()); assert.equal(c.getSnapshot().status,'idle'); assert.ok(c.getSnapshot().error);
  await c.submit({}); assert.equal(c.getSnapshot().status,'complete');
});
