export function getReviewExportBlockers({
  selectedRun,
  claimAudit,
  reportDraft,
  backendConnected,
  signoffBlockers = [],
}) {
  const blockers = [];

  if (!reportDraft) {
    blockers.push('Generate a report before exporting.');
  }

  if (!claimAudit) {
    blockers.push('Run claim audit before exporting.');
  } else if (claimAudit.status === 'fail' || (claimAudit.flagged_claims || []).some((item) => item.severity === 'blocking')) {
    blockers.push('Resolve blocking claim-audit issues before exporting.');
  }

  if (!selectedRun) {
    blockers.push('Select a primary Phase 8 run before exporting.');
  }

  if (signoffBlockers?.length) {
    blockers.push(...signoffBlockers.map((item) => `Review required: ${item}`));
  }

  if (!backendConnected) {
    blockers.push('Backend unavailable — export will stay local and conservative.');
  }

  return blockers;
}

export function normalizeClaimAuditResult(audit = {}) {
  const flaggedClaims = Array.isArray(audit.flagged_claims) ? audit.flagged_claims : [];
  const blocking = flaggedClaims.some((item) => item?.severity === 'blocking');

  return {
    ...audit,
    status: audit.status || (blocking ? 'fail' : 'warning'),
    flagged_claims: flaggedClaims,
    ready_for_export: audit.ready_for_export !== false && !blocking,
  };
}
