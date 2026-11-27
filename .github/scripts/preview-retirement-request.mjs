/** Bounded maintenance selection, separate from ordinary automatic retention. */
export function previewRetirementRequest({ eventName, prNumber, deploymentIds = '', dryRun = 'false' }) {
  const raw = String(deploymentIds).trim();
  if (![true, false, 'true', 'false', ''].includes(dryRun)) throw new Error('Invalid retirement dry-run flag');
  const selectedDryRun = dryRun === true || dryRun === 'true';
  if (!raw && !selectedDryRun) return { deploymentIds: null, dryRun: false, reviewedRetirement: false };
  if (eventName !== 'workflow_dispatch' || String(prNumber) !== '0') throw new Error('Explicit retirement requires manual reconciliation with PR number 0');
  let ids;
  try { ids = JSON.parse(raw); } catch { throw new Error('Retirement deployment IDs must be a JSON array'); }
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(id)) || new Set(ids).size !== ids.length)
    throw new Error('Retirement requires 1 to 100 distinct deployment IDs');
  return { deploymentIds: ids, dryRun: selectedDryRun, reviewedRetirement: true };
}

/** Diagnostic labels never contain auth, query values, aliases or branch names. */
export function redactedProviderEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { return 'provider /unknown'; }
  const provider = url.hostname === 'api.vercel.com' ? 'Vercel' : url.hostname === 'api.github.com' ? 'GitHub' : 'provider';
  const path = url.pathname.replace(/\/dpl_[A-Za-z0-9]+/g, '/:deploymentId').replace(/\/prj_[A-Za-z0-9]+/g, '/:projectId')
    .replace(/(\/aliases)\/[^/]+/g, '$1/:alias').replace(/(\/refs\/heads)\/.*/g, '$1/:branch');
  return `${provider} ${provider === 'provider' ? '/unknown' : path}`;
}
