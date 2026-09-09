export async function parseApiResponse(response, fallbackMessage, { rejectFailureStatus = false } = {}) {
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || (rejectFailureStatus && ['error', 'failed'].includes(data?.status))) {
    const detail = data?.details || data?.detail;
    const explanation = Array.isArray(detail) ? detail.map(d => d.msg || d.message).join('; ') : typeof detail === 'string' ? detail : detail?.message;
    const message = data?.message || data?.summary || explanation || `${fallbackMessage} Backend returned HTTP ${response.status}${data == null ? ' without a JSON error response' : ''}.`;
    const error = new Error([message, explanation && explanation !== message ? explanation : null, data?.failed_step ? `Failed step: ${data.failed_step}.` : null].filter(Boolean).join(' '));
    error.payload = data;
    error.httpStatus = response.status;
    throw error;
  }
  if (data == null) throw new Error(`${fallbackMessage} Backend returned an empty or non-JSON response (HTTP ${response.status}).`);
  return data;
}
