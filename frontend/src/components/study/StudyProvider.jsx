import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { studyIdentity } from '../../lib/studyIdentity.js';
import { createStudySession } from '../../lib/studySession.js';
import { checkStudyHealth, registerStudySession, submitPreSurvey, submitPostSurvey, submitStudyEventsBatch } from '../../lib/api.js';
import { createPostSurvey } from '../../lib/postSurvey.js';
import { createStudyEventLogger, createStudyLifecycle } from '../../lib/studyEvents.js';
import { PreSurvey } from './PreSurvey.jsx';

const logger = createStudyEventLogger({ getIdentity: studyIdentity.getIdentity, send: submitStudyEventsBatch });
const lifecycle = createStudyLifecycle(logger);
const session = createStudySession(studyIdentity, { checkStudyHealth, registerStudySession, submitPreSurvey }, id => lifecycle.confirmed('pre', id));
const postSurvey = createPostSurvey(studyIdentity, submitPostSurvey, id => lifecycle.confirmed('post', id));
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
    const flushHidden = () => { if (document.visibilityState === 'hidden') void logger.flush(); };
    const flushOnline = () => { void logger.flush(); };
    document.addEventListener('visibilitychange', flushHidden);
    window.addEventListener('online', flushOnline);
    return () => {
      document.removeEventListener('visibilitychange', flushHidden);
      window.removeEventListener('online', flushOnline);
      logger.stop();
    };
  }, []);
  return <StudyContext.Provider value={{ ...study.identity, ...study, postSurvey, logStudyEvent: logger.log, flushStudyEvents: logger.flush, loggingStatus, retryRegistration: controller.register, submitPreSurvey: controller.submit }}>
    {(loggingStatus === 'unsaved' || loggingStatus === 'error') && <p role="status" style={{ margin: 8 }}>Some study interaction records have not been saved. You can continue using Causal Studio.</p>}
    <StudyGate study={study} onSubmit={controller.submit} onRetry={controller.register}>{children}</StudyGate>
  </StudyContext.Provider>;
}
