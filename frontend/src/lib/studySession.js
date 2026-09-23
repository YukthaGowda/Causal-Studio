export const PRIVACY_NOTE = 'This platform uses an anonymous participant ID to link survey responses and interaction logs. Please do not enter your name, email, or other personally identifying information.';
const experience = ['none', 'beginner', 'intermediate', 'advanced', 'prefer_not_to_answer'];
export const PRE_SURVEY_FIELDS = [
  ['expertise_area', 'Expertise area', ['clinical_research', 'medicine', 'public_health', 'statistics', 'computer_science', 'engineering', 'behavioral_science', 'other', 'prefer_not_to_answer']],
  ['career_stage', 'Career stage', ['student', 'trainee', 'early_career', 'mid_career', 'senior', 'other', 'prefer_not_to_answer']],
  ['causal_inference_experience', 'Experience with causal inference', experience],
  ['llm_experience', 'Experience with large language models', experience],
  ['rag_experience', 'Experience with retrieval augmented generation', experience],
  ['passive_sensing_experience', 'Experience with passive sensing / wearable / smartphone data', experience],
];

export function createStudySession(identityManager, api, onConfirmed = () => {}) {
  let state = { status: 'initializing', error: '', identity: null, storageUnavailable: false, pending: null };
  const listeners = new Set();
  let registering;
  let submitting;
  const update = (change) => { state = { ...state, ...change }; listeners.forEach(fn => fn()); };
  const register = () => {
    if (registering) return registering;
    registering = (async () => {
      update({ status: 'initializing', error: '' });
      try {
        const identity = identityManager.getIdentity();
        update({ identity, storageUnavailable: identityManager.storageUnavailable() });
        const health = await api.checkStudyHealth();
        if (!health.storage_available) throw new Error('Unavailable');
        const result = await api.registerStudySession(identity);
        if (result.status !== 'ok') throw new Error('Not registered');
        const saved = identityManager.readPending();
        let pending = null;
        if (saved && ['participant_id', 'session_id', 'study_version'].every(key => saved[key] === identity[key]) &&
            typeof saved.submitted_at === 'string' && Number.isFinite(Date.parse(saved.submitted_at)) &&
            PRE_SURVEY_FIELDS.every(([key, , choices]) => choices.includes(saved[key]))) {
          pending = Object.fromEntries(['participant_id', 'session_id', 'study_version', 'submitted_at', ...PRE_SURVEY_FIELDS.map(([key]) => key)].map(key => [key, saved[key]]));
        }
        update({ status: identityManager.isComplete() ? 'complete' : 'survey', pending, storageUnavailable: identityManager.storageUnavailable() });
      } catch {
        update({ status: 'registration_error', error: 'We could not start your study session. Please retry. Your dashboard will open after registration and the pre-survey are saved.' });
      }
    })().finally(() => { registering = null; });
    return registering;
  };
  const submit = (answers) => {
    if (submitting) return submitting;
    if (state.status !== 'survey') return Promise.resolve();
    submitting = (async () => {
      let payload = state.pending;
      if (!payload) {
        const selected = {};
        for (const [key, , choices] of PRE_SURVEY_FIELDS) {
          if (!choices.includes(answers[key])) {
            update({ error: 'Please select an answer for each question.' });
            return;
          }
          selected[key] = answers[key];
        }
        const { participant_id, session_id, study_version } = state.identity;
        payload = { participant_id, session_id, study_version, submitted_at: new Date().toISOString(), ...selected };
        identityManager.savePending(payload);
      }
      update({ status: 'submitting', error: '', pending: payload });
      try {
        const result = await api.submitPreSurvey(payload);
        if (result.status !== 'ok') throw new Error('Not saved');
        try { onConfirmed(identityManager.getIdentity()); } catch { /* Logging is non-blocking. */ }
        identityManager.markComplete();
        identityManager.savePending(null);
        update({ status: 'complete', pending: null, storageUnavailable: identityManager.storageUnavailable() });
      } catch {
        update({ status: 'survey', error: 'We could not confirm that your answers were saved. Retry submission to continue. Your selected answers are preserved.' });
      }
    })().finally(() => { submitting = null; });
    return submitting;
  };
  return { getSnapshot: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, register, submit };
}
