// Render the deterministic report's limited Markdown vocabulary. Escape all data;
// this intentionally does not accept embedded HTML or executable links.
export function renderReportContent(content = '') {
  const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = String(content).split('\n');
  const output = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('| ') && /^\|[\s|:-]+$/.test(lines[i + 1] || '')) {
      const cells = (row, tag) => row.slice(1, -1).split('|').map((cell) => `<${tag}>${escape(cell.trim().replaceAll('&#124;', '|'))}</${tag}>`).join('');
      let html = `<table><thead><tr>${cells(line, 'th')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && lines[i].startsWith('| ')) {
        html += `<tr>${cells(lines[i], 'td')}</tr>`;
        i += 1;
      }
      i -= 1;
      output.push(`${html}</tbody></table>`);
    } else if (line.startsWith('- ')) {
      let html = '<ul>';
      while (i < lines.length && lines[i].startsWith('- ')) {
        html += `<li>${escape(lines[i].slice(2))}</li>`;
        i += 1;
      }
      i -= 1;
      output.push(`${html}</ul>`);
    } else if (/^#{1,3} /.test(line)) {
      const level = line.indexOf(' ');
      output.push(`<h${level}>${escape(line.slice(level + 1))}</h${level}>`);
    } else if (line.trim()) {
      output.push(`<p>${escape(line)}</p>`);
    }
  }
  return output.join('');
}

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
