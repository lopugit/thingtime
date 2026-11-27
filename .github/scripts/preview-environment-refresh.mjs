import { pullRequestIsLive } from './preview-retention-policy.mjs';
import { maintenanceMetadata, maintenanceMetadataIssue } from './preview-maintenance.mjs';
// Explicit fresh publication reuses a verified GitHub bundle, never Vercel's
// redeploy operation (which preserves a prebuilt deployment's old environment).
const fail = reason => { throw new Error(`Preview environment refresh refused (${reason})`); };
export function refreshRequest(env, { eventName, ref, prNumber, maintenance = false }) {
  const deploymentId = env.PREVIEW_REFRESH_DEPLOYMENT_ID || '';
  const runId = env.PREVIEW_REFRESH_RUN_ID || '';
  if (!deploymentId && !runId) return null;
  if (eventName !== 'workflow_dispatch' || ref !== 'refs/heads/main' || !Number.isSafeInteger(Number(prNumber)) || Number(prNumber) < 1) fail('manual-main-only');
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId) || (runId && (!/^[1-9]\d*$/.test(runId) || !Number.isSafeInteger(Number(runId))))) fail('identity');
  return { deploymentId, runId: runId ? Number(runId) : null, prNumber: Number(prNumber) };
}
export function validateRefreshIncumbent(intent, binding, pr, config) {
  const d = binding?.deployment;
  if ((binding?.record?.deploymentId ?? binding?.deploymentId) !== intent.deploymentId || d?.id !== intent.deploymentId || d.projectId !== config.projectId || d.readyState !== 'READY' || d.prebuilt !== true || d.target === 'production') fail('incumbent');
  const m = d.meta || {};
  if (pr.state !== 'open' || pr.number !== intent.prNumber || pr.head?.repo?.full_name !== config.repository || pr.base?.repo?.full_name !== config.repository || m.githubCommitSha !== (config.maintenance?.retainedSourceSha ?? pr.head?.sha) || m.githubCommitRef !== pr.head?.ref || Number(m.githubPrId) !== pr.number || (m.thingtimePreviewRole === 'maintenance') !== !!config.maintenance || m.thingtimeGatewayOwner !== 'false' || m.thingtimeGatewayOrigin !== 'https://master.previews.thingtime.com') fail('source');
  if (config.maintenance && maintenanceMetadataIssue(d, config.maintenance)) fail('maintenance-source');
  const match = /^(\d+)-(\d+)$/.exec(m.thingtimePrPreviewAttempt || '');
  if (!match || (intent.runId && Number(match[1]) !== intent.runId)) fail('attempt');
  return { ...intent, attempt: m.thingtimePrPreviewAttempt, runAttempt: Number(match[2]), sha: config.maintenance?.retainedSourceSha ?? pr.head.sha, authorizationHead: pr.head.sha, maintenance: config.maintenance ? maintenanceMetadata(config.maintenance) : null, ref: pr.head.ref };
}
export function validateRefreshArtifacts(intent, run, artifacts, repository) {
  if (run.id !== intent.runId || run.repository?.full_name !== repository || run.path !== '.github/workflows/develop-pr-preview.yml' || run.status !== 'completed' || run.conclusion !== 'success' || run.head_branch !== 'main') fail('workflow');
  for (const name of [`develop-preview-${intent.runId}-${intent.prNumber}`, `pr-preview-receipt-${intent.runId}-${intent.runAttempt}`]) {
    if (artifacts.filter(a => a.name === name && a.expired === false && a.workflow_run?.id === intent.runId).length !== 1) fail('artifact');
  }
  return intent;
}
export function validateRefreshReceipt(intent, receipt) {
  // Ordinary receipts before retained-source maintenance had one source/head.
  // Infer only an absent field, never a null/wrong value or a maintenance head.
  const authorizationHead = Object.hasOwn(receipt, 'authorizationHead') ? receipt.authorizationHead
    : !intent.maintenance && receipt.sha === intent.authorizationHead ? receipt.sha : null;
  if (receipt.deploymentId !== intent.deploymentId || receipt.state !== 'aliases-restored' || receipt.attempt !== intent.attempt || receipt.prNumber !== intent.prNumber || receipt.sha !== intent.sha || authorizationHead !== intent.authorizationHead || receipt.ref !== intent.ref) fail('receipt');
  if (intent.maintenance ? Object.entries(intent.maintenance).some(([key,value]) => receipt.maintenance?.[key] !== value) : !!receipt.maintenance) fail('receipt-maintenance');
}
export function refreshAutomationCredential(project, projectId) {
  if (project.id !== projectId) fail('credential-project');
  const entries = Object.entries(project.protectionBypass || {}).filter(([, value]) => value?.scope === 'automation-bypass' && value.isEnvVar === true);
  if (entries.length !== 1 || !entries[0][0]) fail('credential-default');
  return entries[0][0];
}
export async function executeRefreshPublisher({ execute, command, args, options, credential }) {
  if (typeof credential !== 'string' || !credential) fail('credential');
  try {
    return await execute(command, [...args, '--env', 'VERCEL_AUTOMATION_BYPASS_SECRET'], {
      ...options, env: { ...options.env, VERCEL_AUTOMATION_BYPASS_SECRET: credential }
    });
  } catch { throw new Error('Vercel fresh publication failed; protected diagnostics withheld'); }
}

export function refreshRetentionCanBeSkipped({ refresh, policy, pullRequest, currentHeadVerified, repository }) {
  return !!refresh && currentHeadVerified === true && policy?.enabled === true &&
    policy.pruneSupersededOpenPr === false && policy.inactivePullRequestDays === null &&
    pullRequest?.draft === false && typeof repository === 'string' && repository.length > 0 &&
    pullRequest.head?.repo?.full_name === repository && pullRequest.base?.repo?.full_name === repository &&
    pullRequestIsLive(pullRequest, policy);
}
export async function reconcilePublicationRetention({ refresh, repository, readCurrent, cleanup }) {
  if (refresh) {
    let current;
    try { current = await readCurrent(); } catch { /* uncertain state uses the canonical sweep */ }
    if (refreshRetentionCanBeSkipped({ refresh, repository, ...current })) return { skipped: true };
  }
  await cleanup();
  return { skipped: false };
}
