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
  const r = latest.get('github-actions[bot]');
  if (r?.state !== 'APPROVED' || r.commit_id !== p.head.sha) return false;
  // The approval is bound to the exact reviewed HEAD -- the only tree this ever
  // merges, and the tree every required check in tested() ran against.
  //
  // It is deliberately NOT bound to p.base.sha. GitHub's pulls API reports
  // base.sha as a snapshot of the base branch from the PR's last
  // synchronization, not the live tip, and it is not the baseRefOid the review
  // controller records in the marker. 'develop' advances continuously (979
  // commits past #1254's base.sha while that PR sat clean, approved and
  // green), so requiring equality with either value made every stored approval
  // expire within minutes: Lopu re-approved #1254 four times at one unchanged
  // head and settlement still reported needs-review. Base freshness is not
  // this function's job and is still enforced, in the two places that can do
  // it correctly: mergeable_state 'behind' is rejected by the allowlist in
  // settle() whenever a ruleset requires an up-to-date branch, and the live
  // base tip is held fixed across the whole settlement below. Keep requiring a
  // well-formed base token so a truncated or hand-edited marker still fails.
  const marker = /<!-- thingtime-lopu-merge-ready:v1 head=([0-9a-f]{40}) base=[0-9a-f]{40} -->/u.exec(r.body || '');
  return marker?.[1] === p.head.sha;
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
  // Read the base branch's LIVE tip and fence it against itself for the rest of
  // the settlement, rather than against the stale pulls-API p.base.sha. This
  // still aborts if the base moves mid-decision -- the actual race this guards
  // -- but is satisfiable on a base branch that receives commits, which the
  // previous equality check was not (it returned 'changed' forever).
  const liveBase = async p => {
    const ref = await api(`git/ref/heads/${encodeURIComponent(p.base.ref)}`);
    if (!sha.test(ref.object?.sha || '')) throw new Error('Incomplete base ref');
    return ref.object.sha;
  };
  const liveHead = async p => {
    const ref = await api(`git/ref/heads/${encodeURIComponent(p.head.ref)}`);
    return ref.object?.sha === p.head.sha;
  };
  const baseTip = await liveBase(initial);
  const liveRefs = async p => await liveHead(p) && await liveBase(p) === baseTip;
  const inspect = async () => {
    const p = await api(path);
    if (!eligible(p, repo) || identity(p) !== identity(initial) || !await liveRefs(p)) return 'changed';
    if (managed(p) && redundant(p, await api(`${path}/files?per_page=100`, 'pages'))) return 'close';
    // 'unstable' means mergeable with a non-passing NON-required check. That is
    // already rejected by tested() below, which is the intended gate: besides
    // naming every required context it requires checkDisposition() === 'ready',
    // i.e. every check run AND commit status on the head is success/neutral/
    // skipped. So demanding 'clean' here only duplicated that gate, while being
    // stricter than the rulesets and relying on a field GitHub computes
    // asynchronously. Keep rejecting 'blocked' (required check or review unmet),
    // 'behind' (strict_required_status_checks_policy), 'dirty', 'draft' and
    // 'unknown' -- this is an allowlist, so any state GitHub adds later is
    // rejected until it is reviewed and added here.
    //
    // This deliberately does NOT make a red third-party check mergeable:
    // checkDisposition() does not filter by app, so the GitHub Advanced Security
    // aggregate 'CodeQL' concluding timed_out still yields 'checks-not-ready'
    // (PR #832 head 08d4c5f7 has exactly 1 of 54 latest check runs red -- that
    // aggregate -- and tested() is false there). Exempting third-party apps
    // would also make GitGuardian advisory, so that is out of scope here; a
    // terminal GHAS aggregate verdict is cleared by a new head SHA, which earns
    // a fresh aggregate suite.
    if (p.mergeable !== true || !['clean', 'unstable'].includes(p.mergeable_state)) return 'not-current';
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
export function selectPulls(pulls, prNumber = '', branch = '') {
  if (prNumber && !/^[1-9][0-9]*$/.test(prNumber)) throw new Error('Invalid PR selector');
  if (branch.length > 255 || /[\r\n\0]/.test(branch)) throw new Error('Invalid branch selector');
  return pulls.filter(p => prNumber ? p.number === Number(prNumber)
    : !branch || p.head?.ref === branch || p.base?.ref === branch);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.REPO;
  if (repo !== 'lopugit/thingtime') throw new Error('Lifecycle is authorized only for lopugit/thingtime');
  const client = github(repo);
  const pulls = await client.api('pulls?state=open&per_page=100', 'pages');
  for (const p of selectPulls(pulls, process.env.PR_NUMBER, process.env.BRANCH)) {
    try { console.log(`#${p.number}: ${await settle({ repo, number: p.number, ...client, apply: process.argv.includes('--apply') })}`); }
    catch { console.error(`::warning::PR #${p.number} settlement deferred: incomplete evidence or rejected write.`); process.exitCode = 1; }
  }
}
