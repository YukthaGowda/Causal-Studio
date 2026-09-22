export const STUDY_VERSION = 'causal-studio-pilot-v1';
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// One manager per document, shared across Strict Mode mounts. No personal inputs.
export function createStudyIdentityManager(environment = globalThis) {
  const memory = new Map();
  let identity;
  let storageUnavailable = false;
  function read(area, key) {
    try { return environment[area].getItem(key) ?? memory.get(key); }
    catch { storageUnavailable = true; return memory.get(key); }
  }
  function write(area, key, value) {
    memory.set(key, value);
    try { environment[area].setItem(key, value); }
    catch { storageUnavailable = true; }
  }
  function getIdentity() {
    if (identity) return identity;
    let participant_id = read('localStorage', 'causal-study-participant');
    if (!new RegExp(`^participant_${uuidPattern}$`, 'i').test(participant_id || '')) {
      participant_id = `participant_${environment.crypto.randomUUID()}`;
    }
    write('localStorage', 'causal-study-participant', participant_id);
    let session;
    try { session = JSON.parse(read('sessionStorage', 'causal-study-session') || 'null'); } catch { /* Replace invalid local state. */ }
    if (session?.participant_id !== participant_id || session?.study_version !== STUDY_VERSION ||
        !new RegExp(`^session_${uuidPattern}$`, 'i').test(session?.session_id || '') ||
        !Number.isFinite(Date.parse(session?.client_created_at))) {
      session = { participant_id, session_id: `session_${environment.crypto.randomUUID()}`, study_version: STUDY_VERSION, client_created_at: new Date().toISOString() };
    }
    identity = Object.freeze({ participant_id, session_id: session.session_id, study_version: STUDY_VERSION, client_created_at: session.client_created_at });
    write('sessionStorage', 'causal-study-session', JSON.stringify(identity));
    return identity;
  }
  function key(kind) {
    const id = getIdentity();
    return `causal-study-${kind}:${id.participant_id}:${id.session_id}:${id.study_version}`;
  }
  return {
    getIdentity,
    isPostComplete: () => read('sessionStorage', key('post-complete')) === 'true',
    markPostComplete: () => write('sessionStorage', key('post-complete'), 'true'),

    storageUnavailable: () => storageUnavailable,
    isComplete: () => read('sessionStorage', key('pre-complete')) === 'true',
    markComplete: () => write('sessionStorage', key('pre-complete'), 'true'),
    readPending: () => { try { return JSON.parse(read('sessionStorage', key('pre-pending')) || 'null'); } catch { return null; } },
    savePending: (value) => write('sessionStorage', key('pre-pending'), JSON.stringify(value)),
  };
}
export const studyIdentity = createStudyIdentityManager();
