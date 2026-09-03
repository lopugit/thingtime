#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const REQUIRED_CATEGORIES = [
  "/language:actions",
  "/language:javascript-typescript",
];
const TRANSIENT_HTTP_STATUS = /\b(?:408|429|500|502|503|504)\b/u;
// An idempotent read can also die below or above the HTTP status line, and
// neither shape carries a status code. A connection torn down mid-response
// reports as a transport string (run 33262097171); a body that stops
// mid-document reports as the decoder's message instead (run 33316907281).
// Status-only matching made both fatal on the first attempt, which is the
// outage resolve-pr-conflicts.yml already retired from its three gh_read_retry
// copies; this helper is the remaining read classifier and needs the same set.
// The widening stays narrow: a genuinely malformed payload (an HTML error
// page, an auth/permission error) carries a different message and still
// surfaces immediately.
//
// This pattern only sees text gh itself produced, where the Go decoder always
// says `unexpected end of JSON input` for a short document regardless of where
// it stopped. When this script does the decoding the message is V8's, which is
// position-specific rather than uniform, so that half is classified
// structurally by isTruncatedJsonRead() below instead of by message.
const TRANSIENT_READ_FAILURE =
  /\b(?:408|429|500|502|503|504)\b|stream error|http2: server sent GOAWAY|connection reset by peer|unexpected EOF|[Uu]nexpected end of JSON input|TLS handshake timeout|i\/o timeout|server closed idle connection|client connection force closed/u;
const CENTRAL_RUN_TITLE = /^Lopu CodeQL PR #(\d+) @ ([0-9a-f]{40,64})$/u;
const ACTIVE_RUN_STATUSES = [
  "queued",
  "in_progress",
  "requested",
  "waiting",
  "pending",
];

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function commandFailureText(error) {
  return [error?.message, error?.stdout, error?.stderr]
    .map((value) => Buffer.isBuffer(value) ? value.toString("utf8") : String(value || ""))
    .filter(Boolean)
    .join("\n");
}

// V8 only says `Unexpected end of JSON input` when a document happens to stop
// on a token boundary. A body cut mid-string or mid-number instead reports a
// positioned message -- `Unterminated string in JSON at position N`, `Expected
// ',' or '}' after property value in JSON at position N` -- so matching the
// end-of-input sentence alone still lost the commonest truncation shapes on the
// runner's Node 22. What separates truncation from corruption is where the
// parse died, not which sentence V8 chose: a short body is a valid prefix and
// always fails at end-of-input, while a corrupt payload (an HTML error page, a
// single-quoted body, a stray token) fails strictly inside the document. Test
// that position rather than tracking V8's message catalogue, which is an
// implementation detail that has already changed once.
export function isTruncatedJsonRead(text, error) {
  if (!(error instanceof SyntaxError)) return false;
  const message = String(error?.message || "");
  if (message.includes("Unexpected end of JSON input")) return true;
  const position = /\bat position (\d+)/u.exec(message);
  if (!position) return false;
  // Compare against the trimmed length so gh's trailing newline cannot make a
  // genuine truncation look like an interior failure.
  return Number(position[1]) >= String(text || "").trimEnd().length;
}

function ghJson(args, { attempts = 4 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let output = "";
    try {
      output = execFileSync("gh", args, {
        encoding: "utf8",
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      // JSON.parse stays inside the try on purpose: when gh exits 0 after a
      // partial write, the truncation surfaces here rather than on stderr, and
      // it is the same recoverable failure one layer up.
      return output.trim() ? JSON.parse(output) : null;
    } catch (error) {
      const failure = commandFailureText(error);
      const transient = TRANSIENT_READ_FAILURE.test(failure)
        || isTruncatedJsonRead(output, error);
      if (attempt === attempts || !transient) {
        throw new Error(`gh ${args.join(" ")} failed: ${failure}`);
      }
      const delaySeconds = 2 ** attempt;
      process.stderr.write(
        `Transient GitHub API failure (attempt ${attempt}/${attempts}); retrying in ${delaySeconds}s.\n`,
      );
      sleep(delaySeconds * 1000);
    }
  }
  throw new Error("GitHub API retry loop ended unexpectedly.");
}

function flattenSlurp(value) {
  assert.ok(Array.isArray(value), "expected gh --slurp output to be an array");
  return value.flatMap((page) => Array.isArray(page) ? page : []);
}

function flattenWorkflowRuns(value) {
  assert.ok(Array.isArray(value), "expected workflow-run pagination to be an array");
  return value.flatMap((page) => page?.workflow_runs || []);
}

function analysisKey(ref, sha) {
  return `${ref}\u0000${sha}`;
}

function prHeadKey(number, sha) {
  return `${Number(number)}:${sha}`;
}

export function completeAnalysisKeys(analyses) {
  const categoriesBySnapshot = new Map();
  for (const analysis of analyses) {
    if (analysis?.tool?.name !== "CodeQL") continue;
    const ref = String(analysis.ref || "");
    const sha = String(analysis.commit_sha || "");
    const category = String(analysis.category || "");
    if (!ref || !sha || !category) continue;
    const key = analysisKey(ref, sha);
    const categories = categoriesBySnapshot.get(key) || new Set();
    categories.add(category);
    categoriesBySnapshot.set(key, categories);
  }

  return new Set(
    [...categoriesBySnapshot.entries()]
      .filter(([, categories]) => REQUIRED_CATEGORIES.every((category) => categories.has(category)))
      .map(([key]) => key),
  );
}

export function activePrHeadKeys(runs) {
  const active = new Set();
  for (const run of runs) {
    const titleMatch = CENTRAL_RUN_TITLE.exec(String(run?.display_title || ""));
    if (titleMatch) active.add(prHeadKey(titleMatch[1], titleMatch[2]));

    for (const pullRequest of run?.pull_requests || []) {
      const number = pullRequest?.number;
      const headSha = pullRequest?.head?.sha;
      if (number && /^[0-9a-f]{40,64}$/u.test(String(headSha || ""))) {
        active.add(prHeadKey(number, headSha));
      }
    }
  }
  return active;
}

export function planBackfill({
  pullRequests,
  completeSnapshots,
  activeHeads,
  analysisSnapshots = new Map(),
  maxDispatches,
}) {
  const ordered = [...pullRequests].sort((left, right) =>
    String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
      || Number(right.number) - Number(left.number));
  const selected = [];

  for (const pullRequest of ordered) {
    const number = Number(pullRequest.number);
    const headSha = String(pullRequest?.head?.sha || "");
    const baseSha = String(pullRequest?.base?.sha || "");
    if (!Number.isSafeInteger(number) || number < 1) continue;
    if (!/^[0-9a-f]{40,64}$/u.test(headSha)) continue;
    if (!/^[0-9a-f]{40,64}$/u.test(baseSha)) continue;
    if (activeHeads.has(prHeadKey(number, headSha))) continue;

    const resolved = analysisSnapshots.get(number);
    const analysisRef = String(resolved?.analysisRef || `refs/pull/${number}/head`);
    const analysisSha = String(resolved?.analysisSha || headSha);
    if (analysisRef !== `refs/pull/${number}/head`
        && analysisRef !== `refs/pull/${number}/merge`) continue;
    if (!/^[0-9a-f]{40,64}$/u.test(analysisSha)) continue;
    if (completeSnapshots.has(analysisKey(analysisRef, analysisSha))) continue;

    selected.push({
      number,
      headSha,
      analysisRef,
      analysisSha,
      updatedAt: pullRequest.updated_at,
    });
    if (selected.length >= maxDispatches) break;
  }
  return selected;
}

function validateEnvironment() {
  const repository = String(process.env.GITHUB_REPOSITORY || "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("GITHUB_REPOSITORY is missing or invalid.");
  }
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required.");

  const maxDispatches = Number(process.env.MAX_DISPATCHES || "4");
  if (!Number.isSafeInteger(maxDispatches) || maxDispatches < 1 || maxDispatches > 20) {
    throw new Error("MAX_DISPATCHES must be an integer from 1 through 20.");
  }
  return { repository, maxDispatches };
}

function listActiveCodeqlRuns(repository) {
  const runs = [];
  for (const status of ACTIVE_RUN_STATUSES) {
    const pages = ghJson([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/actions/workflows/codeql-analysis.yml/runs?status=${status}&per_page=100`,
    ]);
    runs.push(...flattenWorkflowRuns(pages));
  }
  return runs;
}

// `pulls/N.base.sha` is GitHub's cached base pointer and `refs/pull/N/merge`
// is recomputed independently, so the two skew in both directions whenever the
// base branch advances. Accept the live base branch tip as a second valid first
// parent; otherwise a freshly recomputed merge ref reads as stale, the exact
// head is analyzed instead, and Advanced Security opens the PR's aggregate
// CodeQL check against that branch snapshot.
export function analysisSnapshotForPullRequest(pullRequest, mergeCommit = null, baseBranchSha = "") {
  const number = Number(pullRequest?.number);
  const headSha = String(pullRequest?.head?.sha || "");
  const baseSha = String(pullRequest?.base?.sha || "");
  const liveBaseSha = /^[0-9a-f]{40,64}$/u.test(String(baseBranchSha || ""))
    ? String(baseBranchSha)
    : "";
  const mergeSha = String(mergeCommit?.sha || "");
  const parents = (mergeCommit?.parents || []).map((parent) => String(parent?.sha || ""));
  const exactMerge = /^[0-9a-f]{40,64}$/u.test(mergeSha)
    && parents.length === 2
    && (parents[0] === baseSha || (liveBaseSha !== "" && parents[0] === liveBaseSha))
    && parents[1] === headSha;
  return {
    analysisRef: exactMerge ? `refs/pull/${number}/merge` : `refs/pull/${number}/head`,
    analysisSha: exactMerge ? mergeSha : headSha,
  };
}

function optionalPullMergeCommit(repository, number) {
  let mergeRef;
  try {
    mergeRef = ghJson(["api", `repos/${repository}/git/ref/pull/${number}/merge`]);
  } catch (error) {
    if (/\b(?:404|409|422)\b/u.test(String(error?.message || ""))) return null;
    throw error;
  }
  const mergeSha = String(mergeRef?.object?.sha || "");
  if (!/^[0-9a-f]{40,64}$/u.test(mergeSha)) return null;
  try {
    return ghJson(["api", `repos/${repository}/git/commits/${mergeSha}`]);
  } catch (error) {
    if (/\b(?:404|409|422)\b/u.test(String(error?.message || ""))) return null;
    throw error;
  }
}

function optionalBranchTipSha(repository, branch, cache) {
  if (!/^[A-Za-z0-9._/-]+$/u.test(branch)) return "";
  if (cache.has(branch)) return cache.get(branch);
  let tip = "";
  try {
    const ref = ghJson(["api", `repos/${repository}/git/ref/heads/${branch}`]);
    const sha = String(ref?.object?.sha || "");
    if (/^[0-9a-f]{40,64}$/u.test(sha)) tip = sha;
  } catch (error) {
    if (!/\b(?:404|409|422)\b/u.test(String(error?.message || ""))) throw error;
  }
  cache.set(branch, tip);
  return tip;
}

function resolveLiveAnalysisSnapshots(repository, pullRequests) {
  const snapshots = new Map();
  const baseTips = new Map();
  for (const pullRequest of pullRequests) {
    const number = Number(pullRequest.number);
    if (!Number.isSafeInteger(number) || number < 1) continue;
    const mergeCommit = optionalPullMergeCommit(repository, number);
    const baseBranchSha = optionalBranchTipSha(
      repository,
      String(pullRequest?.base?.ref || ""),
      baseTips,
    );
    snapshots.set(number, analysisSnapshotForPullRequest(pullRequest, mergeCommit, baseBranchSha));
  }
  return snapshots;
}

function dispatchAnalysisWithInput(repository, candidate) {
  const payload = JSON.stringify({
    ref: "github-actions",
    inputs: {
      pr_number: String(candidate.number),
      expected_head_sha: candidate.headSha,
      backfill_listener_owned: "true",
    },
  });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      execFileSync("gh", [
        "api",
        "--method",
        "POST",
        `repos/${repository}/actions/workflows/codeql-analysis.yml/dispatches`,
        "--input",
        "-",
      ], {
        input: payload,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return;
    } catch (error) {
      const failure = commandFailureText(error);
      // This POST deliberately keeps the status-only classifier and does not
      // use TRANSIENT_READ_FAILURE. A transport reset or a torn-down body says
      // nothing about whether GitHub already accepted the dispatch, so
      // replaying one could queue a duplicate CodeQL run; a rejecting status
      // is the only evidence that no scan was started.
      if (attempt === 4 || !TRANSIENT_HTTP_STATUS.test(failure)) {
        throw new Error(`CodeQL dispatch for PR #${candidate.number} failed: ${failure}`);
      }
      sleep((2 ** attempt) * 1000);
    }
  }
}

function writeSummary(lines) {
  const body = `${lines.join("\n")}\n`;
  process.stdout.write(body);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
}

function selfTest() {
  const sha = (character) => character.repeat(40);
  const pullRequests = [
    {
      number: 1,
      updated_at: "2026-08-01T00:00:00Z",
      head: { sha: sha("1") },
      base: { sha: sha("a") },
      merge_commit_sha: sha("b"),
    },
    {
      number: 2,
      updated_at: "2026-08-03T00:00:00Z",
      head: { sha: sha("2") },
      base: { sha: sha("a") },
      merge_commit_sha: sha("c"),
    },
    {
      number: 3,
      updated_at: "2026-08-02T00:00:00Z",
      head: { sha: sha("3") },
      base: { sha: sha("a") },
      merge_commit_sha: null,
    },
    {
      number: 4,
      updated_at: "2026-08-04T00:00:00Z",
      head: { sha: sha("4") },
      base: { sha: sha("a") },
      merge_commit_sha: sha("d"),
    },
  ];
  const analyses = [
    ...REQUIRED_CATEGORIES.map((category) => ({
      ref: "refs/pull/1/merge",
      commit_sha: sha("b"),
      category,
      tool: { name: "CodeQL" },
    })),
    ...REQUIRED_CATEGORIES.map((category) => ({
      ref: "refs/pull/4/merge",
      commit_sha: sha("d"),
      category,
      tool: { name: "CodeQL" },
    })),
    {
      ref: "refs/pull/2/merge",
      commit_sha: sha("c"),
      category: REQUIRED_CATEGORIES[0],
      tool: { name: "CodeQL" },
    },
  ];
  const completeSnapshots = completeAnalysisKeys(analyses);
  const activeHeads = activePrHeadKeys([
    {
      display_title: `Lopu CodeQL PR #3 @ ${sha("3")}`,
      pull_requests: [],
    },
  ]);
  const analysisSnapshots = new Map([
    [1, analysisSnapshotForPullRequest(pullRequests[0], {
      sha: sha("b"),
      parents: [{ sha: sha("a") }, { sha: sha("1") }],
    })],
    [2, analysisSnapshotForPullRequest(pullRequests[1], {
      sha: sha("c"),
      parents: [{ sha: sha("a") }, { sha: sha("2") }],
    })],
    [3, analysisSnapshotForPullRequest(pullRequests[2], null)],
    [4, analysisSnapshotForPullRequest(pullRequests[3], {
      sha: sha("d"),
      parents: [{ sha: sha("f") }, { sha: sha("4") }],
    })],
  ]);
  const plan = planBackfill({
    pullRequests,
    completeSnapshots,
    activeHeads,
    analysisSnapshots,
    maxDispatches: 2,
  });
  assert.deepEqual(
    plan.map(({ number, analysisRef, analysisSha }) => ({ number, analysisRef, analysisSha })),
    [
      { number: 4, analysisRef: "refs/pull/4/head", analysisSha: sha("4") },
      { number: 2, analysisRef: "refs/pull/2/merge", analysisSha: sha("c") },
    ],
  );
  assert.equal(completeSnapshots.has(analysisKey("refs/pull/1/merge", sha("b"))), true);
  assert.equal(activeHeads.has(prHeadKey(3, sha("3"))), true);
  assert.deepEqual(analysisSnapshots.get(4), {
    analysisRef: "refs/pull/4/head",
    analysisSha: sha("4"),
  });

  // GitHub refreshes `refs/pull/N/merge` and `pulls/N.base.sha` independently,
  // so a live merge ref legitimately skews from the cached base pointer in
  // either direction once the base branch advances. Only a merge commit that
  // matches neither accepted base is stale. Reading the exact head instead
  // makes Advanced Security bind the PR's aggregate CodeQL check to the branch
  // snapshot and close it `timed_out` when the slow language lands late.
  const skewed = {
    number: 5,
    updated_at: "2026-08-05T00:00:00Z",
    head: { sha: sha("5") },
    base: { sha: sha("a"), ref: "develop" },
  };
  const mergeOf = (first) => ({ sha: sha("e"), parents: [{ sha: first }, { sha: sha("5") }] });
  assert.deepEqual(
    analysisSnapshotForPullRequest(skewed, mergeOf(sha("b")), sha("b")),
    { analysisRef: "refs/pull/5/merge", analysisSha: sha("e") },
    "a merge ref recomputed onto the live base branch tip is current, not stale",
  );
  assert.deepEqual(
    analysisSnapshotForPullRequest(skewed, mergeOf(sha("a")), sha("b")),
    { analysisRef: "refs/pull/5/merge", analysisSha: sha("e") },
    "a merge ref still parented on the cached base pointer stays current",
  );
  assert.deepEqual(
    analysisSnapshotForPullRequest(skewed, mergeOf(sha("a")), ""),
    { analysisRef: "refs/pull/5/merge", analysisSha: sha("e") },
    "an unavailable base branch tip keeps the original cached-base acceptance",
  );
  assert.deepEqual(
    analysisSnapshotForPullRequest(skewed, mergeOf(sha("f")), sha("b")),
    { analysisRef: "refs/pull/5/head", analysisSha: sha("5") },
    "a merge ref matching neither accepted base remains stale and falls back to the head",
  );
  assert.deepEqual(
    analysisSnapshotForPullRequest(skewed, mergeOf("not-a-sha"), "not-a-sha"),
    { analysisRef: "refs/pull/5/head", analysisSha: sha("5") },
    "a malformed base branch tip never widens the stale-merge guard",
  );
  assert.deepEqual(
    analysisSnapshotForPullRequest(
      skewed,
      { sha: sha("e"), parents: [{ sha: sha("b") }, { sha: sha("9") }] },
      sha("b"),
    ),
    { analysisRef: "refs/pull/5/head", analysisSha: sha("5") },
    "the live head parent is still required, so an outdated merge ref is rejected",
  );

  // Exercise the read classifier against real decoder output rather than
  // asserting on the message strings: these are the shapes an inventory
  // response actually takes when it is cut short, and the shapes a broken or
  // hostile endpoint returns instead. Retrying the first group replays an
  // idempotent read; retrying the second would spin four times on a permanent
  // error and bury the real cause.
  const parseFailure = (body) => {
    try {
      JSON.parse(body);
      return null;
    } catch (error) {
      return error;
    }
  };
  const truncated = [
    '{"data":',
    '{"data": {"repository": {"pullRequests": {"nodes": [{"number": 4',
    '[{"data":{"x":1}},{"data":{"y":',
    '{"data": {"title": "a long pull request tit',
    '{"data": {"count": 12',
    '[{"number": 1}, ',
    '{"data": {"nodes": [1, 2',
    // gh writes a trailing newline even when the body above it stopped short.
    '{"data": {"nodes": [1, 2\n',
  ];
  for (const body of truncated) {
    const error = parseFailure(body);
    assert.ok(error, `expected ${JSON.stringify(body)} to fail JSON.parse`);
    assert.equal(
      isTruncatedJsonRead(body, error),
      true,
      `a body that stopped mid-document must be retryable: ${JSON.stringify(body)}`,
    );
  }
  const corrupt = [
    "<html><head><title>502 Bad Gateway</title></head></html>",
    '{"message": "Bad credentials"} trailing',
    '{"a": 1 "b": 2}',
    "[1, 2 3]",
    "{'a': 1}",
    "not json at all",
    '{"a": @}',
  ];
  for (const body of corrupt) {
    const error = parseFailure(body);
    assert.ok(error, `expected ${JSON.stringify(body)} to fail JSON.parse`);
    assert.equal(
      isTruncatedJsonRead(body, error),
      false,
      `a malformed payload must stay fatal: ${JSON.stringify(body)}`,
    );
  }
  // A failed subprocess is classified by TRANSIENT_READ_FAILURE, never by the
  // truncation test, so a non-SyntaxError can never be mistaken for a short read.
  assert.equal(isTruncatedJsonRead("", new Error("gh: command not found")), false);
  assert.equal(
    TRANSIENT_READ_FAILURE.test("unexpected end of JSON input"),
    true,
    "gh's own Go decoder message stays retryable",
  );
  assert.equal(
    TRANSIENT_READ_FAILURE.test("gh: Not Found (HTTP 404)"),
    false,
    "a rejecting status stays fatal",
  );

  process.stdout.write("codeql-open-pr-backfill self-test: OK\n");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const dryRun = process.argv.includes("--dry-run");
  if (process.env.ADVANCED_ENABLED !== "true") {
    writeSummary(["## Lopu CodeQL backfill", "Advanced CodeQL is inactive; no work was dispatched."]);
    return;
  }
  if (process.env.CENTRAL_PR_ENABLED !== "true") {
    writeSummary(["## Lopu CodeQL backfill", "Central PR analysis is inactive; no work was dispatched."]);
    return;
  }

  const { repository, maxDispatches } = validateEnvironment();
  const pullRequests = flattenSlurp(ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/pulls?state=open&per_page=100`,
  ]));
  const analyses = flattenSlurp(ghJson([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/code-scanning/analyses?tool_name=CodeQL&per_page=100`,
  ]));
  const activeRuns = listActiveCodeqlRuns(repository);
  const completeSnapshots = completeAnalysisKeys(analyses);
  // The pull-list `merge_commit_sha` field can lag the live synthetic merge
  // ref. Resolve and parent-check the same current ref used by the analyzer;
  // otherwise a completed snapshot is selected forever as a safe no-op and
  // starves older PRs from the bounded backfill window.
  const analysisSnapshots = resolveLiveAnalysisSnapshots(repository, pullRequests);
  const selected = planBackfill({
    pullRequests,
    completeSnapshots,
    activeHeads: activePrHeadKeys(activeRuns),
    analysisSnapshots,
    maxDispatches,
  });

  if (!dryRun) {
    for (const candidate of selected) dispatchAnalysisWithInput(repository, candidate);
  }
  writeSummary([
    "## Lopu CodeQL backfill",
    `Open PRs inspected: ${pullRequests.length}`,
    `${dryRun ? "Exact scans selected (dry run)" : "Exact scans dispatched"}: ${selected.length}/${maxDispatches}`,
    ...selected.map((candidate) =>
      `- PR #${candidate.number}: ${candidate.analysisRef} @ ${candidate.analysisSha}`),
    selected.length === 0 ? "All current open PR snapshots are already complete or actively scanning." : "",
  ].filter(Boolean));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
