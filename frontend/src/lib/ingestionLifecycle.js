const complete = status => ['completed', 'ready'].includes(status?.status);
const failed = status => ['error', 'failed', 'stale'].includes(status?.status);

function statusError(status) {
  const error = new Error([status.message || 'Document ingestion failed.', status.details || status.detail,
    status.failed_step ? `Failed step: ${status.failed_step}.` : null].filter(Boolean).join(' '));
  error.payload = status;
  return error;
}

function pause(ms, signal) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}

// Only one POST per invocation. Network/timeout ambiguity is resolved by GETs.
export async function followIngestion({ start, readStatus, onUpdate, initialStatus, signal,
  wait = pause, intervalMs = 2000, retryLimit = 3 }) {
  const active = () => {
    if (signal?.aborted) throw new DOMException('Ingestion monitoring stopped.', 'AbortError');
  };
  const publish = value => { active(); onUpdate(value); };
  let current = initialStatus;
  if (current?.status !== 'running') {
    // Do not launch another POST when the server's running state cannot be checked.
    for (let attempt = 1; ; attempt++) {
      active();
      try { current = await readStatus(); break; }
      catch (error) {
        if (error.payload) throw error;
        if (attempt >= retryLimit) throw error;
        publish({ status: 'checking', message: 'Checking whether ingestion is already running…' });
        await wait(intervalMs, signal);
      }
    }
    active();
    if (current?.status !== 'running') {
      publish({ status: 'running', message: 'Document ingestion requested. Waiting for backend status…' });
      try {
        const result = await start();
        active();
        if (failed(result)) throw statusError(result);
        if (complete(result)) { publish(result); return result; }
        publish(result?.status === 'running' ? result : { status: 'checking', message: 'Checking ingestion progress…' });
      } catch (error) {
        active();
        // 409 means another ingestion owns the backend lock: monitor that run.
        if (error.payload && error.httpStatus !== 409) throw error;
        publish({ status: 'checking', message: 'The ingestion request ended before completion was confirmed. Checking backend progress…' });
      }
    } else publish(current);
  } else publish(current);

  let unknowns = 0;
  let unreachable = 0;
  for (;;) {
    active();
    let status;
    try { status = await readStatus(); }
    catch (error) {
      active();
      if (error.payload) throw error;
      if (++unreachable >= retryLimit) {
        const failure = new Error(`Backend status is unreachable after ${retryLimit} consecutive polls. Ingestion completion is unknown. ${error.message}`);
        failure.payload = { status: 'unknown', message: failure.message };
        throw failure;
      }
      publish({ status: 'checking', message: 'Could not refresh ingestion status; retrying…' });
      await wait(intervalMs, signal);
      continue;
    }
    active();
    unreachable = 0;
    if (failed(status)) throw statusError(status);
    if (complete(status)) { publish(status); return status; }
    if (status?.status === 'running') { unknowns = 0; publish(status); }
    else {
      if (++unknowns >= retryLimit) throw statusError({ ...status, status: 'unknown', message: 'Ingestion status remains unknown after repeated checks. The backend may have restarted; inspect its status before retrying ingestion.' });
      publish({ status: 'checking', message: 'Waiting for the backend to confirm ingestion status…' });
    }
    await wait(intervalMs, signal);
  }
}
