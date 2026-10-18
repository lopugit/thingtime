import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const script = resolve('.github/scripts/lopu-model-waterfall.mjs');
test('CLI compiles the saved order, keeps keys private, and detects modified helper files', () => {
 const dir = mkdtempSync(join(tmpdir(),'lopu-plan-'));
 try {
  const temp = join(dir,'temp'); mkdirSync(temp);
  const fixture = join(dir,'fixture.mjs');
  writeFileSync(fixture, `globalThis.fetch = async (url, options = {}) => {
   let value;
   if (String(url).includes('capabilities')) value = {schemaVersion:1,origin:'https://example.test',features:{'api.integration-ci-credentials':{version:'1.1.1'},'api.settings-pr-conflict-auto-resolver-model-waterfall':{version:'1.1.0'}}};
   else if (String(url).includes('settings/')) value = {ok:true,key:'Thingtime.PRConflictAutoResolverModelWaterfall',waterfall:['gpt-6-astra:medium','claude-opus-5:high'],models:[{id:'gpt-6-astra',provider:'openai',efforts:['medium']},{id:'claude-opus-5',provider:'anthropic',efforts:['high']}]};
   else { const body=JSON.parse(options.body); value={ok:true,credentials:[{id:body.platform,name:'Account '+body.platform,platform:body.platform,credentialType:body.platform==='OpenAI'?'openai-api-key':'claude-code-oauth-token',value:body.platform==='OpenAI'?'sk-fixture-openai':'sk-ant-oat-fixture'}]}; }
   return new Response(JSON.stringify(value),{status:200});
  };`);
  const env = { ...process.env, GITHUB_WORKSPACE:dir, RUNNER_TEMP:temp, GITHUB_OUTPUT:join(dir,'out'),GITHUB_ENV:join(dir,'env'), GITHUB_RUN_ID:'123', GITHUB_RUN_ATTEMPT:'1',GITHUB_REPOSITORY:'example/project',GITHUB_WORKFLOW_REF:'example/project/.github/workflows/resolve-pr-conflicts.yml@refs/heads/github-actions',THINGTIME_CI_ROUTER_SECRET:'fixture-router',THINGTIME_CREDENTIAL_VAULT_ORIGIN:'https://example.test',LOPU_SANDBOX:'workspace-write',LOPU_SAFETY_STRATEGY:'drop-sudo' };
  const result = spawnSync(process.execPath,['--import',fixture,script,'prepare'],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const root = join(dir,'.lopu-waterfall-action');
  const action = JSON.parse(readFileSync(join(root,'action.yml')));
  const plan = JSON.parse(readFileSync(join(root,'plan.json')));
  assert.deepEqual(plan.map(x=>x.id),['gpt-6-astra:medium','claude-opus-5:high']);
  assert.doesNotMatch(JSON.stringify({action,plan}), /sk-fixture|sk-ant-oat/);
  assert.match(readFileSync(join(dir,'env'),'utf8'), /LOPU_OPENAI_TOKEN_1=sk-fixture-openai/);
  assert.equal(statSync(join(temp,'lopu-openai-vault.json')).mode & 0o777, 0o600);
  const calls = action.runs.steps.filter(s=>s.uses); assert.equal(calls[0].with.model,'gpt-6-astra');assert.equal(calls[0].with.effort,'medium');
  // A prepared action may not execute a helper modified by a prior model.
  writeFileSync(join(root,'lopu-model-waterfall.mjs'),'throw new Error("tampered helper executed")');
  const check = spawnSync('bash',['-e','-o','pipefail','-c',action.runs.steps[0].run],{env:{...env,GITHUB_ACTION_PATH:root},encoding:'utf8'});
  assert.notEqual(check.status,0);assert.doesNotMatch(check.stderr,/tampered helper executed/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

import { claudeProviderErrors } from './lopu-model-waterfall.mjs';
import { classifyClaudeCredentialFailure } from './classify-claude-credential-failure.mjs';
test('quota wording in user, tool, or ordinary assistant text never triggers another model', () => {
 const task = [
  {type:'user',message:'fix the invalid API key message'},
  {type:'assistant',message:{content:[{text:'The test fixture says rate limit reached'}]}},
  {type:'result',is_error:true,subtype:'error_max_turns',num_turns:500,total_cost_usd:1,result:'Discussed HTTP 429'}
 ];
 assert.equal(classifyClaudeCredentialFailure(claudeProviderErrors(task)).retryable,false);
 task.push({type:'result',is_error:true,error:'authentication_error: invalid OAuth token'});
 assert.equal(classifyClaudeCredentialFailure(claudeProviderErrors(task)).retryable,true);
});
