#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const runGit = (cwd, args, options = {}) =>
  execFileSync("git", args, { cwd, encoding: options.encoding ?? "utf8" });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const rawIndexHash = (root) => {
  const indexPath = runGit(root, ["rev-parse", "--git-path", "index"]).trim();
  return sha256(readFileSync(path.resolve(root, indexPath)));
};

const semanticIndexHash = (root) =>
  sha256(runGit(root, ["ls-files", "--stage", "-z"], { encoding: "buffer" }));

test("semantic index fingerprint ignores encoding-only rewrites but detects staged changes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "thingtime-rebase-index-"));
  try {
    runGit(root, ["init", "-q"]);
    runGit(root, ["config", "user.name", "Lopu fixture"]);
    runGit(root, ["config", "user.email", "lopu-fixture@example.invalid"]);
    writeFileSync(path.join(root, "alpha.txt"), "alpha\n");
    runGit(root, ["add", "alpha.txt"]);

    const semanticBefore = semanticIndexHash(root);
    const rawBefore = rawIndexHash(root);

    // Index v4 changes only the binary path encoding. Modes, object ids,
    // stages, and paths remain identical, exactly the state the verifier cares
    // about while the model is isolated from the real repository.
    runGit(root, ["update-index", "--index-version", "4"]);

    assert.notEqual(rawIndexHash(root), rawBefore, "fixture must rewrite raw index bytes");
    assert.equal(
      semanticIndexHash(root),
      semanticBefore,
      "encoding-only rewrites must not trip the isolation verifier",
    );

    writeFileSync(path.join(root, "alpha.txt"), "changed\n");
    runGit(root, ["add", "alpha.txt"]);
    assert.notEqual(
      semanticIndexHash(root),
      semanticBefore,
      "a staged blob change must still trip the isolation verifier",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
