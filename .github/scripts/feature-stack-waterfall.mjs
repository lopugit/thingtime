#!/usr/bin/env node
// The model only returns conflict-file text. Git operations and path admission
// remain trusted, deterministic, and independently verified by the existing gate.
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalFeatureStackPlan } from './feature-stack-plan.mjs';

const ORIGIN = 'https://thingtime.com';
export function parseResolution(text, paths) {
  const result = JSON.parse(text.replace(/^```(?:json)?\s*\n/u, '').replace(/\n```\s*$/u, ''));
  if (!result || Array.isArray(result) || typeof result !== 'object' || Object.keys(result).length !== paths.length || paths.some(path => !Object.hasOwn(result, path))) throw new Error('AI response must cover exactly the conflicted paths');
  for (const path of paths) if (typeof result[path] !== 'string' || result[path].includes('\0') || /^(?:<<<<<<< |=======\s*$|>>>>>>> )/mu.test(result[path])) throw new Error('AI response contains unresolved or invalid content');
  return result;
}
export async function requestResolution(plan, prompt, env = process.env, fetchImpl = fetch) {
  for (let index = 0; index < plan.modelWaterfall.entries.length; index++) {
    const entry = plan.modelWaterfall.entries[index];
    const body = JSON.stringify({ repository: env.GITHUB_REPOSITORY, workflowRef: env.GITHUB_WORKFLOW_REF, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, nonce: randomBytes(24).toString('hex'), requestedAt: new Date().toISOString(), featureStackRunId: plan.runId, index, prompt });
    const signature = `sha256=${createHmac('sha256', env.THINGTIME_CI_ROUTER_SECRET).update(body).digest('hex')}`;
    // A lost gateway response has an uncertain outcome: stop, never retry it
    // or advance. Only the gateway's explicit unavailable receipt permits that.
    const response = await fetchImpl(`${ORIGIN}/api/v1/integrations/ci/stack-completion`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-thingtime-ci-signature': signature }, body, signal: AbortSignal.timeout(105_000), redirect: 'error' });
    const data = await response.json();
    if (response.ok && data.ok === true && typeof data.text === 'string') return data.text;
    if (response.status === 503 && data.unavailable === true) { console.log(`AI attempt ${index + 1} unavailable (${entry.modelId}); advancing.`); continue; }
    throw new Error(`Stack AI request rejected (${response.status})`);
  }
  throw new Error('Every selected AI endpoint/model is unavailable');
}
export async function mergeWithWaterfall(plan, target, options = {}) {
  canonicalFeatureStackPlan(plan);
  if (!plan.modelWaterfall || !plan.targets.includes(target)) throw new Error('Invalid waterfall target');
  // Do not let hooks/filters from untrusted branches execute with CI secrets.
  const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Lopu', '-c', 'user.email=lopu@users.noreply.github.com', ...args], { encoding: 'utf8', env: childEnv, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  if (git('status', '--porcelain')) throw new Error('Integration worktree must start clean');
  const root = realpathSync('.');
  for (const source of plan.sources.filter(source => source.targets.includes(target))) {
    try { git('merge', '--no-ff', '--no-commit', source.sha); }
    catch (error) { if (!git('diff', '--name-only', '--diff-filter=U')) throw error; }
    const paths = git('diff', '--name-only', '--diff-filter=U', '-z').split('\0').filter(Boolean);
    if (paths.length) {
      const files = {};
      for (const path of paths) {
        const absolute = resolve(root, path);
        if (!absolute.startsWith(root + sep) || path.split('/').includes('.git') || !lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute) throw new Error('Unsupported conflict path; manual resolution required');
        const content = readFileSync(absolute);
        if (content.includes(0) || content.length > 90_000) throw new Error('Conflict file exceeds the text resolver limit');
        files[path] = new TextDecoder('utf-8', { fatal: true }).decode(content);
      }
      const prompt = JSON.stringify({ sourcePr: source.pr, target, files });
      if (prompt.length > 120_000) throw new Error('Conflict batch exceeds the AI transport limit');
      const result = parseResolution(await (options.complete ?? requestResolution)(plan, prompt), paths);
      for (const path of paths) writeFileSync(path, result[path]);
      git('add', '--', ...paths);
    }
    git('commit', '-m', `Merge PR #${source.pr}\n\nFeature-Stack-Source: pr=${source.pr} head=${source.sha}`);
  }
}
async function main() {
  if (!process.env.THINGTIME_CI_ROUTER_SECRET) throw new Error('The selected endpoint waterfall requires the CI router');
  const response = await fetch(`${ORIGIN}/.well-known/thingtime-capabilities.json`, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  const manifest = await response.json();
  const version = manifest.features?.['api.ci-stack-completion']?.version;
  if (!response.ok || manifest.schemaVersion !== 1 || manifest.origin !== ORIGIN || !/^1\.\d+\.\d+$/.test(version ?? '')) throw new Error('Stack completion capability is unavailable');
  await mergeWithWaterfall(canonicalFeatureStackPlan(JSON.parse(readFileSync(process.argv[2], 'utf8'))), process.argv[3]);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Selected AI waterfall did not complete the stack. No merge is published.'); process.exitCode = 1; });
