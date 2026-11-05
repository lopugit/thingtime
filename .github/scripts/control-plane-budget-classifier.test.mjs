// Every `gh_read_retry` helper in resolve-pr-conflicts.yml must recognise an
// exhausted PRIMARY installation budget in BOTH wordings GitHub actually
// produces, because a budget reset is one shared, account-wide, self-healing
// condition and never a defect in any PR — yet `set -euo pipefail` publishes
// the resulting red check against every open PR at once.
//
// The first repair paired a status with the fixed string
// `API rate limit exceeded`, which matched neither live shape:
//
//   * REST also answers "API rate limit ALREADY exceeded for site ID
//     installation", so the fixed-string half missed it. Job 119869752588's
//     sibling 119869167700 (`Find merge-conflicting PRs`, run 39781266094)
//     printed "GitHub API read failed without a recoverable transient
//     response" directly above that line and exited 1.
//   * `gh pr list` goes through the GraphQL wrapper, which prints NO HTTP
//     status line at all — "GraphQL: API rate limit already exceeded for site
//     ID installation." — so the status half could never match. Job
//     119869167555 (`Find PRs for Lopu repository review`, same run) died on
//     exactly that line with the deferral sentinel unwritten.
//
// `GH_BUDGET_EXHAUSTED` in codeql-open-pr-backfill.mjs already classifies both
// shapes; these tests pin the shell helpers to the same contract and pin the
// fail-fast halves, so the repair cannot regress into swallowing a real
// permission failure or a retryable secondary limit.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/resolve-pr-conflicts.yml', import.meta.url), 'utf8');
const OPEN = '          gh_read_retry() {\n';
const CLOSE = '\n          }\n';

// Extract the REAL helper bodies rather than a fixture: a fixture copy of a
// classifier is exactly what drifted from production in the first place.
function readers() {
  const found = [];
  for (let at = workflow.indexOf(OPEN); at !== -1; at = workflow.indexOf(OPEN, at + 1)) {
    const body = workflow.slice(at);
    found.push(body.slice(0, body.indexOf(CLOSE) + CLOSE.length).replace(/^          /gmu, ''));
  }
  // detect / review_detect / review. A fourth copy must opt in deliberately.
  assert.equal(found.length, 3, 'resolve-pr-conflicts.yml carries three read-retry helpers');
  return found;
}

const SENTINEL = 'lopu-gh-budget-exhausted';
function run(reader, stub, temp, call = 'gh_read_retry api "repos/o/r/pulls" || echo "status=$?"') {
  return spawnSync('bash', ['-c', `set -euo pipefail\n${stub}${reader}\n${call}\n`], {
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: temp },
  });
}
// `gh` prints its diagnostics on stderr and exits non-zero; a status-bearing
// wrapper appends "(HTTP n)" and the GraphQL wrapper prints no status at all.
// `sleep` is stubbed out because these tests assert on the notices the backoff
// emits, not on its wall-clock: the real 2+4+8s would cost CI 42s for nothing.
const NO_SLEEP = 'sleep() { :; }\n';
const stub = (message) => `${NO_SLEEP}gh() { printf '%s\\n' ${JSON.stringify(message)} >&2; return 1; }\n`;

const EXHAUSTED = [
  // The exact bytes from run 39781266094, plus the wording the earlier repair
  // did match, so fixing "already" cannot drop the original case.
  'gh: API rate limit already exceeded for site ID installation. (HTTP 403)',
  'gh: API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID E402:1198E7 and timestamp 2026-10-22 14:02:55 UTC. (HTTP 403)',
  'gh: HTTP 403: API rate limit exceeded for installation (https://api.github.com/repos/lopugit/thingtime/pulls?state=open)',
  'GraphQL: API rate limit already exceeded for site ID installation.',
];

for (const [index, reader] of readers().entries()) {
  for (const message of EXHAUSTED) {
    test(`reader ${index} defers an exhausted budget: ${message.slice(0, 48)}`, () => {
      const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
      try {
        const result = run(reader, stub(message), temp);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /status=1/u);
        // The sentinel is the only channel to the step's EXIT trap: without it
        // `set -e` kills the step before the trap can publish the empty answer.
        assert.equal(readFileSync(join(temp, SENTINEL), 'utf8'), '');
        assert.match(result.stderr, /shared installation API budget is exhausted/u);
        // The old message actively misdirected diagnosis toward the PR.
        assert.doesNotMatch(result.stderr, /without a recoverable transient response/u);
        // A primary reset can be most of an hour out, so no retry is spent.
        assert.doesNotMatch(result.stderr, /hit a transient failure/u);
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }

  test(`reader ${index} keeps a bare 403 fatal`, () => {
    // A real permission failure must never be laundered into a deferral.
    const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
    try {
      const result = run(reader, stub('gh: Resource not accessible by integration (HTTP 403)'), temp);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /status=1/u);
      assert.match(result.stderr, /Resource not accessible by integration/u);
      assert.doesNotMatch(result.stderr, /budget is exhausted/u);
      assert.throws(() => readFileSync(join(temp, SENTINEL)));
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  test(`reader ${index} keeps a GraphQL permission error fatal`, () => {
    // The `GraphQL:` prefix alone must not stand in for the budget message,
    // or every GraphQL failure would be deferred as an upstream reset.
    const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
    try {
      const result = run(reader, stub('GraphQL: Resource not accessible by integration (repository.pullRequests)'), temp);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /status=1/u);
      assert.doesNotMatch(result.stderr, /budget is exhausted/u);
      assert.doesNotMatch(result.stderr, /hit a transient failure/u);
      assert.throws(() => readFileSync(join(temp, SENTINEL)));
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  test(`reader ${index} keeps a secondary limit on the bounded backoff`, () => {
    // A secondary limit clears in seconds, unlike a primary reset, so it must
    // stay retryable rather than deferring the whole scan.
    const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
    try {
      const result = run(reader, stub('gh: You have exceeded a secondary rate limit (HTTP 429)'), temp);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /hit a transient failure \(attempt 1\/4\)/u);
      assert.throws(() => readFileSync(join(temp, SENTINEL)));
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  test(`reader ${index} clears a stale sentinel on a successful read`, () => {
    // Otherwise one tolerated budget failure would mask every later unrelated
    // failure in the same step as a deferral.
    const temp = mkdtempSync(join(tmpdir(), 'gh-budget-'));
    try {
      const result = run(reader, 'gh() { echo ok; }\n', temp,
        `: >"$RUNNER_TEMP/${SENTINEL}"\ngh_read_retry api "repos/o/r" >/dev/null`);
      assert.equal(result.status, 0, result.stderr);
      assert.throws(() => readFileSync(join(temp, SENTINEL)));
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
}

test('the shell readers and the CodeQL backfill share one budget contract', () => {
  // Three shell copies drifted from the reviewed JS classifier once already;
  // name both ends so the next edit has to move them together.
  const backfill = readFileSync(new URL('./codeql-open-pr-backfill.mjs', import.meta.url), 'utf8');
  assert.match(
    backfill,
    /const GH_BUDGET_EXHAUSTED[\s\S]*API rate limit \(\?:already \)\?exceeded/u,
    'the CodeQL backfill still accepts the "already exceeded" wording',
  );
  for (const reader of readers()) {
    assert.match(reader, /API rate limit \(already \)\?exceeded/u, 'the shell reader accepts both wordings');
    assert.match(reader, /grep -Fq 'GraphQL: '/u, 'the shell reader accepts the status-less GraphQL wrapper');
  }
});
