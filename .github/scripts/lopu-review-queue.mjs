#!/usr/bin/env node
// Read the exact native concurrency queue, not the latest N workflow runs.
// This helper never cancels work and never coalesces a human conversation.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const pending = new Set(["pending", "queued", "waiting", "requested"]);
const reviewJob = "Lopu reviews selected PRs";

export function reviewScope(prNumber = "", branch = "") {
  if (prNumber && !/^[1-9][0-9]*$/.test(prNumber)) throw new Error("Invalid PR selector");
  if (branch.length > 255 || /[\r\n\0]/.test(branch)) throw new Error("Invalid branch selector");
  return {
    group: `lopu-review-${prNumber || branch || "all"}`,
    title: prNumber
      ? `Lopu reviews PR #${prNumber} from the control plane`
      : branch
        ? `Lopu reviews PRs matching ${branch} from the control plane`
        : "Lopu reviews all eligible PRs from the control plane",
  };
}

export async function findPendingReview({ repo, prNumber = "", branch = "", eventName, read }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repository");
  // Those dispatches carry the exact comment id. Another queued review cannot
  // reconstruct that identity, even when its PR selector happens to match.
  if (["issue_comment", "pull_request_review_comment"].includes(eventName)) return "";
  const { group, title } = reviewScope(prNumber, branch);
  let queue;
  try {
    queue = await read(`repos/${repo}/actions/concurrency_groups/${encodeURIComponent(group)}`);
  } catch (error) {
    // GitHub documents 404 for an inactive group; every other failure defers
    // dispatch instead of creating duplicate work from an unknown queue state.
    if (error.status === 404) return "";
    throw error;
  }
  if (!Array.isArray(queue.group_members) || queue.total_count !== queue.group_members.length) {
    throw new Error("Incomplete Lopu review queue inventory");
  }
  for (const member of queue.group_members) {
    if (member.job_id || !["pending", "in_progress"].includes(member.status)) continue;
    if (!Number.isSafeInteger(member.run_id) || member.run_id <= 0) throw new Error("Invalid queued run id");
    const runPath = `repos/${repo}/actions/runs/${member.run_id}`;
    const run = await read(runPath);
    if (run.event !== "workflow_dispatch" || run.head_branch !== "github-actions"
      || run.actor?.login !== "github-actions[bot]"
      || run.path?.split("@")[0] !== ".github/workflows/resolve-pr-conflicts.yml"
      || run.display_title !== title || run.status === "completed") continue;
    const pages = await read(`${runPath}/jobs?per_page=100`, { paginate: true });
    if (!Array.isArray(pages) || !pages.length || pages.some((page) => !Array.isArray(page.jobs))) {
      throw new Error("Incomplete Lopu review job inventory");
    }
    const jobs = pages.flatMap((page) => page.jobs);
    if (pages[0].total_count !== jobs.length) throw new Error("Incomplete Lopu review job inventory");
    const workers = jobs.filter((job) => job.name === reviewJob);
    // A workflow may hold its outer scope while its worker waits on the fleet.
    // Conversely a `pending` workflow can already have finished its review!
    // Prove that the actual worker has never started before suppressing a new
    // signal. With no jobs, only an unadmitted workflow-level waiter qualifies.
    const unstarted = workers.length === 1 && pending.has(workers[0].status)
      && Array.isArray(workers[0].steps) && workers[0].steps.length === 0;
    const unadmitted = jobs.length === 0 && member.status === "pending" && pending.has(run.status);
    if (unstarted || unadmitted) return `https://github.com/${repo}/actions/runs/${member.run_id}`;
  }
  return "";
}

export function readGitHub(path, { paginate = false } = {}) {
  const args = ["api", path];
  if (paginate) args.push("--paginate", "--slurp");
  try {
    return JSON.parse(execFileSync("gh", args, {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (cause) {
    // Do not echo API response bodies, command environments, or credentials.
    const status = /HTTP (\d{3})/.exec(String(cause.stderr || ""))?.[1];
    const error = new Error(`Lopu queue read failed${status ? ` (HTTP ${status})` : ""}`);
    error.status = Number(status) || undefined;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const url = await findPendingReview({
      repo: process.env.REPO, prNumber: process.env.PR_NUMBER, branch: process.env.BRANCH,
      eventName: process.env.EVENT_NAME, read: readGitHub,
    });
    if (url) console.log(url);
  } catch (error) {
    console.error(`::error::${error.message}; refusing a duplicate review dispatch.`);
    process.exitCode = 1;
  }
}
