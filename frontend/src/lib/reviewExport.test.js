import test from 'node:test';
import assert from 'node:assert/strict';

import { getReviewExportBlockers, normalizeClaimAuditResult } from './reviewExport.js';

test('reports blockers when export prerequisites are missing', () => {
  const blockers = getReviewExportBlockers({
    selectedRun: null,
    claimAudit: null,
    reportDraft: null,
    backendConnected: false,
    signoffBlockers: ['Graph validation has not been reviewed.'],
  });

  assert.ok(blockers.includes('Generate a report before exporting.'));
  assert.ok(blockers.includes('Run claim audit before exporting.'));
  assert.ok(blockers.includes('Select a primary Phase 8 run before exporting.'));
  assert.ok(blockers.includes('Backend unavailable — export will stay local and conservative.'));
});

test('normalizes claim audit failures into a blocking shape', () => {
  const audit = normalizeClaimAuditResult({
    status: 'fail',
    flagged_claims: [{ severity: 'blocking', text: 'unsafe wording' }],
    ready_for_export: false,
  });

  assert.equal(audit.status, 'fail');
  assert.equal(audit.ready_for_export, false);
  assert.equal(audit.flagged_claims.length, 1);
});
