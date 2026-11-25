import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// 25 Nov 2026: the shared installation API budget ran out while unrelated
// PRs were queued. The resolver's batch handoff (run 45549727540) and the
// stack-rebase scan (run 45549774118) each made a raw `gh api` read, `set -e`
// propagated "API rate limit exceeded for installation (HTTP 403)", and #1545
// got two red checks for an upstream budget reset. These tests run the REAL
// workflow shell against a synthetic `gh`: no credentials, network or sleeps.
const read = name => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
const resolver = read('resolve-pr-conflicts.yml');
const stacks = read('rebase-pr-stacks.yml');
const ci = read('control-plane-ci.yml');
const helper = readFileSync(new URL('./gh-budget.sh', import.meta.url), 'utf8');
// Steps source `.github/scripts/gh-budget.sh` relative to the checkout root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const RESOLVER_HANDOFF = 'Dispatch one trusted github-actions worker per bounded PR batch';
const STACK_SCAN = 'Scan open same-repository PRs via the API';
const STACK_HANDOFF = 'Dispatch one exact ref snapshot per root PR';
const steps = [[resolver, RESOLVER_HANDOFF], [stacks, STACK_SCAN], [stacks, STACK_HANDOFF]];

function runBlock(workflow, name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `Missing actual workflow step ${name}`);
  const after = workflow.slice(start);
  const marker = '        run: |\n';
  const at = after.indexOf(marker);
  assert.ok(at > 0 && !after.slice(1, at).includes('\n      - name: '), `${name} has its own run block`);
  const body = [];
  for (const line of after.slice(at + marker.length).split('\n')) {
    if (line !== '' && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

const BUDGET = 'API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 0000:0000:0000:0000:00000000';
const budget = (status = 403) => ({ status, message: BUDGET });
const denied = { status: 403, message: 'Resource not accessible by integration' };
const ok = body => ({ status: 200, body });
const noContent = { status: 204 };

// `gh api` stand-in: records every request and answers from per-route
// sequences (the last answer repeats). Unrouted requests fail loudly with a
// non-budget error so a missing fixture can never look like a deferral.
const fakeGh = `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');
const file=process.env.BUDGET_FAKE_STATE,s=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2);let method='GET',jq=null,stdin=false,slurp=false;const rest=[];
for(let i=1;i<args.length;i++){const a=args[i];
 if(a==='--method')method=args[++i];else if(a==='--jq')jq=args[++i];
 else if(a==='--input')stdin=args[++i]==='-';else if(a==='--slurp')slurp=true;
 else if(!a.startsWith('-'))rest.push(a);}
const endpoint=rest[0],input=stdin?fs.readFileSync(0,'utf8'):null;
const index=s.routes.findIndex(r=>(r.method||'GET')===method&&new RegExp(r.match).test(endpoint));
s.calls.push({method,endpoint,token:process.env.GH_TOKEN,input:input&&JSON.parse(input)});
let r;
if(index<0)r={status:404,message:'unrouted synthetic request '+method+' '+endpoint};
else{const n=s.counts[index]||0;s.counts[index]=n+1;const seq=s.routes[index].responses;r=seq[Math.min(n,seq.length-1)];}
fs.writeFileSync(file,JSON.stringify(s));
if(r.status>=300){process.stderr.write('gh: '+r.message+' (HTTP '+r.status+')\\n');process.exit(1);}
if(r.body===undefined)process.exit(0);
const text=JSON.stringify(slurp?[r.body]:r.body);
if(!jq){process.stdout.write(text+'\\n');process.exit(0);}
const q=cp.spawnSync('jq',['-r',jq],{input:text,encoding:'utf8'});
process.stdout.write(q.stdout);process.stderr.write(q.stderr);process.exit(q.status??1);
`;
// Records sleeps without spending wall time; keeps GNU-only base64 flags
// portable so the suite also runs on macOS developer machines.
const fakeSleep = `#!/usr/bin/env node
const fs=require('node:fs'),file=process.env.BUDGET_FAKE_STATE,s=JSON.parse(fs.readFileSync(file,'utf8'));
s.sleeps.push(Number(process.argv[2]));fs.writeFileSync(file,JSON.stringify(s));
`;
const fakeBase64 = `#!/usr/bin/env node
const fs=require('node:fs'),input=fs.readFileSync(0,'utf8');
const decode=process.argv.slice(2).some(a=>a==='--decode'||a==='-d');
process.stdout.write(decode?Buffer.from(input.trim(),'base64').toString('utf8'):Buffer.from(input).toString('base64'));
`;

function execute(workflow, name, routes, env = {}, { preseedSentinel = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gh-budget-deferral-'));
  try {
    const bin = join(dir, 'bin'), temp = join(dir, 'runner-temp');
    spawnSync('mkdir', ['-p', bin, temp]);
    for (const [command, source] of [['gh', fakeGh], ['sleep', fakeSleep], ['base64', fakeBase64]]) {
      writeFileSync(join(bin, command), source); chmodSync(join(bin, command), 0o755);
    }
    const state = join(dir, 'state.json'), output = join(dir, 'github-output');
    writeFileSync(state, JSON.stringify({ routes, counts: {}, calls: [], sleeps: [] }));
    writeFileSync(output, '');
    if (preseedSentinel) writeFileSync(join(temp, 'lopu-gh-budget-exhausted'), '');
    const result = spawnSync('bash', ['-e', '-c', runBlock(workflow, name)], {
      encoding: 'utf8', timeout: 30000, cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BUDGET_FAKE_STATE: state,
        RUNNER_TEMP: temp, GITHUB_OUTPUT: output, REPO: 'example/project',
        GH_TOKEN: 'synthetic-actions-token', ...env }
    });
    assert.ifError(result.error);
    const recorded = JSON.parse(readFileSync(state, 'utf8'));
    return { ...recorded, status: result.status, output: result.stdout + result.stderr,
      githubOutput: readFileSync(output, 'utf8'), leftovers: existsSync(temp) ? spawnSync('ls', [temp], { encoding: 'utf8' }).stdout : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- resolver batch handoff ----------

const queuedListing = '/actions/workflows/resolve-pr-conflicts\\.yml/runs\\?event=workflow_dispatch&status=queued';
const legacyListing = '/actions/workflows/resolve-pr-conflicts\\.yml/runs\\?event=workflow_dispatch&status=(pending|in_progress)';
const fleetGroup = '/actions/concurrency_groups/lopu-agent-fleet-';
const priorityGroup = '/actions/concurrency_groups/lopu-priority-main-develop-';
const dispatch = '/actions/workflows/resolve-pr-conflicts\\.yml/dispatches$';
const pr = (number, head = `feature/${number}`, base = 'main') => ({ number, head, base, mode: 'outdated', manual_retry: false });
const handoffEnv = { PRS: JSON.stringify([pr(1545), pr(1300, 'sync/main-into-develop', 'develop')]),
  DEPTH: '0', EXECUTION_PROVIDER: 'github-actions', RUNNER_LABEL: '', CONTROL_DISPATCH_ID: '',
  ROUTING_PROOF: '', ROUTING_PROOF_ISSUED_AT: '' };
function handoffRoutes(overrides = {}) {
  const defaults = {
    queued: { match: queuedListing, responses: [ok({ workflow_runs: [] })] },
    legacy: { match: legacyListing, responses: [ok({ workflow_runs: [] })] },
    fleet: { match: fleetGroup, responses: [ok({ total_count: 0, group_members: [] })] },
    priority: { match: priorityGroup, responses: [ok({ total_count: 0, group_members: [] })] },
    dispatch: { method: 'POST', match: dispatch, responses: [noContent] }
  };
  return Object.entries({ ...defaults, ...overrides }).map(([, route]) => route);
}
const posts = result => result.calls.filter(call => call.method === 'POST' && /dispatches$/u.test(call.endpoint));

test('handoff: the 25 Nov run-listing refusal defers green without another request', () => {
  const result = execute(resolver, RESOLVER_HANDOFF,
    handoffRoutes({ queued: { match: queuedListing, responses: [budget()] } }), handoffEnv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /::notice::Deferring this PR batch handoff: GitHub's shared installation API budget is exhausted/u);
  assert.equal(result.calls.length, 1, 'no retry and no dispatch after the refusal');
  assert.deepEqual(posts(result), []);
  assert.deepEqual(result.sleeps, []);
  // The original gh message is still in the log for diagnosis.
  assert.match(result.output, /API rate limit exceeded for installation/u);
});

test('handoff: a 429 carrying the budget message also defers', () => {
  const result = execute(resolver, RESOLVER_HANDOFF,
    handoffRoutes({ legacy: { match: legacyListing, responses: [budget(429)] } }), handoffEnv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Deferring this PR batch handoff/u);
  assert.deepEqual(posts(result), []);
});

test('handoff: a bare 403 is a real permission failure and stays red', () => {
  for (const preseedSentinel of [false, true]) {
    const result = execute(resolver, RESOLVER_HANDOFF,
      handoffRoutes({ queued: { match: queuedListing, responses: [denied] } }), handoffEnv, { preseedSentinel });
    assert.equal(result.status, 1, result.output);
    assert.doesNotMatch(result.output, /Deferring/u);
    assert.match(result.output, /Resource not accessible by integration/u);
  }
});

test('handoff: a tolerated budget refusal cannot mask a genuine failure that follows it', () => {
  const result = execute(resolver, RESOLVER_HANDOFF, handoffRoutes({
    queued: { match: queuedListing, responses: [ok({ workflow_runs: [{ id: 77, head_branch: 'github-actions',
      display_title: 'Lopu resolves a fully materialized PR batch from the control plane' }] })] },
    status: { match: '/actions/runs/77$', responses: [budget()] },
    legacy: { match: legacyListing, responses: [denied] }
  }), handoffEnv);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Worker 77 is now unknown; preserving it/u);
  assert.doesNotMatch(result.output, /Deferring/u);
  assert.equal(result.calls.filter(call => call.method === 'POST').length, 0, 'the tolerated read never cancels');
});

test('handoff: normal dispatch is unchanged, one POST per canonical batch', () => {
  const result = execute(resolver, RESOLVER_HANDOFF, handoffRoutes(), handoffEnv);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /Deferring/u);
  const batches = posts(result).map(call => JSON.parse(Buffer.from(call.input.inputs.pr_batch_b64, 'base64').toString('utf8')));
  // The priority synchronizer lane is dispatched first, in its own batch.
  assert.deepEqual(batches, [[{ manual_retry: false, number: 1300 }], [{ manual_retry: false, number: 1545 }]]);
  assert.ok(posts(result).every(call => call.input.ref === 'github-actions' && call.input.inputs.detector_handoff === true));
  assert.ok(!result.leftovers.includes('lopu-gh-budgeted.'), 'stderr capture files are cleaned up');
});

test('handoff: a refused dispatch is never replayed and earlier batches are not resent', () => {
  const result = execute(resolver, RESOLVER_HANDOFF, handoffRoutes({
    dispatch: { method: 'POST', match: dispatch, responses: [noContent, budget()] }
  }), handoffEnv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Deferring this PR batch handoff/u);
  assert.equal(result.output.match(/^Dispatching /gmu).length, 2, 'the log names the batch that was sent first');
  assert.equal(posts(result).length, 2, 'exactly one attempt per batch: no retry, no duplicate');
  assert.notEqual(posts(result)[0].input.inputs.pr_batch_b64, posts(result)[1].input.inputs.pr_batch_b64);
});

test('handoff: a dispatch refused for another reason still fails red', () => {
  const result = execute(resolver, RESOLVER_HANDOFF, handoffRoutes({
    dispatch: { method: 'POST', match: dispatch, responses: [denied] }
  }), handoffEnv);
  assert.equal(result.status, 1, result.output);
  assert.doesNotMatch(result.output, /Deferring/u);
  assert.equal(posts(result).length, 1);
});

// ---------- stack-rebase scan and its handoff ----------

const openPulls = 'repos/example/project/pulls\\?state=open';
const scanEnv = { EVENT_NAME: 'schedule', PUSHED_REF: 'main', EVENT_PR: '', MANUAL_PR: '', MANUAL_BRANCH: '',
  AUTOMATIC_RETRY: 'false', CASCADE: 'true', LOCK_TTL_SECONDS: '5400', LABEL_WRITE_TOKEN: '' };
const repoRoute = { match: 'repos/example/project$', responses: [ok({ default_branch: 'main' })] };
const samePr = { number: 12, head: { ref: 'feature/a', repo: { full_name: 'example/project' } },
  base: { ref: 'main', repo: { full_name: 'example/project' } }, labels: [] };

test('stack scan: the 25 Nov open-PR listing refusal defers with no targets', () => {
  const result = execute(stacks, STACK_SCAN, [{ match: openPulls, responses: [budget()] }], scanEnv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /::notice::Deferring this stack-rebase scan/u);
  assert.equal(result.githubOutput, 'targets=[]\nany=false\n');
  assert.equal(result.calls.length, 1);
});

test('stack scan: a refusal mid-scan defers instead of publishing a partial verdict', () => {
  const result = execute(stacks, STACK_SCAN, [
    { match: openPulls, responses: [ok([samePr])] }, repoRoute,
    { match: 'repos/example/project/pulls/12$', responses: [budget()] }
  ], scanEnv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.githubOutput, /^targets=\[\]\nany=false\n$/u);
  assert.deepEqual(result.sleeps, [], 'no backoff is spent on a budget reset');
});

test('stack scan: a bare 403 still fails red and publishes nothing', () => {
  const result = execute(stacks, STACK_SCAN, [{ match: openPulls, responses: [denied] }], scanEnv);
  assert.equal(result.status, 1, result.output);
  assert.doesNotMatch(result.output, /Deferring/u);
  assert.equal(result.githubOutput, '');
});

test('stack scan: an empty repository still answers through the normal path once', () => {
  const result = execute(stacks, STACK_SCAN, [{ match: openPulls, responses: [ok([])] }, repoRoute], scanEnv);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /Deferring/u);
  assert.equal(result.githubOutput, 'targets=[]\nany=false\n');
});

const target = number => ({ number, head: `feature/${number}`, base: 'main', head_sha: 'a'.repeat(40),
  base_sha: 'b'.repeat(40), cascade: true, manual: false, stale_lock: false });
const stackHandoffEnv = { TARGETS: JSON.stringify([target(12), target(13)]), EXECUTION_PROVIDER: 'github-actions',
  RUNNER_LABEL: '', CONTROL_DISPATCH_ID: '', ROUTING_PROOF: '', ROUTING_PROOF_ISSUED_AT: '',
  REF_RACE_RETRY: '0', AUTOMATIC_RETRY: 'false' };
const repoDispatch = 'repos/example/project/dispatches$';

test('stack handoff: a refused dispatch defers green without replaying it', () => {
  const result = execute(stacks, STACK_HANDOFF,
    [{ method: 'POST', match: repoDispatch, responses: [noContent, budget()] }], stackHandoffEnv);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /::notice::Deferring this rebase handoff/u);
  assert.deepEqual(result.calls.map(call => call.input.client_payload.pr_number), ['12', '13']);
});

test('stack handoff: normal dispatch and real refusals are unchanged', () => {
  const sent = execute(stacks, STACK_HANDOFF, [{ method: 'POST', match: repoDispatch, responses: [noContent] }], stackHandoffEnv);
  assert.equal(sent.status, 0, sent.output);
  assert.equal(sent.calls.length, 2);
  const refused = execute(stacks, STACK_HANDOFF, [{ method: 'POST', match: repoDispatch, responses: [denied] }], stackHandoffEnv);
  assert.equal(refused.status, 1, refused.output);
  assert.equal(refused.calls.length, 1);
});

// ---------- contract ----------

test('every affected step checks out, sources and traps the one shared budget helper', () => {
  for (const [workflow, name] of steps) {
    const body = runBlock(workflow, name);
    // Sourced before any call, so no gh request can precede the deferral.
    assert.match(body, /^set -euo pipefail\n\. \.github\/scripts\/gh-budget\.sh\ntrap 'gh_budget_defer "[^"]+"[^']*' EXIT\n/u, name);
    // Any raw call would bypass both the record and its clearing.
    const raw = body.split('\n').filter(line => !line.trimStart().startsWith('#'))
      .filter(line => /(^|[^\w-])gh (?!"\$@")/u.test(line));
    assert.deepEqual(raw, [], `${name} has no raw gh call`);
    // The helper comes from the trusted controller ref, never a PR checkout.
    const job = workflow.slice(workflow.lastIndexOf('\n    steps:\n', workflow.indexOf(`      - name: ${name}\n`)),
      workflow.indexOf(`      - name: ${name}\n`));
    assert.match(job, /- name: Check out the trusted API budget helper\n {8}uses: actions\/checkout@[0-9a-f]{40} # v6\.1\.0\n {8}with:\n {10}ref: github-actions\n {10}persist-credentials: false\n {10}sparse-checkout: \.github\/scripts\n\n$/u, name);
  }
  assert.match(helper, /HTTP \(403\|429\)/u);
  assert.match(helper, /API rate limit exceeded/u);
  assert.doesNotMatch(helper.replace(/^#.*$/gmu, ''), /sleep|for attempt|retry/u, 'the helper never retries');
});

test('the resolver handoff job can read its trusted checkout', () => {
  const job = resolver.slice(resolver.indexOf('\n  handoff:\n'), resolver.indexOf('\n  review_detect:\n'));
  assert.match(job, /permissions:\n {6}actions: write\n {6}contents: read\n {4}steps:/u);
});

test('the EXIT trap keeps the failing status it inspects and stays silent on success', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-budget-trap-'));
  try {
    const run = (seed, tail) => spawnSync('bash', ['-c', `set -euo pipefail\n. .github/scripts/gh-budget.sh\n${seed}\n`
      + `trap 'gh_budget_defer "unit check" "any=false"' EXIT\n${tail}\n`],
      { encoding: 'utf8', cwd: repoRoot, env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'out') } });
    rmSync(join(dir, 'out'), { force: true });
    const deferred = run(': >"$LOPU_GH_BUDGET_SENTINEL"', 'exit 3');
    assert.equal(deferred.status, 0);
    assert.match(deferred.stdout, /::notice::Deferring this unit check/u);
    assert.equal(readFileSync(join(dir, 'out'), 'utf8'), 'any=false\n');
    rmSync(join(dir, 'out'), { force: true });
    const passed = run(': >"$LOPU_GH_BUDGET_SENTINEL"', 'true');
    assert.equal(passed.status, 0);
    assert.equal(passed.stdout, '', 'a successful step is never annotated');
    assert.equal(existsSync(join(dir, 'out')), false);
    const failed = run(':', 'exit 3');
    assert.equal(failed.status, 3, 'without the record the original status survives');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('control-plane CI runs this suite', () => {
  assert.match(ci, /node --test [^\n]*\.github\/scripts\/gh-budget-deferral\.test\.mjs/u);
});
