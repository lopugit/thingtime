#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/u;
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });

export function checkDisposition(checks, statuses) {
  const latest = new Map();
  for (const check of checks) {
    const key = `${check.app?.id}:${check.name}`;
    if (!latest.has(key) || latest.get(key).id < check.id) latest.set(key, check);
  }
  const contexts = new Map();
  for (const status of statuses) {
    if (!contexts.has(status.context) || contexts.get(status.context).id < status.id) contexts.set(status.context, status);
  }
  const states = [
    ...[...latest.values()].map((check) => check.status !== 'completed' ? 'pending'
      : ['success', 'neutral', 'skipped'].includes(check.conclusion) ? 'success' : 'failure'),
    ...[...contexts.values()].map((status) => status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : 'failure')
  ];
  if (states.includes('failure')) return 'failure';
  return states.length && states.every((state) => state === 'success') ? 'ready' : 'pending';
}

export async function publishMerge({ repository, pullNumber, head, base, baseSha, run = gh,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 30 }) {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !Number.isSafeInteger(pullNumber) || pullNumber < 1
    || !shaPattern.test(head) || !shaPattern.test(baseSha) || !base) throw new Error('Invalid exact Feature Stack publication identity.');
  const api = (path) => JSON.parse(run(['api', `repos/${repository}/${path}`]));
  const readPull = () => {
    const pull = api(`pulls/${pullNumber}`);
    if (pull.number !== pullNumber || pull.head?.repo?.full_name !== repository || pull.base?.repo?.full_name !== repository
      || pull.head.sha !== head || pull.base.ref !== base) throw new Error('Feature Stack PR identity or verified head changed; rerun against fresh snapshots.');
    return pull;
  };
  let pull = readPull();
  if (pull.merged) return 'merged';
  if (pull.state !== 'open' || pull.draft) throw new Error('Feature Stack PR is closed or draft.');
  try {
    run(['pr', 'merge', String(pullNumber), '--repo', repository, '--auto', '--merge', '--match-head-commit', head]);
  } catch (error) {
    // A write may have succeeded even when its response was lost.
    pull = readPull();
    if (pull.merged) return 'merged';
    if (pull.auto_merge) return 'auto-merge';
    if (!String(error.stderr ?? error.message).includes('Protected branch rules not configured for this branch')) throw error;
    console.log('Auto-merge is unavailable on this target; waiting up to 15 minutes for exact-head checks before a normal merge.');
    const pages = (path) => JSON.parse(run(['api', '--paginate', '--slurp', `repos/${repository}/${path}`]));
    let readyOnce = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      pull = readPull();
      if (pull.merged) return 'merged';
      if (pull.state !== 'open' || pull.draft) throw new Error('Feature Stack PR closed or became draft while waiting.');
      if (pull.auto_merge) return 'auto-merge';
      if (pull.base.sha !== baseSha) throw new Error('Feature Stack target moved; rerun against its new snapshot.');
      if (pull.mergeable === false) throw new Error('Feature Stack PR has merge conflicts.');
      const checks = pages(`commits/${head}/check-runs?filter=latest&per_page=100`).flatMap((page) => {
        if (!Array.isArray(page.check_runs)) throw new Error('Incomplete check-run inventory.');
        return page.check_runs;
      });
      const statuses = pages(`commits/${head}/statuses?per_page=100`).flatMap((page) => {
        if (!Array.isArray(page)) throw new Error('Incomplete status inventory.');
        return page;
      });
      const disposition = checkDisposition(checks, statuses);
      if (disposition === 'failure') throw new Error(`Feature Stack PR #${pullNumber} has failed checks; inspect its checks before retrying.`);
      const ready = disposition === 'ready' && pull.mergeable === true && pull.mergeable_state === 'clean';
      if (ready && readyOnce) {
        try {
          // Ordinary server-enforced merge, never an admin bypass; stale heads fail atomically.
          run(['pr', 'merge', String(pullNumber), '--repo', repository, '--merge', '--match-head-commit', head]);
        } catch (mergeError) {
          if (readPull().merged) return 'merged';
          throw mergeError;
        }
        if (!readPull().merged) throw new Error('GitHub did not confirm the Feature Stack merge.');
        return 'merged';
      }
      readyOnce = ready;
      if (attempt + 1 < attempts) await pause(30_000);
    }
    throw new Error(`Feature Stack PR #${pullNumber} did not become ready within 15 minutes; auto-merge is unavailable. Inspect its checks and rerun publication.`);
  }
  pull = readPull();
  if (pull.merged) return 'merged';
  if (pull.auto_merge) return 'auto-merge';
  throw new Error('GitHub neither merged the Feature Stack nor enabled auto-merge.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await publishMerge({ repository: process.env.REPO, pullNumber: Number(process.argv[2]),
    head: process.argv[3], base: process.env.TARGET_BRANCH, baseSha: process.env.BASE_SHA });
  console.log(`Feature Stack publication: ${result}`);
}
