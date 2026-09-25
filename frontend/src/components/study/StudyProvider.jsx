import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { studyIdentity } from '../../lib/studyIdentity.js';
import { createStudySession } from '../../lib/studySession.js';
import { checkStudyHealth, registerStudySession, submitPreSurvey, submitPostSurvey, submitStudyEventsBatch } from '../../lib/api.js';
import { createPostSurvey } from '../../lib/postSurvey.js';
import { createStudyEventLogger, createStudyLifecycle } from '../../lib/studyEvents.js';
import { retryStudyEventsAfter } from '../../lib/studyEventQueue.js';
import { PreSurvey } from './PreSurvey.jsx';

const logger = createStudyEventLogger({ getIdentity: studyIdentity.getIdentity, send: submitStudyEventsBatch });
const lifecycle = createStudyLifecycle(logger);
const session = createStudySession(studyIdentity, {
  checkStudyHealth,
  registerStudySession: retryStudyEventsAfter(registerStudySession, logger),
  submitPreSurvey: retryStudyEventsAfter(submitPreSurvey, logger),
}, id => lifecycle.confirmed('pre', id));
const postSurvey = createPostSurvey(studyIdentity, retryStudyEventsAfter(submitPostSurvey, logger), id => lifecycle.confirmed('post', id));
const StudyContext = createContext(null);
export const useStudy = () => useContext(StudyContext);
export function StudyGate({ study, children, onSubmit, onRetry }) {
  return study.status === 'complete' ? children : <PreSurvey study={study} onSubmit={onSubmit} onRetry={onRetry} />;
}
export function StudyProvider({ children, controller = session }) {
  const study = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const loggingStatus = useSyncExternalStore(logger.subscribe, logger.getSnapshot, logger.getSnapshot);
  useEffect(() => { controller.register(); }, [controller]);
  useEffect(() => {
    if (study.status === 'complete') lifecycle.confirmed('dashboard', study.identity);
  }, [study.status, study.identity]);
  useEffect(() => {
    logger.start();
    const flushHidden = () => { if (document.visibilityState === 'hidden') void logger.retry(); };
    const flushOnline = () => { void logger.retry(); };
    document.addEventListener('visibilitychange', flushHidden);
    window.addEventListener('online', flushOnline);
    return () => {
      document.removeEventListener('visibilitychange', flushHidden);
      window.removeEventListener('online', flushOnline);
      logger.stop();
    };
  }, []);
  return <StudyContext.Provider value={{ ...study.identity, ...study, postSurvey, logStudyEvent: logger.log, flushStudyEvents: logger.flush, loggingStatus, retryRegistration: controller.register, submitPreSurvey: controller.submit }}>
    {loggingStatus !== 'all_saved' && <StudyLoggingNotice status={loggingStatus} />}
    <StudyGate study={study} onSubmit={controller.submit} onRetry={controller.register}>{children}</StudyGate>
  </StudyContext.Provider>;
}

export function StudyLoggingNotice({ status }) {
  if (status === 'all_saved') return null;
  if (status === 'storage_unavailable') return <p role="status" style={{ margin: 8 }}>Study interaction recording is temporarily limited. This browser cannot keep pending records for retry after a refresh. You can continue using Causal Studio.</p>;
  const detail = status === 'unsaved_persisted' ? 'They are saved on this browser for retry for up to 24 hours.'
    : status === 'error' ? 'Some pending records could not be retained or have expired.' : 'We are trying to save them.';
  return <p role="status" style={{ margin: 8 }}>Some study interaction records have not been saved. {detail} You can continue using Causal Studio.</p>;
}
