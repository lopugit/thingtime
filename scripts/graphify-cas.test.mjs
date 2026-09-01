import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
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
  pruneSnapshots,
  selectSnapshot,
  snapshotRetentionLimit,
  withRepositoryLock,
} from "./graphify-cas.mjs"

// GRAPHIFY_SNAPSHOT_RETENTION is a documented operator override, so an ambient
// value would silently redefine what the retention assertions below mean. The
// suite pins the unset default once, for this process and every child it
// spawns, instead of asserting against whichever policy the caller exported.
delete process.env.GRAPHIFY_SNAPSHOT_RETENTION

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

test("repository ignore policy publishes semantic CAS but not mutable cache", () => {
  const root = path.resolve(import.meta.dirname, "..")
  const inputKey = "a".repeat(64)
  const contentHash = "b".repeat(64)
  const semanticCas = `graphify-out/cache/semantic-cas/v1/${inputKey}/${contentHash}.json`
  const mutableSemantic = `graphify-out/cache/semantic/${inputKey}.json`
  const checkIgnore = (candidate) =>
    spawnSync(
      "git",
      ["-C", root, "check-ignore", "-q", "--no-index", "--", candidate],
      { encoding: "utf8" },
    ).status

  assert.equal(checkIgnore(semanticCas), 1)
  assert.equal(checkIgnore(mutableSemantic), 0)
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

test("a merge unions branch snapshots and pruning restores the retention bound", () => {
  const root = fixture()
  try {
    const base = git(root, ["rev-parse", "HEAD"])
    git(root, ["checkout", "-qb", "branch-a"])
    // Each branch edits its own source file so the two histories merge cleanly
    // while still producing distinct source fingerprints.
    writeFileSync(path.join(root, "a.txt"), "branch-a\n")
    const fingerprintA = computeSourceFingerprint(root)
    const snapshotA = finalizeSnapshot(root, writeOutput(root, "branch-a", 1), {
      ...fingerprintA,
      version: "graphify test",
    })
    git(root, ["add", "-A"])
    git(root, ["commit", "-qm", "snapshot a"])

    git(root, ["checkout", "-q", base])
    git(root, ["checkout", "-qb", "branch-b"])
    writeFileSync(path.join(root, "b.txt"), "branch-b\n")
    const fingerprintB = computeSourceFingerprint(root)
    const snapshotB = finalizeSnapshot(root, writeOutput(root, "branch-b", 2), {
      ...fingerprintB,
      version: "graphify test",
    })
    git(root, ["add", "-A"])
    git(root, ["commit", "-qm", "snapshot b"])

    // Each branch pruned to its own single snapshot while it built, but the
    // snapshots are content-addressed to different source fingerprints, so the
    // merge unions two distinct paths instead of conflicting. Nothing in the
    // merge itself re-applies the bound, which is how a promotion branch grows
    // past retention one snapshot per merged branch.
    git(root, ["merge", "--no-edit", "-m", "merge branch-a", "branch-a"])
    assert.equal(existsSync(snapshotA.path), true)
    assert.equal(existsSync(snapshotB.path), true)
    assert.equal(
      listSnapshots(root).length,
      2,
      "a merge unions both branch snapshots into one tree",
    )
    assert.ok(
      listSnapshots(root).length > snapshotRetentionLimit(),
      "the merged tree exceeds the retention bound until it is pruned again",
    )

    const active = selectSnapshot(root)
    assert.equal(
      active.path,
      snapshotB.path,
      "the richer branch snapshot stays active across the merge",
    )

    const result = pruneSnapshots(root, active)
    assert.equal(result.retention, snapshotRetentionLimit())
    assert.equal(result.removed.length, 1)
    assert.equal(existsSync(snapshotB.path), true)
    assert.equal(existsSync(snapshotA.path), false)
    assert.equal(
      listSnapshots(root).length,
      snapshotRetentionLimit(),
      "pruning after a merge restores the bounded snapshot tree",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
