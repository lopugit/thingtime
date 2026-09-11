import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseResolution, requestResolution, mergeWithWaterfall } from './feature-stack-waterfall.mjs';
import { canonicalFeatureStackPlan, decodeFeatureStackPlan, verifyFeatureStackHistory } from './feature-stack-plan.mjs';
const config = { version: 1, entries: [ { endpointId: 'server:openai', modelId: 'gpt-5.6-sol', effort: 'high', speed: 'normal' }, { endpointId: 'vault:custom', modelId: 'custom/model', effort: null, speed: 'normal' }, { endpointId: 'server:anthropic', modelId: 'claude-opus-5', effort: 'max', speed: 'normal' } ] };
const metadata = { autoDecideBranches: true, autoMerge: true, name: 'Test', runId: 'feature-stack-run-11111111-1111-4111-8111-111111111111', stackId: 'ci-feature-stack-11111111-1111-4111-8111-111111111111', targets: ['develop'], version: 4, modelWaterfall: config };
test('mixed provider selection survives canonical envelope and rejects hidden keys', () => {
  const plan = canonicalFeatureStackPlan({ autoDecideBranches: true, autoMerge: true, name: metadata.name, runId: metadata.runId, sources: [{ base: 'develop', head: 'feature', pr: 1, sha: 'a'.repeat(40), targets: ['develop'], title: 'Feature' }], stackId: metadata.stackId, targets: metadata.targets, version: 4, modelWaterfall: config });
  assert.deepEqual(decodeFeatureStackPlan(Buffer.from(JSON.stringify(plan)).toString('base64')), plan);
  assert.throws(() => canonicalFeatureStackPlan({ ...plan, modelWaterfall: { ...config, token: 'secret' } }));
});
test('AI text can modify only the exact conflict set and must resolve markers', () => {
  assert.deepEqual(parseResolution('{"file":"resolved"}', ['file']), { file: 'resolved' });
  assert.throws(() => parseResolution('{"file":"resolved","../outside":"bad"}', ['file']));
  assert.throws(() => parseResolution('{"file":"<<<<<<< HEAD\\nbad"}', ['file']));
});
test('runner follows only explicit availability receipts across providers', async () => {
  const calls = [];
  const env = { THINGTIME_CI_ROUTER_SECRET: 'test-key', GITHUB_REPOSITORY: 'example/repo', GITHUB_WORKFLOW_REF: 'example/repo/.github/workflows/resolve-pr-conflicts.yml@refs/heads/develop', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' };
  const fetcher = async (_, init) => { const body = JSON.parse(init.body); calls.push(body.index); assert.equal(Object.hasOwn(body, 'modelWaterfall'), false); return calls.length < 3 ? Response.json({ ok: false, unavailable: true }, { status: 503 }) : Response.json({ ok: true, text: 'done' }); };
  assert.equal(await requestResolution(metadata, 'prompt', env, fetcher), 'done'); assert.deepEqual(calls, [0,1,2]);
  calls.length = 0;
  await assert.rejects(requestResolution(metadata, 'prompt', env, async () => { calls.push(0); return Response.json({ ok: false }, { status: 403 }); })); assert.equal(calls.length, 1);
});
test('real conflicting git merges preserve exact parents and conflict-only edits', async () => {
  const cwd = process.cwd(); const dir = mkdtempSync(join(tmpdir(), 'stack-waterfall-'));
  const git = (...args) => execFileSync('git', ['-c','core.hooksPath=/dev/null','-c','user.name=Test','-c','user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  try {
    git('init','-q'); writeFileSync(join(dir,'file.txt'), 'base\n'); git('add','.'); git('commit','-qm','base'); const base = git('rev-parse','HEAD');
    const sources = [];
    for (const [index, value] of ['left','right'].entries()) { git('checkout','--detach',base); git('checkout','-b',`feature-${index}`); writeFileSync(join(dir,'file.txt'), value+'\n'); git('commit','-qam',value); sources.push({ base:'develop',head:`feature-${index}`,pr:index+1,sha:git('rev-parse','HEAD'),targets:['develop'],title:value }); }
    git('checkout','--detach',base); process.chdir(dir);
    const plan = canonicalFeatureStackPlan({ autoDecideBranches: true, autoMerge: true, name: metadata.name, runId: metadata.runId, sources, stackId: metadata.stackId, targets: ['develop'], version:4,modelWaterfall:config });
    let attempts = 0; await mergeWithWaterfall(plan,'develop',{ complete: async (_, prompt) => { attempts++; assert.match(prompt,/left/); assert.match(prompt,/right/); return JSON.stringify({'file.txt':'left\nright\n'}); } });
    assert.equal(attempts,1); assert.equal(readFileSync('file.txt','utf8'),'left\nright\n'); assert.equal(verifyFeatureStackHistory(plan,'develop',base).commits.length,2); assert.equal(git('status','--porcelain'),'');
  } finally { process.chdir(cwd); rmSync(dir,{recursive:true,force:true}); }
});
