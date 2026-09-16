import test from 'node:test';
import assert from 'node:assert/strict';

import { getReviewExportBlockers, normalizeClaimAuditResult, renderReportContent } from './reviewExport.js';

test('report tables and warnings render as printable HTML', () => {
  const html = renderReportContent('| Field | Value |\n| --- | --- |\n| Estimate | 0 |\n\n### Data quality\n\n- Missing values\n- Review lag');
  assert.match(html, /<table><thead>/);
  assert.match(html, /<td>Estimate<\/td><td>0<\/td>/);
  assert.match(html, /<h3>Data quality<\/h3><ul><li>Missing values/);
});

test('report content cannot inject executable HTML and preserves table pipes', () => {
  const html = renderReportContent('| Field | Value |\n| --- | --- |\n| Formula | x &#124; y |\n<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<td>x \| y<\/td>/);
});

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
