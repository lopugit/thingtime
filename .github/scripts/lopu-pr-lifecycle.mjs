#!/usr/bin/env node
// Trusted, metadata-only settlement. Never check out or execute a PR head.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkDisposition } from './feature-stack-publish-merge.mjs';

const sha = /^[0-9a-f]{40}$/u;
const targets = new Set(['main', 'develop', 'github-actions']);
const pauses = new Set(['no-ai-merge', 'ai-merge-paused', 'ai-rebase-paused', 'ai-rebase-in-progress', 'do-not-merge']);
export function eligible(p, repo) {
  return p.state === 'open' && p.draft === false && p.head?.repo?.full_name === repo
    && p.base?.repo?.full_name === repo && targets.has(p.base.ref)
    && !targets.has(p.head.ref) && p.head.ref !== 'all'
    && sha.test(p.head.sha) && sha.test(p.base.sha) && Array.isArray(p.labels)
    && !p.labels.some(l => pauses.has(l.name));
}
function managed(p) {
  return p.head.ref.startsWith('promote/pr-') && /<!-- promotion-of: \d+ -->/u.test(p.body || '')
    || p.head.ref.startsWith('lopu/feature-stack-') && (p.body || '').includes('Feature Stack id:');
}
export function redundant(p, files) {
  // Only known generated integration PRs. A deliberate Graphify maintenance
  // PR is useful work, and a truncated/absent file listing proves nothing.
  return managed(p) && Number.isSafeInteger(p.changed_files) && p.changed_files === files.length
    && files.every(f => typeof f.filename === 'string' && f.filename.startsWith('graphify-out/')
      && (!f.previous_filename || f.previous_filename.startsWith('graphify-out/')));
}
export function approved(p, reviews) {
  const latest = new Map();
  for (const review of reviews) {
    if (!review.user?.login || !Number.isSafeInteger(review.id)) throw new Error('Incomplete reviews');
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    if (!latest.has(review.user.login) || latest.get(review.user.login).id < review.id) latest.set(review.user.login, review);
  }
  if ([...latest.values()].some(r => r.state === 'CHANGES_REQUESTED')) return false;
  const marker = `<!-- thingtime-lopu-merge-ready:v1 head=${p.head.sha} base=${p.base.sha} -->`;
  const r = latest.get('github-actions[bot]');
  return r?.state === 'APPROVED' && r.commit_id === p.head.sha && (r.body || '').includes(marker);
}
export function tested(checks, statuses, base) {
  const latest = new Map();
  for (const c of checks) {
    const key = `${c.app?.id}:${c.name}`;
    if (!latest.has(key) || latest.get(key).id < c.id) latest.set(key, c);
  }
  const passed = [...latest.values()].filter(c => c.app?.slug === 'github-actions' && c.status === 'completed' && c.conclusion === 'success');
  const has = name => passed.some(c => c.name === name || c.name === `control-plane / ${name}`);
  const build = base === 'github-actions' ? has('verify')
    : has('Build + typecheck ratchet + unit tests') && has('API suite (headless /tests runner)');
  return build && has('Analyze (actions)') && (base === 'github-actions' || has('Analyze (javascript-typescript)'))
    && checkDisposition(checks, statuses) === 'ready';
}
const identity = p => JSON.stringify([p.number, p.head?.repo?.full_name, p.head?.ref, p.head?.sha,
  p.base?.repo?.full_name, p.base?.ref, p.base?.sha, p.updated_at]);

export async function settle({ repo, number, api, threads, apply = false }) {
  if (repo !== 'lopugit/thingtime' || !Number.isSafeInteger(number) || number < 1) throw new Error('Unauthorized lifecycle scope');
  const path = `pulls/${number}`;
  const initial = await api(path);
  if (!eligible(initial, repo)) return 'ineligible';
  const liveRefs = async p => {
    const baseRef = await api(`git/ref/heads/${encodeURIComponent(p.base.ref)}`);
    const headRef = await api(`git/ref/heads/${encodeURIComponent(p.head.ref)}`);
    return baseRef.object?.sha === p.base.sha && headRef.object?.sha === p.head.sha;
  };
  const inspect = async () => {
    const p = await api(path);
    if (!eligible(p, repo) || identity(p) !== identity(initial) || !await liveRefs(p)) return 'changed';
    if (managed(p) && redundant(p, await api(`${path}/files?per_page=100`, 'pages'))) return 'close';
    if (p.mergeable !== true || p.mergeable_state !== 'clean') return 'not-current';
    if (!approved(p, await api(`${path}/reviews?per_page=100`, 'pages'))) return 'needs-review';
    if (await threads(number)) return 'unresolved-review';
    const checks = await api(`commits/${p.head.sha}/check-runs?filter=latest&per_page=100`, 'checks');
    const statuses = await api(`commits/${p.head.sha}/statuses?per_page=100`, 'pages');
    return tested(checks, statuses, p.base.ref) ? 'merge' : 'checks-not-ready';
  };
  const decision = await inspect();
  if (!['close', 'merge'].includes(decision) || !apply) return decision;
  // Two complete snapshots, then a final identity fence. No administrator
  // bypass or auto-merge queue; the server also atomically checks the head.
  if (await inspect() !== decision) return 'changed';
  const final = await api(path);
  if (!eligible(final, repo) || identity(final) !== identity(initial) || !await liveRefs(final)) return 'changed';
  try {
    if (decision === 'close') await api(path, 'PATCH', { state: 'closed' });
    else await api(`${path}/merge`, 'PUT', { sha: initial.head.sha, merge_method: 'merge' });
  } catch (error) {
    const result = await api(path);
    if (decision === 'merge' ? !result.merged : result.state !== 'closed') throw error;
  }
  const result = await api(path);
  if (decision === 'merge' ? !result.merged : result.state !== 'closed') throw new Error('Settlement unconfirmed');
  return decision === 'merge' ? 'merged' : 'closed-redundant';
}

export function github(repo) {
  const run = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  const api = async (path, mode, body) => {
    const args = ['api', `repos/${repo}/${path}`];
    if (mode === 'pages' || mode === 'checks') {
      const pages = run([...args, '--paginate', '--slurp']);
      if (!Array.isArray(pages) || !pages.length) throw new Error('Missing pages');
      if (mode === 'checks') {
        if (pages.some(p => !Array.isArray(p.check_runs))) throw new Error('Missing checks');
        const checks = pages.flatMap(p => p.check_runs);
        if (checks.length !== pages[0].total_count) throw new Error('Incomplete checks');
        return checks;
      }
      if (pages.some(p => !Array.isArray(p))) throw new Error('Invalid pages');
      return pages.flat();
    }
    if (mode) args.push('--method', mode);
    for (const [key, value] of Object.entries(body || {})) args.push('-f', `${key}=${value}`);
    return run(args);
  };
  const threads = async number => {
    let cursor = null;
    for (;;) {
      const query = 'query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}';
      const [owner, name] = repo.split('/');
      const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`];
      if (cursor) args.push('-f', `cursor=${cursor}`);
      const result = run(args);
      const t = result.data?.repository?.pullRequest?.reviewThreads;
      if (result.errors || !Array.isArray(t?.nodes) || typeof t.pageInfo?.hasNextPage !== 'boolean'
        || t.nodes.some(n => typeof n?.isResolved !== 'boolean')) throw new Error('Incomplete review threads');
      if (t.nodes.some(n => !n.isResolved)) return true;
      if (!t.pageInfo.hasNextPage) return false;
      if (!t.pageInfo.endCursor || t.pageInfo.endCursor === cursor) throw new Error('Invalid review cursor');
      cursor = t.pageInfo.endCursor;
    }
  };
  return { api, threads };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.REPO;
  if (repo !== 'lopugit/thingtime') throw new Error('Lifecycle is authorized only for lopugit/thingtime');
  const client = github(repo);
  const pulls = await client.api('pulls?state=open&per_page=100', 'pages');
  for (const p of pulls) {
    try { console.log(`#${p.number}: ${await settle({ repo, number: p.number, ...client, apply: process.argv.includes('--apply') })}`); }
    catch { console.error(`::warning::PR #${p.number} settlement deferred: incomplete evidence or rejected write.`); process.exitCode = 1; }
  }
}
