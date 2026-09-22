import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostSurvey, PostSurveyForm } from './PostSurvey.jsx';
import { FEEDBACK_REMINDER, POST_RATINGS } from '../../lib/postSurvey.js';
import { readFileSync } from 'node:fs';
test('five ratings, optional bounded feedback, privacy reminder, no PII fields',()=>{
 const html=renderToStaticMarkup(<PostSurveyForm state={{status:'idle'}} onSubmit={()=>{}}/>);
 assert.equal((html.match(/<select/g)||[]).length,5);assert.equal((html.match(/<textarea/g)||[]).length,1);
 for(const [k] of POST_RATINGS) assert.ok(html.includes(`name="${k}"`));
 assert.ok(html.includes(FEEDBACK_REMINDER));assert.ok(html.includes('maxLength="4000"'));
 for(const key of ['name','email','age','gender','institution','phone','location'])assert.ok(!html.includes(`name="${key}"`));
});
test('success state is visible',()=>{assert.match(renderToStaticMarkup(<PostSurveyForm state={{status:'complete'}}/>),/post-survey has been saved/);});
test('Phase 9 entry is independent of export readiness and leaves report accessible',()=>{
 const html=renderToStaticMarkup(<PostSurvey/>);assert.match(html,/Complete post-survey/);assert.match(html,/continue reviewing your report/);
 const source=readFileSync('src/components/CausalStudioApp.jsx','utf8');
 assert.ok(source.includes('      <PostSurvey />'));
 assert.ok(source.includes('function ReviewView'));
});
