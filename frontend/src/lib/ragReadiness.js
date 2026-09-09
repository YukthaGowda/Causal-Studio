export function requireIngestionReady(ingestion) {
  if (['completed', 'ready'].includes(ingestion?.status)) return;
  if (ingestion?.status === 'running') {
    throw new Error('Documents are still being ingested. Please wait until ingestion completes before running evidence search.');
  }
  if (['error', 'failed'].includes(ingestion?.status)) {
    throw new Error('Document ingestion failed. Please fix ingestion before running evidence search.');
  }
  throw new Error('Documents have not been ingested yet. Please ingest documents before running evidence search.');
}
