import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseWaterfall, orderedAttempts, compileAction, taskClaudeArgs, acceptsCapabilities, retryableOpenAiError } from './lopu-model-waterfall.mjs';
const models = [{ id: 'claude-opus-5', provider: 'anthropic', efforts: ['high','medium'] }, { id: 'gpt-6-astra', provider: 'openai', efforts: ['medium','high'] }, { id: 'gpt-5.6-sol', provider: 'openai', efforts: ['high'] }];
const setting = waterfall => ({ ok: true, key: 'Thingtime.PRConflictAutoResolverModelWaterfall', waterfall, models });
for (const workflow of ['resolve-pr-conflicts', 'rebase-pr-stacks', 'all-branch']) test(`${workflow}: reads the shared DB waterfall helper`, () => {
 const source = readFileSync(new URL(`../workflows/${workflow}.yml`, import.meta.url), 'utf8');
 assert.match(source, /lopu-model-waterfall\.mjs" metadata/);
 assert.doesNotMatch(source, /https:\/\/thingtime.com\/api\/v1\/settings\/pr-conflict-auto-resolver-model-waterfall/);
});
test('mixed providers, reverse order and reasoning variants retain exact administrator order', () => {
 for (const order of [['claude-opus-5:high','gpt-6-astra:medium'],['gpt-6-astra:medium','claude-opus-5:high','gpt-6-astra:high'],['gpt-5.6-sol:high']]) {
  const plan = parseWaterfall(setting(order)); assert.deepEqual(plan.map(x => x.id), order);
  const attempts = orderedAttempts(plan, { Anthropic: [{name:'a'},{name:'b'}], OpenAI: [{name:'c'}] });
  assert.deepEqual(attempts.map(x => [x.id,x.slot]), plan.flatMap(x => x.backend === 'claude' ? [[x.id,1],[x.id,2]] : [[x.id,1]]));
  const actions = compileAction(attempts).runs.steps.filter(x => x.uses);
  assert.deepEqual(actions.map(x => x.with.model ?? attempts[actions.indexOf(x)].model), attempts.map(x => x.model));
  assert.equal(actions.length, attempts.length);
 }
});
test('no unconfigured model or substituted reasoning is admitted', () => {
 for (const order of [[],['unknown:high'],['gpt-6-astra:bogus'],['gpt-6-astra:medium:high'],['gpt-6-astra:medium','gpt-6-astra:medium'],['--model=evil'],['gpt-6-astra:fast']]) assert.throws(() => parseWaterfall(setting(order)));
 assert.deepEqual(parseWaterfall(setting(['claude-opus-5'])).map(x => x.effort), ['']);
 assert.equal(taskClaudeArgs('--max-turns 100 --model old --fallback-model other --effort max --allowedTools Bash'), '--max-turns 100    --allowedTools Bash');
});
test('missing credentials preserve the model entry and advances only with explicit classification', () => {
 const attempts = orderedAttempts(parseWaterfall(setting(['gpt-6-astra:medium','claude-opus-5:high'])), {});
 assert.deepEqual(attempts.map(x => x.slot), [0,0]);
 const steps = compileAction(attempts, {'plan.json':'a'.repeat(64)}).runs.steps;
 assert.match(steps.find(x => x.id === 'check_1').if, /result_0.outputs.retryable == 'true'/);
 assert.match(steps[0].run, /sha256sum --check --status/);
 assert.equal(steps.find(x => x.id === 'agent_0').with.effort, 'medium');
});
test('manifest origin and semantic versions fence credential-dependent operations', () => {
 const manifest = { schemaVersion: 1, origin: 'https://example.test', features: { 'api.settings-pr-conflict-auto-resolver-model-waterfall': {version:'1.1.0'}, 'api.integration-ci-credentials': {version:'1.1.1'} } };
 assert.equal(acceptsCapabilities(manifest, manifest.origin), true);
 assert.equal(acceptsCapabilities(manifest, 'https://other.test'), false);
 manifest.features['api.integration-ci-credentials'].version = '2.0.0'; assert.equal(acceptsCapabilities(manifest, manifest.origin), false);
});
test('only explicit provider rejections advance preflight; task or network failures do not', () => {
 for (const status of [401,403,429,500,502,503,504]) assert.equal(retryableOpenAiError(status), true);
 assert.equal(retryableOpenAiError(404,'model_not_found'), true);
 for (const status of [400,404,408,0]) assert.equal(retryableOpenAiError(status), false);
});
