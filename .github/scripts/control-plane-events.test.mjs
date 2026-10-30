import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { classifyConversation, classifyQueuedConversation, hasAutomationMarker } from './lopu-conversation-gate.mjs';

const workflow = readFileSync(new URL('../workflows/resolve-pr-conflicts.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../workflows/control-plane-ci.yml', import.meta.url), 'utf8');
const marker = '<!-- thingtime-develop-pr-preview -->';
const event = (body, patch = {}) => ({ action: 'created', issue: { pull_request: {} }, comment: { id: 5541425923, user: { type: 'User', login: 'lopugit' }, body }, changes: { body: { from: '' } }, ...patch });

// Evaluate the actual YAML expressions for this intentionally small expression
// subset. No fixture expression duplicates the production admission rules.
function gateExpression(job) {
  const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z_]+:\n/u)[0];
  const expression = block?.match(/\n    if: >-\n((?:      [^\n]*\n)+)/u)?.[1];
  assert.ok(expression, `${job} has an evaluable job gate`);
  return expression;
}
function evaluate(expression, eventName, payload, eligible = 'true', result = 'success') {
  return runInNewContext(expression, {
    github: { event_name: eventName, event: payload, actor: 'lopugit', ref_name: 'main' },
    inputs: { promotion_source_pr: '', promotion_plan_b64: '', maintenance_operation: '', control_dispatch_id: '', ref_race_handoff: false },
    needs: { conversation_gate: { result, outputs: { eligible } }, route: { result: 'success', outputs: { execute: 'true' } } },
    cancelled: () => false,
    startsWith: (value, prefix) => String(value ?? '').toLowerCase().startsWith(prefix.toLowerCase()),
  });
}

for (const eventName of ['issue_comment', 'pull_request_review_comment']) {
  for (const action of ['created', 'edited']) {
    test(`${eventName}/${action}: PAT preview update stops before any runner or provider routing`, () => {
      const payload = event(`${marker}\n### Preview ready`, { action });
      assert.equal(evaluate(gateExpression('conversation_gate'), eventName, payload), false);
      assert.equal(evaluate(gateExpression('route'), eventName, payload, '', 'skipped'), false);
      assert.equal(classifyConversation(eventName, payload).eligible, false);
    });
    test(`${eventName}/${action}: human question and quoted automation reach review`, () => {
      for (const body of ['Please investigate this', `> ${marker}\n> Preview failed\n\nCan you fix this?`, `What about this example?\n\`\`\`html\n${marker}\n\`\`\``]) {
        const payload = event(body, { action });
        assert.equal(evaluate(gateExpression('conversation_gate'), eventName, payload), true);
        assert.equal(classifyConversation(eventName, payload).eligible, true);
        assert.equal(evaluate(gateExpression('route'), eventName, payload), true);
        assert.equal(evaluate(gateExpression('review_detect'), eventName, payload), true);
      }
    });
  }
  test(`${eventName}: bot, empty, unchanged, removed and trailing markers fail closed`, () => {
    const cases = [
      event('hello', { comment: { user: { type: 'Bot' }, body: 'hello' } }),
      event('   '),
      event('same', { action: 'edited', changes: { body: { from: 'same' } } }),
      event('marker removed', { action: 'edited', changes: { body: { from: `${marker}\nold status` } } }),
      event(`Preview result\n\n${marker}`),
      event(` \t<!--THINGTIME-ai-rebase-result:v1 -->\nReady`),
    ];
    for (const payload of cases) {
      assert.equal(classifyConversation(eventName, payload).eligible, false);
      assert.equal(evaluate(gateExpression('route'), eventName, payload, 'false'), false);
    }
    assert.equal(evaluate(gateExpression('route'), eventName, event('hello'), '', 'failure'), false);
  });
}

test('missing author, unrelated issue, deleted event and malformed body never admit', () => {
  for (const payload of [event('x', { issue: {} }), event('x', { action: 'deleted' }), event('x', { comment: {} }), event(null)]) {
    assert.equal(classifyConversation('issue_comment', payload).eligible, false);
  }
});
test('skipped conversation gate preserves non-comment routing, including real failures', () => {
  for (const eventName of ['push', 'schedule', 'workflow_dispatch', 'repository_dispatch', 'pull_request_target']) {
    assert.equal(evaluate(gateExpression('route'), eventName, event(''), '', 'skipped'), true);
  }
  for (const eventName of ['check_run', 'workflow_run']) {
    assert.equal(evaluate(gateExpression('route'), eventName, { [eventName]: { pull_requests: [{ number: 624 }], conclusion: 'failure' } }, '', 'skipped'), true);
  }
});
test('only unquoted standalone markers suppress, with fence and whitespace variations', () => {
  for (const body of [`> ${marker}`, `\t${marker}`, `    ${marker}`, `\`\`\`html\n${marker}\n\`\`\``, `~~~\n${marker}\n~~~`, `Does \`${marker}\` matter?`]) assert.equal(hasAutomationMarker(body), false);
  assert.equal(hasAutomationMarker(`\`\`\`\nexample\n\`\`\`\n${marker}`), true);
  assert.equal(hasAutomationMarker(`> quoted\n\n${marker}`), true);
});
test('CI concurrency isolates unrelated PRs and refs while superseding the same PR', () => {
  const template = ci.match(/^  group: (.+)$/mu)?.[1];
  assert.ok(template);
  const key = (number, ref) => template.replace(/\$\{\{(.+?)\}\}/gu, (_, expr) => runInNewContext(expr, { github: { event: { pull_request: { number } }, ref } }));
  const keys = [key(624, 'refs/pull/624/merge'), key(625, 'refs/pull/625/merge'), key(null, 'refs/heads/github-actions'), key(null, 'refs/heads/main')];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(key(624, 'refs/pull/624/merge'), key(624, 'refs/pull/624/merge'));
  assert.match(ci, /cancel-in-progress: true/u);
  assert.match(template, /^workflow-control-plane-ci-/u);
});
test('every rebase comment-producing step carries an unconditional automation marker', () => {
  const rebase = readFileSync(new URL('../workflows/rebase-pr-stacks.yml', import.meta.url), 'utf8');
  const writers = rebase.split(/\n      - /u).filter(step => step.includes('gh pr comment'));
  assert.equal(writers.length, 4);
  for (const step of writers) assert.match(step, /<!-- thingtime-ai-rebase-(?:ref-race|result|failure|post-push):v1 -->/u);
});
test('event safety tests block CI and classifier always uses the protected checkout', () => {
  const verify = ci.split('\n  verify:\n')[1].split('\n  contract-advisories:')[0];
  assert.match(verify, /node --test \.github\/scripts\/control-plane-events.test.mjs \.github\/scripts\/preview-comments.test.mjs/u);
  const admission = workflow.split('\n  conversation_gate:\n')[1].split('\n  route:')[0];
  assert.match(admission, /ref: github-actions\n\s+persist-credentials: false/u);
  assert.doesNotMatch(admission, /secrets\.|comment\.body.*\}\}/u);
  assert.match(workflow, /id: prepare\n\s+if: steps\.conversation\.outputs\.eligible == 'true'/u);
  assert.match(workflow, /run: node trusted\/\.github\/scripts\/lopu-conversation-gate.mjs --queued/u);
});

test('queued legacy signals recheck the live comment before spending on a model', async () => {
  for (const [kind, endpoint] of [['issue-comment', 'issues'], ['inline-comment', 'pulls']]) {
    const args = { dispatchId: `lopu-review:${kind}:42:100`, repository: 'example/project', prNumber: '624' };
    const comment = { id: 42, user: { type: 'User' }, body: `${marker}\nReady`, [`${endpoint === 'issues' ? 'issue' : 'pull_request'}_url`]: `https://api.github.com/repos/example/project/${endpoint}/624` };
    const readComment = async path => { assert.equal(path, `repos/example/project/${endpoint}/comments/42`); return comment; };
    assert.equal((await classifyQueuedConversation({ ...args, readComment })).eligible, false);
    comment.body = `> ${marker}\nCan you help?`;
    assert.equal((await classifyQueuedConversation({ ...args, readComment })).eligible, true);
    assert.equal((await classifyQueuedConversation({ ...args, readComment: async () => null })).eligible, false);
    await assert.rejects(classifyQueuedConversation({ ...args, readComment: async () => { throw new Error('transport'); } }));
    await assert.rejects(classifyQueuedConversation({ ...args, prNumber: '625', readComment }));
  }
});

test('every routing descendant handles an intentionally skipped conversation ancestor', () => {
  // Actions injects success() when no status function is present. A skipped
  // conversation_gate propagates through a successful route to its descendants.
  // Test the dependency graph, not only route's own expression (PR #592).
  const blocks = [...workflow.matchAll(/^  ([a-z_]+):\n([\s\S]*?)(?=^  [a-z_]+:\n|$(?![\s\S]))/gm)];
  const descendants = new Set(['conversation_gate']);
  const pending = blocks.map(([,name,block]) => ({name,block}));
  for (let pass = 0; pass < pending.length; pass++) {
    for (const {name,block} of pending) {
      const needs = block.match(/^    needs: (.+)$/m)?.[1]?.match(/[a-z_]+/g) ?? [];
      if (!needs.some(name => descendants.has(name))) continue;
      descendants.add(name);
      assert.match(gateExpression(name), /\b(?:always|cancelled)\s*\(/,
        `${name} silently skips after the non-comment admission job`);
    }
  }
  assert.ok(descendants.has('detect') && descendants.has('handoff') && descendants.has('resolve'));
});

// Large PR file inventories made the 100-PR GraphQL page repeatedly time out.
test('detector bounds GraphQL work per page without truncating the inventory', () => {
  const query = workflow.slice(workflow.indexOf('          all_open_prs() {'));
  assert.match(query, /gh_read_retry graphql --paginate --slurp/);
  assert.match(query, /pullRequests\(\s*first: 10,\s*states: OPEN,\s*after: \$endCursor/);
  assert.match(query, /pageInfo \{ hasNextPage endCursor \}/);
});

test('expensive diffs cannot poison the shared PR metadata inventory', () => {
  const inventory = workflow.split('          all_open_prs() {')[1].split('          complete_large_pr_files()')[0];
  assert.doesNotMatch(inventory, /files\(first:|changedFiles/);
  assert.match(inventory, /filesIncomplete:true/);
  assert.match(workflow, /select\(\.filesIncomplete == true or/);
  assert.match(workflow, /filesIncomplete:false/);
});

test('an unavailable diff preserves incomplete state while another PR hydrates', () => {
  const helper = workflow.slice(workflow.indexOf('          complete_large_pr_files() {'), workflow.indexOf('          query() {')).replace(/^          /gm, '');
  const temp = mkdtempSync(join(tmpdir(), 'pr-inventory-'));
  try {
    const script = `set -euo pipefail
    gh_read_retry() {
      case "$*" in *pulls/1/files*) return 1;; esac
      echo '[[{"filename":"app.ts"}]]'
    }
    ${helper}
    complete_large_pr_files '[{"number":1,"files":[],"filesTotal":0,"filesIncomplete":true},{"number":2,"files":[],"filesTotal":0,"filesIncomplete":true}]'`;
    const result = spawnSync('bash', ['-c', script], {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp,REPO:'owner/repo'}});
    assert.equal(result.status,0,result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.equal(rows[0].filesIncomplete,true);
    assert.deepEqual(rows[1].files,['app.ts']);
    assert.equal(rows[1].filesIncomplete,false);
    assert.match(result.stderr,/inventory incomplete/);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

// GitHub answers an exhausted PRIMARY installation budget with HTTP 403 and
// "API rate limit exceeded", never 429. Status-only matching therefore classed
// the single most self-healing condition the API has as non-transient, and
// `set -e` published a red check on every open PR for an upstream budget reset
// (observed 2026-10-27: 112 occurrences in job 122051615523, then again in
// runs 40466388995 / 40467017867). Run the REAL helper against a stubbed `gh`.
const readRetry = (marker, call) => {
  const body = workflow.slice(workflow.indexOf(marker));
  return body.slice(0, body.indexOf('\n          }\n') + 13).replace(/^          /gm, '')
    + `\n${call}\n`;
};
const ghStub = (status, message) => `gh() { echo '${message} (HTTP ${status})' >&2; return 1; }\n`;

test('an exhausted shared API budget is recorded for deferral, not called non-transient', () => {
  const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
  try {
    const script = 'set -euo pipefail\n'
      + ghStub(403, 'gh: API rate limit exceeded for installation')
      + readRetry('          gh_read_retry() {\n            local attempt delay output errors transport slow_diff\n            transport=', 'gh_read_retry pr list || echo "status=$?"');
    const result = spawnSync('bash', ['-c', script], {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status=1/);
    // The sentinel the step's EXIT trap consults.
    assert.ok(readFileSync(join(temp, 'lopu-gh-budget-exhausted'), 'utf8') === '');
    assert.match(result.stderr, /shared installation API budget is exhausted/);
    // The old message actively misdirected diagnosis; it must be gone.
    assert.doesNotMatch(result.stderr, /without a recoverable transient response/);
    // A budget reset is not clearable by a 2-8s backoff: no retry is spent.
    assert.doesNotMatch(result.stderr, /hit a transient failure/);
  } finally { rmSync(temp, {recursive:true, force:true}); }
});

test('a bare 403 still fails fast and a 429 still retries transiently', () => {
  const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
  const marker = '          gh_read_retry() {\n            local attempt delay output errors transport slow_diff\n            transport=';
  try {
    // A real permission failure must not be mistaken for a budget reset.
    const denied = spawnSync('bash', ['-c', 'set -euo pipefail\n'
      + ghStub(403, 'gh: Resource not accessible by integration')
      + readRetry(marker, 'gh_read_retry pr list || echo "status=$?"')],
      {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(denied.status, 0, denied.stderr);
    assert.match(denied.stdout, /status=1/);
    assert.match(denied.stderr, /Resource not accessible by integration/);
    assert.doesNotMatch(denied.stderr, /budget is exhausted/);
    assert.doesNotMatch(denied.stderr, /hit a transient failure/);
    assert.throws(() => readFileSync(join(temp, 'lopu-gh-budget-exhausted')));

    // A secondary limit keeps the existing bounded backoff.
    const secondary = spawnSync('bash', ['-c', 'set -euo pipefail\n'
      + ghStub(429, 'gh: You have exceeded a secondary rate limit')
      + readRetry(marker, 'gh_read_retry pr list || echo "status=$?"')],
      {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(secondary.status, 0, secondary.stderr);
    assert.match(secondary.stderr, /hit a transient failure \(attempt 1\/4\)/);
    assert.throws(() => readFileSync(join(temp, 'lopu-gh-budget-exhausted')));
  } finally { rmSync(temp, {recursive:true, force:true}); }
});

test('a later successful read clears a stale budget sentinel', () => {
  // Otherwise one tolerated budget failure would mask every unrelated
  // failure later in the same step as a deferral.
  const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
  try {
    const script = 'set -euo pipefail\n'
      + 'gh() { echo ok; }\n'
      + readRetry('          gh_read_retry() {\n            local attempt delay output errors transport slow_diff\n            transport=',
        ': >"$RUNNER_TEMP/lopu-gh-budget-exhausted"\ngh_read_retry pr list >/dev/null');
    const result = spawnSync('bash', ['-c', script], {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => readFileSync(join(temp, 'lopu-gh-budget-exhausted')));
  } finally { rmSync(temp, {recursive:true, force:true}); }
});

test('both PR-facing detectors defer an exhausted budget instead of reporting red', () => {
  // The red checks that motivated this repair: a repository-wide budget reset
  // must resolve to each step's existing "nothing to do" answer, not a failure
  // published onto every open PR.
  for (const [step, outputs] of [['prs=[]\\nany=false', /prs=\[\]\nany=false/], ['any=false', /any=false/]]) {
    assert.ok(workflow.includes(step));
    void outputs;
  }
  const traps = [...workflow.matchAll(/defer_on_exhausted_budget\(\) \{\n([\s\S]*?)\n          \}\n          trap defer_on_exhausted_budget EXIT/g)];
  assert.equal(traps.length, 2, 'both PR-facing detectors install the deferral trap');
  const temp = mkdtempSync(join(tmpdir(), 'gh-defer-'));
  try {
    for (const [, body] of traps) {
      const fn = `defer_on_exhausted_budget() {\n${body.replace(/^          /gm, '')}\n}\n`;
      const run = (seed) => spawnSync('bash', ['-c',
        `set -euo pipefail\nLOPU_GH_BUDGET_SENTINEL="$RUNNER_TEMP/s"\n${seed}\n${fn}`
        + 'trap defer_on_exhausted_budget EXIT\nfalse\n'],
        {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp,GITHUB_OUTPUT:join(temp,'out')}});

      rmSync(join(temp,'out'), {force:true});
      const deferred = run(': >"$LOPU_GH_BUDGET_SENTINEL"');
      assert.equal(deferred.status, 0, 'an exhausted budget defers with a green step');
      assert.match(deferred.stdout, /::notice::Deferring this/);
      assert.match(readFileSync(join(temp,'out'),'utf8'), /any=false/);

      rmSync(join(temp,'out'), {force:true});
      rmSync(join(temp,'s'), {force:true});
      const genuine = run(':');
      assert.equal(genuine.status, 1, 'an unrelated failure still fails the step');
      assert.doesNotMatch(genuine.stdout, /Deferring/);
    }
  } finally { rmSync(temp, {recursive:true, force:true}); }
});

// The rebase-stack detector is the third PR-facing detector, and it was the
// last one still converting a shared installation budget into a red check: on
// 2026-10-29 runs 40859189317 and 40859332671 both died in 5s at its very first
// read ("API rate limit exceeded for installation ... (HTTP 403)") and reddened
// `Find stack members that need rebasing` on PR #832. It owns no state and
// republishes targets from live topology on every push/dispatch/sweep, so the
// correct answer to an account-wide budget reset is its existing "nothing to
// rebase" answer, not a failure attributed to the pushed PR.
const rebaseWorkflow = readFileSync(new URL('../workflows/rebase-pr-stacks.yml', import.meta.url), 'utf8');
const rebaseReadRetry = (call) => {
  const marker = '          gh_read_retry() {\n            local attempt delay output errors transport slow_diff\n            transport=';
  const body = rebaseWorkflow.slice(rebaseWorkflow.indexOf(marker));
  assert.ok(rebaseWorkflow.includes(marker), 'the rebase detector carries the shared read-retry helper');
  return 'LOPU_GH_BUDGET_SENTINEL="$RUNNER_TEMP/lopu-gh-budget-exhausted"\n'
    + body.slice(0, body.indexOf('\n          }\n') + 13).replace(/^          /gm, '')
    + `\n${call}\n`;
};

test('the rebase detector routes every scan read through the retrying reader', () => {
  // A single unrouted read re-arms the whole defect, because `set -euo pipefail`
  // kills the step before the EXIT trap can reach its deferral branch.
  const step = rebaseWorkflow.slice(
    rebaseWorkflow.indexOf('      - name: Scan open same-repository PRs via the API'),
  );
  const scan = step.slice(0, step.indexOf('\n  ai_rebase:') + 1 || undefined);
  for (const read of [
    'repos/$REPO/pulls?state=open&per_page=100',
    'repos/$REPO',
    'repos/$REPO/git/ref/heads/$encoded',
    'repos/$REPO/branches/$encoded',
    'repos/$REPO/pulls/$number',
    'repos/$REPO/issues/$number/comments?per_page=100',
    'repos/$REPO/issues/$number/events?per_page=100',
  ]) {
    const line = scan.split('\n').find((candidate) => candidate.includes(read));
    assert.ok(line, `the rebase scan still reads ${read}`);
    assert.match(line, /gh_read_retry api /u, `${read} is read through gh_read_retry`);
  }
});

test('the rebase detector defers an exhausted budget with its empty answer', () => {
  const traps = [...rebaseWorkflow.matchAll(/defer_on_exhausted_budget\(\) \{\n([\s\S]*?)\n          \}\n          trap defer_on_exhausted_budget EXIT/gu)];
  assert.equal(traps.length, 1, 'the rebase detector installs exactly one deferral trap');
  const temp = mkdtempSync(join(tmpdir(), 'rebase-defer-'));
  try {
    const fn = `defer_on_exhausted_budget() {\n${traps[0][1].replace(/^          /gm, '')}\n}\n`;
    const run = (seed) => spawnSync('bash', ['-c',
      `set -euo pipefail\nLOPU_GH_BUDGET_SENTINEL="$RUNNER_TEMP/s"\n${seed}\n${fn}`
      + 'trap defer_on_exhausted_budget EXIT\nfalse\n'],
      {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp,GITHUB_OUTPUT:join(temp,'out')}});

    rmSync(join(temp,'out'), {force:true});
    const deferred = run(': >"$LOPU_GH_BUDGET_SENTINEL"');
    assert.equal(deferred.status, 0, 'an exhausted budget defers with a green step');
    assert.match(deferred.stdout, /::notice::Deferring this rebase scan/u);
    // Both outputs, or the downstream `any == 'true'` gate reads an unset value
    // while `targets` keeps a stale payload from a duplicate key.
    const outputs = readFileSync(join(temp,'out'),'utf8');
    assert.match(outputs, /targets=\[\]/u);
    assert.match(outputs, /any=false/u);

    rmSync(join(temp,'out'), {force:true});
    rmSync(join(temp,'s'), {force:true});
    const genuine = run(':');
    assert.equal(genuine.status, 1, 'an unrelated failure still fails the step');
    assert.doesNotMatch(genuine.stdout, /Deferring/u);
  } finally { rmSync(temp, {recursive:true, force:true}); }
});

test('the rebase reader defers a primary budget 403 and keeps a bare 403 fatal', () => {
  const temp = mkdtempSync(join(tmpdir(), 'rebase-budget-'));
  try {
    const exhausted = spawnSync('bash', ['-c', 'set -euo pipefail\n'
      + ghStub(403, 'gh: API rate limit exceeded for installation')
      + rebaseReadRetry('gh_read_retry api "repos/o/r/pulls" || echo "status=$?"')],
      {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(exhausted.status, 0, exhausted.stderr);
    assert.match(exhausted.stdout, /status=1/u);
    assert.equal(readFileSync(join(temp, 'lopu-gh-budget-exhausted'), 'utf8'), '');
    assert.match(exhausted.stderr, /shared installation API budget is exhausted/u);
    // The published reset is most of an hour out, so no retry is spent on it.
    assert.doesNotMatch(exhausted.stderr, /hit a transient failure/u);

    rmSync(join(temp, 'lopu-gh-budget-exhausted'), {force:true});
    const denied = spawnSync('bash', ['-c', 'set -euo pipefail\n'
      + ghStub(403, 'gh: Resource not accessible by integration')
      + rebaseReadRetry('gh_read_retry api "repos/o/r/pulls" || echo "status=$?"')],
      {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(denied.status, 0, denied.stderr);
    assert.match(denied.stdout, /status=1/u);
    assert.match(denied.stderr, /Resource not accessible by integration/u);
    assert.doesNotMatch(denied.stderr, /budget is exhausted/u);
    assert.throws(() => readFileSync(join(temp, 'lopu-gh-budget-exhausted')));

    // A successful read clears a stale sentinel, so one tolerated budget
    // failure cannot mask an unrelated failure later in the same step.
    const cleared = spawnSync('bash', ['-c', 'set -euo pipefail\n'
      + 'gh() { echo ok; }\n'
      + rebaseReadRetry(': >"$RUNNER_TEMP/lopu-gh-budget-exhausted"\ngh_read_retry api "repos/o/r" >/dev/null')],
      {encoding:'utf8',env:{...process.env,RUNNER_TEMP:temp}});
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.throws(() => readFileSync(join(temp, 'lopu-gh-budget-exhausted')));
  } finally { rmSync(temp, {recursive:true, force:true}); }
});
