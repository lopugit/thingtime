import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

import {
  activateSnapshot,
  computeSourceFingerprint,
  finalizeSnapshot,
  hydrateSemanticCache,
  ingestSemanticCache,
  listSnapshots,
  normalizeGraphifyScopeArgs,
  prepareWorkingOutput,
  pruneSnapshots,
  selectSnapshot,
  snapshotRetentionLimit,
  withHiddenGraphifyPaths,
  withRepositoryLock,
} from "./graphify-cas.mjs"

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim()
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "thingtime-graphify-cas-test-"))
  git(root, ["init", "-q"])
  git(root, ["config", "user.name", "Lopu Test"])
  git(root, ["config", "user.email", "lopu-test@example.invalid"])
  writeFileSync(path.join(root, "source.txt"), "one\n")
  mkdirSync(path.join(root, "graphify-out"), { recursive: true })
  writeFileSync(path.join(root, "graphify-out", "graph.json"), "{}\n")
  git(root, ["add", "."])
  git(root, ["commit", "-qm", "fixture"])
  return root
}

function writeOutput(root, name, nodeCount) {
  const output = path.join(root, "graphify-out", ".work", name)
  mkdirSync(output, { recursive: true })
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
  }))
  writeFileSync(
    path.join(output, "graph.json"),
    `${JSON.stringify({ directed: false, multigraph: false, graph: {}, nodes, links: [] })}\n`,
  )
  writeFileSync(path.join(output, "manifest.json"), "{}\n")
  writeFileSync(path.join(output, "GRAPH_REPORT.md"), `# ${name}\n`)
  return output
}

function writeDetailedOutput(root, name, files) {
  const output = path.join(root, "graphify-out", ".work", name)
  mkdirSync(output, { recursive: true })
  const nodes = []
  const manifest = {}
  for (const [sourceFile, details] of Object.entries(files)) {
    for (let index = 0; index < details.nodes; index += 1) {
      nodes.push({ id: `${sourceFile}-${index}`, source_file: sourceFile })
    }
    manifest[sourceFile] = {
      ast_hash: details.astHash ?? `${sourceFile}-ast`,
      semantic_hash: details.semanticHash ?? `${sourceFile}-semantic`,
    }
  }
  writeFileSync(
    path.join(output, "graph.json"),
    `${JSON.stringify({ directed: false, multigraph: false, graph: {}, nodes, links: [] })}\n`,
  )
  writeFileSync(
    path.join(output, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  )
  writeFileSync(path.join(output, "GRAPH_REPORT.md"), `# ${name}\n`)
  return output
}

test("wrapper-local exclusions never reach Graphify 0.9.4", () => {
  const root = fixture()
  try {
    const scope = normalizeGraphifyScopeArgs(root, [
      "update",
      root,
      "--exclude",
      "trusted/",
      "--exclude=trusted/nested-copy",
      "--exclude=generated-copy",
      "--force",
    ])
    assert.deepEqual(scope.args, ["update", root, "--force"])
    assert.deepEqual(
      scope.exclusions.map(({ relative }) => relative),
      ["trusted", "generated-copy"],
    )
    assert.throws(
      () => normalizeGraphifyScopeArgs(root, ["update", root, "--exclude", "../outside"]),
      /must stay inside the repository/,
    )
    assert.throws(
      () => normalizeGraphifyScopeArgs(root, ["extract", root, "--exclude=graphify-out/cache"]),
      /cannot exclude its own graphify-out state/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("excluded nested checkout is hidden only while Graphify runs", () => {
  const root = fixture()
  const trusted = path.join(root, "trusted")
  mkdirSync(trusted)
  writeFileSync(path.join(trusted, "sentinel"), "preserve me\n")
  try {
    const { exclusions } = normalizeGraphifyScopeArgs(root, [
      "update",
      root,
      "--exclude",
      "trusted/",
    ])
    const value = withHiddenGraphifyPaths(root, exclusions, () => {
      assert.equal(existsSync(trusted), false)
      return "updated"
    })
    assert.equal(value, "updated")
    assert.equal(readFileSync(path.join(trusted, "sentinel"), "utf8"), "preserve me\n")

    assert.throws(
      () =>
        withHiddenGraphifyPaths(root, exclusions, () => {
          assert.equal(existsSync(trusted), false)
          throw new Error("child failed")
        }),
      /child failed/,
    )
    assert.equal(readFileSync(path.join(trusted, "sentinel"), "utf8"), "preserve me\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("source fingerprint excludes every graphify-out change", () => {
  const root = fixture()
  try {
    const first = computeSourceFingerprint(root)
    writeFileSync(path.join(root, "graphify-out", "graph.json"), '{"changed":true}\n')
    const graphOnly = computeSourceFingerprint(root)
    assert.deepEqual(graphOnly, first)

    writeFileSync(path.join(root, "source.txt"), "two\n")
    const sourceChanged = computeSourceFingerprint(root)
    assert.notEqual(sourceChanged.sourceFingerprint, first.sourceFingerprint)
    assert.notEqual(sourceChanged.sourceTree, first.sourceTree)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("source fingerprint never changes the caller's staged index", () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, "source.txt"), "staged\n")
    git(root, ["add", "source.txt"])
    const treeBefore = git(root, ["write-tree"])
    const patchBefore = git(root, ["diff", "--cached", "--binary"])

    computeSourceFingerprint(root)

    assert.equal(git(root, ["write-tree"]), treeBefore)
    assert.equal(git(root, ["diff", "--cached", "--binary"]), patchBefore)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("source fingerprint ignores a co-located controller checkout", () => {
  const root = fixture()
  try {
    const clean = computeSourceFingerprint(root)

    // Controller jobs check this repository out a second time at ./trusted,
    // inside the product worktree and covered by no ignore rule. Its HEAD must
    // not key the product's snapshots, or no ordinary checkout could ever
    // match the committed snapshot and every run would rebuild from scratch.
    const nested = path.join(root, "trusted")
    mkdirSync(nested, { recursive: true })
    git(nested, ["init", "-q"])
    git(nested, ["config", "user.name", "Lopu Test"])
    git(nested, ["config", "user.email", "lopu-test@example.invalid"])
    writeFileSync(path.join(nested, "controller.txt"), "one\n")
    git(nested, ["add", "."])
    git(nested, ["commit", "-qm", "controller"])
    assert.deepEqual(computeSourceFingerprint(root), clean)

    // A later, unrelated control-plane commit must not move the key either.
    writeFileSync(path.join(nested, "controller.txt"), "two\n")
    git(nested, ["add", "."])
    git(nested, ["commit", "-qm", "controller update"])
    assert.deepEqual(computeSourceFingerprint(root), clean)

    // Real source still keys the snapshot.
    writeFileSync(path.join(root, "source.txt"), "two\n")
    assert.notEqual(
      computeSourceFingerprint(root).sourceFingerprint,
      clean.sourceFingerprint,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("immutable output variants coexist and richer valid output wins", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    const first = finalizeSnapshot(root, writeOutput(root, "first", 1), {
      ...fingerprint,
      version: "graphify test",
    })
    const second = finalizeSnapshot(root, writeOutput(root, "second", 2), {
      ...fingerprint,
      version: "graphify test",
    })

    assert.notEqual(first.path, second.path)
    assert.equal(listSnapshots(root, fingerprint.sourceFingerprint).length, 2)
    assert.equal(selectSnapshot(root, fingerprint.sourceFingerprint).path, second.path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("bounded retention keeps the active snapshot and prunes superseded trees", () => {
  const root = fixture()
  try {
    const firstFingerprint = computeSourceFingerprint(root)
    const first = finalizeSnapshot(root, writeOutput(root, "first", 1), {
      ...firstFingerprint,
      version: "graphify test",
    })

    writeFileSync(path.join(root, "source.txt"), "two\n")
    const secondFingerprint = computeSourceFingerprint(root)
    const second = finalizeSnapshot(root, writeOutput(root, "second", 2), {
      ...secondFingerprint,
      version: "graphify test",
    })

    writeFileSync(path.join(root, "source.txt"), "three\n")
    const thirdFingerprint = computeSourceFingerprint(root)
    const third = finalizeSnapshot(root, writeOutput(root, "third", 3), {
      ...thirdFingerprint,
      version: "graphify test",
    })

    const result = pruneSnapshots(root, second, 2)
    assert.equal(result.retention, 2)
    assert.equal(result.retained.length, 2)
    assert.equal(result.removed.length, 1)
    assert.equal(existsSync(second.path), true)
    assert.equal(existsSync(third.path), true)
    assert.equal(existsSync(first.path), false)
    assert.equal(listSnapshots(root).length, 2)
    assert.equal(
      existsSync(path.dirname(first.path)),
      false,
      "empty source-fingerprint directories are removed",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("snapshot retention defaults to one and rejects unsafe values", () => {
  assert.equal(snapshotRetentionLimit(undefined), 1)
  assert.equal(snapshotRetentionLimit("3"), 3)
  assert.throws(() => snapshotRetentionLimit("0"), /positive integer/)
  assert.throws(() => snapshotRetentionLimit("1.5"), /positive integer/)
  assert.throws(() => snapshotRetentionLimit("all"), /positive integer/)
})

test("a large graph collapse requires an explicit force decision", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    finalizeSnapshot(root, writeOutput(root, "baseline", 4), {
      ...fingerprint,
      version: "graphify test",
    })
    assert.throws(
      () =>
        finalizeSnapshot(root, writeOutput(root, "collapsed", 1), {
          ...fingerprint,
          version: "graphify test",
          minimumNodeCount: 4,
        }),
      /Graphify output collapsed from 4 to 1 nodes/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("an unchanged file cannot silently lose multiple symbols", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    finalizeSnapshot(
      root,
      writeDetailedOutput(root, "per-file-baseline", {
        "unchanged.ts": { nodes: 4 },
        "other.ts": { nodes: 1 },
      }),
      { ...fingerprint, version: "graphify test" },
    )

    assert.throws(
      () =>
        finalizeSnapshot(
          root,
          writeDetailedOutput(root, "per-file-poisoned", {
            "unchanged.ts": { nodes: 1 },
            "other.ts": { nodes: 6 },
          }),
          { ...fingerprint, version: "graphify test" },
        ),
      /Graphify output dropped symbols for unchanged files: unchanged\.ts \(4 -> 1 nodes\)/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("one-node extractor jitter remains publishable", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    finalizeSnapshot(
      root,
      writeDetailedOutput(root, "jitter-baseline", {
        "unchanged.ts": { nodes: 4 },
        "other.ts": { nodes: 1 },
      }),
      { ...fingerprint, version: "graphify test" },
    )
    const candidate = finalizeSnapshot(
      root,
      writeDetailedOutput(root, "jitter-candidate", {
        "unchanged.ts": { nodes: 3 },
        "other.ts": { nodes: 2 },
      }),
      { ...fingerprint, version: "graphify test" },
    )

    assert.ok(candidate)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a changed manifest hash permits a legitimate per-file reduction", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    finalizeSnapshot(
      root,
      writeDetailedOutput(root, "changed-baseline", {
        "changed.ts": { nodes: 4, astHash: "before" },
        "other.ts": { nodes: 1 },
      }),
      { ...fingerprint, version: "graphify test" },
    )
    const candidate = finalizeSnapshot(
      root,
      writeDetailedOutput(root, "changed-candidate", {
        "changed.ts": { nodes: 1, astHash: "after" },
        "other.ts": { nodes: 4 },
      }),
      { ...fingerprint, version: "graphify test" },
    )

    assert.ok(candidate)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("byte-identical output deduplicates to one snapshot", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    const firstOutput = writeOutput(root, "same-a", 2)
    const firstReport = readFileSync(
      path.join(firstOutput, "GRAPH_REPORT.md"),
      "utf8",
    )
    const first = finalizeSnapshot(root, firstOutput, {
      ...fingerprint,
      version: "graphify test",
    })
    const secondOutput = writeOutput(root, "same-b", 2)
    writeFileSync(
      path.join(secondOutput, "GRAPH_REPORT.md"),
      firstReport,
    )
    const second = finalizeSnapshot(root, secondOutput, {
      ...fingerprint,
      version: "graphify test",
    })

    assert.equal(second.path, first.path)
    assert.equal(listSnapshots(root, fingerprint.sourceFingerprint).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("working output makes immutable snapshot files writable", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    const snapshot = finalizeSnapshot(root, writeOutput(root, "immutable", 2), {
      ...fingerprint,
      version: "graphify test",
    })
    assert.equal(statSync(path.join(snapshot.path, "graph.json")).mode & 0o222, 0)

    const working = prepareWorkingOutput(root, "b".repeat(64))
    for (const name of ["graph.json", "manifest.json", "GRAPH_REPORT.md"]) {
      assert.notEqual(
        statSync(path.join(working, name)).mode & 0o200,
        0,
        `${name} is owner-writable in the private workspace`,
      )
    }
    writeFileSync(path.join(working, "GRAPH_REPORT.md"), "# refreshed\n")
    assert.equal(
      readFileSync(path.join(working, "GRAPH_REPORT.md"), "utf8"),
      "# refreshed\n",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("an existing artifact path rejects changed portable bytes", () => {
  const root = fixture()
  try {
    const fingerprint = computeSourceFingerprint(root)
    const firstOutput = writeOutput(root, "original", 2)
    const originalReport = readFileSync(
      path.join(firstOutput, "GRAPH_REPORT.md"),
      "utf8",
    )
    const snapshot = finalizeSnapshot(root, firstOutput, {
      ...fingerprint,
      version: "graphify test",
    })
    chmodSync(path.join(snapshot.path, "graph.json"), 0o644)
    writeFileSync(
      path.join(snapshot.path, "graph.json"),
      '{"directed":false,"multigraph":false,"graph":{},"nodes":[],"links":[]}\n',
    )
    const retryOutput = writeOutput(root, "retry", 2)
    writeFileSync(
      path.join(retryOutput, "GRAPH_REPORT.md"),
      originalReport,
    )

    assert.throws(
      () =>
        finalizeSnapshot(root, retryOutput, {
          ...fingerprint,
          version: "graphify test",
        }),
      /Content-addressed snapshot invariant failed/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("mutable semantic cache revisions become immutable coexisting variants", () => {
  const root = fixture()
  try {
    const inputKey = "a".repeat(64)
    const mutable = path.join(root, "graphify-out/cache/semantic")
    const mutableEntry = path.join(mutable, `${inputKey}.json`)
    mkdirSync(mutable, { recursive: true })
    writeFileSync(
      mutableEntry,
      `${JSON.stringify({ nodes: [{ id: "one" }], edges: [], hyperedges: [] })}\n`,
    )
    ingestSemanticCache(root)

    writeFileSync(
      mutableEntry,
      `${JSON.stringify({ nodes: [{ id: "one" }, { id: "two" }], edges: [{ source: "one", target: "two" }], hyperedges: [] })}\n`,
    )
    ingestSemanticCache(root)
    rmSync(mutable, { recursive: true, force: true })
    hydrateSemanticCache(root)

    const variants = path.join(
      root,
      "graphify-out/cache/semantic-cas/v1",
      inputKey,
    )
    assert.equal(
      readdirSync(variants).filter((name) => name.endsWith(".json")).length,
      2,
    )
    const hydrated = JSON.parse(readFileSync(mutableEntry, "utf8"))
    assert.equal(hydrated.nodes.length, 2)
    assert.equal(hydrated.edges.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("activation replaces a dangling compatibility alias", () => {
  const root = fixture()
  try {
    git(root, ["rm", "-q", "graphify-out/graph.json"])
    git(root, ["commit", "-qm", "remove legacy graph"])
    const fingerprint = computeSourceFingerprint(root)
    const first = finalizeSnapshot(root, writeOutput(root, "first-alias", 1), {
      ...fingerprint,
      version: "graphify test",
    })
    activateSnapshot(root, first)
    assert.equal(statSync(path.join(first.path, "graph.json")).mode & 0o222, 0)
    const alias = path.join(root, "graphify-out/graph.json")
    rmSync(first.path, { recursive: true, force: true })
    assert.equal(existsSync(alias), false)

    const second = finalizeSnapshot(root, writeOutput(root, "second-alias", 2), {
      ...fingerprint,
      version: "graphify test",
    })
    activateSnapshot(root, second)
    assert.equal(
      path.resolve(path.dirname(alias), readlinkSync(alias)),
      path.join(second.path, "graph.json"),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("activation reclaims an untracked regular compatibility alias", () => {
  const root = fixture()
  try {
    git(root, ["rm", "-q", "graphify-out/graph.json"])
    git(root, ["commit", "-qm", "remove legacy graph"])
    const fingerprint = computeSourceFingerprint(root)
    const snapshot = finalizeSnapshot(
      root,
      writeOutput(root, "regular-alias", 2),
      { ...fingerprint, version: "graphify test" },
    )
    const alias = path.join(root, "graphify-out", "graph.json")
    writeFileSync(alias, "legacy generated output\n")

    activateSnapshot(root, snapshot)

    assert.equal(lstatSync(alias).isSymbolicLink(), true)
    assert.equal(
      path.resolve(path.dirname(alias), readlinkSync(alias)),
      path.join(snapshot.path, "graph.json"),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("activation replaces an ignored regular compatibility output", () => {
  const root = fixture()
  try {
    git(root, ["rm", "-q", "graphify-out/graph.json"])
    writeFileSync(path.join(root, ".gitignore"), "graphify-out/graph.json\n")
    git(root, ["add", ".gitignore"])
    git(root, ["commit", "-qm", "ignore generated graph alias"])
    mkdirSync(path.join(root, "graphify-out"), { recursive: true })
    writeFileSync(
      path.join(root, "graphify-out/graph.json"),
      '{"stale":true}\n',
    )

    const fingerprint = computeSourceFingerprint(root)
    const snapshot = finalizeSnapshot(
      root,
      writeOutput(root, "ignored-regular-alias", 2),
      { ...fingerprint, version: "graphify test" },
    )
    activateSnapshot(root, snapshot)

    const alias = path.join(root, "graphify-out/graph.json")
    assert.equal(
      path.resolve(path.dirname(alias), readlinkSync(alias)),
      path.join(snapshot.path, "graph.json"),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a live repository writer serializes the next writer", async () => {
  const root = fixture()
  const moduleUrl = pathToFileURL(
    path.join(import.meta.dirname, "graphify-cas.mjs"),
  ).href
  const childCode = `
    import { withRepositoryLock } from ${JSON.stringify(moduleUrl)};
    const signal = new Int32Array(new SharedArrayBuffer(4));
    withRepositoryLock(${JSON.stringify(root)}, () => {
      process.stdout.write("locked\\n");
      Atomics.wait(signal, 0, 0, 500);
    });
  `
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", childCode],
    { stdio: ["ignore", "pipe", "inherit"] },
  )
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve)
      child.once("error", reject)
      child.once("exit", (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`lock child exited ${code}`))
        }
      })
    })
    assert.equal(
      existsSync(path.join(root, "graphify-out", ".locks", "writer")),
      true,
    )
    const started = Date.now()
    withRepositoryLock(root, () => {})
    assert.ok(Date.now() - started >= 250)
  } finally {
    if (child.exitCode === null) child.kill()
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once("exit", resolve))
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test("independent branch snapshots merge without generated-file conflicts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "thingtime-graphify-merge-test-"))
  try {
    git(root, ["init", "-q", "-b", "main"])
    git(root, ["config", "user.name", "Lopu Test"])
    git(root, ["config", "user.email", "lopu-test@example.invalid"])
    writeFileSync(
      path.join(root, ".gitattributes"),
      "graphify-out/snapshots/** -merge\ngraphify-out/cache/semantic-cas/** -merge\n",
    )
    writeFileSync(path.join(root, "source.txt"), "base\n")
    git(root, ["add", "."])
    git(root, ["commit", "-qm", "base"])

    git(root, ["checkout", "-qb", "branch-a"])
    const branchA = path.join(
      root,
      "graphify-out/snapshots/v1/source-a/artifact-a",
    )
    mkdirSync(branchA, { recursive: true })
    writeFileSync(path.join(branchA, "graph.json"), '{"nodes":[],"links":[]}\n')
    const cacheA = path.join(
      root,
      "graphify-out/cache/semantic-cas/v1/input-key/content-a.json",
    )
    mkdirSync(path.dirname(cacheA), { recursive: true })
    writeFileSync(cacheA, '{"nodes":[{"id":"a"}],"edges":[],"hyperedges":[]}\n')
    git(root, ["add", "."])
    git(root, ["commit", "-qm", "snapshot a"])

    git(root, ["checkout", "-q", "main"])
    git(root, ["checkout", "-qb", "branch-b"])
    const branchB = path.join(
      root,
      "graphify-out/snapshots/v1/source-b/artifact-b",
    )
    mkdirSync(branchB, { recursive: true })
    writeFileSync(path.join(branchB, "graph.json"), '{"nodes":[],"links":[]}\n')
    const cacheB = path.join(
      root,
      "graphify-out/cache/semantic-cas/v1/input-key/content-b.json",
    )
    mkdirSync(path.dirname(cacheB), { recursive: true })
    writeFileSync(cacheB, '{"nodes":[{"id":"b"}],"edges":[],"hyperedges":[]}\n')
    git(root, ["add", "."])
    git(root, ["commit", "-qm", "snapshot b"])

    git(root, ["merge", "--no-edit", "branch-a"])
    assert.equal(
      readFileSync(path.join(branchA, "graph.json"), "utf8"),
      '{"nodes":[],"links":[]}\n',
    )
    assert.equal(
      readFileSync(path.join(branchB, "graph.json"), "utf8"),
      '{"nodes":[],"links":[]}\n',
    )
    assert.equal(existsSync(cacheA), true)
    assert.equal(existsSync(cacheB), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
