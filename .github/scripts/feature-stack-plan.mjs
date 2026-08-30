#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SHA = /^[0-9a-f]{40}$/u;
const REF = /^(?![./])(?!.*(?:\.\.|\/\.|\.\/|@\{|\\|[~^:?*\[]))[A-Za-z0-9._/-]{1,180}(?<![./])$/u;
const MAX_SOURCES = 20;
const MAX_TARGETS = 2;

const exactKeys = (value, keys) =>
  value && !Array.isArray(value) && typeof value === "object" &&
  Object.keys(value).join(",") === keys.join(",");

export function canonicalFeatureStackPlan(input) {
  if (!exactKeys(input, ["autoMerge", "name", "sources", "targets", "version"]) || input.version !== 1) {
    throw new Error("invalid feature stack envelope");
  }
  if (input.autoMerge !== true || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 80 ||
      input.name !== input.name.trim() || /[\u0000-\u001f\u007f]/u.test(input.name)) {
    throw new Error("invalid feature stack metadata");
  }
  if (!Array.isArray(input.sources) || input.sources.length < 2 || input.sources.length > MAX_SOURCES) {
    throw new Error("feature stack needs 2-20 sources");
  }
  if (!Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > MAX_TARGETS) {
    throw new Error("feature stack needs 1-2 targets");
  }
  const sourceNumbers = new Set();
  const sourceRefs = new Set();
  const sources = input.sources.map((source) => {
    if (!exactKeys(source, ["head", "pr", "sha", "title"]) ||
        !Number.isSafeInteger(source.pr) || source.pr < 1 || source.pr > 999999999 ||
        typeof source.head !== "string" || !REF.test(source.head) ||
        typeof source.sha !== "string" || !SHA.test(source.sha) ||
        typeof source.title !== "string" || source.title.length < 1 || source.title.length > 200 ||
        source.title !== source.title.trim() || /[\u0000-\u001f\u007f]/u.test(source.title)) {
      throw new Error("invalid feature stack source");
    }
    if (sourceNumbers.has(source.pr) || sourceRefs.has(source.head)) throw new Error("duplicate feature stack source");
    sourceNumbers.add(source.pr);
    sourceRefs.add(source.head);
    return { head: source.head, pr: source.pr, sha: source.sha, title: source.title };
  });
  const targetSet = new Set();
  const targets = input.targets.map((target) => {
    if (typeof target !== "string" || !REF.test(target) || sourceRefs.has(target) || targetSet.has(target)) {
      throw new Error("invalid feature stack target");
    }
    targetSet.add(target);
    return target;
  });
  return { autoMerge: true, name: input.name, sources, targets, version: 1 };
}

export function decodeFeatureStackPlan(encoded) {
  if (typeof encoded !== "string" || encoded.length < 8 || encoded.length > 24000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new Error("invalid feature stack encoding");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 16000 || bytes.toString("base64") !== encoded) throw new Error("invalid feature stack encoding");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const plan = canonicalFeatureStackPlan(JSON.parse(text));
  if (JSON.stringify(plan) !== text) throw new Error("feature stack plan is not canonical");
  return plan;
}

export function featureStackId(plan) {
  return createHash("sha256").update(JSON.stringify(canonicalFeatureStackPlan(plan))).digest("hex").slice(0, 16);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function verifyFeatureStackHistory(plan, target, baseSha, head = "HEAD") {
  const canonical = canonicalFeatureStackPlan(plan);
  if (!canonical.targets.includes(target) || !SHA.test(baseSha)) throw new Error("invalid verification target");
  const commits = git("rev-list", "--first-parent", "--reverse", `${baseSha}..${head}`).split("\n").filter(Boolean);
  assert.equal(commits.length, canonical.sources.length, "one merge commit is required per source");
  let previous = baseSha;
  for (let index = 0; index < canonical.sources.length; index += 1) {
    const source = canonical.sources[index];
    const commit = commits[index];
    const parents = git("show", "-s", "--format=%P", commit).split(" ");
    assert.deepEqual(parents, [previous, source.sha], `source PR #${source.pr} must be the next exact merge parent`);
    const message = git("show", "-s", "--format=%B", commit);
    assert.match(message, new RegExp(`^Feature-Stack-Source: pr=${source.pr} head=${source.sha}$`, "mu"));

    let mergeOutput = "";
    try {
      mergeOutput = git("-c", "core.attributesFile=/dev/null", "merge-tree", "--write-tree", "--no-messages", "--name-only", previous, source.sha);
    } catch (error) {
      mergeOutput = String(error.stdout ?? "").trim();
    }
    const [autoTree, ...conflictLines] = mergeOutput.split("\n");
    assert.match(autoTree ?? "", SHA, "merge-tree must produce an auto-merge tree");
    const conflicts = new Set(conflictLines.filter(Boolean));
    const actualTree = git("show", "-s", "--format=%T", commit);
    const changed = git("diff-tree", "-r", "--name-only", autoTree, actualTree).split("\n").filter(Boolean);
    if (conflicts.size === 0) assert.equal(actualTree, autoTree, `clean source PR #${source.pr} must match git's auto-merge tree`);
    for (const path of changed) {
      assert.ok(conflicts.has(path), `source PR #${source.pr} changed non-conflict path ${path}`);
    }
    const unmerged = git("ls-tree", "-r", "--name-only", commit);
    assert.ok(unmerged.length > 0, "merge commit tree must be readable");
    previous = commit;
  }
  return { commits, stackId: featureStackId(canonical) };
}

function selfTest() {
  const plan = canonicalFeatureStackPlan({
    autoMerge: true,
    name: "Search + Messenger",
    sources: [
      { head: "feature/search", pr: 12, sha: "a".repeat(40), title: "Search" },
      { head: "feature/messenger", pr: 14, sha: "b".repeat(40), title: "Messenger" }
    ],
    targets: ["develop", "main"],
    version: 1
  });
  const encoded = Buffer.from(JSON.stringify(plan)).toString("base64");
  assert.deepEqual(decodeFeatureStackPlan(encoded), plan);
  assert.equal(featureStackId(plan).length, 16);
  assert.throws(() => canonicalFeatureStackPlan({ ...plan, targets: ["develop", "develop"] }), /target/);
  assert.throws(() => decodeFeatureStackPlan(Buffer.from(JSON.stringify({ ...plan, extra: true })).toString("base64")), /envelope/);

  const originalCwd = process.cwd();
  const repository = mkdtempSync(join(tmpdir(), "feature-stack-plan-"));
  try {
    process.chdir(repository);
    git("init", "-q");
    git("config", "user.name", "Feature Stack Test");
    git("config", "user.email", "feature-stack@example.invalid");
    writeFileSync("base.txt", "base\n");
    git("add", "base.txt");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");

    git("switch", "-q", "-c", "source-one");
    writeFileSync("one.txt", "one\n");
    git("add", "one.txt");
    git("commit", "-q", "-m", "source one");
    const sourceOne = git("rev-parse", "HEAD");

    git("switch", "-q", "--detach", base);
    git("switch", "-q", "-c", "source-two");
    writeFileSync("two.txt", "two\n");
    git("add", "two.txt");
    git("commit", "-q", "-m", "source two");
    const sourceTwo = git("rev-parse", "HEAD");

    const historyPlan = canonicalFeatureStackPlan({
      autoMerge: true,
      name: "Verifier",
      sources: [
        { head: "source-one", pr: 1, sha: sourceOne, title: "One" },
        { head: "source-two", pr: 2, sha: sourceTwo, title: "Two" }
      ],
      targets: ["develop"],
      version: 1
    });
    git("switch", "-q", "--detach", base);
    git("merge", "--no-ff", "-q", "-m", `Merge source one\n\nFeature-Stack-Source: pr=1 head=${sourceOne}`, sourceOne);
    git("merge", "--no-ff", "-q", "-m", `Merge source two\n\nFeature-Stack-Source: pr=2 head=${sourceTwo}`, sourceTwo);
    assert.equal(verifyFeatureStackHistory(historyPlan, "develop", base).commits.length, 2);
  } finally {
    process.chdir(originalCwd);
    rmSync(repository, { recursive: true, force: true });
  }
  console.log("Feature Stack plan self-test: OK");
}

if (process.argv.includes("--self-test")) selfTest();
else if (process.argv[2] === "decode") {
  const plan = decodeFeatureStackPlan(process.argv[3] ?? "");
  process.stdout.write(`${JSON.stringify({ plan, stackId: featureStackId(plan) })}\n`);
} else if (process.argv[2] === "verify") {
  const plan = canonicalFeatureStackPlan(JSON.parse(readFileSync(process.argv[3], "utf8")));
  process.stdout.write(`${JSON.stringify(verifyFeatureStackHistory(plan, process.argv[4], process.argv[5]))}\n`);
} else {
  console.error("usage: feature-stack-plan.mjs --self-test | decode <base64> | verify <plan.json> <target> <base-sha>");
  process.exit(2);
}
