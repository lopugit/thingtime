import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./resolve-canonical-instruction-type-conflicts.sh", import.meta.url),
);

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function write(cwd, name, value) {
  fs.writeFileSync(path.join(cwd, name), value, "utf8");
}

test("normalizes only the proven root instruction symlink migration", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "lopu-type-conflict-"));
  try {
    git(fixture, ["init", "-q"]);
    git(fixture, ["config", "user.name", "Lopu test"]);
    git(fixture, ["config", "user.email", "lopu-test@example.invalid"]);

    write(fixture, "AI_ALL.md", "canonical v1\n");
    write(fixture, "AGENTS.md", "old agents instructions\n");
    write(fixture, "CLAUDE.md", "old claude instructions\n");
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "-qm", "ancestor"]);
    const ancestor = git(fixture, ["rev-parse", "HEAD"]);

    git(fixture, ["switch", "-qc", "target"]);
    fs.rmSync(path.join(fixture, "AGENTS.md"));
    fs.rmSync(path.join(fixture, "CLAUDE.md"));
    fs.symlinkSync("AI_ALL.md", path.join(fixture, "AGENTS.md"));
    fs.symlinkSync("AI_ALL.md", path.join(fixture, "CLAUDE.md"));
    write(fixture, "AI_ALL.md", "canonical v2\n");
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "-qm", "canonical aliases"]);
    const target = git(fixture, ["rev-parse", "HEAD"]);

    git(fixture, ["switch", "-qC", "head", ancestor]);
    write(fixture, "AGENTS.md", "historical head agents instructions\n");
    write(fixture, "CLAUDE.md", "historical head claude instructions\n");
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "-qm", "historical regular instructions"]);

    const merge = spawnSync(
      "git",
      ["merge", "--no-commit", "--no-ff", target],
      { cwd: fixture, encoding: "utf8" },
    );
    assert.notEqual(merge.status, 0, "fixture must stop on distinct-type conflicts");
    assert.match(git(fixture, ["ls-files", "-u"]), /AGENTS\.md~HEAD/);
    assert.match(git(fixture, ["ls-files", "-u"]), /CLAUDE\.md~HEAD/);

    execFileSync("bash", [script, target], {
      cwd: fixture,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(git(fixture, ["ls-files", "-u"]), "");
    assert.equal(fs.readlinkSync(path.join(fixture, "AGENTS.md")), "AI_ALL.md");
    assert.equal(fs.readlinkSync(path.join(fixture, "CLAUDE.md")), "AI_ALL.md");
    assert.equal(fs.existsSync(path.join(fixture, "AGENTS.md~HEAD")), false);
    assert.equal(fs.existsSync(path.join(fixture, "CLAUDE.md~HEAD")), false);
    assert.equal(fs.readFileSync(path.join(fixture, "AI_ALL.md"), "utf8"), "canonical v2\n");

    git(fixture, ["commit", "--no-edit"]);
    assert.equal(
      git(fixture, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ").length,
      3,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
