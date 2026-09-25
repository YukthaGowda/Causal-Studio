// Dedicated outbox: callers must sanitize semantic events BEFORE enqueueing.
// No localStorage payload fallback. Survey records are never sent by this queue.
export const QUEUE_TTL_MS = 24 * 60 * 60 * 1000;
export const QUEUE_LIMIT = 100;
const STORE = 'pending_events';

export function createIndexedDBEventStore({ getIndexedDB = () => globalThis.indexedDB, timeoutMs = 3000 } = {}) {
  let opening;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request, finished = false;
      const fail = () => { if (!finished) { finished = true; clearTimeout(timer); reject(Error('Study queue unavailable')); } };
      const timer = setTimeout(fail, timeoutMs);
      try {
        request = getIndexedDB().open('causal-studio-study-outbox', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'event_id' });
        };
        request.onerror = request.onblocked = fail;
        request.onsuccess = () => {
          const db = request.result;
          if (finished) { db.close(); return; }
          finished = true; clearTimeout(timer);
          db.onversionchange = () => { db.close(); opening = null; };
          db.onclose = () => { opening = null; };
          resolve(db);
        };
      } catch { fail(); }
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transaction(action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, value;
      const timer = setTimeout(() => { try { tx?.abort(); } catch { /* Already closed. */ } reject(Error('Study queue unavailable')); }, timeoutMs);
      try {
        tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
        tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(Error('Study queue unavailable')); };
        action(tx.objectStore(STORE), result => { value = result; });
      } catch { clearTimeout(timer); reject(Error('Study queue unavailable')); }
    });
  }
  return {
    load: () => transaction((store, done) => { store.getAll().onsuccess = e => done(e.target.result); }),
    // Count and insert in one transaction: another tab cannot exceed the limit.
    put: (record, limit = QUEUE_LIMIT) => transaction((store, done) => {
      store.get(record.event_id).onsuccess = existing => {
        if (existing.target.result) { done(true); return; }
        store.count().onsuccess = count => {
          if (count.target.result >= Math.min(limit, QUEUE_LIMIT)) { done(false); return; }
          store.add(record); done(true);
        };
      };
    }),
    // Never resurrect an event acknowledged/deleted by another tab.
    update: record => transaction(store => {
      store.get(record.event_id).onsuccess = existing => { if (existing.target.result) store.put(record); };
    }),
    remove: ids => transaction(store => { for (const id of ids) store.delete(id); }),
  };
}

export function createStudyEventQueue({ send, sanitizeRestored, store = createIndexedDBEventStore(),
  now = () => new Date().toISOString(), schedule = setTimeout, cancel = clearTimeout,
  maxQueue = QUEUE_LIMIT, batchSize = 10, maxAttempts = 3, delayMs = 2000, retryCooldownMs = 30000 }) {
  maxQueue = Math.max(1, Math.min(maxQueue, QUEUE_LIMIT));
  batchSize = Math.max(1, Math.min(batchSize, 10));
  maxAttempts = Math.max(1, Math.min(maxAttempts, 3));
  const queue = [], listeners = new Set();
  let state = 'all_saved', work = Promise.resolve(), initialization, available = false;
  let inFlight, timer, expiryTimer, paused = false, lost = 0, expired = 0, lastCycle = -Infinity;
  const clock = () => Date.parse(now());
  const record = item => ({ event_id: item.event.event_id, event: item.event, queued_at: item.queued_at,
    retry_count: item.retry_count, last_attempt_at: item.last_attempt_at });
  function publish() {
    state = lost || expired ? 'error' : !available ? 'storage_unavailable' : !queue.length ? 'all_saved'
      : inFlight ? 'unsaved_retrying' : queue.every(item => item.persisted) ? 'unsaved_persisted' : 'unsaved_retrying';
    for (const fn of listeners) { try { fn(); } catch { /* Logging is non-blocking. */ } }
  }
  function storageFailed() { available = false; publish(); }
  // Serialize storage mutations, but never hold this chain during a network call.
  function run(task) {
    const result = work.then(task).catch(() => { storageFailed(); return false; });
    work = result; return result;
  }
  function forget(item) { const i = queue.indexOf(item); if (i >= 0) queue.splice(i, 1); }
  async function remove(ids) {
    if (!ids.length || !available) return;
    try { await store.remove(ids); } catch { storageFailed(); throw Error('Queue cleanup unavailable'); }
  }
  async function prune() {
    const stale = queue.filter(item => clock() - Date.parse(item.queued_at) >= QUEUE_TTL_MS);
    for (const item of stale) forget(item);
    expired += stale.length;
    await remove(stale.map(item => item.event.event_id));
  }
  function scheduleExpiry() {
    if (expiryTimer) cancel(expiryTimer);
    expiryTimer = null;
    if (paused || !queue.length) return;
    const wait = Math.max(1, Math.min(...queue.map(item => Date.parse(item.queued_at) + QUEUE_TTL_MS - clock())));
    expiryTimer = schedule(() => { expiryTimer = null; void run(async () => { await prune(); publish(); scheduleExpiry(); }); }, wait);
  }
  function scheduleFlush(delay = delayMs) {
    if (!paused && !inFlight && !timer && queue.some(item => item.attempts < maxAttempts))
      timer = schedule(() => { timer = null; void flush(); }, delay);
  }
  function initialize() {
    if (initialization) return initialization;
    initialization = run(async () => {
      try {
        const records = await store.load();
        available = true;
        const restored = [], invalid = [];
        for (const saved of records) {
          const queued = Date.parse(saved.queued_at);
          if (!Number.isFinite(queued) || clock() - queued >= QUEUE_TTL_MS || queued > clock()) {
            invalid.push(saved.event_id); expired++; continue;
          }
          let event;
          try { event = sanitizeRestored(saved.event); } catch { /* Reject corrupt records. */ }
          if (!event || saved.event_id !== event.event_id || restored.length >= maxQueue) { invalid.push(saved.event_id); lost++; continue; }
          // The original event identity/timestamp/ID are retained, never getIdentity().
          const item = { event, queued_at: saved.queued_at, retry_count: Number.isSafeInteger(saved.retry_count) && saved.retry_count >= 0 ? saved.retry_count : 0,
            last_attempt_at: Number.isFinite(Date.parse(saved.last_attempt_at)) ? saved.last_attempt_at : null, attempts: 0, persisted: true };
          restored.push(item);
          await store.update(record(item)); // Reapply privacy allowlists before retry.
        }
        await remove(invalid);
        const ids = new Set(restored.map(item => item.event.event_id));
        const fresh = queue.filter(item => !ids.has(item.event.event_id));
        queue.splice(0, queue.length, ...restored, ...fresh);
        if (queue.length > maxQueue) { lost += queue.length - maxQueue; queue.splice(maxQueue); }
      } catch { storageFailed(); }
      publish(); scheduleFlush(); scheduleExpiry();
    });
    return initialization;
  }
  function enqueue(event) {
    if (queue.some(item => item.event.event_id === event.event_id)) return event.event_id;
    if (queue.length >= maxQueue) { lost++; publish(); return false; }
    // Only the already-sanitized event is cloned or handed to storage.
    const item = { event: structuredClone(event), queued_at: now(), retry_count: 0, last_attempt_at: null, attempts: 0, persisted: false };
    queue.push(item); publish(); initialize();
    void run(async () => {
      await prune();
      if (available && queue.includes(item) && !item.persisted) {
        try {
          item.persisted = await store.put(record(item), maxQueue);
          if (!item.persisted) { forget(item); lost++; }
        } catch { storageFailed(); }
      }
      publish(); scheduleFlush(); scheduleExpiry();
    });
    return event.event_id;
  }
  function flush() {
    if (inFlight) return inFlight;
    if (timer) cancel(timer);
    timer = null;
    initialize();
    let batch = [];
    inFlight = run(async () => {
      await prune();
      batch = queue.filter(item => item.attempts < maxAttempts).slice(0, batchSize);
      for (const item of batch) {
        item.attempts++; item.retry_count++; item.last_attempt_at = now();
        if (available) {
          try {
            if (item.persisted) await store.update(record(item));
            else item.persisted = await store.put(record(item), maxQueue);
          } catch { storageFailed(); }
        }
      }
      publish();
      return true;
    }).then(async prepared => {
      if (!prepared || !batch.length) return false;
      // A storage wait may cross the expiry boundary; never send expired records.
      batch = batch.filter(item => clock() - Date.parse(item.queued_at) < QUEUE_TTL_MS);
      if (!batch.length) return false;
      const result = await send(batch.map(item => structuredClone(item.event)));
      if (result?.status !== 'ok' || !Number.isInteger(result.inserted) || !Number.isInteger(result.duplicates) || result.inserted < 0 || result.duplicates < 0 || result.inserted + result.duplicates !== batch.length) throw Error('Unconfirmed batch');
      return run(async () => {
        // Deletion must complete before claiming all saved. A failed deletion can
        // safely be retried with the same IDs (server deduplicates).
        if (batch.some(item => item.persisted) && !available) throw Error('Queue cleanup unavailable');
        await remove(batch.map(item => item.event.event_id));
        for (const item of batch) forget(item);
        return true;
      });
    }).catch(() => false).finally(() => {
      inFlight = null; publish(); scheduleExpiry();
      scheduleFlush(delayMs * 2 ** Math.max(0, ...batch.map(item => item.attempts - 1)));
    });
    publish(); return inFlight;
  }
  // Explicit recovery starts a fresh bounded cycle, with a cooldown. Automatic
  // retries never reset attempts, and new events do not reset older events.
  function retry() {
    if (inFlight) return inFlight;
    if (clock() - lastCycle < retryCooldownMs) return Promise.resolve(false);
    lastCycle = clock();
    for (const item of queue) item.attempts = 0;
    if (!available) initialization = null;
    return flush();
  }
  return {
    enqueue, flush, retry,
    getSnapshot: () => state,
    getCounts: () => ({ pending: queue.length, expired, dropped: lost }),
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    start: () => { paused = false; initialize(); scheduleFlush(); scheduleExpiry(); },
    stop: () => { paused = true; if (timer) cancel(timer); if (expiryTimer) cancel(expiryTimer); timer = expiryTimer = null; },
  };
}

// A confirmed study API interaction is a recovery opportunity, never a reason
// to repeat that API call. Do not wrap the event-batch sender with this helper.
export function retryStudyEventsAfter(api, logger) {
  return async (...args) => {
    const result = await api(...args);
    if (result?.status === 'ok') {
      try { void logger.retry().catch(() => {}); } catch { /* Survey success is independent. */ }
    }
    return result;
  };
}
