#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const REQUIRED_CATEGORIES = [
  "/language:actions",
  "/language:javascript-typescript",
];
const TRANSIENT_HTTP_STATUS = /\b(?:408|429|500|502|503|504)\b/u;
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

function ghJson(args, { attempts = 4 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = execFileSync("gh", args, {
        encoding: "utf8",
        env: process.env,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return output.trim() ? JSON.parse(output) : null;
    } catch (error) {
      const failure = commandFailureText(error);
      if (attempt === attempts || !TRANSIENT_HTTP_STATUS.test(failure)) {
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
  invalidMergeSnapshots = new Set(),
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
    const mergeSha = String(pullRequest.merge_commit_sha || "");
    if (!Number.isSafeInteger(number) || number < 1) continue;
    if (!/^[0-9a-f]{40,64}$/u.test(headSha)) continue;
    if (!/^[0-9a-f]{40,64}$/u.test(baseSha)) continue;
    if (activeHeads.has(prHeadKey(number, headSha))) continue;

    const mergeRef = `refs/pull/${number}/merge`;
    const mergeSnapshot = analysisKey(mergeRef, mergeSha);
    const useMerge = /^[0-9a-f]{40,64}$/u.test(mergeSha)
      && !invalidMergeSnapshots.has(mergeSnapshot);
    const analysisRef = useMerge ? mergeRef : `refs/pull/${number}/head`;
    const analysisSha = useMerge ? mergeSha : headSha;
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

function validateCompletedMergeSnapshots(repository, pullRequests, completeSnapshots) {
  const invalid = new Set();
  for (const pullRequest of pullRequests) {
    const number = Number(pullRequest.number);
    const mergeSha = String(pullRequest.merge_commit_sha || "");
    const headSha = String(pullRequest?.head?.sha || "");
    const baseSha = String(pullRequest?.base?.sha || "");
    const ref = `refs/pull/${number}/merge`;
    const snapshot = analysisKey(ref, mergeSha);
    if (!mergeSha || !completeSnapshots.has(snapshot)) continue;

    let commit;
    try {
      commit = ghJson(["api", `repos/${repository}/git/commits/${mergeSha}`]);
    } catch (error) {
      // GitHub may retire a synthetic merge object while this read-only
      // inventory is in flight. Treat only that expected race as invalid;
      // authentication/permission/API failures still stop the pass.
      if (/\b(?:404|409|422)\b/u.test(String(error?.message || ""))) {
        invalid.add(snapshot);
        continue;
      }
      throw error;
    }
    const parents = (commit?.parents || []).map((parent) => parent.sha);
    if (parents.length !== 2 || parents[0] !== baseSha || parents[1] !== headSha) {
      invalid.add(snapshot);
    }
  }
  return invalid;
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
  const invalidMergeSnapshots = new Set([
    analysisKey("refs/pull/4/merge", sha("d")),
  ]);
  const plan = planBackfill({
    pullRequests,
    completeSnapshots,
    activeHeads,
    invalidMergeSnapshots,
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
  const invalidMergeSnapshots = validateCompletedMergeSnapshots(
    repository,
    pullRequests,
    completeSnapshots,
  );
  const selected = planBackfill({
    pullRequests,
    completeSnapshots,
    activeHeads: activePrHeadKeys(activeRuns),
    invalidMergeSnapshots,
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
