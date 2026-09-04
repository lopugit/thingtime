#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../..");
const actionPath = path.join(
  repositoryRoot,
  ".github/actions/rebase-conflict-round/action.yml",
);

const runGit = (cwd, args, options = {}) =>
  execFileSync("git", args, {
    cwd,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function filesUnder(root, relative) {
  const absolute = path.join(root, relative);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(root, child) : [child];
  });
}

function hashNamedFiles(root, names) {
  const chunks = [];
  for (const name of [...names].sort()) {
    chunks.push(Buffer.from(`${name}\0`));
    chunks.push(Buffer.from(`${sha256(readFileSync(path.join(root, name)))}\n`));
  }
  return sha256(Buffer.concat(chunks));
}

function hashTrustedTree(root) {
  return hashNamedFiles(root, [
    ...filesUnder(root, ".github/actions/lopu-agent"),
    ...filesUnder(root, ".github/actions/rebase-conflict-round"),
    ...filesUnder(root, ".github/scripts/rebase-stack"),
    ".github/scripts/classify-claude-credential-failure.mjs",
    ".github/scripts/graphify-cas.mjs",
    ".github/scripts/lopu-credential-vault.mjs",
    ".github/scripts/stage-graphify-snapshots.mjs",
  ]);
}

function hashRebaseState(repo) {
  const gitDir = runGit(repo, ["rev-parse", "--absolute-git-dir"]).trim();
  const candidate = ["rebase-merge", "rebase-apply"]
    .map((name) => path.join(gitDir, name))
    .find((name) => {
      try {
        return statSync(name).isDirectory();
      } catch {
        return false;
      }
    });
  assert.ok(candidate, "fixture must be stopped in a rebase");
  const names = filesUnder(candidate, ".").map((name) => `./${name}`);
  return hashNamedFiles(candidate, names);
}

function extractVerifierScript() {
  const source = readFileSync(actionPath, "utf8");
  const step = source.indexOf(
    "    - name: Verify scratch and continue the isolated real rebase",
  );
  assert.notEqual(step, -1, "verify step must exist");
  const marker = "\n      run: |\n";
  const bodyStart = source.indexOf(marker, step);
  assert.notEqual(bodyStart, -1, "verify step must have an inline script");
  const start = bodyStart + marker.length;
  const end = source.indexOf("\n    - name:", start);
  assert.notEqual(end, -1, "verify step must have a following step");
  return source
    .slice(start, end)
    .split("\n")
    .map((line) => {
      assert.ok(line === "" || line.startsWith("        "), `bad script indentation: ${line}`);
      return line.slice(8);
    })
    .join("\n");
}

function copyTrustedTree(destination) {
  const paths = [
    ".github/actions/lopu-agent",
    ".github/actions/rebase-conflict-round",
    ".github/scripts/rebase-stack",
  ];
  for (const relative of paths) {
    const target = path.join(destination, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repositoryRoot, relative), target, { recursive: true });
  }
  mkdirSync(path.join(destination, ".github/scripts"), { recursive: true });
  for (const name of [
    "classify-claude-credential-failure.mjs",
    "graphify-cas.mjs",
    "lopu-credential-vault.mjs",
    "stage-graphify-snapshots.mjs",
  ]) {
    cpSync(
      path.join(repositoryRoot, ".github/scripts", name),
      path.join(destination, ".github/scripts", name),
    );
  }
}

function makeStoppedRebase(root, { executableConflict = false } = {}) {
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "Lopu verifier fixture"]);
  runGit(repo, ["config", "user.email", "lopu-fixture@example.invalid"]);
  runGit(repo, ["config", "merge.conflictStyle", "zdiff3"]);
  writeFileSync(path.join(repo, "conflict.txt"), "base\n");
  if (executableConflict) chmodSync(path.join(repo, "conflict.txt"), 0o755);
  writeFileSync(path.join(repo, "related.txt"), "related base\n");
  runGit(repo, ["add", "."]);
  runGit(repo, ["commit", "-qm", "base"]);
  const base = runGit(repo, ["rev-parse", "HEAD"]).trim();

  runGit(repo, ["switch", "-qc", "feature"]);
  writeFileSync(path.join(repo, "conflict.txt"), "feature\n");
  runGit(repo, ["commit", "-qam", "feature"]);
  const rebaseHead = runGit(repo, ["rev-parse", "HEAD"]).trim();

  runGit(repo, ["switch", "-qc", "destination", base]);
  writeFileSync(path.join(repo, "conflict.txt"), "destination\n");
  runGit(repo, ["commit", "-qam", "destination"]);
  const head = runGit(repo, ["rev-parse", "HEAD"]).trim();
  runGit(repo, ["switch", "-q", "feature"]);
  const rebase = spawnSync("git", ["rebase", "destination"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.notEqual(rebase.status, 0, "fixture rebase must conflict");
  assert.equal(runGit(repo, ["rev-parse", "HEAD"]).trim(), head);
  assert.equal(runGit(repo, ["rev-parse", "REBASE_HEAD"]).trim(), rebaseHead);

  return { repo, head, rebaseHead, base };
}

function runVerifier({ addNewFile = false, executableConflict = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "thingtime-rebase-related-"));
  const fixture = makeStoppedRebase(root, { executableConflict });
  const scratch = path.join(root, "scratch");
  const trusted = path.join(root, "trusted");
  mkdirSync(scratch);
  mkdirSync(trusted);
  copyTrustedTree(trusted);
  writeFileSync(path.join(scratch, "conflict.txt"), "destination\nfeature\n");
  writeFileSync(path.join(scratch, "related.txt"), "related fixed\n");
  if (addNewFile) writeFileSync(path.join(scratch, "invented.txt"), "invented\n");

  const output = path.join(root, "github-output");
  const githubEnv = path.join(root, "github-env");
  writeFileSync(output, "");
  writeFileSync(githubEnv, "");
  const env = {
    ...process.env,
    RUNNER_TEMP: root,
    GITHUB_OUTPUT: output,
    GITHUB_ENV: githubEnv,
    REPO_ABS: fixture.repo,
    SCRATCH_ABS: scratch,
    SAFE_TRUSTED_ABS: trusted,
    EXPECTED_TRUSTED_SHA256: hashTrustedTree(trusted),
    EXPECTED_HEAD_SHA: fixture.head,
    EXPECTED_REBASE_HEAD_SHA: fixture.rebaseHead,
    EXPECTED_REBASE_PARENT_SHA: fixture.base,
    EXPECTED_INDEX_ENTRIES_SHA256: sha256(
      runGit(fixture.repo, ["ls-files", "--stage", "-z"], { encoding: "buffer" }),
    ),
    EXPECTED_REBASE_STATE_SHA256: hashRebaseState(fixture.repo),
    EXPECTED_CONFLICT_PATHS: "conflict.txt",
    EXPECTED_AI_CONFLICT_PATHS: "conflict.txt",
    EXPECTED_DETERMINISTIC_PATHS: "",
    ALLOW_UNRESOLVED: "false",
    GRAPHIFY_RESET: "false",
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    ANTHROPIC_API_KEY_FALLBACK: "",
    CLAUDE_CODE_OAUTH_TOKEN_FALLBACK: "",
    OPENAI_API_KEY: "",
    ACTION_GITHUB_TOKEN: "",
  };
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", extractVerifierScript()],
    { cwd: scratch, env, encoding: "utf8" },
  );
  return { root, fixture, result, output };
}

function runPrepareExecutableConflict() {
  const root = mkdtempSync(path.join(tmpdir(), "thingtime-rebase-executable-"));
  const fixture = makeStoppedRebase(root, { executableConflict: true });
  const scratch = path.join(root, "scratch");
  const round = path.join(root, "round");
  const output = path.join(root, "github-output");
  mkdirSync(scratch);
  mkdirSync(round);
  writeFileSync(output, "");
  const result = spawnSync(
    path.join(repositoryRoot, ".github/scripts/rebase-stack/prepare-round.sh"),
    [fixture.repo, scratch, round],
    {
      cwd: fixture.repo,
      env: {
        ...process.env,
        RUNNER_TEMP: root,
        GITHUB_OUTPUT: output,
        GITHUB_WORKSPACE: scratch,
      },
      encoding: "utf8",
    },
  );
  return { root, fixture, scratch, result, output };
}

test("verifier imports a bounded related edit and completes the stopped rebase", () => {
  const run = runVerifier();
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    assert.equal(readFileSync(path.join(run.fixture.repo, "related.txt"), "utf8"), "related fixed\n");
    assert.equal(runGit(run.fixture.repo, ["show", "HEAD:related.txt"]), "related fixed\n");
    assert.match(readFileSync(run.output, "utf8"), /^complete=true$/m);
    assert.equal(
      runGit(run.fixture.repo, ["status", "--porcelain"]),
      "",
      "verified replay must leave a clean checkout",
    );
  } finally {
    rmSync(run.root, { recursive: true, force: true });
  }
});

test("verifier rejects an invented related file before importing scratch bytes", () => {
  const run = runVerifier({ addNewFile: true });
  try {
    assert.notEqual(run.result.status, 0);
    assert.match(
      `${run.result.stdout}\n${run.result.stderr}`,
      /Related scratch edit is not one existing stage-0 file: invented\.txt/,
    );
    assert.equal(runGit(run.fixture.repo, ["rev-parse", "HEAD"]).trim(), run.fixture.head);
    assert.equal(readFileSync(path.join(run.fixture.repo, "related.txt"), "utf8"), "related base\n");
  } finally {
    rmSync(run.root, { recursive: true, force: true });
  }
});

test("verifier preserves an executable text conflict's incoming Git mode", () => {
  const run = runVerifier({ executableConflict: true });
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    assert.equal(
      runGit(run.fixture.repo, ["ls-tree", "HEAD", "conflict.txt"]).split(/\s+/)[0],
      "100755",
    );
    assert.equal(statSync(path.join(run.fixture.repo, "conflict.txt")).mode & 0o777, 0o755);
    assert.match(readFileSync(run.output, "utf8"), /^complete=true$/m);
  } finally {
    rmSync(run.root, { recursive: true, force: true });
  }
});

test("prepare admits executable regular text without exposing executable scratch", () => {
  const run = runPrepareExecutableConflict();
  try {
    assert.equal(run.result.status, 0, run.result.stderr || run.result.stdout);
    assert.equal(statSync(path.join(run.scratch, "conflict.txt")).mode & 0o777, 0o644);
    const output = readFileSync(run.output, "utf8");
    assert.match(output, /^needs_ai=true$/m);
    assert.match(output, /^conflict\.txt$/m);
  } finally {
    rmSync(run.root, { recursive: true, force: true });
  }
});
