import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/codeql-analysis.yml', import.meta.url), 'utf8');
const startName = 'Wait for every sibling language leg to start';
const holdName = 'Hold the faster analysis until the slowest language lands';
const epoch = 1700000000;
const sha = 'a'.repeat(40);
const iso = seconds => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
function shellStep(name) {
  const block = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name: ')[0];
  assert.ok(block, `Missing actual workflow step ${name}`);
  return block.split('        run: |\n')[1].split('\n').map(line => line.replace(/^ {10}/u, '')).join('\n');
}
const defaultJobs = { jobs: [
  { name: 'Analyze (actions)', status: 'in_progress' },
  { name: 'Analyze (javascript-typescript)', status: 'in_progress' }
] };
const success = body => ({ body });
const rate = headers => ({ status: 403, headers, body: { message: 'API rate limit exceeded for installation' } });
const analysis = (overrides = {}) => ({ commit_sha: sha, tool: { name: 'CodeQL' }, category: '/language:javascript-typescript', created_at: iso(epoch), ...overrides });

// Execute the actual immutable workflow shell with a synthetic clock and API.
// No production credentials, network, real sleeping, or copied polling model.
const fakeCommand = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const file=process.env.CODEQL_FAKE_STATE,s=JSON.parse(fs.readFileSync(file,'utf8'));
const save=()=>fs.writeFileSync(file,JSON.stringify(s));
const name=path.basename(process.argv[1]),args=process.argv.slice(2);
if(name==='date'){
 const d=args.indexOf('-d');
 const value=d<0?s.now:Date.parse(args[d+1])/1000;
 if(!Number.isFinite(value))process.exit(1);
 console.log(Math.floor(value));
}else if(name==='sleep'){
 if(s.cancelOnSleep)process.exit(130);
 s.sleeps.push(Number(args[0]));s.now+=Number(args[0]);save();
}else if(name==='timeout'){
 s.timeouts.push(Number(args[1].replace(/s$/,'')));save();
 const r=cp.spawnSync(args[2],args.slice(3),{stdio:'inherit'});process.exit(r.status??1);
}else if(name==='gh'){
 const endpoint=args.at(-1),route=endpoint.includes('code-scanning/analyses')?'analyses':endpoint.includes('/jobs?')?'jobs':'run';
 const n=s.counts[route]||0;s.counts[route]=n+1;s.calls.push({route,endpoint,at:s.now});
 const spec=s.routes[route];let r;
 if(spec?.sequence)r=spec.sequence[Math.min(n,spec.sequence.length-1)];
 else if(spec?.schedule)r=[...spec.schedule].reverse().find(x=>x.at<=s.now-s.start)?.response;
 r??=route==='run'?{body:{run_started_at:new Date(s.start*1000).toISOString().replace('.000Z','Z')}}:route==='jobs'?{body:s.defaultJobs}:{body:[]};
 save();
 console.log('HTTP/2.0 '+(r.status||200)+' status');
 for(const [key,value]of Object.entries(r.headers||{}))console.log(key+': '+value);
 console.log('');console.log(typeof r.body==='string'?r.body:JSON.stringify(r.body));
 process.exit(r.exitCode??(r.status>=400?1:0));
}
`;
function execute(name, routes = {}, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-ordering-'));
  try {
    for (const command of ['gh', 'sleep', 'date', 'timeout']) {
      const path = join(dir, command);
      writeFileSync(path, fakeCommand); chmodSync(path, 0o755);
    }
    const file = join(dir, 'state.json');
    writeFileSync(file, JSON.stringify({ now: epoch, start: epoch, counts: {}, calls: [], sleeps: [], timeouts: [], routes, defaultJobs, ...extra }));
    const result = spawnSync('bash', ['-c', shellStep(name)], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CODEQL_FAKE_STATE: file,
        REPO: 'example/project', RUN_ID: '42', RUN_ATTEMPT: '3', EXPECTED_LEGS: '2',
        LANGUAGE: 'actions', SLOWEST_LANGUAGE: 'javascript-typescript', ANALYSIS_REF: 'refs/pull/7/merge', ANALYSIS_SHA: sha,
        FALLBACK_REF: '', FALLBACK_SHA: '', GH_TOKEN: 'synthetic-never-transmitted' }
    });
    assert.ifError(result.error);
    return { ...JSON.parse(readFileSync(file, 'utf8')), status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('both trusted inline transports stay identical and uploads retain the built-in token', () => {
  const transport = name => shellStep(name).split('\n\ndeadline=')[0].split('poll_now()')[1];
  assert.ok(transport(startName));
  // Pin the whole transport, through poll_wait, not just its first function.
  assert.equal(transport(startName), transport(holdName));
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.doesNotMatch(workflow, /secrets\.|token:\s*\$\{\{/u);
  assert.match(workflow, /github\/codeql-action\/analyze@/u);
});

test('start barrier scopes jobs to the current attempt and never waits for completion', () => {
  const result = execute(startName);
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0].endpoint, /attempts\/3\/jobs/u);
  assert.deepEqual(result.sleeps, []);
});

test('a quota response cools both endpoints until reset, then preserves exact analysis ordering', () => {
  const result = execute(holdName, {
    analyses: { sequence: [rate({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(epoch + 300) }), success([analysis()])] }
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls.map(x => [x.route, x.at - epoch]), [['run', 0], ['analyses', 0], ['analyses', 300]]);
  assert.match(result.output, /has landed/u);
});

for (const retry of ['90', new Date((epoch + 90) * 1000).toUTCString()]) {
  test(`Retry-After ${retry} suspends the start barrier without extra requests`, () => {
    const result = execute(startName, { jobs: { sequence: [rate({ 'Retry-After': retry }), success(defaultJobs)] } });
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls.map(x => x.at - epoch), [0, 90]);
  });
}

test('reset beyond deadline neither oversleeps nor repeats requests, and does not skip analysis', () => {
  const result = execute(holdName, { run: { sequence: [rate({ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(epoch + 3600) })] } });
  assert.equal(result.status, 0);
  assert.equal(result.calls.length, 1);
  assert.equal(result.now - epoch, 1200);
  assert.match(result.output, /revision is still scanned/u);
  assert.ok(result.timeouts.every(x => x > 0 && x <= 30));
});

test('a successful final quota unit waits for reset before handing off to init', () => {
  const result = execute(startName, { jobs: { sequence: [{ body: defaultJobs, headers: {
    'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(epoch + 120)
  } }] } });
  assert.equal(result.status, 0);
  assert.equal(result.now - epoch, 120);
  assert.equal(result.calls.length, 1);
});

test('old, wrong-head and wrong-category results cannot release a re-scan', () => {
  const result = execute(holdName, { analyses: { sequence: [
    success([analysis({ created_at: iso(epoch - 1) }), analysis({ commit_sha: 'b'.repeat(40) }), analysis({ category: '/language:actions' })]),
    success([analysis()])
  ] } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.sleeps, [15]);
  assert.equal(result.counts.analyses, 2);
});

test('failed sibling releases ordering immediately without claiming an uploaded analysis', () => {
  const jobs = { jobs: [{ name: 'Analyze (javascript-typescript)', status: 'completed', conclusion: 'failure' }] };
  const result = execute(holdName, { jobs: { sequence: [success(jobs)] } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.sleeps, []);
  assert.match(result.output, /ended without success/u);
  assert.doesNotMatch(result.output, /has landed/u);
});

test('malformed/transient responses retry with capped backoff and the original deadline', () => {
  const result = execute(startName, { jobs: { sequence: [{ status: 502, body: 'unavailable' }, success('<html>not jobs</html>')] } });
  assert.equal(result.status, 0);
  assert.equal(result.now - epoch, 600);
  assert.deepEqual(result.sleeps.slice(0, 4), [15, 30, 60, 60]);
  assert.ok(result.calls.length <= 12);
  assert.match(result.output, /deadline elapsed/u);
});

test('successful sibling grace remains bounded if subsequent requests exhaust quota', () => {
  const jobs = { jobs: [{ name: 'Analyze (javascript-typescript)', status: 'completed', conclusion: 'success' }] };
  const result = execute(holdName, {
    analyses: { sequence: [success([]), rate({ 'Retry-After': '3600' })] },
    jobs: { sequence: [success(jobs)] }
  });
  assert.equal(result.status, 0);
  assert.equal(result.now - epoch, 180);
  assert.match(result.output, /processing grace elapsed/u);
});

test('a pending sibling keeps upload ordering with at most 45 reads over twenty minutes', () => {
  const result = execute(holdName);
  assert.equal(result.status, 0);
  assert.equal(result.now - epoch, 1200);
  assert.equal(result.calls.length, 45);
  assert.doesNotMatch(result.output, /has landed|ended without success/u);
});

test('job cancellation interrupts sleep rather than being swallowed as a successful barrier', () => {
  const queued = { jobs: [{ name: 'Analyze (actions)', status: 'in_progress' }, { name: 'Analyze (javascript-typescript)', status: 'queued' }] };
  const result = execute(startName, { jobs: { sequence: [success(queued)] } }, { cancelOnSleep: true });
  assert.equal(result.status, 130);
  assert.equal(result.calls.length, 1);
});

test('cancellation also interrupts a successful quota-cooldown inside an if-tested API function', () => {
  const result = execute(startName, { jobs: { sequence: [{ body: defaultJobs, headers: {
    'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(epoch + 120)
  } }] } }, { cancelOnSleep: true });
  assert.equal(result.status, 130);
  assert.doesNotMatch(result.output, /All 2 analysis legs have started/u);
});

for (const exitCode of [130, 143]) {
  test(`API child cancellation ${exitCode} is propagated without a retry`, () => {
    const result = execute(startName, { jobs: { sequence: [{ exitCode, body: 'cancelled' }] } });
    assert.equal(result.status, exitCode);
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.sleeps, []);
  });
}
