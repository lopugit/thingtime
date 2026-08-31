#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SYNC_HEAD = "sync/main-into-develop";
const SYNC_BASE = "develop";

class GitHubRequestError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "GitHubRequestError";
    this.status = status;
    this.payload = payload;
  }
}

const exactSha = (name, value) => {
  if (!SHA.test(value)) throw new Error(`${name} must be an exact 40-character commit SHA`);
  return value;
};

const exactPullNumber = (value) => {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error("SYNC_PR_NUMBER must be a positive integer");
  return Number(value);
};

export function assertSyncPullRequestShape({ pull, repository, pullNumber }) {
  assert.equal(pull.number, pullNumber, "GitHub returned a different pull request number");
  assert.equal(pull.head?.repo?.full_name, repository, "sync PR head repository changed");
  assert.equal(pull.base?.repo?.full_name, repository, "sync PR base repository changed");
  assert.equal(pull.head?.ref, SYNC_HEAD, "only the automation-owned sync head may auto-merge");
  assert.equal(pull.base?.ref, SYNC_BASE, "the automation-owned sync PR may target only develop");
}

export function syncMergeDisposition({
  pull,
  repository,
  pullNumber,
  expectedHeadSha,
  expectedMainSha,
  expectedDevelopSha,
  liveMainSha,
  liveDevelopSha,
}) {
  assertSyncPullRequestShape({ pull, repository, pullNumber });

  if (pull.state !== "open") {
    if (pull.merged === true || pull.merged_at) return { outcome: "already-merged" };
    throw new Error("the standing sync PR closed without merging");
  }
  if (liveMainSha !== expectedMainSha) return { outcome: "deferred", reason: "main-moved" };
  if (liveDevelopSha !== expectedDevelopSha) return { outcome: "deferred", reason: "develop-moved" };
  if (pull.head.sha !== expectedHeadSha) return { outcome: "deferred", reason: "head-moved" };
  if (pull.base.sha !== liveDevelopSha) return { outcome: "deferred", reason: "base-refreshing" };
  if (pull.mergeable === false) return { outcome: "conflicting" };
  if (pull.mergeable !== true) return { outcome: "pending" };
  return { outcome: "ready" };
}

export function assertHeadContainsMain({ comparison, mainSha }) {
  assert.equal(
    comparison.merge_base_commit?.sha,
    mainSha,
    "the sync PR head does not contain the exact live main commit",
  );
  assert.ok(
    comparison.status === "ahead" || comparison.status === "identical",
    `unexpected main-to-sync comparison status: ${comparison.status}`,
  );
}

export function headContainsMain({ comparison, mainSha }) {
  return (
    comparison.merge_base_commit?.sha === mainSha
    && (comparison.status === "ahead" || comparison.status === "identical")
  );
}

async function githubRequest({ repository, token, path, method = "GET", body }) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "thingtime-main-develop-sync-merger",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    throw new GitHubRequestError(
      `GitHub ${method} ${path} failed (${response.status}): ${payload?.message || "unknown error"}`,
      response.status,
      payload,
    );
  }
  return payload;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeOutput(name, value) {
  const line = `${name}=${value}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line, "utf8");
  else process.stdout.write(line);
}

function notice(message) {
  process.stdout.write(`::notice::${message}\n`);
}

function warning(message) {
  process.stdout.write(`::warning::${message}\n`);
}

export async function mergeStandingSyncPullRequest({
  repository = process.env.REPO || process.env.GITHUB_REPOSITORY || "",
  token = process.env.GH_TOKEN || "",
  pullNumber = exactPullNumber(process.env.SYNC_PR_NUMBER || ""),
  expectedHeadSha = exactSha("EXPECTED_SYNC_HEAD_SHA", process.env.EXPECTED_SYNC_HEAD_SHA || ""),
  expectedMainSha = exactSha("EXPECTED_MAIN_SHA", process.env.EXPECTED_MAIN_SHA || ""),
  expectedDevelopSha = exactSha("EXPECTED_DEVELOP_SHA", process.env.EXPECTED_DEVELOP_SHA || ""),
  pollAttempts = Number(process.env.SYNC_MERGE_POLL_ATTEMPTS || "12"),
  pollIntervalMs = Number(process.env.SYNC_MERGE_POLL_INTERVAL_MS || "5000"),
  request = githubRequest,
} = {}) {
  if (!REPOSITORY.test(repository)) throw new Error("REPO must be an exact owner/repository name");
  if (!token) throw new Error("GH_TOKEN is required to merge the standing sync PR");
  if (!Number.isSafeInteger(pollAttempts) || pollAttempts < 1 || pollAttempts > 30) {
    throw new Error("SYNC_MERGE_POLL_ATTEMPTS must be an integer from 1 through 30");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 30_000) {
    throw new Error("SYNC_MERGE_POLL_INTERVAL_MS must be an integer from 0 through 30000");
  }

  let disposition = null;
  let pull = null;
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    pull = await request({ repository, token, path: `pulls/${pullNumber}` });
    const [mainRef, developRef] = await Promise.all([
      request({ repository, token, path: "git/ref/heads/main" }),
      request({ repository, token, path: "git/ref/heads/develop" }),
    ]);
    const liveMainSha = exactSha("live main SHA", mainRef.object?.sha || "");
    const liveDevelopSha = exactSha("live develop SHA", developRef.object?.sha || "");
    disposition = syncMergeDisposition({
      pull,
      repository,
      pullNumber,
      expectedHeadSha,
      expectedMainSha,
      expectedDevelopSha,
      liveMainSha,
      liveDevelopSha,
    });
    if (disposition.outcome !== "pending") break;
    if (attempt < pollAttempts) await sleep(pollIntervalMs);
  }

  if (disposition.outcome === "already-merged") {
    writeOutput("outcome", "already-merged");
    notice(`Standing main → develop sync PR #${pullNumber} was already merged.`);
    return disposition;
  }
  if (disposition.outcome === "deferred") {
    writeOutput("outcome", "deferred");
    writeOutput("reason", disposition.reason);
    notice(`Standing sync PR #${pullNumber} deferred safely because ${disposition.reason}.`);
    return disposition;
  }
  if (disposition.outcome === "conflicting") {
    writeOutput("outcome", "conflicting");
    notice(`Standing sync PR #${pullNumber} still conflicts; Lopu conflict resolution retains ownership.`);
    return disposition;
  }
  if (disposition.outcome !== "ready") {
    writeOutput("outcome", "pending");
    notice(`GitHub has not finished computing mergeability for standing sync PR #${pullNumber}.`);
    return { outcome: "pending" };
  }

  const comparison = await request({
    repository,
    token,
    path: `compare/${expectedMainSha}...${expectedHeadSha}`,
  });
  if (!headContainsMain({ comparison, mainSha: expectedMainSha })) {
    writeOutput("outcome", "deferred");
    writeOutput("reason", "head-missing-main");
    notice(`Standing sync PR #${pullNumber} deferred safely because its head does not contain live main.`);
    return { outcome: "deferred", reason: "head-missing-main" };
  }

  let merged;
  try {
    merged = await request({
      repository,
      token,
      path: `pulls/${pullNumber}/merge`,
      method: "PUT",
      body: { sha: expectedHeadSha, merge_method: "merge" },
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && [405, 409, 422].includes(error.status)) {
      writeOutput("outcome", "deferred");
      writeOutput("reason", `github-${error.status}`);
      warning(`GitHub deferred standing sync PR #${pullNumber}: ${error.message}`);
      return { outcome: "deferred", reason: `github-${error.status}` };
    }
    throw error;
  }

  if (merged?.merged !== true || !SHA.test(merged.sha || "")) {
    writeOutput("outcome", "deferred");
    writeOutput("reason", "github-not-merged");
    warning(`GitHub did not merge standing sync PR #${pullNumber}: ${merged?.message || "no reason returned"}`);
    return { outcome: "deferred", reason: "github-not-merged" };
  }

  const liveDevelop = await request({ repository, token, path: "git/ref/heads/develop" });
  const liveDevelopSha = exactSha("post-merge develop SHA", liveDevelop.object?.sha || "");
  const postMergeComparison = await request({
    repository,
    token,
    path: `compare/${expectedMainSha}...${liveDevelopSha}`,
  });
  assertHeadContainsMain({ comparison: postMergeComparison, mainSha: expectedMainSha });

  writeOutput("outcome", "merged");
  writeOutput("merge_sha", merged.sha);
  notice(`Merged standing main → develop sync PR #${pullNumber} at ${merged.sha}.`);
  return { outcome: "merged", mergeSha: merged.sha };
}

async function selfTest() {
  const repository = "lopugit/thingtime";
  const main = "a".repeat(40);
  const develop = "b".repeat(40);
  const head = "c".repeat(40);
  const pull = {
    number: 475,
    state: "open",
    merged: false,
    mergeable: true,
    head: { ref: SYNC_HEAD, sha: head, repo: { full_name: repository } },
    base: { ref: SYNC_BASE, sha: develop, repo: { full_name: repository } },
  };
  const input = {
    pull,
    repository,
    pullNumber: 475,
    expectedHeadSha: head,
    expectedMainSha: main,
    expectedDevelopSha: develop,
    liveMainSha: main,
    liveDevelopSha: develop,
  };

  assert.deepEqual(syncMergeDisposition(input), { outcome: "ready" });
  assert.deepEqual(syncMergeDisposition({ ...input, pull: { ...pull, mergeable: false } }), {
    outcome: "conflicting",
  });
  assert.deepEqual(syncMergeDisposition({ ...input, pull: { ...pull, mergeable: null } }), {
    outcome: "pending",
  });
  assert.deepEqual(syncMergeDisposition({ ...input, liveMainSha: "d".repeat(40) }), {
    outcome: "deferred",
    reason: "main-moved",
  });
  assert.deepEqual(syncMergeDisposition({ ...input, liveDevelopSha: "d".repeat(40) }), {
    outcome: "deferred",
    reason: "develop-moved",
  });
  assert.deepEqual(syncMergeDisposition({ ...input, pull: { ...pull, head: { ...pull.head, sha: main } } }), {
    outcome: "deferred",
    reason: "head-moved",
  });
  assert.deepEqual(syncMergeDisposition({ ...input, pull: { ...pull, state: "closed", merged: true } }), {
    outcome: "already-merged",
  });
  assert.throws(
    () => syncMergeDisposition({ ...input, pull: { ...pull, head: { ...pull.head, ref: "main" } } }),
    /automation-owned sync head/u,
  );
  assert.throws(
    () => syncMergeDisposition({ ...input, pull: { ...pull, base: { ...pull.base, ref: "main" } } }),
    /may target only develop/u,
  );
  assert.doesNotThrow(() =>
    assertHeadContainsMain({
      comparison: { status: "ahead", merge_base_commit: { sha: main } },
      mainSha: main,
    }),
  );
  assert.equal(
    headContainsMain({
      comparison: { status: "ahead", merge_base_commit: { sha: main } },
      mainSha: main,
    }),
    true,
  );
  assert.equal(
    headContainsMain({
      comparison: { status: "diverged", merge_base_commit: { sha: develop } },
      mainSha: main,
    }),
    false,
  );
  assert.throws(
    () =>
      assertHeadContainsMain({
        comparison: { status: "diverged", merge_base_commit: { sha: develop } },
        mainSha: main,
      }),
    /does not contain the exact live main/u,
  );

  const mergeSha = "e".repeat(40);
  let developReads = 0;
  const requests = [];
  const result = await mergeStandingSyncPullRequest({
    repository,
    token: "test-token",
    pullNumber: 475,
    expectedHeadSha: head,
    expectedMainSha: main,
    expectedDevelopSha: develop,
    pollAttempts: 1,
    pollIntervalMs: 0,
    request: async ({ path, method = "GET", body }) => {
      requests.push({ path, method, body });
      if (path === "pulls/475" && method === "GET") return pull;
      if (path === "git/ref/heads/main") return { object: { sha: main } };
      if (path === "git/ref/heads/develop") {
        developReads += 1;
        return { object: { sha: developReads === 1 ? develop : mergeSha } };
      }
      if (path === `compare/${main}...${head}`) {
        return { status: "ahead", merge_base_commit: { sha: main } };
      }
      if (path === "pulls/475/merge" && method === "PUT") {
        assert.deepEqual(body, { sha: head, merge_method: "merge" });
        return { merged: true, sha: mergeSha };
      }
      if (path === `compare/${main}...${mergeSha}`) {
        return { status: "ahead", merge_base_commit: { sha: main } };
      }
      throw new Error(`unexpected self-test request: ${method} ${path}`);
    },
  });
  assert.deepEqual(result, { outcome: "merged", mergeSha });
  assert.equal(
    requests.filter(({ path }) => path === "pulls/475/merge").length,
    1,
    "the happy path submits exactly one terminal merge",
  );
  process.stdout.write("main/develop sync merger: self-test OK\n");
}

if (process.argv.includes("--self-test")) {
  selfTest().catch((error) => {
    process.stderr.write(`::error::${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  mergeStandingSyncPullRequest().catch((error) => {
    process.stderr.write(`::error::${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
