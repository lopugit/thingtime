#!/usr/bin/env node
// Promote develop → main as reviewable per-feature PRs (with stacks).
//
// Scans PRs merged into SOURCE_BRANCH (develop), and for each one that has not
// yet reached TARGET_BRANCH (main) re-applies its exact diff onto main via
// `git cherry-pick -x` on a dedicated `promote/pr-<n>-<slug>` branch, then
// opens a promotion PR targeting main. PRs that belong to the same feature
// group are stacked: the first promotion PR targets main, the second targets
// the first promotion branch, and so on (ordered by merge time into develop).
//
// Group membership for a source PR is resolved from, in priority order:
//   1. A `Promotion-Group: <key>` line or `<!-- promotion-group: <key> -->`
//      comment in the source PR body.
//   2. A `stack:<key>`, `group:<key>` or `feature:<key>` label.
//   3. A `feature/<key>/...` or `feat/<key>/...` head branch (3+ segments).
//   4. A conventional-commit title scope, e.g. `feat(<key>): ...`
//      (disable with GROUP_FROM_TITLE_SCOPE=false).
// PRs with no group signal promote as standalone single PRs.
//
// State model (no external state files — everything is derived from GitHub):
//   - A promotion PR carries `<!-- promotion-of: <n> -->` in its body and a
//     deterministic `promote/pr-<n>-*` head branch; either identifies it.
//   - promotion MERGED  → source is done, never touched again.
//   - promotion OPEN    → reused as the base for later stack members.
//   - promotion CLOSED  → the change was rejected for main; never recreated
//                         (reopen the closed PR to change your mind).
//   - content already on main (ancestor merge commit, or the cherry-pick
//     comes out empty) → skipped as a no-op.
//   - cherry-pick conflict → the group stops there (later members depend on
//     it); the summary prints exact manual commands, and the next run resumes
//     once the manually-pushed branch exists.
//
// A maintenance pass also retargets open promotion PRs whose base promotion
// PR has merged (backstop for GitHub's delete-branch auto-retargeting).
//
// Run modes: normal, DRY_RUN=1 (simulates cherry-picks in a temp worktree and
// reports the full plan without pushing/creating anything), --self-test
// (pure-helper assertions, no git/gh needed).

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const env = (key, fallback = "") => {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
};
const flag = (key, fallback) => {
  const value = env(key, fallback ? "true" : "false").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
};

const CFG = {
  source: env("SOURCE_BRANCH", "develop"),
  target: env("TARGET_BRANCH", "main"),
  lookback: Math.max(1, Math.min(100, Number(env("LOOKBACK", "50")) || 50)),
  maxNewPrs: Math.max(1, Number(env("MAX_NEW_PRS", "10")) || 10),
  requireLabel: env("REQUIRE_LABEL", ""),
  skipLabels: env("SKIP_LABELS", "no-promote,skip-promotion")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  groupFromTitleScope: flag("GROUP_FROM_TITLE_SCOPE", true),
  groupFromBranchPrefix: flag("GROUP_FROM_BRANCH_PREFIX", true),
  commentOnSource: flag("COMMENT_ON_SOURCE", true),
  promotionLabel: env("PROMOTION_LABEL", "promotion"),
  dryRun: flag("DRY_RUN", false),
  repo: env("GH_REPO", env("GITHUB_REPOSITORY", "")),
};

// ---------------------------------------------------------------------------
// Small process helpers (execFile only — no shell, no quoting hazards)
// ---------------------------------------------------------------------------

const EXEC_OPTS = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { ...EXEC_OPTS, stdio: ["ignore", "pipe", "pipe"], ...opts })
    .toString().trim();
}

function tryRun(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { ...EXEC_OPTS, ...opts });
  return {
    ok: res.status === 0,
    status: res.status,
    out: (res.stdout || "").toString().trim(),
    err: (res.stderr || "").toString().trim(),
  };
}

const git = (args, cwd) => run("git", args, cwd ? { cwd } : {});
const tryGit = (args, cwd) => tryRun("git", args, cwd ? { cwd } : {});
const gh = (args) => run("gh", args);
const ghJson = (args) => JSON.parse(run("gh", args) || "null");
const tryGh = (args) => tryRun("gh", args);

// ---------------------------------------------------------------------------
// Pure helpers (covered by --self-test)
// ---------------------------------------------------------------------------

export function slugify(text, maxLen = 40) {
  const slug = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || "change";
}

const STRIP_PREFIXES = ["claude", "codex", "feature", "feat", "fix", "chore", "promote"];

export function promotionBranchFor(pr) {
  const segments = (pr.headRefName || "").split("/").filter(Boolean);
  while (segments.length > 1 && STRIP_PREFIXES.includes(segments[0].toLowerCase())) {
    segments.shift();
  }
  const base = segments.join("-") || pr.title || `pr-${pr.number}`;
  return `promote/pr-${pr.number}-${slugify(base)}`;
}

export function parsePromotionOf(body) {
  const match = /<!--\s*promotion-of:\s*#?(\d+)\s*-->/i.exec(body || "");
  return match ? Number(match[1]) : null;
}

export function parsePromotionGroupMarker(body) {
  const match = /<!--\s*promotion-group:\s*([^>]*?)\s*-->/i.exec(body || "");
  const key = match ? slugify(match[1]) : "";
  return key && key !== "change" ? key : null;
}

export function groupKeyFor(pr, cfg = CFG) {
  const body = pr.body || "";
  const explicit =
    /(?:^|\n)\s*promotion-group\s*:\s*([^\n<]+)/i.exec(body)?.[1] ??
    /<!--\s*promotion-group:\s*([^>]*?)\s*-->/i.exec(body)?.[1];
  if (explicit && slugify(explicit) !== "change") return slugify(explicit);

  for (const label of pr.labels || []) {
    const name = (label.name || label || "").toLowerCase();
    const match = /^(?:stack|group|feature):(.+)$/.exec(name);
    if (match && slugify(match[1]) !== "change") return slugify(match[1]);
  }

  if (cfg.groupFromBranchPrefix) {
    const segments = (pr.headRefName || "").split("/").filter(Boolean);
    if (segments.length >= 3 && ["feature", "feat"].includes(segments[0].toLowerCase())) {
      return slugify(segments[1]);
    }
  }

  if (cfg.groupFromTitleScope) {
    const match = /^(?:feat|fix|chore|refactor|perf|docs|test|build|ci|style)\(([^)]+)\)!?:/i
      .exec(pr.title || "");
    if (match && slugify(match[1]) !== "change") return slugify(match[1]);
  }

  return null; // standalone
}

export function promotionTitleFor(pr, groupKey, position) {
  const prefix = groupKey ? `[Promote][${groupKey} #${position}]` : "[Promote]";
  return `${prefix} ${pr.title} (#${pr.number})`;
}

export function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

async function selfTest() {
  const { strict: assert } = await import("node:assert");

  assert.equal(slugify("Hello, World! 42"), "hello-world-42");
  assert.equal(slugify("---"), "change");
  assert.equal(slugify("a".repeat(80)).length, 40);

  const pr = { number: 7, headRefName: "claude/search-index-abc123", title: "feat: add search" };
  assert.equal(promotionBranchFor(pr), "promote/pr-7-search-index-abc123");
  assert.equal(promotionBranchFor({ number: 8, headRefName: "", title: "Fix: A thing" }),
    "promote/pr-8-fix-a-thing");

  assert.equal(parsePromotionOf("hi\n<!-- promotion-of: 123 -->\nbye"), 123);
  assert.equal(parsePromotionOf("<!-- promotion-of: #45 -->"), 45);
  assert.equal(parsePromotionOf("nothing"), null);
  assert.equal(parsePromotionGroupMarker("<!-- promotion-group: search-v2 -->"), "search-v2");
  assert.equal(parsePromotionGroupMarker("<!-- promotion-group:  -->"), null);

  const cfg = { groupFromTitleScope: true, groupFromBranchPrefix: true };
  assert.equal(groupKeyFor({ body: "Promotion-Group: Search V2", title: "x" }, cfg), "search-v2");
  assert.equal(groupKeyFor({ body: "<!-- promotion-group: search -->", title: "x" }, cfg), "search");
  assert.equal(groupKeyFor({ labels: [{ name: "stack:messenger" }], title: "x" }, cfg), "messenger");
  assert.equal(groupKeyFor({ labels: [{ name: "feature:Feed Algo" }], title: "x" }, cfg), "feed-algo");
  assert.equal(groupKeyFor({ headRefName: "feature/search/indexing", title: "x" }, cfg), "search");
  assert.equal(groupKeyFor({ headRefName: "feature/only-two", title: "x" }, cfg), null);
  assert.equal(groupKeyFor({ title: "feat(search): add fuzzy match" }, cfg), "search");
  assert.equal(groupKeyFor({ title: "feat(search): x" }, { ...cfg, groupFromTitleScope: false }), null);
  assert.equal(groupKeyFor({ title: "plain title", headRefName: "claude/foo-bar" }, cfg), null);

  assert.equal(promotionTitleFor({ title: "Add search", number: 9 }, null, 1), "[Promote] Add search (#9)");
  assert.equal(promotionTitleFor({ title: "Add search", number: 9 }, "search", 2),
    "[Promote][search #2] Add search (#9)");

  assert.ok(setsEqual(new Set(["a", "b"]), new Set(["b", "a"])));
  assert.ok(!setsEqual(new Set(["a"]), new Set(["a", "b"])));

  console.log("self-test OK");
}

// ---------------------------------------------------------------------------
// GitHub data loading
// ---------------------------------------------------------------------------

function repoFlag() {
  return CFG.repo ? ["--repo", CFG.repo] : [];
}

function listMergedSourcePrs() {
  const fields = "number,title,body,labels,headRefName,url,mergedAt,mergeCommit,author";
  const prs = ghJson([
    "pr", "list", ...repoFlag(),
    "--base", CFG.source, "--state", "merged",
    "--limit", String(CFG.lookback), "--json", fields,
  ]) || [];
  prs.sort((a, b) => (a.mergedAt || "").localeCompare(b.mergedAt || ""));
  return prs;
}

function listPromotionPrs() {
  const fields = "number,state,title,body,headRefName,baseRefName,url";
  const prs = ghJson([
    "pr", "list", ...repoFlag(),
    "--state", "all", "--limit", "200", "--json", fields,
  ]) || [];
  return prs.filter(
    (pr) => pr.headRefName?.startsWith("promote/pr-") || parsePromotionOf(pr.body) !== null,
  );
}

// Collapse possibly-multiple promotion records per source PR: MERGED wins,
// then OPEN, then the newest CLOSED.
function indexPromotionsBySource(promotionPrs) {
  const bySource = new Map();
  const rank = { MERGED: 3, OPEN: 2, CLOSED: 1 };
  for (const pr of promotionPrs) {
    const source =
      parsePromotionOf(pr.body) ??
      Number(/^promote\/pr-(\d+)-/.exec(pr.headRefName || "")?.[1] || NaN);
    if (!Number.isFinite(source)) continue;
    const existing = bySource.get(source);
    if (
      !existing ||
      (rank[pr.state] || 0) > (rank[existing.state] || 0) ||
      ((rank[pr.state] || 0) === (rank[existing.state] || 0) && pr.number > existing.number)
    ) {
      bySource.set(source, pr);
    }
  }
  return bySource;
}

function listRemotePromotionBranches() {
  const out = tryGit(["ls-remote", "--heads", "origin", "refs/heads/promote/*"]);
  if (!out.ok) return new Set();
  return new Set(
    out.out.split("\n").filter(Boolean)
      .map((line) => line.split("\t")[1]?.replace("refs/heads/", ""))
      .filter(Boolean),
  );
}

// ---------------------------------------------------------------------------
// Maintenance: retarget open promotion PRs whose base promotion has merged
// ---------------------------------------------------------------------------

function retargetPass(promotionPrs, results) {
  const byHead = new Map(promotionPrs.map((pr) => [pr.headRefName, pr]));
  for (const pr of promotionPrs) {
    if (pr.state !== "OPEN" || pr.baseRefName === CFG.target) continue;
    if (!pr.baseRefName?.startsWith("promote/")) continue;
    let base = pr.baseRefName;
    let hops = 0;
    while (hops++ < 20) {
      const basePr = byHead.get(base);
      if (basePr?.state === "MERGED") {
        base = basePr.baseRefName;
        continue;
      }
      if (basePr?.state === "CLOSED") {
        results.warnings.push(
          `#${pr.number} targets \`${base}\`, whose promotion PR #${basePr.number} was closed without merging — the stack needs manual attention.`,
        );
        base = pr.baseRefName; // leave unchanged
      }
      break;
    }
    if (base !== pr.baseRefName) {
      if (CFG.dryRun) {
        results.retargeted.push(`(dry-run) would retarget #${pr.number}: \`${pr.baseRefName}\` → \`${base}\``);
      } else {
        const res = tryGh(["pr", "edit", String(pr.number), ...repoFlag(), "--base", base]);
        if (res.ok) {
          results.retargeted.push(`retargeted #${pr.number}: \`${pr.baseRefName}\` → \`${base}\``);
          pr.baseRefName = base;
        } else {
          results.warnings.push(`failed to retarget #${pr.number} to \`${base}\`: ${res.err}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cherry-pick planning and execution
// ---------------------------------------------------------------------------

// Decide what to cherry-pick for one source PR. Merge commits use `-m 1`
// (full PR diff vs develop's first parent). Single-parent merge commits are
// squash or rebase merges: a squash commit alone IS the full diff; a rebase
// merge of a multi-commit PR needs the whole rebased range, which we accept
// only when its combined file list matches the PR's file list.
function computePicks(pr) {
  const sha = pr.mergeCommit?.oid;
  if (!sha) return { error: "merge commit unknown" };
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).split(/\s+/).length - 1;
  if (parents >= 2) return { picks: [{ sha, mainline: true }] };

  const commitCount = Number(
    tryGh(["pr", "view", String(pr.number), ...repoFlag(), "--json", "commits",
      "--jq", ".commits | length"]).out || "1",
  );
  if (commitCount <= 1) return { picks: [{ sha }] };

  const rangeStart = tryGit(["rev-parse", `${sha}~${commitCount}`]);
  if (rangeStart.ok) {
    const rangeFiles = new Set(
      tryGit(["diff", "--name-only", `${sha}~${commitCount}`, sha]).out.split("\n").filter(Boolean),
    );
    const prFiles = new Set(
      (tryGh(["pr", "view", String(pr.number), ...repoFlag(), "--json", "files",
        "--jq", ".files[].path"]).out || "").split("\n").filter(Boolean),
    );
    if (prFiles.size > 0 && setsEqual(rangeFiles, prFiles)) {
      return { picks: [{ range: `${sha}~${commitCount}..${sha}` }] };
    }
  }
  return {
    picks: [{ sha }],
    warning: `#${pr.number} looks rebase-merged with ${commitCount} commits; promoting the merge commit only — verify the promotion diff.`,
  };
}

// Returns { status: "ok" | "conflict" | "error", detail? } and leaves the
// worktree clean (picks applied on success, fully aborted otherwise).
function applyPicks(worktree, picks) {
  for (const pick of picks) {
    const args = ["cherry-pick", "-x"];
    if (pick.mainline) args.push("-m", "1");
    args.push(pick.range || pick.sha);
    let res = tryGit(args, worktree);
    // Empty picks (content already on main) stop the sequencer; skip through
    // them until the pick finishes or a real conflict appears.
    let guard = 0;
    while (!res.ok && guard++ < 100) {
      const unmerged = tryGit(["diff", "--name-only", "--diff-filter=U"], worktree).out;
      if (unmerged) {
        tryGit(["cherry-pick", "--abort"], worktree);
        return { status: "conflict", detail: unmerged.split("\n").slice(0, 20).join(", ") };
      }
      if (/empty|nothing to commit/i.test(res.err + res.out)) {
        res = tryGit(["cherry-pick", "--skip"], worktree);
        if (res.ok || /no cherry-pick.*in progress/i.test(res.err)) { res = { ok: true }; break; }
        continue;
      }
      tryGit(["cherry-pick", "--abort"], worktree);
      return { status: "error", detail: (res.err || res.out).slice(0, 500) };
    }
    if (!res.ok) {
      tryGit(["cherry-pick", "--abort"], worktree);
      return { status: "error", detail: (res.err || res.out).slice(0, 500) };
    }
  }
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// Promotion PR creation
// ---------------------------------------------------------------------------

let labelEnsured = false;
function ensurePromotionLabel() {
  if (labelEnsured || !CFG.promotionLabel) return labelEnsured;
  const res = tryGh(["label", "create", CFG.promotionLabel, ...repoFlag(),
    "--color", "5319e7", "--force",
    "--description", "Automated develop → main promotion PR"]);
  labelEnsured = res.ok;
  return labelEnsured;
}

function promotionBody(pr, groupKey, position, groupPrs, statusFor) {
  const lines = [];
  lines.push(
    `Automated promotion of #${pr.number} from \`${CFG.source}\` to \`${CFG.target}\`, ` +
    `opened by the **Promote develop to main** workflow for release review.`,
    "",
    `<!-- promotion-of: ${pr.number} -->`,
  );
  if (groupKey) lines.push(`<!-- promotion-group: ${groupKey} -->`);
  lines.push(
    "",
    "## Source",
    "| | |",
    "| --- | --- |",
    `| Source PR | #${pr.number} — ${pr.title} |`,
    `| Author | @${pr.author?.login || "unknown"} |`,
    `| Merged into \`${CFG.source}\` | ${pr.mergedAt || "unknown"} |`,
    `| Merge commit | \`${pr.mergeCommit?.oid || "unknown"}\` |`,
    `| Head branch | \`${pr.headRefName}\` |`,
  );
  if (groupKey && groupPrs.length > 1) {
    lines.push(
      "",
      `## Stack — \`${groupKey}\` (position ${position} of ${groupPrs.length} known)`,
      "",
      "Review and merge bottom-up. Delete each promotion branch when its PR",
      "merges so GitHub retargets the next PR automatically (the scheduled",
      "workflow run also retargets stacks as a backstop).",
      "",
      "| # | Source PR | Promotion |",
      "| --- | --- | --- |",
    );
    groupPrs.forEach((member, idx) => {
      const status = member.number === pr.number ? "_this PR_" : statusFor(member);
      lines.push(`| ${idx + 1} | #${member.number} ${member.title} | ${status} |`);
    });
  }
  lines.push(
    "",
    "## How to review",
    "",
    `- This PR re-applies the source PR's exact changes onto \`${CFG.target}\``,
    "  (`git cherry-pick -x`; each commit message references the original SHA).",
    `- Merge it normally to release the change to \`${CFG.target}\` —`,
    "  the **Sync main into develop** workflow keeps `develop` aligned afterwards.",
    `- Close it (without merging) to keep the change out of \`${CFG.target}\`;`,
    "  the workflow never recreates a closed promotion (reopen it to change your mind).",
    "",
    "---",
    "🤖 Generated by the `promote-develop-to-main` workflow.",
  );
  return lines.join("\n");
}

function createPromotionPr({ branch, base, title, body }) {
  const bodyFile = join(os.tmpdir(), `promotion-body-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  writeFileSync(bodyFile, body);
  try {
    const args = ["pr", "create", ...repoFlag(),
      "--base", base, "--head", branch, "--title", title, "--body-file", bodyFile];
    if (ensurePromotionLabel()) args.push("--label", CFG.promotionLabel);
    return { ok: true, url: gh(args).split("\n").pop() };
  } catch (error) {
    return { ok: false, err: String(error.stderr || error.message || error).slice(0, 500) };
  } finally {
    rmSync(bodyFile, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function summarize(results, eligibleCount) {
  const md = [];
  md.push(`## Promote ${CFG.source} → ${CFG.target}${CFG.dryRun ? " (dry run)" : ""}`, "");
  md.push(`Scanned the last ${CFG.lookback} PRs merged into \`${CFG.source}\`; ${eligibleCount} eligible for promotion this run.`, "");
  const section = (title, items) => {
    if (!items.length) return;
    md.push(`### ${title}`, "", ...items.map((item) => `- ${item}`), "");
  };
  section("Created", results.created);
  section("Retargeted", results.retargeted);
  section("Conflicts (manual promotion needed)", results.conflicts);
  section("Blocked", results.blocked);
  section("Warnings", results.warnings);
  section("Skipped", results.skipped);
  if (!results.created.length && !results.conflicts.length && !results.blocked.length) {
    md.push("Nothing new to promote. ✅", "");
  }
  const text = md.join("\n");
  console.log(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

function conflictHelp(pr, branch, base) {
  return [
    `#${pr.number} (**${pr.title}**) does not cherry-pick cleanly onto \`${base}\`. Promote it manually:`,
    "  ```",
    `  git fetch origin ${CFG.target} ${CFG.source}`,
    `  git switch -c ${branch} ${base === CFG.target ? `origin/${CFG.target}` : `origin/${base}`}`,
    `  git cherry-pick -x -m 1 ${pr.mergeCommit?.oid || "<merge-commit>"}`,
    "  # resolve conflicts, git cherry-pick --continue",
    `  git push -u origin ${branch}`,
    "  ```",
    `  The next workflow run will open the promotion PR for \`${branch}\` automatically.`,
  ].join("\n");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await selfTest();
    return;
  }

  const results = {
    created: [], retargeted: [], conflicts: [], blocked: [], warnings: [], skipped: [],
  };
  const skip = (pr, reason) => results.skipped.push(`#${pr.number} ${pr.title} — ${reason}`);

  // --- Preflight -----------------------------------------------------------
  run("gh", ["auth", "status"]);
  if (!CFG.repo) {
    CFG.repo = ghJson(["repo", "view", "--json", "nameWithOwner"])?.nameWithOwner || "";
  }
  const fetched = tryGit(["fetch", "origin", CFG.target, CFG.source]);
  if (!fetched.ok) {
    if (new RegExp(`couldn't find remote ref ${CFG.source}`, "i").test(fetched.err)) {
      console.log(`::notice::No ${CFG.source} branch — nothing to promote.`);
      summarize(results, 0);
      return;
    }
    throw new Error(`git fetch failed: ${fetched.err}`);
  }
  const mainSha = git(["rev-parse", `origin/${CFG.target}`]);

  // --- Load state ----------------------------------------------------------
  const sourcePrs = listMergedSourcePrs();
  const promotionPrs = listPromotionPrs();
  const promoBySource = indexPromotionsBySource(promotionPrs);
  const remoteBranches = listRemotePromotionBranches();

  retargetPass(promotionPrs, results);

  // --- Filter candidates ---------------------------------------------------
  const eligible = [];
  for (const pr of sourcePrs) {
    const labels = (pr.labels || []).map((l) => (l.name || "").toLowerCase());
    if (pr.headRefName === CFG.target) continue; // sync main→develop PRs
    if (pr.headRefName?.startsWith("promote/")) continue;
    if (parsePromotionOf(pr.body) !== null) continue; // is itself a promotion
    if (labels.some((name) => CFG.skipLabels.includes(name))) {
      skip(pr, `skip label`);
      continue;
    }
    if (CFG.requireLabel && !labels.includes(CFG.requireLabel.toLowerCase())) {
      skip(pr, `missing required label \`${CFG.requireLabel}\``);
      continue;
    }
    if (!pr.mergeCommit?.oid) {
      skip(pr, "merge commit unknown");
      continue;
    }
    eligible.push(pr);
  }

  // --- Group ---------------------------------------------------------------
  const groups = new Map(); // key → { key, prs } ; standalone key = "pr-<n>"
  for (const pr of eligible) {
    const key = groupKeyFor(pr, CFG);
    const mapKey = key || `pr-${pr.number}`;
    if (!groups.has(mapKey)) groups.set(mapKey, { key, prs: [] });
    groups.get(mapKey).prs.push(pr); // eligible is already mergedAt-ascending
  }

  // --- Process each group as one cherry-pick chain -------------------------
  const worktreeRoot = mkdtempSync(join(process.env.RUNNER_TEMP || os.tmpdir(), "promote-"));
  const worktree = join(worktreeRoot, "wt");
  git(["worktree", "add", "--detach", worktree, mainSha]);
  let createdCount = 0;

  const statusFor = (member) => {
    const rec = promoBySource.get(member.number);
    if (rec) return `#${rec.number} (${rec.state.toLowerCase()})`;
    return "_pending_";
  };

  try {
    for (const group of groups.values()) {
      let baseName = CFG.target;
      let baseRef = mainSha;

      // Older stack members can fall outside the lookback window; chain onto
      // the newest open promotion PR of the same group if one exists.
      if (group.key) {
        const external = promotionPrs
          .filter((p) => p.state === "OPEN" &&
            parsePromotionGroupMarker(p.body) === group.key &&
            !group.prs.some((member) => member.number === parsePromotionOf(p.body)))
          .sort((a, b) => a.number - b.number)
          .pop();
        if (external) {
          baseName = external.headRefName;
          baseRef = `origin/${external.headRefName}`;
        }
      }

      git(["checkout", "--detach", baseRef], worktree);

      for (const [index, pr] of group.prs.entries()) {
        const position = index + 1;
        const record = promoBySource.get(pr.number);

        if (record?.state === "MERGED") {
          skip(pr, `already promoted and merged (#${record.number})`);
          continue;
        }
        if (record?.state === "OPEN") {
          skip(pr, `promotion #${record.number} already open`);
          baseName = record.headRefName;
          git(["checkout", "--detach", `origin/${record.headRefName}`], worktree);
          continue;
        }
        if (record?.state === "CLOSED") {
          skip(pr, `promotion #${record.number} was closed without merging — not recreating (reopen it to promote)`);
          continue;
        }

        const inMain = tryGit(["merge-base", "--is-ancestor", pr.mergeCommit.oid, mainSha]).ok;
        if (inMain) {
          skip(pr, `merge commit already on ${CFG.target}`);
          continue;
        }

        const branch = promotionBranchFor(pr);
        const existingBranch = [...remoteBranches].find((name) =>
          name.startsWith(`promote/pr-${pr.number}-`));
        if (existingBranch) {
          // Branch pushed earlier (or manually after a conflict) but PR missing.
          if (CFG.dryRun) {
            results.created.push(`(dry-run) would open PR for existing branch \`${existingBranch}\` → \`${baseName}\``);
          } else {
            const title = promotionTitleFor(pr, group.key, position);
            const body = promotionBody(pr, group.key, position, group.prs, statusFor);
            const created = createPromotionPr({ branch: existingBranch, base: baseName, title, body });
            if (created.ok) {
              results.created.push(`${created.url} — ${title} (from existing branch)`);
              createdCount += 1;
            } else {
              results.blocked.push(`#${pr.number}: PR creation for existing \`${existingBranch}\` failed: ${created.err}`);
              break;
            }
          }
          baseName = existingBranch;
          git(["checkout", "--detach", `origin/${existingBranch}`], worktree);
          continue;
        }

        if (createdCount >= CFG.maxNewPrs) {
          results.warnings.push(
            `MAX_NEW_PRS=${CFG.maxNewPrs} reached — #${pr.number}${group.key ? ` (and the rest of \`${group.key}\`)` : ""} deferred to the next run.`,
          );
          break;
        }

        const plan = computePicks(pr);
        if (plan.error) { skip(pr, plan.error); continue; }
        if (plan.warning) results.warnings.push(plan.warning);

        const beforeSha = git(["rev-parse", "HEAD"], worktree);
        const applied = applyPicks(worktree, plan.picks);
        if (applied.status === "conflict") {
          results.conflicts.push(conflictHelp(pr, branch, baseName));
          break; // later group members depend on this one
        }
        if (applied.status === "error") {
          results.blocked.push(`#${pr.number}: cherry-pick failed: ${applied.detail}`);
          break;
        }
        const ahead = Number(git(["rev-list", "--count", `${beforeSha}..HEAD`], worktree) || "0");
        if (ahead === 0) {
          skip(pr, `no-op — content already on \`${baseName}\``);
          continue;
        }

        if (CFG.dryRun) {
          results.created.push(`(dry-run) would create \`${branch}\` → \`${baseName}\` (${ahead} commit${ahead === 1 ? "" : "s"}) for #${pr.number} ${pr.title}`);
          baseName = branch;
          createdCount += 1;
          continue;
        }

        const pushed = tryGit(["push", "origin", `HEAD:refs/heads/${branch}`], worktree);
        if (!pushed.ok) {
          results.blocked.push(
            `#${pr.number}: push of \`${branch}\` was refused (${pushed.err.split("\n")[0]}). ` +
            "If the change touches `.github/workflows/`, GITHUB_TOKEN cannot push it — set the `PROMOTION_PAT` secret.",
          );
          break;
        }
        const title = promotionTitleFor(pr, group.key, position);
        const body = promotionBody(pr, group.key, position, group.prs, statusFor);
        const created = createPromotionPr({ branch, base: baseName, title, body });
        if (!created.ok) {
          results.blocked.push(`#${pr.number}: pushed \`${branch}\` but PR creation failed: ${created.err} — the next run will open it.`);
          break;
        }
        results.created.push(`${created.url} — ${title}`);
        createdCount += 1;
        baseName = branch;
        remoteBranches.add(branch);
        if (CFG.commentOnSource) {
          tryGh(["pr", "comment", String(pr.number), ...repoFlag(),
            "--body", `🚀 Promotion PR for \`${CFG.target}\` opened: ${created.url}`]);
        }
      }
    }
  } finally {
    tryGit(["worktree", "remove", "--force", worktree]);
    tryGit(["worktree", "prune"]);
    rmSync(worktreeRoot, { recursive: true, force: true });
  }

  summarize(results, eligible.length);
}

main().catch((error) => {
  console.error(`::error::${String(error?.stack || error)}`);
  process.exit(1);
});
