// Static, credential-free fallback for preview hostnames with no exact alias.
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const FALLBACK_BRANCH = 'github-actions';
export const FALLBACK_MARKER = 'thingtime-preview-missing-v1';
export const FALLBACK_HEADER = 'x-thingtime-preview';
const hash = (text) => createHash('sha256').update(text).digest('base64');

export function fallbackPage({ repository, suffixes, rootStatus = 200 }) {
  if (![200, 404].includes(rootStatus)) throw new Error('Invalid missing-page root status');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Array.isArray(suffixes) || suffixes.length !== 2
    || suffixes.some((suffix) => !/^previews\.(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(suffix))
    || new Set(suffixes).size !== 2) throw new Error('Invalid preview fallback scope');
  const script = `const suffixes = ${JSON.stringify(suffixes)};
const host = window.location.hostname;
const suffix = suffixes.find(value => host.endsWith('.' + value));
const label = suffix ? host.slice(0, -(suffix.length + 1)) : '';
const match = /^pr-([1-9][0-9]*)$/.exec(label);
if (match) {
  document.getElementById('context').textContent = 'PR #' + match[1] + ' · ' + (suffix === suffixes[0] ? 'Develop preview' : 'Production preview');
  document.getElementById('pull-request').href = 'https://github.com/${repository}/pull/' + match[1];
}
document.getElementById('retry').addEventListener('click', () => window.location.reload());`;
  const style = `*{box-sizing:border-box}body{margin:0;min-height:100svh;background:#fafafa;color:#171717;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;padding:40px 24px}main{width:100%;max-width:580px}.brand{font-weight:650;font-size:15px;letter-spacing:-.02em;display:flex;align-items:center;gap:9px;margin-bottom:56px}.mark{width:20px;height:20px;border-radius:6px;background:#171717;color:white;display:grid;place-items:center;font-size:12px}.eyebrow{font-size:13px;color:#737373;margin:0 0 12px}h1{font-size:clamp(30px,6vw,42px);font-weight:600;line-height:1.15;letter-spacing:-.04em;margin:0 0 22px}p{color:#525252;margin:0 0 16px}.hint{font-size:14px;color:#737373}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}a,button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 17px;border-radius:8px;font:inherit;font-size:14px;font-weight:550;cursor:pointer;text-decoration:none}a{background:#171717;color:white;border:1px solid #171717}button{background:white;color:#262626;border:1px solid #d4d4d4}a:hover{background:#333}button:hover{background:#f5f5f5}a:focus-visible,button:focus-visible{outline:3px solid #8b5cf6;outline-offset:4px}footer{margin-top:48px;padding-top:20px;border-top:1px solid #e5e5e5;font-size:12px;color:#737373}@media(max-width:480px){body{padding:32px 22px}.brand{margin-bottom:40px}.actions>*{flex:1;white-space:nowrap}}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>[Preview] No build found · Thingtime</title>
<style>${style}</style></head><body><main data-preview-state="${FALLBACK_MARKER}">
<div class="brand"><span class="mark" aria-hidden="true">t</span>Thingtime <span style="font-weight:400;color:#737373">/ previews</span></div>
<p class="eyebrow" id="context">Preview unavailable</p>
<h1>No preview build found</h1>
<p>There isn’t a published preview at this address yet.</p>
<p class="hint">The build may be queued, running, failed, or removed after the pull request closed. Check the pull request for its latest preview status and links.</p>
<div class="actions"><a id="pull-request" href="https://github.com/${repository}/pulls" rel="noreferrer">Open pull request ↗</a><button id="retry" type="button">Try again</button></div>
<footer>This address is reserved for a PR preview. You haven’t been redirected to the live site.</footer>
</main><script>${script}</script></body></html>`;
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    [FALLBACK_HEADER]: 'missing',
    'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${hash(style)}' 'unsafe-hashes' 'sha256-${hash('font-weight:400;color:#737373')}'; script-src 'sha256-${hash(script)}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  // Directory listings can replace any 404 at "/" (including edge responses).
  // Keep that project-wide setting untouched: the root is a marked soft 404,
  // all other paths are real 404s. Publishers reject the marker at any status.
  // Projects without directory listings can opt into a true root 404.
  const output = { version: 3, routes: [
    { src: '/', dest: '/missing.html', status: rootStatus, headers },
    { src: '/(.*)', dest: '/missing.html', status: 404, headers }
  ] };
  return { html, headers, output, digest: createHash('sha256').update(html + JSON.stringify(output)).digest('hex') };
}

export function fallbackResponseIssue(response, body) {
  if (![200, 404].includes(response.status)) return 'unexpected-status';
  if (response.headers.get(FALLBACK_HEADER) !== 'missing') return 'missing-header';
  if (!response.headers.get('cache-control')?.includes('no-store')) return 'cacheable';
  if (!body.includes(`data-preview-state="${FALLBACK_MARKER}"`)) return 'wrong-page';
  return null;
}

export function publishedPreviewResponseIssue(response) {
  if (response.headers.get(FALLBACK_HEADER) === 'missing') return 'missing-build';
  // Explicit authentication challenges are valid for protected previews.
  if ((response.status >= 200 && response.status < 400) || [401, 403].includes(response.status)) return null;
  return `http-${response.status}`;
}

export async function verifyPublishedPreview(url, { fetcher = fetch, pause = delay } = {}) {
  let reason = 'unreachable';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetcher(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      reason = publishedPreviewResponseIssue(response);
      if (!reason) return;
    } catch { reason = 'unreachable'; }
    if (attempt < 4) await pause(1000 * (attempt + 1));
  }
  throw new Error(`Published PR preview alias did not pass HTTPS verification (${reason})`);
}

export function fallbackDeploymentIssue(deployment, { projectId }, digest) {
  if (!/^dpl_[A-Za-z0-9]+$/.test(deployment?.id ?? '') || deployment.projectId !== projectId) return 'wrong-project';
  if (deployment.readyState !== 'READY' || deployment.target === 'production') return 'not-safe-ready-preview';
  if (deployment.meta?.thingtimePreviewFallback !== '1' || deployment.meta?.thingtimePreviewFallbackContent !== digest) return 'wrong-content';
  if (deployment.meta?.thingtimeDevelopPrPreview || deployment.meta?.thingtimeAdminPrPreview) return 'pr-deployment';
  return null;
}

export function fallbackDomainIssue(domain, { projectId, suffix, previousBranch }) {
  if (domain?.projectId !== projectId || domain?.name !== `*.${suffix}` || domain.verified !== true) return 'wrong-domain';
  if (domain.redirect || domain.customEnvironmentId) return 'unexpected-binding';
  if (![previousBranch, FALLBACK_BRANCH].includes(domain.gitBranch ?? null)) return 'unexpected-branch';
  return null;
}

export async function installFallbackAliases({ request, config, deployment, digest }) {
  const issue = fallbackDeploymentIssue(deployment, config, digest);
  if (issue) throw new Error(`Refusing fallback installation: ${issue}`);
  const inventory = [];
  // Validate both exact wildcard targets before the first write.
  for (const [index, suffix] of config.suffixes.entries()) {
    const alias = `*.${suffix}`, path = `/v9/projects/${config.projectId}/domains/${encodeURIComponent(alias)}`;
    const domain = await request(path);
    const problem = fallbackDomainIssue(domain, { projectId: config.projectId, suffix, previousBranch: index === 0 ? 'develop' : null });
    if (problem) throw new Error(`Refusing wildcard change: ${problem}`);
    inventory.push({ alias, path, domain });
  }
  for (const { alias, path, domain } of inventory) {
    if (domain.gitBranch !== FALLBACK_BRANCH) {
      try { await request(path, { method: 'PATCH', body: { gitBranch: FALLBACK_BRANCH } }); }
      catch (error) { if ((await request(path)).gitBranch !== FALLBACK_BRANCH) throw error; }
    }
    const aliasPath = `/v4/aliases/${encodeURIComponent(alias)}?projectId=${config.projectId}`;
    let current = await request(aliasPath, { accept: [200, 404] });
    if (current?.deploymentId !== deployment.id) {
      try { await request(`/v2/deployments/${deployment.id}/aliases`, { method: 'POST', body: { alias } }); }
      catch (error) { if ((await request(aliasPath))?.deploymentId !== deployment.id) throw error; }
    }
    current = await request(aliasPath);
    const configured = await request(path);
    if (current?.deploymentId !== deployment.id || current?.projectId !== config.projectId
      || current?.alias !== alias || configured.gitBranch !== FALLBACK_BRANCH) throw new Error('Wildcard read-back failed');
  }
  return inventory.map(({ alias, domain }) => ({ alias, previousBranch: domain.gitBranch ?? null, branch: FALLBACK_BRANCH, deploymentId: deployment.id }));
}
