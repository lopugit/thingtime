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

// GitHub answers `actions/runs/{id}` and `.../jobs` with transient 502/503 and
// occasional transport resets. A single blip used to fail this reader outright,
// and because `findPendingReview` is deliberately fail-closed on an unknown
// queue state the enclosing step then reddened `Hand off one Lopu repository
// review session` on whichever PR was pushed -- a shared condition no PR caused
// and none can clear -- while also dropping the review dispatch it was about to
// make. Retry the same bounded ladder the shell `gh_read_retry` readers in
// resolve-pr-conflicts.yml already use. A definite answer is never retried, so
// an inactive group (404) still resolves instantly and a bare 401/403 stays
// fatal rather than sleeping on a real permission failure.
const retryableStatus = new Set([408, 425, 429, 500, 502, 503, 504]);
// One ladder shared by every read in a process, not one per read: the handoff
// job allows five minutes and already spends minutes inside its own reads, so a
// per-read budget could trade this red check for a red timeout.
const backoff = [2000, 4000, 8000];

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function readGitHub(path, { paginate = false, wait = pause, ladder = backoff } = {}) {
  const args = ["api", path];
  if (paginate) args.push("--paginate", "--slurp");
  for (;;) {
    try {
      return JSON.parse(execFileSync("gh", args, {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
      }));
    } catch (cause) {
      // Do not echo API response bodies, command environments, or credentials.
      // The failure *class* carries no private value and is the only diagnosable
      // signal the control-plane log keeps, so name it: an unlabelled read
      // failure is why the first instance of this defect could not be
      // classified from its own job log after the fact.
      const status = /HTTP (\d{3})/.exec(String(cause.stderr || ""))?.[1];
      // `code` names a transport or timeout failure, `signal` the 30s kill, and
      // `status` a gh exit that printed no status line. A SyntaxError carries
      // none of them, which is itself the answer: the body was not JSON.
      const detail = status ? `HTTP ${status}`
        : String(cause.code ?? cause.signal ?? (cause.status != null ? `exit ${cause.status}` : "unreadable response"));
      const error = new Error(`Lopu queue read failed (${detail})`);
      error.status = Number(status) || undefined;
      // No status means a transport reset, a 30s kill, or a truncated body;
      // every one of those is worth one more read before giving a verdict.
      if (error.status && !retryableStatus.has(error.status)) throw error;
      if (!ladder.length) throw error;
      wait(ladder.shift());
    }
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
