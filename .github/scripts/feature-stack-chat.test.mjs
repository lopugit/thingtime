import assert from 'node:assert/strict';
import test from 'node:test';
import { answerCommand, safeRunContext, serveRunChat } from './feature-stack-chat.mjs';
import { progressSnapshot } from './feature-stack-progress.mjs';
test('responder has no tools, repository, shared HOME, or runner credentials', () => {
  const command = answerCommand({ model: 'test', token: 'model-token', home: '/tmp/isolated', cwd: '/tmp/isolated', prompt: 'hello' });
  assert.equal(command.args[command.args.indexOf('--tools') + 1], '');
  assert.ok(command.args.includes('--strict-mcp-config'));
  assert.ok(command.args.includes('--disable-slash-commands'));
  assert.equal(command.options.env.GH_TOKEN, undefined);
  assert.equal(command.options.env.THINGTIME_CI_ROUTER_SECRET, undefined);
  assert.equal(command.options.env.HOME, '/tmp/isolated');
});
test('safe run context excludes raw logs, secrets and source content', () => {
  const result = safeRunContext({ jobs: [{ name: 'Merge Feature Stack into main', logs: 'secret', token: 'secret', steps: [{ name: 'Publish', status: 'in_progress', secret: 'secret' }] }], prs: [{ body: 'private', base: { ref: 'main' }, number: 1, mergeable_state: 'dirty' }], at: 'now' });
  assert.ok(!JSON.stringify(result).includes('secret')); assert.ok(!JSON.stringify(result).includes('private'));
});
test('uncertain reply delivery retries the same lease without answering twice', async () => {
  const state = { done: false, context: {} }; const replies = []; let calls = 0; let answers = 0;
  await serveRunChat({}, state, { pause: async () => {}, answer: async () => { answers++; return 'Waiting for checks.'; }, exchange: async (_scope, reply) => {
    calls++; replies.push(reply);
    if (calls === 1) return { id: 'q', lease: 'lease', question: 'why' };
    if (calls === 2) throw new Error('Network reply lost');
    state.done = true; return null;
  } });
  assert.equal(answers, 1); assert.deepEqual(replies[1], replies[2]);
});
test('waiting gates and failed workers do not masquerade as active model work', () => {
  const snapshot = progressSnapshot({ targets: ['main', 'develop'], startedAt: Date.now(), jobs: [
    { name: 'Merge Feature Stack into main', status: 'completed', conclusion: 'success' },
    { name: 'Confirm Feature Stack merged into main', status: 'in_progress' },
    { name: 'Merge Feature Stack into develop', status: 'completed', conclusion: 'failure' }
  ] });
  assert.equal(snapshot.targets[0].status, 'waiting'); assert.equal(snapshot.targets[1].status, 'failure');
  assert.match(snapshot.message, /0 working/); assert.equal(snapshot.expectedFinishAt, null);
});

test('target PR lookup is scoped to the exact stack branch and reads computed mergeability', async () => {
  const { githubStackPullRequests } = await import('./feature-stack-progress.mjs');
  const urls = [];
  const request = async url => {
    urls.push(url);
    const body = url.includes('?') ? [{ number: 9, head: {ref: 'lopu/feature-stack-stack-to-develop', repo: { full_name: 'owner/repo' }}, base: {ref:'develop'} }] : {number:9,mergeable:false,mergeable_state:'dirty',base:{ref:'develop'}};
    return new Response(JSON.stringify(body));
  };
  const result = await githubStackPullRequests({repository:'owner/repo',stackId:'stack',targets:['develop'],token:'test-token',request});
  assert.equal(new URL(urls[0]).searchParams.get('head'), 'owner:lopu/feature-stack-stack-to-develop');
  assert.equal(urls[1], 'https://api.github.com/repos/owner/repo/pulls/9');
  assert.equal(result.prs[0].mergeable_state, 'dirty');
  assert.deepEqual(result.unavailableTargets, []);
});

test('model failures advance configured credentials; answer never returns a credential and the temporary HOME is removed', async () => {
  const { answerQuestion } = await import('./feature-stack-chat.mjs');
  const { existsSync } = await import('node:fs');
  const attempts = [];
  const execute = (file, args, options, done) => {
    attempts.push(options);
    return { stdin: { end: prompt => {
      assert.equal(JSON.parse(prompt).question, 'What is waiting?');
      if (attempts.length === 1) done(new Error('unavailable'), '');
      else done(null, JSON.stringify({result:'Waiting for checks. secret-two'}));
    } } };
  };
  const answer = await answerQuestion({question:'What is waiting?',history:[]},{status:'in_progress'}, { execute, env: { LOPU_CLAUDE_TOKEN_1:'secret-one',LOPU_CLAUDE_TOKEN_2:'secret-two',GH_TOKEN:'never-forward',THINGTIME_CI_ROUTER_SECRET:'never-forward-either' } });
  assert.equal(answer, 'Waiting for checks. [redacted]');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].env.GH_TOKEN, undefined);
  assert.equal(existsSync(attempts[1].cwd), false);
});

test('legacy sparse checkouts can still execute the reporter without the optional chat module', async () => {
  const {mkdtempSync,copyFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os'); const {join}=await import('node:path'); const {execFileSync}=await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'stack-legacy-'));
  try { const file=join(dir,'feature-stack-progress.mjs');copyFileSync(new URL('./feature-stack-progress.mjs',import.meta.url),file);
    assert.match(execFileSync(process.execPath,[file,'--self-test'],{encoding:'utf8'}),/self-test passed/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
