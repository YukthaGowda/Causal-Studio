import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useStudy } from './StudyProvider.jsx';
import { POST_RATINGS, FEEDBACK_REMINDER } from '../../lib/postSurvey.js';

export function PostSurveyForm({ state, onSubmit }) {
  const [answers, setAnswers] = useState({ open_feedback: '' });
  if (state.status === 'complete') return <p role="status">Thank you. Your post-survey has been saved. You can continue reviewing your report.</p>;
  const locked = Boolean(state.pending);
  const values = state.pending || answers;
  return <form onSubmit={event => { event.preventDefault(); onSubmit(answers); }}>
    <p>{FEEDBACK_REMINDER}</p>
    <p>Rate each item from 1 (very low) to 5 (very high).</p>
    {state.error && <p role="alert">{state.error}</p>}
    {POST_RATINGS.map(([key, label]) => <div key={key} style={{ marginBottom: 12 }}>
      <label htmlFor={`post-${key}`}>{label}</label>
      <select id={`post-${key}`} name={key} required disabled={locked} value={values[key] ?? ''}
        onChange={event => setAnswers(current => ({ ...current, [key]: Number(event.target.value) }))} style={{ display: 'block', padding: 8 }}>
        <option value="" disabled>Select a rating</option>
        {[1,2,3,4,5].map(n => <option value={n} key={n}>{n}</option>)}
      </select>
    </div>)}
    <label htmlFor="post-feedback">Optional open-ended feedback</label>
    <textarea id="post-feedback" name="open_feedback" maxLength={4000} rows={4} disabled={locked} value={values.open_feedback || ''}
      onChange={event => setAnswers(current => ({ ...current, open_feedback: event.target.value }))} style={{ display: 'block', width: '100%' }} />
    <p>Maximum 4,000 characters.</p>
    <button className="btn" type="submit" disabled={state.status === 'submitting'}>{state.status === 'submitting' ? 'Saving…' : locked ? 'Retry submission' : 'Submit post-survey'}</button>
  </form>;
}
function ConnectedPostSurvey({ controller }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.initialize(); }, [controller]);
  return <PostSurveyForm state={state} onSubmit={controller.submit} />;
}
export function PostSurvey() {
  const study = useStudy();
  return <details className="card">
    <summary style={{ cursor: 'pointer' }}>Complete post-survey</summary>
    <p>This survey is optional. You can complete it even if analysis or export is incomplete, and continue reviewing your report.</p>
    {study?.postSurvey ? <ConnectedPostSurvey controller={study.postSurvey} /> : <p role="status">Study session unavailable. You can continue reviewing your report.</p>}
  </details>;
}
