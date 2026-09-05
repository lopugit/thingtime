import assert from "node:assert/strict";
import test from "node:test";
import { findPendingReview, reviewScope } from "./lopu-review-queue.mjs";

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
