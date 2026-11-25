import assert from "node:assert/strict";
import test from "node:test";
import { decideRun, FORCE_GRACE_MS, JOB_LIMIT_MS, jobFamily, sweep } from "./lopu-stuck-run-sweeper.mjs";

const NOW = Date.parse("2026-11-25T07:30:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const run = (extra = {}) => ({ id: 1, status: "in_progress", path: ".github/workflows/resolve-pr-conflicts.yml", updated_at: ago(60_000), ...extra });
const job = (name, status, extra = {}) => ({ name, status, conclusion: null, started_at: null, completed_at: null, ...extra });

test("a job past the hour is cancelled, then force-cancelled when the cancel is ignored", () => {
  const hung = (age) => [job("Lopu builds and repairs the all branch", "in_progress", { started_at: ago(age) })];
  assert.equal(decideRun(run(), hung(59 * 60_000), NOW).action, "none");
  assert.equal(decideRun(run(), hung(JOB_LIMIT_MS), NOW).action, "cancel");
  assert.equal(decideRun(run(), hung(JOB_LIMIT_MS + FORCE_GRACE_MS), NOW).action, "force-cancel");
});

test("runs only waiting for the fleet lane are never touched", () => {
  const waiting = [job("Lopu reviews selected PRs", "queued"), job("route", "completed", { conclusion: "success", completed_at: ago(6 * 3_600_000) })];
  assert.equal(decideRun(run({ updated_at: ago(6 * 3_600_000) }), waiting, NOW).action, "none");
});

test("a batch stops after three consecutive failures of one matrix family while more are waiting", () => {
  const failed = (n, minutesAgo) => job(`Resolve PR #${n}`, "completed", { conclusion: "failure", completed_at: ago(minutesAgo * 60_000) });
  const batch = [failed(1127, 60), failed(1132, 40), failed(1126, 20), job("Resolve PR #1156", "queued"), job("Resolve PR #1092", "queued")];
  const decision = decideRun(run(), batch, NOW);
  assert.equal(decision.action, "cancel");
  assert.match(decision.reason, /Resolve PR #/);
  const recovered = [...batch.slice(0, 2), job("Resolve PR #1126", "completed", { conclusion: "success", completed_at: ago(10 * 60_000) }), ...batch.slice(3)];
  assert.equal(decideRun(run(), recovered, NOW).action, "none", "a success breaks the streak");
  assert.equal(decideRun(run(), batch.slice(0, 3), NOW).action, "none", "nothing left to stop");
});

test("a ghost run with no live job for an hour is force-cancelled", () => {
  const done = [job("Find merge-conflicting PRs", "completed", { conclusion: "cancelled", completed_at: ago(30 * 24 * 3_600_000) })];
  assert.equal(decideRun(run({ updated_at: ago(30 * 24 * 3_600_000) }), done, NOW).action, "force-cancel");
  assert.equal(decideRun(run({ updated_at: ago(10 * 60_000) }), done, NOW).action, "none");
});

test("runs outside the Lopu fleet workflows are out of scope", () => {
  const long = [job("Build iOS archive", "in_progress", { started_at: ago(3 * 3_600_000) })];
  assert.equal(decideRun(run({ path: ".github/workflows/ios-testflight.yml" }), long, NOW).action, "none");
  assert.equal(decideRun(run({ path: ".github/workflows/all-branch.yml" }), long, NOW).action, "force-cancel");
  assert.equal(jobFamily("Resolve PR #1145"), "Resolve PR #");
});

test("sweep cancels through the API, honours dry run and defers on an exhausted budget", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  const respond = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = async (url, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
    if (url.includes("/actions/runs?")) return respond(200, { workflow_runs: [run({ id: 7, display_title: "Lopu scans PRs" }), run({ id: 8, path: ".github/workflows/web-ci.yml" })] });
    if (url.includes("/runs/7/jobs")) return respond(200, { jobs: [job("Lopu builds and repairs the all branch", "in_progress", { started_at: ago(2 * JOB_LIMIT_MS) })] });
    return respond(202, null);
  };
  try {
    const log = () => {};
    assert.deepEqual((await sweep({ repo: "o/r", token: "t", now: NOW, dryRun: true, log })).map((a) => a.action), ["force-cancel"]);
    assert.ok(!calls.some((call) => call.startsWith("POST")), "dry run never posts");
    await sweep({ repo: "o/r", token: "t", now: NOW, log });
    assert.ok(calls.includes("POST /repos/o/r/actions/runs/7/force-cancel"));
    assert.ok(!calls.some((call) => call.includes("/runs/8/")), "non-fleet runs are never inspected");
    globalThis.fetch = async () => respond(403, { message: "API rate limit exceeded for installation" });
    const notes = [];
    assert.deepEqual(await sweep({ repo: "o/r", token: "t", now: NOW, log: (line) => notes.push(line) }), []);
    assert.match(notes.join("\n"), /budget is exhausted/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
