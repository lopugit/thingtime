#!/usr/bin/env node
// Explicit two-phase operator rollout: stage a static preview, then install only
// the verified wildcard aliases. Never promotes a production deployment.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fallbackPage, fallbackResponseIssue, fallbackDeploymentIssue, installFallbackAliases } from './preview-fallback.mjs';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const config = {
  repository: required('GITHUB_REPOSITORY'), projectId: required('VERCEL_PROJECT_ID'),
  teamId: required('VERCEL_TEAM_ID'), teamSlug: required('VERCEL_TEAM_SLUG'),
  rootStatus: Number(process.env.PREVIEW_FALLBACK_ROOT_STATUS || 200),
  suffixes: [required('PREVIEW_ALIAS_SUFFIX'), required('PRODUCTION_PREVIEW_ALIAS_SUFFIX')]
};
if (!/^prj_[A-Za-z0-9]+$/.test(config.projectId) || !/^team_[A-Za-z0-9]+$/.test(config.teamId)
  || !/^[a-z0-9-]+$/.test(config.teamSlug)) throw new Error('Invalid fallback project identity');
const page = fallbackPage(config);
const request = async (path, { method = 'GET', body, accept = [200] } = {}) => {
  const response = await fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${config.teamId}`, {
    method, headers: { Authorization: `Bearer ${required('VERCEL_API_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000)
  });
  if (!accept.includes(response.status)) throw new Error(`Vercel ${method} failed: HTTP ${response.status}`);
  if (response.status === 404) return null;
  return response.json();
};
const verifyPage = async (url) => {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const issue = fallbackResponseIssue(response, await response.text());
  if (issue) throw new Error(`Fallback page check failed: ${issue}`);
};
const main = async () => {
  const mode = process.argv[2];
  if (mode === '--stage') {
    const directory = await mkdtemp(join(tmpdir(), 'thingtime-preview-fallback-'));
    await mkdir(join(directory, '.vercel/output/static'), { recursive: true });
    await writeFile(join(directory, '.vercel/project.json'), JSON.stringify({ orgId: config.teamId, projectId: config.projectId }));
    await writeFile(join(directory, '.vercel/output/config.json'), JSON.stringify(page.output));
    await writeFile(join(directory, '.vercel/output/static/missing.html'), page.html);
    const args = ['exec', '--yes', '--package=vercel@59.10.0', '--', 'vercel', 'deploy', '--prebuilt', '--archive=tgz',
      '--target=preview', '--yes', '--scope', config.teamSlug, '--cwd', directory,
      '--meta', 'thingtimePreviewFallback=1', '--meta', `thingtimePreviewFallbackContent=${page.digest}`];
    let result;
    try { result = await promisify(execFile)('npm', args, {
      env: { ...process.env, VERCEL_TOKEN: required('VERCEL_API_TOKEN'), VERCEL_ORG_ID: config.teamId, VERCEL_PROJECT_ID: config.projectId },
      timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024
    }); } catch (error) {
      const detail = String(error.stderr ?? '').replaceAll(required('VERCEL_API_TOKEN'), '[redacted]').slice(-2000);
      throw new Error(`Static fallback staging failed; no wildcard was changed. ${detail}`);
    }
    const urls = [...new Set(result.stdout.match(/https:\/\/[a-z0-9-]+\.vercel\.app\b/g) ?? [])];
    if (urls.length !== 1) throw new Error('Ambiguous staging URL; inspect marked Vercel deployments before retrying');
    const url = urls[0];
    const deployment = await request(`/v13/deployments/${new URL(url).hostname}`);
    const issue = fallbackDeploymentIssue(deployment, config, page.digest);
    if (issue) throw new Error(`Staged fallback identity failed: ${issue}`);
    await verifyPage(url);
    console.log(JSON.stringify({ id: deployment.id, url, digest: page.digest, outputDirectory: directory }));
    return;
  }
  if (mode === '--install') {
    const id = process.argv[3];
    if (!/^dpl_[A-Za-z0-9]+$/.test(id ?? '')) throw new Error('Install requires an exact staged deployment ID');
    const deployment = await request(`/v13/deployments/${id}`);
    const issue = fallbackDeploymentIssue(deployment, config, page.digest);
    if (issue) throw new Error(`Staged fallback identity failed: ${issue}`);
    if (!/^[a-z0-9-]+\.vercel\.app$/.test(deployment.url ?? '')) throw new Error('Invalid fallback URL');
    await verifyPage(`https://${deployment.url}`);
    console.log(JSON.stringify(await installFallbackAliases({ request, config, deployment, digest: page.digest })));
    for (const suffix of config.suffixes) await verifyPage(`https://controller-fallback-probe.${suffix}/`);
    console.log('Both preview wildcards serve the verified missing-build page.');
    return;
  }
  throw new Error('Use --stage, then --install <verified-deployment-id>');
};
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
