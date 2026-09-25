import { useMemo, useReducer } from 'react';
import { createWorkflowState, updateWorkflowState } from './workflowDesign.js';

export function useWorkflowDesign(initial) {
  const [state, dispatch] = useReducer(updateWorkflowState, initial, createWorkflowState);
  const setters = useMemo(() => Object.fromEntries(Object.keys(state).map(key => [key, value => dispatch({ key, value })])), []);
  return { state, fields: Object.fromEntries(Object.keys(state).map(key => [key, [state[key], setters[key]]])) };
}
