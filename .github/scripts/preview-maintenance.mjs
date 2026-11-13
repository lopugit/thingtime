import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { gatewaySourcePaths, gatewaySourceIssue } from './preview-gateway-source.mjs';
const execute = promisify(execFile);
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = ['schemaVersion','purpose','repository','prNumber','expectedHeadSha','headRef','retainedDeploymentId','retainedSourceSha','sourceTree','patchPath','patchSha256','implementationCommit'];
const fail = code => { throw new Error(`Preview maintenance refused (${code})`); };
export function maintenanceRequest(env = process.env, { eventName, ref, prNumber } = {}) {
  const request = { commit: env.PREVIEW_MAINTENANCE_ARTIFACT_COMMIT || '', path: env.PREVIEW_MAINTENANCE_MANIFEST_PATH || '', digest: env.PREVIEW_MAINTENANCE_MANIFEST_SHA256 || '' };
  if (!Object.values(request).some(Boolean)) return null;
  if (eventName !== 'workflow_dispatch' || ref !== 'refs/heads/main' || !Number.isSafeInteger(Number(prNumber)) || Number(prNumber) < 1) fail('manual-main-only');
  if (!sha(request.commit) || !digest(request.digest) || !/^ops\/preview-maintenance\/[a-z0-9][a-z0-9-]*\/manifest\.json$/.test(request.path)) fail('artifact-pin');
  return request;
}
export function parseMaintenanceManifest(bytes, request, repository, prNumber) {
  if (sha256(bytes) !== request.digest) fail('manifest-digest');
  let value; try { value = JSON.parse(bytes); } catch { fail('manifest-json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) fail('manifest-shape');
  if (value.schemaVersion !== 1 || value.purpose !== 'preview-protection' || value.repository !== repository || value.prNumber !== Number(prNumber) || !Number.isSafeInteger(value.prNumber) || value.prNumber < 1) fail('manifest-scope');
  if (![value.expectedHeadSha,value.retainedSourceSha,value.sourceTree,value.implementationCommit].every(sha) || !digest(value.patchSha256) || !/^dpl_[a-zA-Z0-9]+$/.test(value.retainedDeploymentId)) fail('manifest-identity');
  if (typeof value.headRef !== 'string' || !value.headRef || /[\x00-\x20\x7f~^:?*\[\\]/.test(value.headRef) || value.headRef.includes('..') || ['main','develop','github-actions'].includes(value.headRef)) fail('manifest-ref');
  if (value.patchPath !== request.path.replace(/manifest\.json$/, 'protection.patch')) fail('patch-path');
  return { ...value, artifact: request };
}
async function blob(github, repository, path, commit) {
  const entry = await github(`/repos/${repository}/contents/${path}?ref=${commit}`);
  if (entry?.type !== 'file' || entry.encoding !== 'base64' || typeof entry.content !== 'string') fail('artifact-blob');
  const bytes = Buffer.from(entry.content, 'base64');
  if (typeof entry.sha !== 'string' || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.sha) fail('blob-integrity');
  return bytes;
}
async function ancestor(github, repository, base, head) {
  const comparison = await github(`/repos/${repository}/compare/${base}...${head}`);
  if (!['ahead','identical'].includes(comparison?.status) || comparison.merge_base_commit?.sha !== base) fail('main-provenance');
}
export async function loadMaintenance(request, { github, repository, prNumber }) {
  const main = await github(`/repos/${repository}/git/ref/heads/main`);
  if (!sha(main?.object?.sha)) fail('main-unavailable');
  await ancestor(github, repository, request.commit, main.object.sha);
  const value = parseMaintenanceManifest(await blob(github, repository, request.path, request.commit), request, repository, prNumber);
  await ancestor(github, repository, value.implementationCommit, request.commit);
  const patch = await blob(github, repository, value.patchPath, request.commit);
  if (sha256(patch) !== value.patchSha256) fail('patch-digest');
  return { ...value, patch };
}
export function assertMaintenanceHead(intent, pullRequest) {
  if (pullRequest?.number !== intent.prNumber || pullRequest.state !== 'open' || pullRequest.head?.sha !== intent.expectedHeadSha || pullRequest.head?.ref !== intent.headRef || pullRequest.head?.repo?.full_name !== intent.repository || pullRequest.base?.repo?.full_name !== intent.repository) fail('current-head');
}
export function assertMaintenanceIncumbent(intent, binding) {
  if (!binding || binding.deployment?.id !== intent.retainedDeploymentId || binding.deployment.readyState !== 'READY' || binding.deployment.meta?.githubCommitSha !== intent.retainedSourceSha || binding.deployment.meta?.githubCommitRef !== intent.headRef) fail('incumbent');
}
export function maintenanceBindingState(intent, binding) {
  if (binding?.deployment?.readyState === 'READY' && !maintenanceMetadataIssue(binding.deployment, intent) && binding.deployment.meta?.githubCommitRef === intent.headRef) return 'published';
  assertMaintenanceIncumbent(intent, binding);
  return 'retained';
}
export function maintenanceGithubDeploymentMatches(deployment, intent) {
  return deployment?.environment === `develop-pr-${intent.prNumber}-maintenance` && deployment.ref === intent.retainedSourceSha && deployment.sha === intent.retainedSourceSha && deployment.payload?.kind === 'thingtimeDevelopPrPreview' && deployment.payload?.role === 'maintenance' && deployment.payload?.authorizationHead === intent.expectedHeadSha && deployment.payload?.sha === intent.retainedSourceSha && Number(deployment.payload?.pullRequest) === intent.prNumber && Object.entries(maintenanceMetadata(intent)).every(([key,value]) => deployment.payload[key] === value);
}
export async function getOrCreateMaintenanceDeployment(intent, { read, create }) {
  const existing = await read();
  if (existing) {
    if (!maintenanceGithubDeploymentMatches(existing, intent)) fail('github-deployment-identity');
    return existing;
  }
  try {
    const created = await create();
    if (!maintenanceGithubDeploymentMatches(created, intent)) fail('github-deployment-identity');
    return created;
  } catch (error) {
    const reconciled = await read();
    if (reconciled && maintenanceGithubDeploymentMatches(reconciled, intent)) return reconciled;
    throw error;
  }
}
export function maintenanceMetadata(intent) {
  return { thingtimePreviewRole: 'maintenance', thingtimeMaintenanceCommit: intent.artifact.commit, thingtimeMaintenancePath: intent.artifact.path,
    thingtimeMaintenanceDigest: intent.artifact.digest, thingtimeMaintenanceTree: intent.sourceTree, thingtimeMaintenancePatch: intent.patchSha256,
    thingtimeMaintenanceAuthorizedHead: intent.expectedHeadSha, thingtimeMaintenanceRetainedDeployment: intent.retainedDeploymentId };
}
export function maintenanceMetadataIssue(deployment, intent) {
  if (!intent || Object.entries(maintenanceMetadata(intent)).some(([key,value]) => deployment?.meta?.[key] !== value) || deployment.meta?.githubCommitSha !== intent.retainedSourceSha) return 'maintenance-identity';
  return null;
}
export function preserveMaintenanceAlias(binding, current, intent) {
  if (binding?.deployment?.meta?.thingtimePreviewRole !== 'maintenance' || current?.state !== 'open') return false;
  if (current.number !== intent.prNumber || current.head?.ref !== intent.headRef || current.head?.repo?.full_name !== intent.repository || current.base?.repo?.full_name !== intent.repository || maintenanceMetadataIssue(binding.deployment, intent)) fail('maintenance-alias-provenance');
  // A newer PR head does not silently replace this reviewed working baseline.
  // Ordinary event-driven publication may replace it only after candidate checks.
  return true;
}
export function maintenancePinFromDeployment(deployment) {
  const meta = deployment?.meta;
  if (meta?.thingtimePreviewRole !== 'maintenance') return null;
  const env = { PREVIEW_MAINTENANCE_ARTIFACT_COMMIT: meta.thingtimeMaintenanceCommit, PREVIEW_MAINTENANCE_MANIFEST_PATH: meta.thingtimeMaintenancePath, PREVIEW_MAINTENANCE_MANIFEST_SHA256: meta.thingtimeMaintenanceDigest };
  return maintenanceRequest(env, { eventName: 'workflow_dispatch', ref: 'refs/heads/main', prNumber: meta.githubPrId });
}
export async function reconstructMaintenance(intent, directory, { run = execute } = {}) {
  const cwd = resolve(directory);
  const git = async args => (await run('git', args, { cwd })).stdout.trim();
  if (await git(['rev-parse','HEAD']) !== intent.retainedSourceSha || await git(['status','--porcelain','--untracked-files=no'])) fail('build-base');
  // Patch bytes are already pinned to reviewed canonical-main provenance. git
  // apply refuses path traversal; the exact resulting full tree is then checked.
  if (sha256(intent.patch) !== intent.patchSha256) fail('patch-digest');
  const temporary = await mkdtemp(join(tmpdir(), 'preview-reviewed-patch-'));
  try {
    const patchPath = join(temporary, 'protection.patch');
    await writeFile(patchPath, intent.patch, { mode: 0o600 });
    await git(['apply','--index','--check',patchPath]);
    await git(['apply','--index',patchPath]);
  } finally { await rm(temporary, { recursive:true, force:true }); }
  if (await git(['write-tree']) !== intent.sourceTree) fail('build-tree');
  const sources = Object.fromEntries(await Promise.all(gatewaySourcePaths.map(async path => [path, await readFile(resolve(cwd,path),'utf8')])));
  if (gatewaySourceIssue(sources)) fail('gateway-source');
}
export function maintenanceReceipt(intent) {
  return { schemaVersion:1, artifact:intent.artifact, sourceBase:intent.retainedSourceSha, sourceTree:intent.sourceTree, patchSha256:intent.patchSha256, authorizationHead:intent.expectedHeadSha };
}
export function assertMaintenanceReceipt(value, intent) {
  if (JSON.stringify(value) !== JSON.stringify(maintenanceReceipt(intent))) fail('prebuilt-receipt');
}
// Used only by the credential-free build job's protected controller checkout.
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const request = maintenanceRequest(process.env, { eventName:'workflow_dispatch',ref:'refs/heads/main',prNumber:process.env.PREVIEW_MAINTENANCE_PR_NUMBER });
  if (!request) fail('missing-pin');
  const github = async path => {
    const response = await fetch(`https://api.github.com${path}`, { headers:{ Accept:'application/vnd.github+json', Authorization:`Bearer ${process.env.GH_TOKEN}` },redirect:'error',signal:AbortSignal.timeout(30_000) });
    if (!response.ok) fail(`github-http-${response.status}`);
    return response.json();
  };
  const intent = await loadMaintenance(request, {github,repository:process.env.GITHUB_REPOSITORY,prNumber:process.env.PREVIEW_MAINTENANCE_PR_NUMBER});
  await reconstructMaintenance(intent, process.env.PREVIEW_MAINTENANCE_PRODUCT_DIR);
  await writeFile(process.env.PREVIEW_MAINTENANCE_RECEIPT_PATH, JSON.stringify(maintenanceReceipt(intent)), {mode:0o600});
}
