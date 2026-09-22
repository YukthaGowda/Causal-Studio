import React, { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { studyIdentity } from '../../lib/studyIdentity.js';
import { createStudySession } from '../../lib/studySession.js';
import { checkStudyHealth, registerStudySession, submitPreSurvey, submitPostSurvey } from '../../lib/api.js';
import { createPostSurvey } from '../../lib/postSurvey.js';
import { PreSurvey } from './PreSurvey.jsx';

const session = createStudySession(studyIdentity, { checkStudyHealth, registerStudySession, submitPreSurvey });
const postSurvey = createPostSurvey(studyIdentity, submitPostSurvey);
const StudyContext = createContext(null);
export const useStudy = () => useContext(StudyContext);
export function StudyGate({ study, children, onSubmit, onRetry }) {
  return study.status === 'complete' ? children : <PreSurvey study={study} onSubmit={onSubmit} onRetry={onRetry} />;
}
export function StudyProvider({ children, controller = session }) {
  const study = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.register(); }, [controller]);
  return <StudyContext.Provider value={{ ...study.identity, ...study, postSurvey, retryRegistration: controller.register, submitPreSurvey: controller.submit }}>
    <StudyGate study={study} onSubmit={controller.submit} onRetry={controller.register}>{children}</StudyGate>
  </StudyContext.Provider>;
}
