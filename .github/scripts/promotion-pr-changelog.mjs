#!/usr/bin/env node
// Maintain the standing develop → main promotion PR and its changelog.
//
// Called by .github/workflows/promote-develop-to-main.yml on every push to
// develop (and manual dispatch). Behaviour:
//   - No open promotion PR (base main, head develop) while develop is ahead
//     of main → open one, with the changelog already in the body.
//   - An open promotion PR exists → refresh the changelog section in its
//     description (between the promotion-changelog markers) and, when the set
//     of carried PRs actually changed, post a short delta comment so watchers
//     get a notification without re-reading the whole body.
//   - develop and main are level → do nothing. That is the normal state right
//     after a promotion merges and "Sync main into develop" levels the
//     branches again.
//
// The changelog is the first-parent spine of main..develop: the PR merges and
// direct pushes that landed on develop and that merging the promotion PR would
// ship to main. Ancestry and content can disagree — the same work often reaches
// main through its own main-based PR, and "Sync main into develop" then merges
// main back into develop, leaving develop ahead by commits whose content main
// already has. The spine is non-empty but the merge would change no files, so
// the section leads with an explicit no-op warning (see contentEmpty in
// buildSection) instead of claiming those PRs "will land in main". The no-op
// test compares the two root tree OIDs, which holds whether or not main is an
// ancestor of develop and needs no blobs. Each spine commit is attributed to a
// merged develop-based PR by, in order:
//   1. its subject ("Merge pull request #N ..." and squash-style "... (#N)");
//   2. content matching against recently merged develop-based PRs — merge
//      commit SHA, exact PR title, then the PRs' own commit subjects. This is
//      what keeps attribution alive after the AI rebase workflow rewrites
//      develop onto main, which replays PR commits as plain commits with no
//      merge subjects and new SHAs;
//   3. the commits/{sha}/pulls association API as a bounded last resort.
// Spine commits no PR claims are listed separately as direct commits.
//
// State model (no external state files — everything derives from the PR):
//   - The body section between <!-- promotion-changelog:start --> and
//     <!-- promotion-changelog:end --> is replaced wholesale on refresh; a
//     body without markers (e.g. the pre-changelog promotion PR) gets the
//     section appended, preserving any human-written preamble.
//   - <!-- promotion-changelog-prs: n,n --> inside the section records the
//     carried PR set; the delta comment is computed against it, so re-runs
//     and no-op pushes never spam comments.
//   - The section footer pins the develop commit it was built from using the
//     committer date (not wall-clock), so re-running on the same sha produces
//     a byte-identical body and skips the edit entirely.
//
// Env:
//   GH_TOKEN         token for reads, body edits and comments (required)
//   GH_TOKEN_CREATE  token used only to OPEN a new promotion PR; a PAT here
//                    lets Web CI run on the opening event (GITHUB_TOKEN-opened
//                    PRs get no pull_request runs). Falls back to GH_TOKEN.
//   GH_REPO          owner/repo (defaults to GITHUB_REPOSITORY)
//   BASE_BRANCH / HEAD_BRANCH  default main / develop
//   PROMOTION_PR_LABELS  labels created-if-missing and kept applied to the
//                    standing PR on every run (default "no-ai-rebase").
//                    no-ai-rebase keeps the AI rebase workflow from ever
//                    flattening develop's merge commits into plain commits —
//                    develop is an integration branch whose history IS its
//                    "Merge pull request #N" commits (they are attribution
//                    tier 1 for this changelog, and the repo's house style is
//                    merge commits). The merge-based conflict resolver still
//                    owns the PR's conflicts (it merges main into develop,
//                    preserving history). Set empty to opt out.
//   GIT_BASE / GIT_HEAD        git revs to diff; default origin/<base> and
//                              HEAD (the checked-out develop push). Local dry
//                              runs usually pass GIT_HEAD=origin/develop.
//   SKIP_LABELS      labels flagged with a warning in the changelog, default
//                    "no-promote,skip-promotion" (same set the per-feature
//                    promotion design treats as do-not-promote)
//   DRY_RUN=1        compute and print everything, write nothing
//
// Local validation:
//   node .github/scripts/promotion-pr-changelog.mjs --self-test
//   DRY_RUN=1 GH_REPO=lopugit/thingtime GIT_HEAD=origin/develop \
//     node .github/scripts/promotion-pr-changelog.mjs

import { execFileSync } from "node:child_process";
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
  base: env("BASE_BRANCH", "main"),
  head: env("HEAD_BRANCH", "develop"),
  gitBase: "",
  gitHead: env("GIT_HEAD", "HEAD"),
  repo: env("GH_REPO", env("GITHUB_REPOSITORY", "")),
  skipLabels: env("SKIP_LABELS", "no-promote,skip-promotion")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  prLabels: env("PROMOTION_PR_LABELS", "no-ai-rebase")
    .split(",").map((s) => s.trim()).filter(Boolean),
  dryRun: flag("DRY_RUN", false),
  assocApiBudget: 30, // max commits/{sha}/pulls fallback lookups per run
  recentMergedLimit: 40, // merged develop PRs prefetched for content matching
  innerCommitPrBudget: 25, // of those, how many get their commit subjects indexed
  labelVerifyBudget: 60, // carried PRs whose labels are re-checked via REST
  maxPrRows: 200,
  maxDirectRows: 50,
  maxCommentRows: 20,
};
CFG.gitBase = env("GIT_BASE", `origin/${CFG.base}`);

const MARKER_START = "<!-- promotion-changelog:start -->";
const MARKER_END = "<!-- promotion-changelog:end -->";
const PR_SET_RE = /<!--\s*promotion-changelog-prs:\s*([0-9,\s]*?)-->/;

// ---------------------------------------------------------------------------
// Small process helpers (execFile only — no shell, no quoting hazards)
// ---------------------------------------------------------------------------

const EXEC_OPTS = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { ...EXEC_OPTS, ...opts });
}
const git = (...args) => run("git", args).trim();

// True when merging the promotion would change no files. Compares the two
// commits' root tree OIDs rather than ancestry: develop can sit several commits
// ahead of main while carrying content main already has (work merged straight
// to main, then synced back into develop). Equal root trees mean any merge of
// the two produces main's current tree, so this holds whether or not main is an
// ancestor of develop.
//
// rev-parse and not `git diff --quiet`, deliberately: promote-develop-to-main
// checks out with filter=blob:none, and on differing trees — the normal case on
// every real promotion — `git diff` lazily fetches the differing blobs from the
// promisor remote. That is a needless network round trip on a 1.7 GB repo, and
// it exits 128 rather than 1 whenever the remote is unreachable or the checkout
// dropped its credentials (persist-credentials: false), which this function
// rethrows and nothing above catches — a promisor hiccup would fail the whole
// promotion job. Tree OIDs are already local in a blobless clone, so this needs
// no blobs and no network. Same primitive build-all-branch.mjs uses to detect a
// no-op rebuild. A missing rev still throws, so genuine git failures are never
// silently read as "differs".
//
// One-sided on purpose: equal trees always mean a no-op merge, but a no-op
// merge does not always mean equal trees — main strictly ahead in content
// (a hotfix landed before "Sync main into develop" runs) still merges to main's
// own tree while this reports "differs". A miss only falls back to the plain
// carrying wording, never to a false no-op claim. Deciding it exactly needs
// merge-tree, which this control plane runs only under the
// core.attributesFile=/dev/null sandbox because gitattributes-selected merge
// drivers are arbitrary code execution; that is not worth it for a transient
// state the sync workflow collapses on every push to main.
function treesMatch(base, head) {
  return git("rev-parse", `${base}^{tree}`) === git("rev-parse", `${head}^{tree}`);
}
const gh = (args, opts = {}) => run("gh", args, opts);
const ghJson = (args, opts = {}) => JSON.parse(gh(args, opts) || "null");

function summary(line) {
  console.log(line);
  const file = env("GITHUB_STEP_SUMMARY");
  if (file) appendFileSync(file, `${line}\n`);
}

let tmpDir = null;
function bodyFile(name, content) {
  if (!tmpDir) tmpDir = mkdtempSync(join(os.tmpdir(), "promotion-changelog-"));
  const file = join(tmpDir, name);
  writeFileSync(file, content);
  return file;
}

// ---------------------------------------------------------------------------
// Pure helpers (covered by --self-test)
// ---------------------------------------------------------------------------

export function parsePrNumberFromSubject(subject) {
  const merge = subject.match(/^Merge pull request #(\d+)\b/);
  if (merge) return Number(merge[1]);
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  if (squash) return Number(squash[1]);
  return null;
}

export function normalizeSubject(subject) {
  return String(subject ?? "").replace(/\s+/g, " ").trim();
}

export function escapeCell(text, max = 100) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : "");

export function buildSection(data) {
  const {
    prs, directs, totalCommits, headShort, headDate, base, head,
    contentEmpty = false,
    maxPrRows = CFG.maxPrRows, maxDirectRows = CFG.maxDirectRows,
  } = data;
  const setLine = [...prs.map((p) => p.number)].sort((a, b) => a - b).join(",");
  const lines = [];
  lines.push(MARKER_START);
  lines.push(`<!-- promotion-changelog-prs: ${setLine} -->`);
  lines.push("## 📋 What this promotion carries");
  lines.push("");
  const prCount = `**${prs.length} pull request${prs.length === 1 ? "" : "s"}**`;
  const commitCount = `${totalCommits} commit${totalCommits === 1 ? "" : "s"}`;
  if (contentEmpty) {
    lines.push(
      `> ⚠️ **This promotion would ship no file changes.** \`${head}\` and \`${base}\` have identical trees, ` +
      `so merging this PR only reconciles history (\`${head}\` is ${commitCount} ahead). Everything listed below ` +
      `already reached \`${base}\` by another route — nothing here is waiting to be released.`,
    );
    lines.push("");
  }
  if (prs.length) {
    lines.push(
      contentEmpty
        ? `${prCount} merged into \`${head}\` (${commitCount}) — already present in \`${base}\`, listed for history, newest first:`
        : `${prCount} merged into \`${head}\` (${commitCount}) will land in \`${base}\` when this PR merges — newest first:`,
    );
    lines.push("");
    lines.push("| PR | Title | Author | Source branch | Merged (UTC) |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const pr of prs.slice(0, maxPrRows)) {
      const flagged = pr.flagged ? " ⚠️" : "";
      lines.push(
        `| #${pr.number}${flagged} | ${escapeCell(pr.title)} | ${escapeCell(pr.author, 40)} | \`${escapeCell(pr.branch, 80)}\` | ${fmtDate(pr.mergedAt)} |`,
      );
    }
    if (prs.length > maxPrRows) {
      lines.push("");
      lines.push(`…and ${prs.length - maxPrRows} older pull requests not listed.`);
    }
  } else {
    lines.push(
      `No merged \`${head}\`-based pull requests are waiting — the ${commitCount} below landed on \`${head}\` directly.`,
    );
  }
  const flagged = prs.filter((p) => p.flagged);
  if (flagged.length) {
    lines.push("");
    lines.push(
      `⚠️ **Carries \`no-promote\`-labeled PRs:** ${flagged.map((p) => `#${p.number}`).join(", ")}. ` +
      (contentEmpty
        ? `Their changes are already in \`${base}\`, so holding this PR back no longer keeps them out — revert them on \`${base}\` if they must not be there.`
        : `An omnibus \`${head}\` → \`${base}\` merge ships their changes anyway — split or revert them first if they must not reach \`${base}\`.`),
    );
  }
  if (directs.length) {
    lines.push("");
    lines.push("<details>");
    lines.push(
      `<summary>Direct commits on \`${head}\` without a merged PR (${directs.length})</summary>`,
    );
    lines.push("");
    for (const c of directs.slice(0, maxDirectRows)) {
      lines.push(`- \`${c.sha}\` ${escapeCell(c.subject, 120)}`);
    }
    if (directs.length > maxDirectRows) {
      lines.push(`- …and ${directs.length - maxDirectRows} more.`);
    }
    lines.push("");
    lines.push("</details>");
  }
  lines.push("");
  lines.push(
    `<sub>Auto-maintained by the *Promote develop to main* workflow — refreshed from \`${head}\` @ \`${headShort}\` (${headDate}). ` +
    "Delta comments below track when entries enter or leave the promotion window.</sub>",
  );
  lines.push(MARKER_END);
  return lines.join("\n");
}

export function spliceSection(body, section) {
  const normalized = String(body ?? "").replace(/\r\n/g, "\n");
  const start = normalized.indexOf(MARKER_START);
  if (start === -1) {
    const trimmed = normalized.trimEnd();
    return trimmed ? `${trimmed}\n\n${section}\n` : `${section}\n`;
  }
  const end = normalized.indexOf(MARKER_END, start);
  const tail = end === -1 ? "\n" : normalized.slice(end + MARKER_END.length);
  return `${normalized.slice(0, start)}${section}${tail}`;
}

export function parsePrSet(body) {
  const match = String(body ?? "").replace(/\r\n/g, "\n").match(PR_SET_RE);
  if (!match) return null;
  return new Set(
    match[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
  );
}

export function computeMissingLabels(wanted, present) {
  const have = new Set(present.map((l) => String(l).toLowerCase()));
  return wanted.filter((l) => !have.has(String(l).toLowerCase()));
}

export function computeDelta(oldSet, newSet) {
  const added = [...newSet].filter((n) => !oldSet.has(n)).sort((a, b) => b - a);
  const removed = [...oldSet].filter((n) => !newSet.has(n)).sort((a, b) => b - a);
  return { added, removed };
}

export function buildComment({ initialized, delta, prsByNumber, total, totalCommits, contentEmpty = false, maxRows = CFG.maxCommentRows }) {
  const lines = [];
  const carry = `**${total} PR${total === 1 ? "" : "s"}** (${totalCommits} commit${totalCommits === 1 ? "" : "s"})`
    + (contentEmpty ? " — ⚠️ no file changes; the content is already on the base branch" : "");
  const describe = (n) => {
    const pr = prsByNumber.get(n);
    if (!pr) return `- #${n}`;
    return `- #${n} — ${escapeCell(pr.title)} (${escapeCell(pr.author, 40)})${pr.flagged ? " ⚠️ `no-promote`" : ""}`;
  };
  if (initialized) {
    lines.push(`📋 **Promotion changelog initialized** — this promotion currently carries ${carry}:`);
    lines.push("");
    const listed = [...prsByNumber.keys()].slice(0, maxRows);
    for (const n of listed) lines.push(describe(n));
    if (prsByNumber.size > listed.length) {
      lines.push(`- …and ${prsByNumber.size - listed.length} more.`);
    }
    lines.push("");
    lines.push(
      "The PR description now holds the full changelog and refreshes on every push to `develop`; " +
      "future comments only report what was added or removed.",
    );
    return lines.join("\n");
  }
  lines.push(`📋 **Promotion changelog updated** — now carrying ${carry}.`);
  if (delta.added.length) {
    lines.push("");
    lines.push("Added:");
    for (const n of delta.added.slice(0, maxRows)) lines.push(describe(n));
    if (delta.added.length > maxRows) lines.push(`- …and ${delta.added.length - maxRows} more.`);
  }
  if (delta.removed.length) {
    lines.push("");
    lines.push("Removed (no longer in the promotion window — rebased away, reverted, or already on `main`):");
    for (const n of delta.removed.slice(0, maxRows)) lines.push(`- #${n}`);
    if (delta.removed.length > maxRows) lines.push(`- …and ${delta.removed.length - maxRows} more.`);
  }
  lines.push("");
  lines.push("The full changelog lives in the PR description.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GitHub lookups
// ---------------------------------------------------------------------------

function toPrMeta(raw) {
  if (!raw) return null;
  const labels = (raw.labels ?? []).map((l) => String(l.name ?? l).toLowerCase());
  return {
    number: raw.number,
    title: raw.title ?? "",
    author: raw.user?.login ?? "",
    branch: raw.head?.ref ?? "",
    baseRef: raw.base?.ref ?? "",
    mergedAt: raw.merged_at ?? null,
    flagged: labels.some((l) => CFG.skipLabels.includes(l)),
    labelsVerified: true, // REST label data is authoritative
  };
}

// gh pr list rides the search index, whose labels can lag recent label edits
// (observed live: a fresh no-promote label showing as []). Re-check the PRs
// that actually appear in the changelog against REST before rendering flags.
function verifyFlags(prs) {
  for (const pr of prs.slice(0, CFG.labelVerifyBudget)) {
    if (pr.labelsVerified) continue;
    try {
      const labels = ghJson(["api", `repos/${CFG.repo}/issues/${pr.number}/labels`]) ?? [];
      pr.flagged = labels.some((l) => CFG.skipLabels.includes(String(l.name ?? "").toLowerCase()));
      pr.labelsVerified = true;
    } catch {
      // keep the prefetched value
    }
  }
}

const prCache = new Map();
function fetchPr(number) {
  if (prCache.has(number)) return prCache.get(number);
  let meta = null;
  try {
    meta = toPrMeta(ghJson(["api", `repos/${CFG.repo}/pulls/${number}`]));
  } catch {
    meta = null; // deleted/inaccessible PR — treat its commit as direct
  }
  prCache.set(number, meta);
  return meta;
}

// Content index over recently merged develop-based PRs, used to attribute
// spine commits the subject regex cannot claim — the normal state after the
// AI rebase workflow rewrites develop (replayed commits keep their subjects
// but lose merge markers and change SHAs).
const contentIndex = { loaded: false, prs: [], bySha: new Map(), byTitle: new Map(), bySubject: null };

function loadContentIndex() {
  if (contentIndex.loaded) return contentIndex;
  contentIndex.loaded = true;
  try {
    const merged = ghJson([
      "pr", "list", "--repo", CFG.repo, "--base", CFG.head, "--state", "merged",
      "--limit", String(CFG.recentMergedLimit),
      "--json", "number,title,headRefName,mergedAt,author,labels,mergeCommit",
    ]) ?? [];
    for (const raw of merged) {
      const meta = {
        number: raw.number,
        title: raw.title ?? "",
        author: raw.author?.login ?? "",
        branch: raw.headRefName ?? "",
        baseRef: CFG.head,
        mergedAt: raw.mergedAt ?? null,
        flagged: (raw.labels ?? []).some((l) => CFG.skipLabels.includes(String(l.name ?? "").toLowerCase())),
        labelsVerified: false, // search-backed data; re-checked if it reaches the changelog
      };
      prCache.set(meta.number, meta);
      contentIndex.prs.push(meta);
      if (raw.mergeCommit?.oid) contentIndex.bySha.set(raw.mergeCommit.oid, meta);
      const title = normalizeSubject(meta.title);
      if (title && !contentIndex.byTitle.has(title)) contentIndex.byTitle.set(title, meta);
    }
  } catch {
    // best-effort: without the index, subjects and the association API still work
  }
  return contentIndex;
}

// Lazily index the commit subjects of the prefetched PRs (newest first, one
// API call each, bounded) so rebase-replayed commits map back to their PR.
function loadSubjectIndex() {
  const index = loadContentIndex();
  if (index.bySubject) return index.bySubject;
  index.bySubject = new Map();
  for (const pr of index.prs.slice(0, CFG.innerCommitPrBudget)) {
    try {
      const commits = ghJson(["api", `repos/${CFG.repo}/pulls/${pr.number}/commits?per_page=100`]) ?? [];
      for (const c of commits) {
        const subject = normalizeSubject(String(c.commit?.message ?? "").split("\n")[0]);
        if (subject && !index.bySubject.has(subject)) index.bySubject.set(subject, pr);
      }
    } catch {
      // skip this PR; others may still match
    }
  }
  return index.bySubject;
}

function contentMatchedPr(sha, subject) {
  const index = loadContentIndex();
  const bySha = index.bySha.get(sha);
  if (bySha) return bySha;
  const normalized = normalizeSubject(subject);
  if (!normalized) return null;
  const byTitle = index.byTitle.get(normalized);
  if (byTitle) return byTitle;
  return loadSubjectIndex().get(normalized) ?? null;
}

// Standing-PR labels. no-ai-rebase is honored by both AI history workflows:
// the rebase workflow skips labeled PRs outright, and the merge-based
// conflict resolver explicitly keeps ownership of them — so develop's merge
// commits (attribution tier 1) survive instead of being flattened.
const LABEL_SPECS = {
  "no-ai-rebase": {
    color: "1d76db",
    description: "Opt this PR's head branch out of AI history rewriting; the merge resolver owns its conflicts",
  },
};

const ensuredLabels = new Set();
function ensureLabelExists(name) {
  if (ensuredLabels.has(name)) return;
  try {
    gh(["api", `repos/${CFG.repo}/labels/${encodeURIComponent(name)}`]);
  } catch {
    const spec = LABEL_SPECS[name] ?? { color: "ededed", description: "" };
    if (CFG.dryRun) {
      console.log(`DRY_RUN: would create missing label "${name}".`);
    } else {
      gh([
        "api", "-X", "POST", `repos/${CFG.repo}/labels`,
        "-f", `name=${name}`, "-f", `color=${spec.color}`, "-f", `description=${spec.description}`,
      ]);
    }
  }
  ensuredLabels.add(name);
}

// Keep the wanted labels applied to the open standing PR. Labels are read via
// REST (issues/N/labels) — authoritative, unlike search-backed listings — and
// re-added when missing, so a stray label removal self-heals on the next push.
function syncPrLabels(prNumber) {
  if (!CFG.prLabels.length) return;
  let present = [];
  try {
    present = (ghJson(["api", `repos/${CFG.repo}/issues/${prNumber}/labels`]) ?? [])
      .map((l) => String(l.name ?? ""));
  } catch {
    return; // reads failed — leave labels for the next run rather than guessing
  }
  const missing = computeMissingLabels(CFG.prLabels, present);
  if (!missing.length) return;
  for (const name of missing) ensureLabelExists(name);
  if (CFG.dryRun) {
    console.log(`DRY_RUN: would add label(s) ${missing.join(", ")} to PR #${prNumber}.`);
    return;
  }
  gh([
    "pr", "edit", String(prNumber), "--repo", CFG.repo,
    ...missing.flatMap((name) => ["--add-label", name]),
  ]);
  summary(`Re-applied missing label(s) on PR #${prNumber}: ${missing.join(", ")}.`);
}

let assocBudget = CFG.assocApiBudget;
function associatedPr(sha) {
  if (assocBudget <= 0) return null;
  assocBudget -= 1;
  try {
    const pulls = ghJson(["api", `repos/${CFG.repo}/commits/${sha}/pulls`]) ?? [];
    for (const raw of pulls) {
      const meta = toPrMeta(raw);
      if (meta?.mergedAt && meta.baseRef === CFG.head) {
        prCache.set(meta.number, meta);
        return meta;
      }
    }
  } catch {
    // association lookup is best-effort; the commit stays a direct entry
  }
  return null;
}

// ---------------------------------------------------------------------------
// Self-test (pure helpers only — no git/gh needed)
// ---------------------------------------------------------------------------

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) {
      console.error(`self-test FAIL: ${msg}`);
      process.exitCode = 1;
    }
  };
  assert(parsePrNumberFromSubject("Merge pull request #189 from lopugit/x") === 189, "merge subject");
  assert(parsePrNumberFromSubject("feat: fluid compute (#123)") === 123, "squash subject");
  assert(parsePrNumberFromSubject("Merge pull request #7 from a/b into c") === 7, "merge subject with suffix");
  assert(parsePrNumberFromSubject("chore: refresh graphify outputs") === null, "plain subject");
  assert(parsePrNumberFromSubject("Merge main into develop (AI-resolved conflicts)") === null, "sync merge subject");
  assert(normalizeSubject("  feat:   thing \n") === "feat: thing", "subject normalization");
  assert(escapeCell("a|b") === "a\\|b", "cell pipe escape");
  assert(escapeCell("a\\b") === "a\\\\b", "cell backslash escape");
  assert(escapeCell("x".repeat(200)).length <= 101, "cell truncation");

  const section = buildSection({
    prs: [
      { number: 186, title: "ci: standing promo | workflow", author: "lopugit", branch: "claude/develop-main-auto-pr-365e02", mergedAt: "2026-08-07T10:00:00Z", flagged: true },
      { number: 187, title: "feat: thing", author: "lopugit", branch: "feat/thing", mergedAt: "2026-08-07T11:00:00Z", flagged: false },
    ],
    directs: [{ sha: "abc1234", subject: "Merge main into develop" }],
    totalCommits: 9,
    headShort: "4d2defc3",
    headDate: "2026-08-08",
    base: "main",
    head: "develop",
  });
  assert(section.startsWith(MARKER_START) && section.endsWith(MARKER_END), "section markers");
  assert(section.includes("promotion-changelog-prs: 186,187"), "sorted set line");
  assert(section.includes("ci: standing promo \\| workflow"), "escaped title in table");
  assert(section.includes("#186 ⚠️"), "flagged row marker");
  assert(section.includes("Direct commits"), "directs section");
  assert(section.includes("will land in `main`"), "carrying promotion claims a landing");
  assert(!section.includes("would ship no file changes"), "carrying promotion has no no-op warning");

  // A promotion whose trees already match must never claim the listed PRs
  // "will land in main" — that is the develop-ahead-but-content-identical
  // state left behind when work reaches main directly and is synced back.
  const noop = buildSection({
    prs: [{ number: 635, title: "feat: editor", author: "lopugit", branch: "codex/editor", mergedAt: "2026-09-06T03:06:52Z", flagged: true }],
    directs: [{ sha: "b1f8e212", subject: "Merge remote-tracking branch 'origin/main' into develop" }],
    totalCommits: 3,
    headShort: "b1f8e212",
    headDate: "2026-09-06",
    base: "main",
    head: "develop",
    contentEmpty: true,
  });
  assert(noop.includes("would ship no file changes"), "no-op promotion warns up front");
  assert(!noop.includes("will land in `main`"), "no-op promotion drops the landing claim");
  assert(noop.includes("already present in `main`"), "no-op promotion reframes the table");
  assert(noop.includes("already in `main`"), "no-op promotion corrects no-promote advice");
  assert(!noop.includes("ships their changes anyway"), "no-op promotion drops stale no-promote advice");
  assert(noop.includes("promotion-changelog-prs: 635"), "no-op promotion keeps the delta set line");
  assert(parsePrSet(noop).has(635), "no-op promotion set line stays parseable");

  const fresh = spliceSection("Preamble text.", section);
  assert(fresh.includes("Preamble text.\n\n<!-- promotion-changelog:start -->"), "append after preamble");
  assert(spliceSection(fresh, section) === fresh, "idempotent splice");
  const rewritten = spliceSection(fresh.replace("186,187", "186"), section);
  assert(rewritten === fresh, "marker replacement restores section");
  assert(spliceSection("body\r\nwith crlf", section).includes("body\nwith crlf"), "crlf normalization");

  assert(parsePrSet("no markers here") === null, "pr set absent");
  assert([...parsePrSet(fresh)].join(",") === "186,187", "pr set parse");
  assert(parsePrSet(`${MARKER_START}\n<!-- promotion-changelog-prs:  -->`).size === 0, "empty pr set");

  const delta = computeDelta(new Set([1, 2]), new Set([2, 3]));
  assert(delta.added.join(",") === "3" && delta.removed.join(",") === "1", "delta");

  assert(computeMissingLabels(["no-ai-rebase"], []).join(",") === "no-ai-rebase", "missing label");
  assert(computeMissingLabels(["no-ai-rebase"], ["No-AI-Rebase"]).length === 0, "label match is case-insensitive");
  assert(computeMissingLabels([], ["x"]).length === 0, "no wanted labels");

  const comment = buildComment({
    initialized: false,
    delta: { added: [187], removed: [42] },
    prsByNumber: new Map([[187, { number: 187, title: "feat: thing", author: "lopugit", flagged: false }]]),
    total: 2,
    totalCommits: 9,
  });
  assert(comment.includes("Added:") && comment.includes("#187") && comment.includes("#42"), "delta comment");
  assert(!comment.includes("no file changes"), "carrying delta comment has no no-op note");

  const noopComment = buildComment({
    initialized: false,
    delta: { added: [635], removed: [] },
    prsByNumber: new Map([[635, { number: 635, title: "feat: editor", author: "lopugit", flagged: false }]]),
    total: 1,
    totalCommits: 3,
    contentEmpty: true,
  });
  assert(noopComment.includes("no file changes"), "no-op delta comment flags the empty promotion");

  if (process.exitCode) throw new Error("self-test failed");
  console.log("self-test OK");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const PREAMBLE =
  "Standing promotion PR opened by the *Promote develop to main* workflow. " +
  "Its head is `develop`, so every new push or merge to `develop` shows up here on its own. " +
  "Merge it whenever main should catch up — the workflow opens the next one after the following push to `develop`. " +
  "The *Sync main into develop* workflow levels develop with main again after each promotion.";

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  if (!CFG.repo) throw new Error("GH_REPO or GITHUB_REPOSITORY must be set");

  const spineRaw = git(
    "log", "--first-parent", "--format=%H%x09%s", `${CFG.gitBase}..${CFG.gitHead}`,
  );
  const spine = spineRaw
    ? spineRaw.split("\n").map((line) => {
        const [sha, ...rest] = line.split("\t");
        return { sha, subject: rest.join("\t") };
      })
    : [];
  const totalCommits = Number(git("rev-list", "--count", `${CFG.gitBase}..${CFG.gitHead}`)) || 0;
  const headShort = spine.length ? spine[0].sha.slice(0, 8) : "";
  const headDate = spine.length
    ? git("show", "-s", "--format=%cs", spine[0].sha)
    : "";

  const openPr = ghJson([
    "pr", "list", "--repo", CFG.repo, "--base", CFG.base, "--head", CFG.head,
    "--state", "open", "--json", "number,body",
  ])?.[0];
  if (openPr) syncPrLabels(openPr.number);

  if (!spine.length) {
    summary(
      openPr
        ? `\`${CFG.head}\` and \`${CFG.base}\` are level — leaving PR #${openPr.number} untouched.`
        : `\`${CFG.head}\` has nothing \`${CFG.base}\` lacks — no promotion PR needed.`,
    );
    return;
  }

  // Resolve each spine commit (newest first) to a merged develop-based PR, or
  // keep it as a direct commit.
  const prs = [];
  const seen = new Set();
  const directs = [];
  for (const commit of spine) {
    let meta = null;
    const fromSubject = parsePrNumberFromSubject(commit.subject);
    if (fromSubject) meta = fetchPr(fromSubject);
    if (!meta) meta = contentMatchedPr(commit.sha, commit.subject);
    if (!meta) meta = associatedPr(commit.sha);
    if (meta?.mergedAt && meta.baseRef === CFG.head) {
      if (!seen.has(meta.number)) {
        seen.add(meta.number);
        prs.push(meta);
      }
    } else {
      directs.push({ sha: commit.sha.slice(0, 8), subject: commit.subject });
    }
  }

  verifyFlags(prs);
  const contentEmpty = treesMatch(CFG.gitBase, CFG.gitHead);
  // The job summary is the only place an operator reliably learns the
  // promotion is a no-op. The body carries the ⚠️ warning, but only the run
  // that flips the state actually rewrites it — every later push finds the
  // body already current and returns early. The delta comment is gated on the
  // PR set changing, and "Sync main into develop" empties the content without
  // touching that set, so buildComment's note effectively never fires here.
  // Tagging the summary lines keeps "carrying N PRs / M commits" from reading
  // as a pending release in exactly the state this whole change is about.
  const noopNote = contentEmpty ? ", no file changes vs base" : "";
  const section = buildSection({
    prs, directs, totalCommits, headShort, headDate, base: CFG.base, head: CFG.head,
    contentEmpty,
  });
  const prsByNumber = new Map(prs.map((p) => [p.number, p]));
  const newSet = new Set(prsByNumber.keys());

  try {
    if (!openPr) {
      const body = `${PREAMBLE}\n\n${section}\n`;
      for (const name of CFG.prLabels) ensureLabelExists(name);
      if (CFG.dryRun) {
        console.log(`DRY_RUN: would open a promotion PR (${CFG.head} → ${CFG.base}) labeled [${CFG.prLabels.join(", ")}] with body:\n${body}`);
      } else {
        const createToken = env("GH_TOKEN_CREATE", env("GH_TOKEN"));
        const url = gh(
          [
            "pr", "create", "--repo", CFG.repo, "--base", CFG.base, "--head", CFG.head,
            "--title", "Promote develop to main", "--body-file", bodyFile("body.md", body),
            ...CFG.prLabels.flatMap((name) => ["--label", name]),
          ],
          { env: { ...process.env, GH_TOKEN: createToken, GITHUB_TOKEN: createToken } },
        ).trim();
        console.log(url);
      }
      summary(
        `Opened a promotion PR (${CFG.head} → ${CFG.base}) carrying ${prs.length} PRs / ${totalCommits} commits${noopNote}.`,
      );
      return;
    }

    const oldBody = String(openPr.body ?? "").replace(/\r\n/g, "\n");
    const newBody = spliceSection(oldBody, section);
    if (newBody === oldBody) {
      summary(`Changelog on PR #${openPr.number} is already current (${prs.length} PRs / ${totalCommits} commits${noopNote}).`);
      return;
    }

    const oldSet = parsePrSet(oldBody);
    const initialized = oldSet === null;
    const delta = computeDelta(oldSet ?? new Set(), newSet);

    if (CFG.dryRun) {
      console.log(`DRY_RUN: would update PR #${openPr.number} body to:\n${newBody}`);
    } else {
      gh([
        "pr", "edit", String(openPr.number), "--repo", CFG.repo,
        "--body-file", bodyFile("body.md", newBody),
      ]);
    }

    const worthCommenting = initialized
      ? newSet.size > 0
      : delta.added.length > 0 || delta.removed.length > 0;
    if (worthCommenting) {
      const comment = buildComment({
        initialized, delta, prsByNumber, total: newSet.size, totalCommits, contentEmpty,
      });
      if (CFG.dryRun) {
        console.log(`DRY_RUN: would comment on PR #${openPr.number}:\n${comment}`);
      } else {
        gh([
          "pr", "comment", String(openPr.number), "--repo", CFG.repo,
          "--body-file", bodyFile("comment.md", comment),
        ]);
      }
      summary(
        `Refreshed the changelog on PR #${openPr.number} (${prs.length} PRs / ${totalCommits} commits${noopNote}); ` +
        `delta comment ${CFG.dryRun ? "planned" : "posted"} (+${delta.added.length} / −${delta.removed.length}${initialized ? ", initialized" : ""}).`,
      );
    } else {
      summary(
        `Refreshed the changelog on PR #${openPr.number} (${prs.length} PRs / ${totalCommits} commits${noopNote}); PR set unchanged, no comment.`,
      );
    }
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
