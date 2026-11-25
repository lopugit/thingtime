// End-to-end check of the all-branch fleet split: the deterministic build job
// rebuilds and checks the union in one blobless clone, hands a failing union
// to the doctor job, and the doctor job restores the exact tree in a second
// blobless clone, admits or stands down against live tips, and pushes with a
// lease. `gh` and `corepack` are fakes; every git operation is real.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./build-all-branch.mjs", import.meta.url));

const isolatedGit = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Lopu test",
  GIT_AUTHOR_EMAIL: "lopu@example.invalid",
  GIT_COMMITTER_NAME: "Lopu test",
  GIT_COMMITTER_EMAIL: "lopu@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

function sh(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, ...isolatedGit } });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}
const git = (cwd, ...args) => sh(cwd, "git", args);

function commitFiles(cwd, files, message) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "all-branch-handoff-"));
  const origin = join(root, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "develop");
  git(origin, "config", "uploadpack.allowFilter", "true");
  git(origin, "config", "uploadpack.allowAnySHA1InWant", "true");
  commitFiles(
    origin,
    {
      ".github/workflows/ci.yml": "name: ci\n",
      "app.txt": "one\ntwo\nthree\n",
      "remix/package.json": '{"name":"fixture"}\n',
      "remix/pnpm-lock.yaml": "lockfileVersion: 9\n",
    },
    "base"
  );
  git(origin, "branch", "main");
  git(origin, "checkout", "-q", "-b", "feature/one");
  const one = commitFiles(origin, { "app.txt": "one (PR 1)\ntwo\nthree\n" }, "PR 1");
  git(origin, "checkout", "-q", "develop");
  git(origin, "checkout", "-q", "-b", "feature/two");
  const two = commitFiles(origin, { "app.txt": "one\ntwo\nthree (PR 2)\n", "two.txt": "new file\n" }, "PR 2");
  git(origin, "checkout", "-q", "develop");
  git(origin, "update-ref", "refs/pull/1/head", one);
  git(origin, "update-ref", "refs/pull/2/head", two);
  // A previously pushed union, so the doctor must lease against a real tip.
  git(origin, "checkout", "-q", "-b", "all");
  const previousAll = commitFiles(origin, { "ALL_BRANCH.md": "# old union\n" }, "all: manifest (0 PRs merged, 0 skipped)");
  git(origin, "checkout", "-q", "develop");

  const bin = join(root, "bin");
  mkdirSync(bin);
  const pulls = [
    { number: 1, title: "PR one", baseRefName: "develop", headRefName: "feature/one", headRefOid: one, isCrossRepository: false, labels: [] },
    { number: 2, title: "PR two", baseRefName: "develop", headRefName: "feature/two", headRefOid: two, isCrossRepository: false, labels: [] },
  ];
  writeFileSync(join(root, "pulls.json"), JSON.stringify(pulls));
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncat "${join(root, "pulls.json")}"\n`);
  // Install re-resolves the lockfile (a dirty tracked file the doctor must
  // inherit); the build then fails the way a semantic union collision does.
  writeFileSync(
    join(bin, "corepack"),
    [
      "#!/bin/sh",
      'case "$*" in',
      '  *" install "*|*" install") printf "re-resolved: true\\n" >> remix/pnpm-lock.yaml; echo installed ;;',
      '  *"run build"*) echo "app.txt(1,1): error TS2300: Duplicate identifier" >&2; exit 1 ;;',
      "esac",
      "",
    ].join("\n")
  );
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "corepack"), 0o755);
  return { root, origin, bin, one, two, previousAll };
}

function clone(fx, name) {
  const dir = join(fx.root, name);
  sh(fx.root, "git", ["clone", "-q", "--filter=blob:none", "--no-local", `file://${fx.origin}`, dir]);
  return dir;
}

// Run one builder mode the way a workflow step does; returns step outputs.
function step(fx, cwd, ...args) {
  const outputs = join(fx.root, `out-${Math.random().toString(16).slice(2)}`);
  const summary = `${outputs}.md`;
  writeFileSync(outputs, "");
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...isolatedGit,
      PATH: `${fx.bin}:${process.env.PATH}`,
      ALL_BRANCH_FORCE: "1",
      GITHUB_ACTIONS: "",
      GH_TOKEN: "",
      GITHUB_REPOSITORY: "example/project",
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  const values = Object.fromEntries(
    readFileSync(outputs, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/=(.*)/s).slice(0, 2))
  );
  return {
    status: result.status,
    log: `${result.stdout}${result.stderr}`,
    outputs: values,
    summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
  };
}
const ok = (run) => {
  assert.equal(run.status, 0, run.log);
  return run;
};
const readState = (dir) => JSON.parse(readFileSync(join(dir, ".all-doctor/state.json"), "utf8"));

test("a failing union crosses from the build job to a fleet-only doctor job intact", () => {
  const fx = fixture();
  try {
    // ---- build job (never in the agent fleet) ----
    const build = clone(fx, "build");
    assert.equal(ok(step(fx, build, "build")).outputs.proceed, "true");
    const check = ok(step(fx, build, "check"));
    assert.equal(check.outputs.build_ok, "false");
    assert.equal(check.outputs.ai_eligible, "true");
    assert.match(readFileSync(join(build, "remix/pnpm-lock.yaml"), "utf8"), /re-resolved/);
    const handoffDir = join(fx.root, "artifact");
    const handoff = ok(step(fx, build, "handoff", "--out", handoffDir));
    assert.equal(handoff.outputs.handoff, "true");
    assert.match(handoff.summary, /did not hold the fleet and did not push/);
    const manifest = JSON.parse(readFileSync(join(handoffDir, "handoff.json"), "utf8"));
    assert.equal(manifest.tip, git(build, "rev-parse", "HEAD"));
    assert.equal(manifest.remoteTip, fx.previousAll);
    assert.deepEqual(manifest.pulls, [
      { number: 1, sha: fx.one },
      { number: 2, sha: fx.two },
    ]);
    assert.notEqual(manifest.worktree, manifest.tree, "the re-resolved lockfile is part of the handed-off tree");
    assert.equal(git(fx.origin, "rev-parse", "refs/heads/all"), fx.previousAll, "the build job did not push");

    // The pack carries only what the build job created, never origin's blobs.
    const probe = join(fx.root, "probe.pack");
    cpSync(join(handoffDir, "union.pack"), probe);
    git(fx.root, "index-pack", probe);
    const packed = sh(fx.root, "sh", ["-c", `git show-index < "${probe.replace(/\.pack$/, ".idx")}"`]);
    const originBlob = git(fx.origin, "rev-parse", "develop:remix/package.json");
    const mergedBlob = git(build, "rev-parse", "HEAD:app.txt");
    assert.doesNotMatch(packed, new RegExp(originBlob), "promisor objects stay on origin");
    assert.match(packed, new RegExp(mergedBlob), "the merged blob the build job created is handed over");

    // ---- two doctor jobs admitted against the same live tips ----
    const doctorA = clone(fx, "doctor-a");
    const doctorB = clone(fx, "doctor-b");
    for (const doctor of [doctorA, doctorB]) {
      assert.equal(ok(step(fx, doctor, "doctor-admit", "--from", handoffDir)).outputs.proceed, "true");
      assert.equal(git(doctor, "branch", "--show-current"), "all");
      assert.equal(git(doctor, "rev-parse", "HEAD"), manifest.tip);
      assert.equal(readFileSync(join(doctor, "app.txt"), "utf8"), "one (PR 1)\ntwo\nthree (PR 2)\n");
      assert.equal(
        readFileSync(join(doctor, "remix/pnpm-lock.yaml"), "utf8"),
        readFileSync(join(build, "remix/pnpm-lock.yaml"), "utf8"),
        "the doctor inherits the exact dirty working tree"
      );
      assert.match(readFileSync(join(doctor, ".all-doctor/build.log"), "utf8"), /Duplicate identifier/);
      assert.equal(readState(doctor).lease, fx.previousAll);
    }

    // Doctor A: dependencies for round 1 (the build log survives), a model
    // edit, the guarded commit, the record and a leased push.
    const install = ok(step(fx, doctorA, "doctor-install"));
    assert.match(install.log, /installed/);
    assert.match(readFileSync(join(doctorA, ".all-doctor/build.log"), "utf8"), /Duplicate identifier/);
    writeFileSync(join(doctorA, "app.txt"), "one (PR 1)\ntwo\nthree (PR 2, deduplicated)\n");
    const commit = ok(step(fx, doctorA, "doctor-commit", "--round", "1"));
    assert.equal(commit.outputs.committed, "true");
    assert.equal(git(doctorA, "show", "--name-only", "--format=", "HEAD"), "app.txt", "the lockfile stays out of doctor commits");
    ok(step(fx, doctorA, "doctor-record"));
    const pushedA = ok(step(fx, doctorA, "push"));
    assert.match(pushedA.summary, /Force-pushed origin\/all/);
    const tipA = git(doctorA, "rev-parse", "HEAD");
    assert.equal(git(fx.origin, "rev-parse", "refs/heads/all"), tipA);

    // Doctor B was admitted before A pushed; its lease now refuses quietly.
    const pushedB = ok(step(fx, doctorB, "push"));
    assert.match(pushedB.summary, /Superseded — origin\/all moved while the doctor was repairing/);
    assert.equal(git(fx.origin, "rev-parse", "refs/heads/all"), tipA, "an older doctor never overwrites a newer union");

    // A doctor that reaches the fleet after the union moved stands down.
    const doctorC = clone(fx, "doctor-c");
    const late = ok(step(fx, doctorC, "doctor-admit", "--from", handoffDir));
    assert.equal(late.outputs.proceed, "false");
    assert.match(late.summary, /stood down without running a model or pushing: .*origin\/all moved/);
    assert.equal(git(doctorC, "branch", "--show-current"), "develop", "a stale doctor restores nothing");

    // So does one whose PR input moved while it waited.
    const movedDir = join(fx.root, "artifact-moved");
    cpSync(handoffDir, movedDir, { recursive: true });
    writeFileSync(join(movedDir, "handoff.json"), JSON.stringify({ ...manifest, remoteTip: tipA }));
    git(fx.origin, "checkout", "-q", "feature/two");
    git(fx.origin, "update-ref", "refs/pull/2/head", commitFiles(fx.origin, { "two.txt": "newer\n" }, "PR 2 again"));
    git(fx.origin, "checkout", "-q", "develop");
    const doctorD = clone(fx, "doctor-d");
    const movedInput = ok(step(fx, doctorD, "doctor-admit", "--from", movedDir));
    assert.equal(movedInput.outputs.proceed, "false");
    assert.match(movedInput.summary, /PR #2 moved from/);

    // A tampered handoff is refused before any git argument is built from it.
    const tamperedDir = join(fx.root, "artifact-tampered");
    cpSync(handoffDir, tamperedDir, { recursive: true });
    writeFileSync(join(tamperedDir, "handoff.json"), JSON.stringify({ ...manifest, tip: "--upload-pack=touch pwned" }));
    const tampered = step(fx, clone(fx, "doctor-e"), "doctor-admit", "--from", tamperedDir);
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.log, /handoff tip must be a full object id/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
