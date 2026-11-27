import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// 25 Nov 2026: the conflict detector re-read `pulls/N/files` for every open PR
// on every scan -- ~143 PRs, ~316 paginated requests, ~18 scans an hour, over
// half of the GitHub App's 5,000/hr installation budget -- and 26 PRs answered
// HTTP 422 "diff is taking too long to generate" every time. These tests run
// the REAL detect scan step (and the helper it sources) against a synthetic
// `gh`: no credentials, network or sleeps. Each run happens in a scratch
// directory whose `.github` links to this checkout, so the helper's default
// cache path is the very file actions/cache restores and saves.
const read = name => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');
const workflow = read('resolve-pr-conflicts.yml');
const ci = read('control-plane-ci.yml');
const helper = readFileSync(new URL('./pr-files-inventory.sh', import.meta.url), 'utf8');
const testing = readFileSync(new URL('../TESTING.md', import.meta.url), 'utf8');
const dotGithub = fileURLToPath(new URL('..', import.meta.url));
// Node's main-module check compares realpaths, so a CLI reached through the
// `.github` link would silently do nothing: hand the classifier its real path.
const statusHelper = fileURLToPath(new URL('./lopu-pr-status.mjs', import.meta.url));

const SCAN = 'Scan open PRs and assign deterministic resolver ownership';
const CACHE = '.lopu-pr-files-cache.json';
const MARKER = '.lopu-pr-files-cache.save';
const DAY = 86400;
const SIX_HOURS = 21600;

function runBlock(name) {
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

const sha = digit => digit.repeat(40);
const node = (number, { head = sha('a'), base = 'main' } = {}) => ({
  number, headRefName: `feature/${number}`, headRefOid: head, baseRefName: base,
  isCrossRepository: false, isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  labels: { nodes: [] }
});
const TOO_LONG = { status: 422, message: 'Server Error: Sorry, this diff is taking too long to generate.' };
const BUDGET = { status: 403, message: 'API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 0000:0000' };

// `gh api` stand-in. It records every request, answers the open-PR GraphQL
// inventory from `prs`, each `pulls/N/files` from `files[N]` (an array of
// pages, or an error), and acknowledges label/metadata traffic so the rest of
// the real step runs to completion.
const fakeGh = `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');
const file=process.env.FILES_FAKE_STATE,s=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2);let method='GET',jq=null,slurp=false,input=null;const rest=[];
for(let i=1;i<args.length;i++){const a=args[i];
 if(a==='--method'||a==='-X')method=args[++i];else if(a==='--jq'||a==='-q')jq=args[++i];
 else if(a==='--input')input=args[++i];else if(a==='--slurp')slurp=true;
 else if(['-f','-F','--field','--raw-field','-H','--header'].includes(a)){i++;if(method==='GET'&&rest[0]!=='graphql')method='POST';}
 else if(!a.startsWith('-'))rest.push(a);}
const endpoint=rest[0];
const body=input&&input!=='-'&&fs.existsSync(input)?JSON.parse(fs.readFileSync(input,'utf8')):null;
s.calls.push({method,endpoint,body});
let r;const files=/^repos\\/example\\/project\\/pulls\\/(\\d+)\\/files\\?per_page=100$/.exec(endpoint);
if(endpoint==='graphql')r={status:200,body:{data:{repository:{pullRequests:{nodes:s.prs,pageInfo:{hasNextPage:false,endCursor:null}}}}}};
else if(files){const n=files[1],seq=s.files[n];if(!seq)r={status:404,message:'Not Found'};
 else{const c=s.fileCounts[n]||0;s.fileCounts[n]=c+1;r=Array.isArray(seq)?{status:200,body:seq}:seq[c]??seq.default;}}
else if(endpoint==='repos/example/project')r=s.repoFails?{status:404,message:'Not Found'}:{status:200,body:{default_branch:'main'}};
else if(/^repos\\/example\\/project\\/actions\\/concurrency_groups\\//.test(endpoint))r={status:200,body:{group_members:[]}};
else if(/^repos\\/example\\/project\\/labels\\?per_page=100$/.test(endpoint))r={status:200,body:[]};
else if(method!=='GET')r={status:200,body:{}};
else r={status:404,message:'unrouted synthetic request '+method+' '+endpoint};
fs.writeFileSync(file,JSON.stringify(s));
if(r.status>=300){process.stderr.write('gh: '+r.message+' (HTTP '+r.status+')\\n');process.exit(1);}
// --paginate --slurp prints one array of pages; a files route already IS one.
const text=JSON.stringify(slurp&&!files?[r.body]:r.body);
if(!jq){process.stdout.write(text+'\\n');process.exit(0);}
const q=cp.spawnSync('jq',['-r',jq],{input:text,encoding:'utf8'});
process.stdout.write(q.stdout);process.stderr.write(q.stderr);process.exit(q.status??1);
`;
const fakeSleep = `#!/usr/bin/env node
const fs=require('node:fs'),file=process.env.FILES_FAKE_STATE,s=JSON.parse(fs.readFileSync(file,'utf8'));
s.sleeps.push(Number(process.argv[2]));fs.writeFileSync(file,JSON.stringify(s));
`;
// Keeps GNU-only base64 flags portable so the suite also runs on macOS.
const fakeBase64 = `#!/usr/bin/env node
const fs=require('node:fs'),input=fs.readFileSync(0,'utf8');
const decode=process.argv.slice(2).some(a=>a==='--decode'||a==='-d');
process.stdout.write(decode?Buffer.from(input.trim(),'base64').toString('utf8'):Buffer.from(input).toString('base64'));
`;

function scan({ prs, files, cache, env = {}, deadline = '600', repoFails = false, marker = false }) {
  const dir = mkdtempSync(join(tmpdir(), 'pr-files-cache-'));
  try {
    const bin = join(dir, 'bin'), temp = join(dir, 'runner-temp'), work = join(dir, 'workspace');
    for (const path of [bin, temp, work]) mkdirSync(path, { recursive: true });
    symlinkSync(dotGithub, join(work, '.github'));
    for (const [command, source] of [['gh', fakeGh], ['sleep', fakeSleep], ['base64', fakeBase64]]) {
      writeFileSync(join(bin, command), source); chmodSync(join(bin, command), 0o755);
    }
    const state = join(dir, 'state.json'), output = join(dir, 'github-output');
    writeFileSync(state, JSON.stringify({ prs, files, repoFails, fileCounts: {}, calls: [], sleeps: [] }));
    if (marker) writeFileSync(join(work, MARKER), '');
    writeFileSync(output, '');
    if (typeof cache === 'function') cache(join(work, CACHE));
    else if (cache !== undefined) writeFileSync(join(work, CACHE), typeof cache === 'string' ? cache : JSON.stringify(cache));
    const regular = path => { try { return lstatSync(path).isFile(); } catch { return false; } };
    const before = regular(join(work, CACHE)) ? readFileSync(join(work, CACHE), 'utf8') : null;
    const result = spawnSync('bash', ['-e', '-c', runBlock(SCAN)], {
      encoding: 'utf8', timeout: 120000, cwd: work,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FILES_FAKE_STATE: state,
        RUNNER_TEMP: temp, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, 'summary'),
        GH_TOKEN: 'synthetic-actions-token', REPO: 'example/project', EVENT_NAME: 'schedule',
        EVENT_ACTION: '', EVENT_REF: 'main', TARGET_PUSH: 'false', CALLER_WORKFLOW_REF: '',
        EVENT_ACTOR: 'github-actions[bot]', TARGET: 'main', SELECTED_PR: '', PR_BATCH_B64: '',
        INPUT_BRANCH: '', DEPTH: '0', DETECTOR_HANDOFF: 'false', ROUTED_MANUAL_RETRY: 'false',
        ONLY_PR: '', PRIORITY_SYNC_EVENT: 'false', SCAN_HEAD: 'false', SCAN_ALL: 'true',
        HUMAN_EXPLICIT: 'false', MANUAL_RETRY: 'false', MERGEABLE_POLL_SECONDS: '500',
        MERGEABLE_POLL_INTERVAL: '15', FILES_INVENTORY_DEADLINE_SECONDS: deadline,
        STATUS_HELPER: statusHelper, ...env }
    });
    assert.ifError(result.error);
    const recorded = JSON.parse(readFileSync(state, 'utf8'));
    const after = regular(join(work, CACHE)) ? readFileSync(join(work, CACHE), 'utf8') : null;
    return {
      ...recorded, status: result.status, log: result.stdout + result.stderr,
      githubOutput: readFileSync(output, 'utf8'), before, after,
      cache: after === null ? null : JSON.parse(after), marked: regular(join(work, MARKER)),
      leftovers: spawnSync('ls', ['-A', temp], { encoding: 'utf8' }).stdout.trim()
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const fileReads = result => result.calls.filter(call => /\/pulls\/\d+\/files\?/u.test(call.endpoint))
  .map(call => Number(/pulls\/(\d+)\/files/u.exec(call.endpoint)[1]));
// The save step's only trigger is this marker file (see the YAML contract).
const saved = result => result.marked;
const labelled = (result, number) => result.calls
  .filter(call => call.method === 'POST' && call.endpoint === `repos/example/project/issues/${number}/labels`)
  .flatMap(call => call.body?.labels ?? []);
const entry = (result, number) => result.cache.entries.find(item => item.number === number);
const now = () => Math.floor(Date.now() / 1000);

// #10 and #11 share shared.ts, so their overlap label can only come from
// their changed paths; #11 spans two pages; #12 changes one unrelated file.
const PRS = () => [node(10, { head: sha('a') }), node(11, { head: sha('b') }), node(12, { head: sha('c'), base: 'develop' })];
const FILES = () => ({
  10: [[{ filename: 'shared.ts' }, { filename: 'a.ts' }]],
  11: [[{ filename: 'b.ts' }], [{ filename: 'shared.ts' }]],
  12: [[{ filename: 'c.ts' }]]
});
// One real cold scan seeds every warm-cache test; each gets its own copy.
let warmed;
const warm = () => structuredClone(warmed ??= scan({ prs: PRS(), files: FILES() }).cache);

test('a cold scan reads every PR once, publishes the overlap and saves the inventory', () => {
  const result = scan({ prs: PRS(), files: FILES() });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [10, 11, 12]);
  assert.deepEqual(result.sleeps, []);
  assert.ok(labelled(result, 10).includes('lopu: overlapping files'), result.log);
  assert.ok(labelled(result, 11).includes('lopu: overlapping files'));
  assert.ok(!labelled(result, 12).includes('lopu: overlapping files'));
  assert.ok(saved(result), 'a changed inventory asks the save step to run');
  assert.equal(result.cache.version, 1);
  assert.deepEqual(result.cache.entries.map(({ number, headRefOid, baseRefName, files }) => ({ number, headRefOid, baseRefName, files })), [
    { number: 10, headRefOid: sha('a'), baseRefName: 'main', files: ['a.ts', 'shared.ts'] },
    { number: 11, headRefOid: sha('b'), baseRefName: 'main', files: ['b.ts', 'shared.ts'] },
    { number: 12, headRefOid: sha('c'), baseRefName: 'develop', files: ['c.ts'] }
  ]);
  assert.ok(result.cache.entries.every(item => Math.abs(item.readAt - now()) < 120));
  // The measurable per-scan line: three reads, four paginated REST requests.
  assert.match(result.log, /Changed-file inventory: 0 PR\(s\) reused from the cache, 0 cached diff-too-long, 3 read from GitHub in 4 REST request\(s\), 0 deferred/u);
  assert.equal(result.leftovers, '', 'every scratch file is removed');
});

test('a cache hit skips the read and still feeds the overlap classification', () => {
  const cache = warm();
  const result = scan({ prs: PRS(), files: FILES(), cache });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [], 'no PR is re-read at an unchanged head and base');
  assert.ok(labelled(result, 10).includes('lopu: overlapping files'), 'cached paths reach the classifier');
  assert.ok(labelled(result, 11).includes('lopu: overlapping files'));
  assert.equal(saved(result), false, 'an unchanged inventory is not saved again');
  assert.equal(result.after, result.before, 'the restored file is left untouched');
  assert.match(result.log, /3 PR\(s\) reused from the cache, 0 cached diff-too-long, 0 read from GitHub in 0 REST request\(s\)/u);
});

test('a moved head re-reads only that PR and carries the rest unchanged', () => {
  const cache = warm();
  const prs = PRS(); prs[1].headRefOid = sha('d');
  const files = FILES(); files[11] = [[{ filename: 'b.ts' }]];
  const result = scan({ prs, files, cache });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [11]);
  assert.ok(saved(result));
  assert.deepEqual(entry(result, 11).files, ['b.ts']);
  assert.equal(entry(result, 11).headRefOid, sha('d'));
  // Carried entries keep their original read time, so the TTL still counts.
  assert.deepEqual(entry(result, 10), cache.entries.find(item => item.number === 10));
  assert.ok(!labelled(result, 10).includes('lopu: overlapping files'), 'the fresh read replaced the stale overlap');
});

test('a retargeted PR is re-read even when its head did not move', () => {
  const cache = warm();
  const prs = PRS(); prs[2].baseRefName = 'main';
  const result = scan({ prs, files: FILES(), cache });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [12]);
  assert.equal(entry(result, 12).baseRefName, 'main');
});

test('an entry older than the daily TTL is revalidated', () => {
  const cache = warm();
  cache.entries[0].readAt = now() - DAY - 5;
  cache.entries[1].readAt = now() - DAY + 600;
  const result = scan({ prs: PRS(), files: FILES(), cache });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [10]);
  assert.ok(Math.abs(entry(result, 10).readAt - now()) < 120, 'the re-read restarts its TTL');
});

test('closed PRs drop out of the saved inventory', () => {
  const cache = warm();
  const result = scan({ prs: PRS().slice(0, 2), files: FILES(), cache });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), []);
  assert.ok(saved(result));
  assert.deepEqual(result.cache.entries.map(item => item.number), [10, 11]);
});

test('a corrupt or off-shape cache is ignored and every PR is read', () => {
  const good = warm();
  const variants = {
    'not JSON': '{"version":1,"entries":[',
    'wrong version': { ...good, version: 2 },
    'extra top-level key': { ...good, extra: true },
    'extra entry key': { ...good, entries: good.entries.map(item => ({ ...item, run: 'x' })) },
    'non-hex head': { ...good, entries: good.entries.map(item => ({ ...item, headRefOid: 'HEAD' })) },
    'future readAt': { ...good, entries: good.entries.map(item => ({ ...item, readAt: now() + 3600 })) },
    'duplicate PR': { ...good, entries: [...good.entries, good.entries[0]] },
    'files not strings': { ...good, entries: good.entries.map(item => ({ ...item, files: [1] })) },
    'tooLarge with files': { ...good, entries: good.entries.map(item => ({ ...item, tooLarge: true })) },
    'array root': good.entries
  };
  for (const [label, cache] of Object.entries(variants)) {
    const result = scan({ prs: PRS(), files: FILES(), cache });
    assert.equal(result.status, 0, `${label}: ${result.log}`);
    assert.deepEqual(fileReads(result), [10, 11, 12], label);
    assert.match(result.log, /::warning::Ignoring the restored changed-file cache: it is not the exact shape/u, label);
    assert.ok(saved(result), `${label}: a clean inventory replaces it`);
    assert.equal(result.cache.entries.length, 3, label);
  }
  for (const [label, plant] of Object.entries({
    directory: path => mkdirSync(path),
    'dangling symlink': path => symlinkSync('/nonexistent/lopu-cache', path)
  })) {
    const result = scan({ prs: PRS(), files: FILES(), cache: plant });
    assert.equal(result.status, 0, `${label}: ${result.log}`);
    assert.deepEqual(fileReads(result), [10, 11, 12], label);
    assert.match(result.log, /it is not a regular file/u, label);
  }
});

test('a 422 diff-too-long is cached per head: one probe, then a named skip until the head moves or 6h pass', () => {
  const files = FILES(); files[12] = { default: TOO_LONG };
  const first = scan({ prs: PRS(), files });
  assert.equal(first.status, 0, first.log);
  assert.deepEqual(fileReads(first), [10, 11, 12], 'exactly one attempt: the slow-diff retry stays declined');
  assert.deepEqual(first.sleeps, []);
  assert.match(first.log, /Could not complete the changed-file inventory for #12; .*\(inventory incomplete\)/u);
  assert.deepEqual(Object.keys(entry(first, 12)).sort(), ['baseRefName', 'headRefOid', 'number', 'readAt', 'tooLarge']);

  const second = scan({ prs: PRS(), files, cache: first.cache });
  assert.equal(second.status, 0, second.log);
  assert.deepEqual(fileReads(second), [], 'the refusal is not replayed at the same head');
  assert.match(second.log, /::warning::Reused 1 cached HTTP 422 "diff is taking too long to generate" result\(s\) at unchanged heads; .*\(inventory incomplete\).*#12/u);
  assert.equal(saved(second), false);

  const moved = PRS(); moved[2].headRefOid = sha('e');
  const third = scan({ prs: moved, files: FILES(), cache: first.cache });
  assert.deepEqual(fileReads(third), [12], 'a new head is probed again');
  assert.deepEqual(entry(third, 12).files, ['c.ts']);

  const aged = structuredClone(first.cache);
  aged.entries.find(item => item.number === 12).readAt = now() - SIX_HOURS - 5;
  const fourth = scan({ prs: PRS(), files, cache: aged });
  assert.deepEqual(fileReads(fourth), [12], 'a cached 422 is re-probed after six hours');

  // Any other 422 stays an ordinary, uncached read failure.
  const invalid = FILES(); invalid[12] = { default: { status: 422, message: 'Validation Failed: No commits between main and topic' } };
  const other = scan({ prs: PRS(), files: invalid });
  assert.equal(entry(other, 12), undefined);
});

test('the deadline still bounds reads, while cache hits need no budget', () => {
  const cache = warm();
  // #12's entry is for an older head, so #12 is a miss that the deadline defers.
  cache.entries.find(item => item.number === 12).headRefOid = sha('9');
  const result = scan({ prs: PRS(), files: FILES(), cache, deadline: '0' });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [], 'past the deadline nothing is read');
  assert.match(result.log, /reached its 0s budget with 1 PR\(s\) un-hydrated; .*\(inventory incomplete\): #12/u);
  assert.ok(labelled(result, 10).includes('lopu: overlapping files'), 'hits are applied regardless of the deadline');
  assert.equal(saved(result), true, 'the stale entry is dropped and the rest saved');
  assert.deepEqual(result.cache.entries.map(item => item.number), [10, 11]);

  const cold = scan({ prs: PRS(), files: FILES(), deadline: '0' });
  assert.deepEqual(fileReads(cold), []);
  assert.match(cold.log, /reached its 0s budget with 3 PR\(s\) un-hydrated; .*: #10 #11 #12/u);
  assert.equal(saved(cold), false, 'nothing new to save');
});

test('a budget refusal stops further reads instead of hammering a limited API', () => {
  const files = FILES(); files[10] = { default: BUDGET };
  const result = scan({ prs: PRS(), files });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [10], 'no request follows the refusal');
  assert.match(result.log, /::warning::GitHub's shared API budget refused the changed-file inventory; 3 PR\(s\) were not read .*#10 #11 #12/u);
  assert.deepEqual(result.sleeps, []);
  assert.equal(saved(result), false);
});

test('pull_request_target uses the cache but never asks to save it', () => {
  const cache = warm();
  const prs = PRS(); prs[0].headRefOid = sha('f');
  const result = scan({ prs, files: FILES(), cache,
    env: { EVENT_NAME: 'pull_request_target', EVENT_ACTION: 'synchronize', ONLY_PR: '10', SCAN_ALL: 'false' } });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), [10]);
  assert.equal(saved(result), false, 'low-trust events get read-only cache tokens');
  assert.equal(result.after, result.before);
});

test('a scan that dies after hydrating still marks its inventory for the always() save', () => {
  // 25 Nov 2026, job 139078940060: the cold scan read for its full deadline,
  // the per-candidate tail outran timeout-minutes, the job was cancelled, and
  // a success-only save never ran -- so no scan could ever start warm.
  const result = scan({ prs: PRS(), files: FILES(), repoFails: true });
  assert.notEqual(result.status, 0, 'the later failure is still reported');
  assert.deepEqual(fileReads(result), [10, 11, 12]);
  assert.ok(saved(result), 'the marker is written as soon as the inventory is');
  assert.deepEqual(result.cache.entries.map(item => item.number), [10, 11, 12]);
});

test('a marker that arrives with a restored archive is cleared when nothing changed', () => {
  const result = scan({ prs: PRS(), files: FILES(), cache: warm(), marker: true });
  assert.equal(result.status, 0, result.log);
  assert.deepEqual(fileReads(result), []);
  assert.equal(saved(result), false);
});

// ---------- contract ----------

test('the detect job restores before and saves after the scan with pinned, run-unique cache steps', () => {
  const job = workflow.slice(workflow.indexOf('\n  detect:\n'), workflow.indexOf('\n  promotion_validate:\n'));
  assert.match(job, /\n {4}permissions:\n {6}actions: read\n {6}contents: read\n(?: {6}#[^\n]*\n)* {6}pull-requests: write\n {6}issues: write\n {4}outputs:/u,
    'the cache adds no token permission');
  assert.match(job, /- name: Check out the trusted Lopu PR-status helper\n {8}uses: actions\/checkout@[0-9a-f]{40} # v6\.1\.0\n {8}with:\n {10}ref: github-actions\n {10}fetch-depth: 1\n {10}persist-credentials: false\n {10}sparse-checkout: \.github\/scripts\n/u);
  const restore = /\n {6}- uses: actions\/cache\/restore@([0-9a-f]{40}) # v6\.1\.0\n {8}with:\n {10}path: (\S+)\n {10}key: ([^\n]+)\n {10}restore-keys: ([^\n]+)\n/u.exec(job);
  const save = /\n {6}- if: always\(\) && hashFiles\('([^']+)'\) != ''\n {8}uses: actions\/cache\/save@([0-9a-f]{40}) # v6\.1\.0\n {8}with:\n {10}path: (\S+)\n {10}key: ([^\n]+)\n/u.exec(job);
  assert.ok(restore && save, 'both cache steps exist in their exact pinned shape');
  const [, restoreSha, restorePath, restoreKey, restorePrefix] = restore;
  const [, saveMarker, saveSha, savePath, saveKey] = save;
  assert.equal(saveMarker, MARKER, 'the save runs even after a timeout, but only for a marked inventory');
  assert.equal(restoreSha, saveSha, 'restore and save share one audited commit');
  assert.equal(restorePath, CACHE);
  assert.equal(savePath, CACHE);
  assert.match(helper, /^LOPU_PR_FILES_CACHE="\$\{LOPU_PR_FILES_CACHE:-\.lopu-pr-files-cache\.json\}"$/mu, 'the helper reads and writes that path');
  assert.match(helper, /^LOPU_PR_FILES_CACHE_SAVE="\$\{LOPU_PR_FILES_CACHE_SAVE:-\.lopu-pr-files-cache\.save\}"$/mu, 'and writes that marker');
  assert.equal(restoreKey, saveKey);
  assert.equal(saveKey, 'lopu-pr-files-v1-${{ github.run_id }}-${{ github.run_attempt }}', 'entries are immutable, so every save key is run-unique');
  assert.ok(saveKey.startsWith(restorePrefix), 'the restore prefix finds the newest earlier save');
  const order = ['Check out the trusted Lopu PR-status helper', 'actions/cache/restore@', `name: ${SCAN}`, 'actions/cache/save@'].map(text => job.indexOf(text));
  assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), 'checkout, restore, scan, save');
});

test('the scan step sources the trusted helper and carries every PR head into the inventory', () => {
  const body = runBlock(SCAN);
  const sourced = body.indexOf('\n. .github/scripts/pr-files-inventory.sh\n');
  assert.ok(sourced > 0 && sourced < body.indexOf('all_open="$(complete_large_pr_files "$all_open")"'));
  assert.doesNotMatch(body, /complete_large_pr_files\(\) \{/u, 'one definition, in the helper');
  assert.match(body, /\n +headRefName\n +headRefOid\n +baseRefName\n/u, 'GraphQL selects the head commit');
  assert.match(body, /\{number, headRefName, headRefOid, baseRefName, isCrossRepository,/u);
  assert.match(body, /headRefOid:\.head\.sha,/u, 'the exact standing-sync path carries it too');
  assert.match(workflow, /FILES_INVENTORY_DEADLINE_SECONDS: "600"/u);
  assert.ok(Buffer.byteLength(workflow) <= 510000, 'resolve-pr-conflicts.yml stays within the run-graph size limit');
});

test('the helper never evaluates cache content and keeps diagnostics off the captured stdout', () => {
  const code = helper.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /\beval\b|\bsource\b|\. "\$|bash -c|node -e/u);
  assert.ok(code.split('\n').filter(line => line.includes('::warning::')).every(line => line.endsWith('>&2')));
  assert.match(code, /\[ "\$\{EVENT_NAME:-\}" != pull_request_target \]/u);
});

test('control-plane CI runs this suite and TESTING.md documents it', () => {
  assert.match(ci, /node --test [^\n]*\.github\/scripts\/pr-files-inventory-cache\.test\.mjs/u);
  assert.match(testing, /pr-files-inventory-cache\.test\.mjs/u);
});
