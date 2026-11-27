import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findPendingReview, readGitHub, reviewScope } from "./lopu-review-queue.mjs";

const repo = "example/project";
const url = `https://github.com/${repo}/actions/runs/123`;
const run = {
  event: "workflow_dispatch", head_branch: "github-actions", actor: { login: "github-actions[bot]" },
  path: ".github/workflows/resolve-pr-conflicts.yml", display_title: reviewScope("627").title,
  status: "pending", created_at: "2020-01-01T00:00:00Z",
};
const worker = { name: "Lopu reviews selected PRs", status: "pending", steps: [] };
function fixture({ member = {}, metadata = {}, jobs = [worker], queueError, jobPages } = {}) {
  const calls = [];
  const read = async (path, options) => {
    calls.push({ path, options });
    if (path.includes("/concurrency_groups/")) {
      if (queueError) throw queueError;
      return { total_count: 1, group_members: [{ run_id: 123, status: "in_progress", ...member }] };
    }
    if (path.endsWith("/123")) return { ...run, ...metadata };
    if (path.endsWith("/jobs?per_page=100")) return jobPages || [{ total_count: jobs.length, jobs }];
    throw new Error(`Unexpected read: ${path}`);
  };
  return { calls, find: (input = {}) => findPendingReview({ repo, prNumber: "627", eventName: "check_run", read, ...input }) };
}

test("finds an old fleet waiter without scanning the most recent 100 dispatches", async () => {
  const f = fixture();
  assert.equal(await f.find(), url);
  assert.equal(f.calls[0].path, `repos/${repo}/actions/concurrency_groups/lopu-review-627`);
  assert.ok(f.calls.every(({ path }) => !path.includes("/workflows/")));
  assert.deepEqual(f.calls.at(-1).options, { paginate: true });
});

test("also recognizes an unadmitted outer workflow with no jobs", async () => {
  assert.equal(await fixture({ member: { status: "pending" }, jobs: [] }).find(), url);
});

test("does not mistake running or completed reviews for unstarted work", async () => {
  for (const status of ["in_progress", "completed"]) {
    assert.equal(await fixture({ jobs: [{ ...worker, status }] }).find(), "");
  }
  assert.equal(await fixture({ jobs: [{ ...worker, steps: [{ name: "Set up job", status: "completed" }] }] }).find(), "");
  assert.equal(await fixture({ jobs: [] }).find(), "", "a holder whose job has not materialized is not proven safe");
});

test("human conversation bypasses coalescing without even reading the queue", async () => {
  for (const eventName of ["issue_comment", "pull_request_review_comment"]) {
    const f = fixture();
    assert.equal(await f.find({ eventName }), "");
    assert.equal(f.calls.length, 0);
  }
});

test("checks provenance and exact scope, not just the concurrency group name", async () => {
  for (const metadata of [
    { actor: { login: "someone" } }, { head_branch: "feature" }, { event: "push" },
    { path: ".github/workflows/different.yml" }, { display_title: reviewScope("628").title }, { status: "completed" },
  ]) assert.equal(await fixture({ metadata }).find(), "");
  assert.equal(await fixture({ member: { job_id: 789 } }).find(), "");
});

test("reads every jobs page before deciding; a late-page completed worker is not a waiter", async () => {
  const early = Array.from({ length: 100 }, () => ({ name: "Other job", status: "completed" }));
  const jobPages = [{ total_count: 101, jobs: early }, { total_count: 101, jobs: [{ ...worker, status: "completed" }] }];
  assert.equal(await fixture({ jobPages }).find(), "");
  jobPages[1].jobs[0] = worker;
  assert.equal(await fixture({ jobPages }).find(), url);
});

test("inactive group is empty; denied, transient, and malformed reads fail closed", async () => {
  assert.equal(await fixture({ queueError: { status: 404 } }).find(), "");
  for (const status of [403, 429, 502]) {
    await assert.rejects(fixture({ queueError: Object.assign(new Error("read failed"), { status }) }).find());
  }
  await assert.rejects(fixture({ jobPages: [{ total_count: 2, jobs: [worker] }] }).find(), /Incomplete/);
  await assert.rejects(fixture({ jobPages: [] }).find(), /Incomplete/);
  await assert.rejects(findPendingReview({ repo, read: async () => ({ total_count: 2, group_members: [] }) }), /Incomplete/);
});

test("an active review permits exactly one newest unadmitted follow-up", async () => {
  const read = async (path) => {
    if (path.includes("/concurrency_groups/")) return {
      total_count: 2, group_members: [{ run_id: 122, status: "in_progress" }, { run_id: 123, status: "pending" }],
    };
    if (path.endsWith("/122")) return { ...run, status: "in_progress" };
    if (path.endsWith("/123")) return run;
    if (path.includes("/122/jobs")) return [{ total_count: 1, jobs: [{ ...worker, status: "in_progress" }] }];
    if (path.includes("/123/jobs")) return [{ total_count: 0, jobs: [] }];
    throw new Error("Unexpected read");
  };
  assert.equal(await findPendingReview({ repo, prNumber: "627", eventName: "push", read }), url);
});

// `findPendingReview` is fail-closed by design, so the reader underneath it is
// the only place a transient API blip can be absorbed. Drive the real reader
// through a fake `gh` on PATH rather than a stubbed transport: a fixture copy
// of the retry classifier is exactly the drift this cover exists to prevent.
function fakeGh(body) {
  const dir = mkdtempSync(join(tmpdir(), "lopu-review-queue-"));
  const counter = join(dir, "attempts");
  const gh = join(dir, "gh");
  writeFileSync(counter, "0");
  writeFileSync(gh, `#!/usr/bin/env bash\nn=$(( $(cat '${counter}') + 1 ))\nprintf '%s' "$n" >'${counter}'\n${body}\n`);
  chmodSync(gh, 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  const waited = [];
  return {
    waited,
    wait: (ms) => waited.push(ms),
    attempts: () => Number(readFileSync(counter, "utf8")),
    [Symbol.dispose]: () => { process.env.PATH = path; },
  };
}
const succeedAfter = (n, failure) => `if [ "$n" -le ${n} ]; then\n${failure}\nexit 1\nfi\nprintf '{"total_count":0,"group_members":[]}'`;

test("a transient read is retried on the bounded ladder instead of reddening a PR check", () => {
  const gh = fakeGh(succeedAfter(2, "echo 'gh: Server Error (HTTP 502)' >&2"));
  try {
    const ladder = [2000, 4000, 8000];
    assert.deepEqual(readGitHub("repos/a/b/actions/runs/1/jobs", { wait: gh.wait, ladder }), {
      total_count: 0, group_members: [],
    });
    assert.equal(gh.attempts(), 3, "the blip is absorbed by re-reading, not by guessing the queue state");
    assert.deepEqual(gh.waited, [2000, 4000], "2/4/8s, the same ladder the shell gh_read_retry readers use");
    assert.deepEqual(ladder, [8000], "one ladder is shared by the whole process, so a five-minute job cannot time out");
  } finally { gh[Symbol.dispose](); }
});

test("a transport failure with no HTTP status is retried and names its class for the log", () => {
  const gh = fakeGh(succeedAfter(1, "echo 'error connecting to api.github.com' >&2"));
  try {
    assert.ok(readGitHub("repos/a/b", { wait: gh.wait, ladder: [1] }));
    assert.equal(gh.attempts(), 2);
  } finally { gh[Symbol.dispose](); }

  const dead = fakeGh("echo 'error connecting to api.github.com' >&2\nexit 1");
  try {
    assert.throws(
      () => readGitHub("repos/a/b", { wait: dead.wait, ladder: [1, 2, 3] }),
      // The original message said only "Lopu queue read failed", which is why
      // the first observed instance could not be classified from its own log.
      (error) => error.message === "Lopu queue read failed (exit 1)" && error.status === undefined,
    );
    assert.equal(dead.attempts(), 4, "the ladder bounds the retries; an exhausted budget still gives a verdict");
    assert.deepEqual(dead.waited, [1, 2, 3]);
  } finally { dead[Symbol.dispose](); }
});

test("a definite answer is never slept on: 404 resolves instantly and a bare 403 stays fatal", () => {
  for (const [status, expected] of [[404, 404], [403, 403], [401, 401], [422, 422]]) {
    const gh = fakeGh(`echo 'gh: nope (HTTP ${status})' >&2\nexit 1`);
    try {
      assert.throws(() => readGitHub("repos/a/b", { wait: gh.wait, ladder: [1, 2, 3] }), (error) => {
        assert.equal(error.status, expected);
        return true;
      });
      assert.equal(gh.attempts(), 1, `HTTP ${status} is an answer, not a blip`);
      assert.deepEqual(gh.waited, [], "a real permission or scope failure must not spend the shared ladder");
    } finally { gh[Symbol.dispose](); }
  }
});

test("branch names are encoded and exact PR selectors take precedence", async () => {
  assert.deepEqual(reviewScope("", "feature/topic"), {
    group: "lopu-review-feature/topic", title: "Lopu reviews PRs matching feature/topic from the control plane",
  });
  const f = fixture();
  await f.find({ prNumber: "", branch: "feature/topic" });
  assert.match(f.calls[0].path, /lopu-review-feature%2Ftopic$/);
  assert.equal(reviewScope("627", "develop").group, "lopu-review-627");
  assert.equal(reviewScope().group, "lopu-review-all");
  assert.throws(() => reviewScope("0"), /Invalid/);
  assert.throws(() => reviewScope("", "bad\nbranch"), /Invalid/);
});
