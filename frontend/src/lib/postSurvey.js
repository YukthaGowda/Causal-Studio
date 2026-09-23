export const FEEDBACK_REMINDER = 'Please do not include your name, email, or other personally identifying information in your feedback.';
export const POST_RATINGS = [
  ['overall_usability', 'Overall usability'],
  ['trust_in_guidance', 'Trust in system guidance'],
  ['causal_workflow_clarity', 'Clarity of causal workflow'],
  ['ai_assistant_helpfulness', 'Helpfulness of artificial intelligence assistant'],
  ['final_report_confidence', 'Confidence in reviewing the final report'],
];
export function createPostSurvey(identityManager, send, onConfirmed = () => {}) {
  let state = { status: 'idle', error: '', pending: null };
  let inFlight;
  const listeners = new Set();
  const update = change => { state = { ...state, ...change }; listeners.forEach(fn => fn()); };
  function initialize() {
    if (identityManager.isPostComplete()) update({ status: 'complete', pending: null });
  }
  function submit(answers) {
    if (inFlight) return inFlight;
    if (state.status === 'complete') return Promise.resolve();
    inFlight = (async () => {
      let payload = state.pending;
      if (!payload) {
        const selected = {};
        for (const [key] of POST_RATINGS) {
          if (!Number.isInteger(answers[key]) || answers[key] < 1 || answers[key] > 5) {
            update({ error: 'Please select a rating from 1 to 5 for each question.' }); return;
          }
          selected[key] = answers[key];
        }
        const feedback = answers.open_feedback ?? '';
        if (typeof feedback !== 'string' || feedback.length > 4000) {
          update({ error: 'Please keep feedback within 4,000 characters.' }); return;
        }
        const { participant_id, session_id, study_version } = identityManager.getIdentity();
        payload = { participant_id, session_id, study_version, submitted_at: new Date().toISOString(), ...selected, open_feedback: feedback };
      }
      update({ status: 'submitting', pending: payload, error: '' });
      try {
        const result = await send(payload);
        if (result.status !== 'ok') throw Error();
        try { onConfirmed(identityManager.getIdentity()); } catch { /* Logging is non-blocking. */ }
        identityManager.markPostComplete();
        update({ status: 'complete', pending: null });
      } catch {
        update({ status: 'idle', error: 'We could not confirm your feedback was saved. Please retry. You can continue reviewing your report.' });
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return { initialize, submit, getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
}
