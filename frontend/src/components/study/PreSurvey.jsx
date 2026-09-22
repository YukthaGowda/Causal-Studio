import React, { useState } from 'react';
import { PRE_SURVEY_FIELDS, PRIVACY_NOTE } from '../../lib/studySession.js';

export function PreSurvey({ study, onSubmit, onRetry }) {
  const [answers, setAnswers] = useState({});
  const pending = study.pending;
  const available = study.status === 'survey';
  return <main style={{ maxWidth: 680, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
    <h1>Welcome to Causal Studio</h1>
    <h2>Pre-study survey</h2>
    <p>{PRIVACY_NOTE}</p>
    {study.storageUnavailable && <p role="status">Browser storage is unavailable. Your anonymous identity or survey progress may not survive a refresh or a future visit.</p>}
    {study.error && <p role="alert">{study.error}</p>}
    {study.status === 'initializing' && <p role="status">Starting your anonymous study session…</p>}
    {study.status === 'registration_error' && <button type="button" onClick={onRetry}>Retry session registration</button>}
    <form onSubmit={event => { event.preventDefault(); onSubmit(answers); }}>
      {PRE_SURVEY_FIELDS.map(([key, label, choices]) => <div key={key} style={{ marginBottom: 16 }}>
        <label htmlFor={key}>{label}</label>
        <select id={key} name={key} required disabled={!available || Boolean(pending)} value={pending?.[key] || answers[key] || ''}
          onChange={event => setAnswers(current => ({ ...current, [key]: event.target.value }))}
          style={{ display: 'block', width: '100%', padding: 10 }}>
          <option value="" disabled>Select an option</option>
          {choices.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())}</option>)}
        </select>
      </div>)}
      <button type="submit" disabled={!available}>{study.status === 'submitting' ? 'Saving…' : pending ? 'Retry submission' : 'Submit and enter Causal Studio'}</button>
    </form>
  </main>;
}
