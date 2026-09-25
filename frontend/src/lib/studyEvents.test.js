import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createStudyEventLogger, createStudyLifecycle, sanitizeMetadata, summarizeAnalysis, EVENT_TYPES } from './studyEvents.js';
import { createStudySession, PRE_SURVEY_FIELDS } from './studySession.js';
import { createPostSurvey, POST_RATINGS } from './postSurvey.js';
const identity={participant_id:`participant_${webcrypto.randomUUID()}`,session_id:`session_${webcrypto.randomUUID()}`,study_version:'pilot-v1'};
const click={event_type:'button_click',event_label:'test_button',phase:9};
function fixture(options={}) {
 const batches=[], jobs=new Map();let sequence=0;
 const logger=createStudyEventLogger({store:{load:async()=>[],put:async()=>true,update:async()=>{},remove:async()=>{}},getIdentity:()=>identity,uuid:()=>webcrypto.randomUUID(),now:()=> '2026-09-22T12:00:00.000Z',send:async events=>{batches.push(events);return {status:'ok',inserted:events.length,duplicates:0};},schedule:fn=>{jobs.set(++sequence,fn);return sequence;},cancel:id=>jobs.delete(id),...options});
 return {logger,batches,jobs};
}
test('event UUID, timestamp, identity and normalized phase',async()=>{
 const {logger,batches}=fixture();const id=logger.log(click);await logger.flush();const e=batches[0][0];
 assert.match(id,/^[a-f0-9-]{36}$/);assert.equal(e.client_timestamp,'2026-09-22T12:00:00.000Z');for(const [k,v] of Object.entries(identity))assert.equal(e[k],v);assert.equal(e.phase,'review');
});
test('event type validation',()=>{const {logger}=fixture();for(const type of EVENT_TYPES)assert.ok(logger.log({...click,event_type:type}));assert.equal(logger.log({...click,event_type:'typing'}),false);});
test('metadata allowlist and source/outcome aliases',()=>{
 assert.deepEqual(sanitizeMetadata({action_status:'attempted',response_source:'deterministic_response',export_format:'pdf',graph_node_count:4}),{status:'started',source:'deterministic_response',format:'pdf',node_count:4});
 const bad=Object.fromEntries('name email age gender institution phone address location ip device_id filename dataset report stack_trace api_key url environment'.split(' ').map(k=>[k,'private']));
 assert.deepEqual(sanitizeMetadata({...bad,warning_count:2,nested:{secret:1}}),{warning_count:2,metadata_sanitized:true});
});
test('batch size, deduplication, and successful queue removal',async()=>{
 const {logger,batches}=fixture({batchSize:2});const id=logger.log(click);logger.log({...click,event_id:id});logger.log(click);logger.log(click);await logger.flush();await logger.flush();assert.deepEqual(batches.map(b=>b.length),[2,1]);logger.log({...click,event_id:id});await logger.flush();assert.equal(batches.length,2);assert.equal(logger.getSnapshot(),'all_saved');
});
test('bounded retries retain stable events and unsaved state',async()=>{
 const calls=[];const {logger,jobs}=fixture({send:async e=>{calls.push(e);throw Error();}});logger.log(click);for(let n=0;n<6;n++)await logger.flush();assert.equal(calls.length,3);assert.deepEqual(calls[0],calls[2]);assert.equal(logger.getSnapshot(),'unsaved_persisted');logger.stop();assert.equal(jobs.size,0);
});
test('retry success accepts server dedup acknowledgement',async()=>{
 let count=0;const {logger}=fixture({send:async e=>{if(++count===1)throw Error();return {status:'ok',inserted:0,duplicates:e.length};}});logger.log(click);assert.equal(await logger.flush(),false);assert.equal(await logger.flush(),true);assert.equal(logger.getSnapshot(),'all_saved');
});
test('queue and identity failures do not throw into workflow',()=>{
 const {logger}=fixture({maxQueue:1});logger.log(click);assert.equal(logger.log(click),false);assert.equal(logger.getSnapshot(),'error');assert.doesNotThrow(()=>fixture({getIdentity:()=>{throw Error();}}).logger.log(click));
});
test('chat text gated by submitted/displayed flags and sources kept distinct',async()=>{
 const {logger,batches}=fixture();logger.log({...click,event_type:'chat_user_message',user_input_text:'typing'});logger.log({...click,event_type:'chat_assistant_response',assistant_output_text:'not shown'});
 logger.log({...click,event_type:'chat_user_message',submitted:true,user_input_text:'Explain this. user@example.com https://private.test file.csv'});
 const sources=['llm_response','deterministic_response','fallback_response','error_response'];for(const source of sources)logger.log({...click,event_type:'chat_assistant_response',displayed:true,assistant_output_text:'Review assumptions.',metadata:{response_source:source}});
 await logger.flush();const e=batches[0];assert.ok(!('user_input_text' in e[0]));assert.ok(!('assistant_output_text' in e[1]));assert.ok(!/user@example|https:|file.csv/.test(e[2].user_input_text));assert.deepEqual(e.slice(3).map(x=>x.metadata_json.source),sources);
});
test('compact analysis summaries omit full outputs',()=>{
 assert.deepEqual(summarizeAnalysis('feasibility',{status:'marginal',warnings:['a','b'],safe_to_continue:true,report:'secret'}),{status:'marginal',warning_count:2,safe_to_continue:true});
 assert.deepEqual(summarizeAnalysis('graph',{status:'valid',nodes:[{},{}],edges:[{}]}),{status:'valid',node_count:2,edge_count:1});
 assert.deepEqual(summarizeAnalysis('identification',{identification_status:'requires_revision'}),{status:'requires_revision'});
 assert.deepEqual(summarizeAnalysis('estimation',{status:'completed',model_type:'statsmodels_logit',primary_result:{sample_size:31,point_estimate:999}}),{status:'completed',model_type:'statsmodels_logit',sample_size:31});
 assert.deepEqual(summarizeAnalysis('report',{status:'success',content:'private'}),{status:'success'});
});
test('only confirmed survey submissions and one dashboard start logged',async()=>{
 const {logger,batches}=fixture(), lifecycle=createStudyLifecycle(logger);let complete=false,fail=true;
 const m={getIdentity:()=>identity,storageUnavailable:()=>false,isComplete:()=>complete,markComplete:()=>{complete=true;},readPending:()=>null,savePending:()=>{},markPostComplete:()=>{}};
 const pre=createStudySession(m,{checkStudyHealth:async()=>({storage_available:true}),registerStudySession:async()=>({status:'ok'}),submitPreSurvey:async()=>{if(fail)throw Error();return {status:'ok'};}},id=>lifecycle.confirmed('pre',id));
 await pre.register();await pre.submit(Object.fromEntries(PRE_SURVEY_FIELDS.map(([k,,v])=>[k,v[0]])));await logger.flush();assert.equal(batches.length,0);
 fail=false;await pre.submit({});lifecycle.confirmed('dashboard',identity);lifecycle.confirmed('dashboard',identity);
 const post=createPostSurvey(m,async()=>({status:'ok'}),id=>lifecycle.confirmed('post',id));await post.submit(Object.fromEntries(POST_RATINGS.map(([k])=>[k,3])));await logger.flush();
 assert.deepEqual(batches[0].map(e=>e.event_type),['pre_survey_submit','page_view','post_survey_submit']);assert.equal(pre.getSnapshot().status,'complete');assert.equal(post.getSnapshot().status,'complete');
});
test('logger callback failure cannot undo confirmed survey',async()=>{
 const post=createPostSurvey({getIdentity:()=>identity,markPostComplete:()=>{}},async()=>({status:'ok'}),()=>{throw Error();});await post.submit(Object.fromEntries(POST_RATINGS.map(([k])=>[k,3])));assert.equal(post.getSnapshot().status,'complete');
});
test('concurrent flush shares request; stopping cancels retries',async()=>{
 let release,count=0;const {logger,jobs}=fixture({send:e=>{count++;return new Promise(resolve=>{release=()=>resolve({status:'ok',inserted:e.length,duplicates:0});});}});logger.log(click);const a=logger.flush(),b=logger.flush();await new Promise(setImmediate);assert.equal(count,1);assert.equal(a,b);logger.stop();release();await a;assert.equal(jobs.size,0);
});

test('unconfirmed acknowledgements remain unsaved; new arrivals survive inflight batch',async()=>{
 let release;const {logger}=fixture({send:()=>new Promise(resolve=>{release=resolve;})});logger.log(click);const pending=logger.flush();await new Promise(setImmediate);logger.log(click);release({status:'ok',inserted:0,duplicates:0});await pending;assert.equal(logger.getSnapshot(),'unsaved_persisted');logger.stop();
});
test('restored pre-survey completion does not fabricate submit event',async()=>{
 let called=false;const manager={getIdentity:()=>identity,storageUnavailable:()=>false,isComplete:()=>true,readPending:()=>null};
 const pre=createStudySession(manager,{checkStudyHealth:async()=>({storage_available:true}),registerStudySession:async()=>({status:'ok'})},()=>{called=true;});await pre.register();assert.equal(pre.getSnapshot().status,'complete');assert.equal(called,false);
});
