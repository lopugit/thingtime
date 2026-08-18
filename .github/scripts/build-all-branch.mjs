#!/usr/bin/env node

// Deterministically rebuild the wildcard `all` branch.
//
// `all` = develop + main + every open, same-repo pull request (stacked
// branch → branch PRs included) merged together, so all in-progress work can
// be tried — and Vercel-previewed — in one place. Design notes:
//
// - Full rebuild, not accretion: every run recreates `all` from the current
//   base tips and open-PR set, so closed/merged PRs fall out on their own and
//   the branch never accumulates resolution debt. The result is force-pushed,
//   but only when the rebuilt *tree* differs from the pushed one — reruns with
//   identical inputs are no-ops and do not retrigger Vercel.
// - Merge order is stack-aware: PRs based on develop/main first, then PRs
//   based on those PRs' heads, and so on, ascending PR number within a layer.
//   Later merges win contested hunks via `-X theirs`, with a matching
//   theirs-biased fallback for the conflicts strategy options cannot settle
//   (modify/delete, directory/file, and `-merge`-attributed paths). A PR whose
//   merge cannot complete at all is skipped and reported, never fatal.
// - graphify-out/graph.json normally merges through the repo's graphify union
//   driver, which CI does not install; the driver is overridden to `cp %B %A`
//   (take theirs) so graph conflicts resolve the same way as everything else.
//   The graph/manifest pair may go stale on `all`; nothing runs
//   `graphify update` there.
// - `.github` is pinned to develop's copy: workflows never execute on `all`
//   (GITHUB_TOKEN pushes trigger no workflows, and schedules only run from the
//   default branch), and the pin keeps the force-push inside the default
//   token's powers — GitHub refuses GITHUB_TOKEN pushes that change
//   .github/workflows/** content. When develop's own workflow files changed
//   since the last `all` push, that normalized delta still trips the refusal;
//   the fallback then re-pins `.github` to the previously pushed `all` state
//   and retries, leaving those files stale-but-inert until a workflow-scoped
//   credential next rebuilds the branch.
// - Fork PRs are excluded by default: `all` deploys through this repo's
//   Vercel project, and routing unreviewed fork code into it would bypass
//   Vercel's own fork-authorization step. Label a PR `no-all` to opt it out of
//   the union explicitly.
//
// Requirements: a pushable `origin` checkout of the repo, plus `gh` auth
// (GH_TOKEN in Actions) for PR listing. Tunables: ALL_BRANCH_NAME (all),
// ALL_BASE_BRANCHES ("develop main" — the first entry is the starting point),
// ALL_SKIP_LABEL (no-all), ALL_INCLUDE_FORKS=1, ALL_PUSH=0 (build without
// pushing). Outside GitHub Actions the script refuses to run without
// ALL_BRANCH_FORCE=1 because it hard-switches branches in the current
// checkout.
//
// `--self-test` runs the pure planning/rendering examples and exits.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const ALL_BRANCH = process.env.ALL_BRANCH_NAME || "all";
const BASE_BRANCHES = (process.env.ALL_BASE_BRANCHES || "develop main")
  .split(/\s+/)
  .filter(Boolean);
const SKIP_LABEL = process.env.ALL_SKIP_LABEL || "no-all";
const INCLUDE_FORKS = process.env.ALL_INCLUDE_FORKS === "1";
const PUSH = process.env.ALL_PUSH !== "0";
const REPOSITORY = process.env.GITHUB_REPOSITORY || "lopugit/thingtime";
const REMOTE_ALL_REF = "refs/all-build/remote-all";

// Override the repo's graphify union merge driver (the binary is not
// installed here) with a take-theirs command matching the global bias.
const MERGE_CONFIG = [
  "-c",
  "merge.graphify.name=all-branch take-theirs override",
  "-c",
  "merge.graphify.driver=cp %B %A",
];

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
const git = (...args) => run("git", args).replace(/\n$/, "");
const tryGit = (...args) =>
  spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const singleLine = (text, max = 120) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const tableCell = (text) => singleLine(text).replaceAll("|", "\\|");

// Decide which open PRs join the union and in what order. Pure: exercised by
// --self-test below.
export function planMerges(
  pullRequests,
  { baseBranches, allBranch, skipLabel, includeForks = false }
) {
  const skipped = [];
  const candidates = [];
  const seenHeads = new Set();
  const reserved = new Set([...baseBranches, allBranch]);
  for (const pr of [...pullRequests].sort((a, b) => a.number - b.number)) {
    const labels = (pr.labels || []).map((label) => label.name);
    if (labels.includes(skipLabel)) {
      skipped.push({ pr, reason: `labelled ${skipLabel}` });
    } else if (pr.isCrossRepository && !includeForks) {
      skipped.push({ pr, reason: "fork PR (excluded from the union by default)" });
    } else if (reserved.has(pr.headRefName)) {
      skipped.push({
        pr,
        reason: `head ${pr.headRefName} is a base branch (its content is already merged)`,
      });
    } else if (seenHeads.has(pr.headRefName)) {
      skipped.push({
        pr,
        reason: `duplicate head ${pr.headRefName} (already queued by an earlier PR)`,
      });
    } else {
      seenHeads.add(pr.headRefName);
      candidates.push(pr);
    }
  }

  // Layered topological order over base → head edges, seeded by the base
  // branches: parents always merge before the PRs stacked on them.
  const ordered = [];
  const reachable = new Set(baseBranches);
  let remaining = candidates;
  while (remaining.length > 0) {
    const layer = remaining.filter((pr) => reachable.has(pr.baseRefName));
    if (layer.length === 0) break;
    ordered.push(...layer);
    const inLayer = new Set(layer.map((pr) => pr.number));
    for (const pr of layer) reachable.add(pr.headRefName);
    remaining = remaining.filter((pr) => !inLayer.has(pr.number));
  }
  for (const pr of remaining) {
    skipped.push({
      pr,
      reason: `base ${pr.baseRefName} is not ${baseBranches.join("/")} or an open PR head (dangling stack)`,
    });
  }
  return { ordered, skipped };
}

// Render the ALL_BRANCH.md manifest. Deliberately timestamp-free so identical
// inputs produce identical trees (that is what push dedup keys on).
export function renderManifest({ allBranch, baseTips, merges, skipped }) {
  const lines = [
    `# \`${allBranch}\` — the everything branch`,
    "",
    "Generated by the **Build all branch** workflow (`.github/workflows/all-branch.yml`",
    "listener → protected `github-actions` implementation). Rebuilt from scratch and",
    `force-pushed on every change: never base work on \`${allBranch}\`, never edit it by`,
    "hand, and expect `git reset --hard` when tracking it locally.",
    "",
    `Bases: ${baseTips
      .map(({ branch, sha }) => `\`${branch}\` @ ${sha.slice(0, 7)}`)
      .join(" + ")}`,
    "",
  ];
  if (merges.length > 0) {
    lines.push(
      `## Merged pull requests (${merges.length}, in merge order)`,
      "",
      "| PR | Head | Title | Result |",
      "| --- | --- | --- | --- |"
    );
    for (const { pr, result } of merges) {
      lines.push(
        `| #${pr.number} | \`${pr.headRefName}\` @ ${pr.headRefOid.slice(0, 7)} | ${tableCell(pr.title)} | ${tableCell(result)} |`
      );
    }
    lines.push("");
  } else {
    lines.push("No open pull requests qualified for this rebuild.", "");
  }
  if (skipped.length > 0) {
    lines.push(
      `## Skipped pull requests (${skipped.length})`,
      "",
      "| PR | Head | Reason |",
      "| --- | --- | --- |"
    );
    for (const { pr, reason } of [...skipped].sort((a, b) => a.pr.number - b.pr.number)) {
      lines.push(`| #${pr.number} | \`${pr.headRefName}\` | ${tableCell(reason)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// Merge one ref with the newest-wins policy. Returns { result } on success or
// { failed } after cleanly aborting, so one impossible merge never poisons the
// rest of the rebuild.
function mergeRef(ref, message) {
  const before = git("rev-parse", "HEAD");
  const merge = spawnSync(
    "git",
    [...MERGE_CONFIG, "merge", "--no-ff", "--no-edit", "-X", "theirs", "-m", message, ref],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "inherit", "pipe"] }
  );
  if (merge.status === 0) {
    return git("rev-parse", "HEAD") === before
      ? { result: "already included" }
      : { result: "clean merge" };
  }
  if (tryGit("rev-parse", "-q", "--verify", "MERGE_HEAD").status !== 0) {
    return { failed: `merge could not start: ${singleLine(merge.stderr, 200)}` };
  }

  // `-X theirs` already settled every textual conflict; what remains are the
  // structural cases (modify/delete, directory/file, -merge attributes).
  // Resolve them with the same bias: theirs where a "theirs" version exists,
  // deletion where theirs deleted.
  const abort = (failed) => {
    tryGit("merge", "--abort");
    return { failed };
  };
  const stagesByPath = new Map();
  for (const entry of git("ls-files", "-u", "-z").split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const stage = entry.slice(0, tab).split(" ")[2];
    const path = entry.slice(tab + 1);
    if (!stagesByPath.has(path)) stagesByPath.set(path, new Set());
    stagesByPath.get(path).add(stage);
  }
  const resolvedPaths = [];
  for (const [path, stages] of stagesByPath) {
    const resolved = stages.has("3")
      ? tryGit("checkout", "--theirs", "--", path).status === 0 &&
        tryGit("add", "--", path).status === 0
      : tryGit("rm", "-f", "-q", "--ignore-unmatch", "--", path).status === 0;
    if (!resolved) return abort(`could not theirs-resolve ${singleLine(path, 160)}`);
    resolvedPaths.push(path);
  }
  if (git("ls-files", "-u") !== "") {
    return abort("unmerged paths remained after theirs-resolution");
  }
  const commit = tryGit("commit", "--no-edit");
  if (commit.status !== 0) {
    return abort(`conflict commit failed: ${singleLine(commit.stderr, 200)}`);
  }
  const shown = singleLine(resolvedPaths.slice(0, 8).join(", "), 200);
  return {
    result: `auto-resolved theirs (${resolvedPaths.length} paths: ${shown}${resolvedPaths.length > 8 ? ", …" : ""})`,
  };
}

// Re-establish the invariants merges can break: make .github exactly match
// sourceRef's copy (restores content, deletes extras), drop the
// `path~refs_all-build_pr-N` collision artifacts theirs-side checkouts leave
// beside file-vs-symlink conflicts, and restore the root AGENTS.md/CLAUDE.md
// instruction symlinks (they must resolve to AI_ALL.md on every generated
// checkout; a legacy PR side can replace or delete them). Returns true when a
// pin commit was created.
function pinInvariants(sourceRef, label) {
  const junk = git("ls-files", "-z")
    .split("\0")
    .filter((path) => path.includes("~refs_all-build_pr-"));
  if (junk.length > 0) tryGit("rm", "-q", "-f", "--", ...junk);
  tryGit("rm", "-r", "-q", "-f", "--ignore-unmatch", "--", ".github");
  const restore = tryGit("checkout", sourceRef, "--", ".github");
  if (restore.status !== 0) {
    throw new Error(`could not restore .github from ${sourceRef}: ${restore.stderr}`);
  }
  tryGit("checkout", sourceRef, "--", "AGENTS.md", "CLAUDE.md");
  if (tryGit("diff", "--cached", "--quiet").status === 0) return false;
  run("git", ["commit", "-q", "-m", `all: pin .github and instruction symlinks to ${label}`]);
  return true;
}

function selfTest() {
  const pr = (number, base, head, extra = {}) => ({
    number,
    title: `PR ${number}`,
    baseRefName: base,
    headRefName: head,
    headRefOid: "a".repeat(40),
    isCrossRepository: false,
    labels: [],
    ...extra,
  });
  const options = { baseBranches: ["develop", "main"], allBranch: "all", skipLabel: "no-all" };

  // A stacked child merges after its parent even when its number is lower.
  {
    const parent = pr(30, "develop", "feature/parent");
    const child = pr(8, "feature/parent", "feature/child");
    const { ordered, skipped } = planMerges([child, parent], options);
    assert.deepEqual(ordered.map((p) => p.number), [30, 8]);
    assert.equal(skipped.length, 0);
  }

  // Dangling stacks, forks, opt-out labels, base-branch heads, duplicates.
  {
    const prs = [
      pr(1, "develop", "feat/a"),
      pr(2, "closed/gone", "feat/dangling"),
      pr(3, "develop", "feat/fork", { isCrossRepository: true }),
      pr(4, "develop", "feat/optout", { labels: [{ name: "no-all" }] }),
      pr(5, "main", "develop"),
      pr(6, "main", "feat/a"),
      pr(7, "feat/a", "feat/stacked"),
    ];
    const { ordered, skipped } = planMerges(prs, options);
    assert.deepEqual(ordered.map((p) => p.number), [1, 7]);
    const reasons = Object.fromEntries(skipped.map(({ pr: p, reason }) => [p.number, reason]));
    assert.match(reasons[2], /dangling stack/);
    assert.match(reasons[3], /fork PR/);
    assert.match(reasons[4], /labelled no-all/);
    assert.match(reasons[5], /base branch/);
    assert.match(reasons[6], /duplicate head/);
    const withForks = planMerges(prs, { ...options, includeForks: true });
    assert.deepEqual(withForks.ordered.map((p) => p.number), [1, 3, 7]);
  }

  // Manifest rendering: deterministic, pipe-safe, timestamp-free.
  {
    const input = {
      allBranch: "all",
      baseTips: [
        { branch: "develop", sha: "d".repeat(40) },
        { branch: "main", sha: "e".repeat(40) },
      ],
      merges: [
        { pr: pr(9, "develop", "feat/x", { title: "adds | pipes | everywhere" }), result: "clean merge" },
      ],
      skipped: [{ pr: pr(2, "gone", "feat/dangling"), reason: "base gone (dangling stack)" }],
    };
    const manifest = renderManifest(input);
    assert.equal(manifest, renderManifest(input));
    assert.match(manifest, /adds \\\| pipes \\\| everywhere/);
    assert.match(manifest, /#9/);
    assert.match(manifest, /dangling/);
    assert.doesNotMatch(manifest, /\d{4}-\d{2}-\d{2}[T ]\d{2}:/);
  }
}

function main() {
  const inActions = process.env.GITHUB_ACTIONS === "true";
  if (!inActions && process.env.ALL_BRANCH_FORCE !== "1") {
    console.error(
      "build-all-branch: refusing to run outside GitHub Actions without ALL_BRANCH_FORCE=1 — it hard-switches branches in the current checkout."
    );
    process.exit(2);
  }
  process.chdir(git("rev-parse", "--show-toplevel"));
  if (inActions) {
    git("config", "user.name", "github-actions[bot]");
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  }

  run(
    "git",
    [
      "fetch",
      "--no-tags",
      "--force",
      "origin",
      ...BASE_BRANCHES.map((branch) => `+refs/heads/${branch}:refs/remotes/origin/${branch}`),
    ],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  tryGit("fetch", "--no-tags", "--force", "origin", `+refs/heads/${ALL_BRANCH}:${REMOTE_ALL_REF}`);

  const pullRequests = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--repo",
      REPOSITORY,
      "--state",
      "open",
      "--limit",
      "500",
      "--json",
      "number,title,baseRefName,headRefName,headRefOid,isCrossRepository,labels",
    ])
  );
  const plan = planMerges(pullRequests, {
    baseBranches: BASE_BRANCHES,
    allBranch: ALL_BRANCH,
    skipLabel: SKIP_LABEL,
    includeForks: INCLUDE_FORKS,
  });
  const { ordered } = plan;
  const skipped = [...plan.skipped];
  console.log(
    `build-all-branch: ${pullRequests.length} open PRs — merging ${ordered.length}, skipping ${skipped.length}`
  );

  if (ordered.length > 0) {
    run(
      "git",
      [
        "fetch",
        "--no-tags",
        "--force",
        "origin",
        ...ordered.map((pr) => `+refs/pull/${pr.number}/head:refs/all-build/pr-${pr.number}`),
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
  }

  git("checkout", "--force", "-B", ALL_BRANCH, `refs/remotes/origin/${BASE_BRANCHES[0]}`);
  const baseTips = BASE_BRANCHES.map((branch) => ({
    branch,
    sha: git("rev-parse", `refs/remotes/origin/${branch}`),
  }));

  const notes = [];
  for (const branch of BASE_BRANCHES.slice(1)) {
    const outcome = mergeRef(`refs/remotes/origin/${branch}`, `all: merge ${branch}`);
    if (outcome.failed) {
      notes.push(`⚠️ base merge of ${branch} failed: ${outcome.failed}`);
      console.error(`build-all-branch: base merge of ${branch} failed: ${outcome.failed}`);
    } else {
      notes.push(`base ${branch}: ${outcome.result}`);
    }
  }

  const merges = [];
  for (const pr of ordered) {
    const outcome = mergeRef(
      `refs/all-build/pr-${pr.number}`,
      `all: merge PR #${pr.number} — ${singleLine(pr.title)}`
    );
    if (outcome.failed) {
      skipped.push({ pr, reason: outcome.failed });
      console.error(`build-all-branch: PR #${pr.number} skipped: ${outcome.failed}`);
    } else {
      merges.push({ pr, result: outcome.result });
      console.log(`build-all-branch: PR #${pr.number} ${outcome.result}`);
    }
  }

  pinInvariants(`refs/remotes/origin/${BASE_BRANCHES[0]}`, BASE_BRANCHES[0]);

  const manifest = renderManifest({ allBranch: ALL_BRANCH, baseTips, merges, skipped });
  writeFileSync("ALL_BRANCH.md", manifest);
  git("add", "--", "ALL_BRANCH.md");
  if (tryGit("diff", "--cached", "--quiet").status !== 0) {
    run("git", ["commit", "-q", "-m", `all: manifest (${merges.length} PRs merged, ${skipped.length} skipped)`]);
  }

  let pushLine;
  const builtTree = git("rev-parse", "HEAD^{tree}");
  const remoteTree = tryGit("rev-parse", "-q", "--verify", `${REMOTE_ALL_REF}^{tree}`);
  if (remoteTree.status === 0 && remoteTree.stdout.trim() === builtTree) {
    pushLine = `No push needed — the rebuilt tree is identical to origin/${ALL_BRANCH}.`;
  } else if (!PUSH) {
    pushLine = `Build only (ALL_PUSH=0): origin/${ALL_BRANCH} was not updated.`;
  } else {
    const pushArgs = ["push", "--force", "origin", `${ALL_BRANCH}:refs/heads/${ALL_BRANCH}`];
    let push = spawnSync("git", pushArgs, { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
    if (push.status !== 0 && /workflow/i.test(push.stderr || "")) {
      // GITHUB_TOKEN may not change .github/workflows/** content. Re-pin
      // .github to the previously pushed all state so the tip-to-tip workflow
      // delta disappears, then retry once.
      console.error(`build-all-branch: push refused (${singleLine(push.stderr, 200)})`);
      if (tryGit("rev-parse", "-q", "--verify", REMOTE_ALL_REF).status === 0) {
        const repinned = pinInvariants(
          REMOTE_ALL_REF,
          "previously pushed all (.github/workflows push restriction)"
        );
        notes.push(
          "⚠️ .github re-pinned to the previous all state: GITHUB_TOKEN cannot push the pending workflow-file delta."
        );
        if (repinned && git("rev-parse", "HEAD^{tree}") === remoteTree.stdout.trim()) {
          push = { status: 0 };
          pushLine = `No push needed after re-pin — origin/${ALL_BRANCH} already matches.`;
        } else {
          push = spawnSync("git", pushArgs, { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
        }
      }
    }
    if (push.status !== 0) {
      console.error(`build-all-branch: push failed: ${push.stderr || ""}`);
      process.exitCode = 1;
      pushLine = `❌ Push to origin/${ALL_BRANCH} failed: ${singleLine(push.stderr, 300)}`;
    } else {
      pushLine = pushLine || `Force-pushed origin/${ALL_BRANCH} (${merges.length} PRs merged, ${skipped.length} skipped).`;
    }
  }

  const summary = ["## Build all branch", "", pushLine, "", ...notes.map((note) => `- ${note}`), "", manifest].join("\n");
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("build-all-branch: self-test OK");
} else {
  try {
    main();
  } catch (error) {
    console.error(`build-all-branch: fatal: ${error?.message || error}`);
    process.exit(1);
  }
}
