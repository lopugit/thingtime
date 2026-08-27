import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

import {
  computeSourceFingerprint,
  finalizeSnapshot,
  listSnapshots,
  selectSnapshot,
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
      "graphify-out/snapshots/** -merge\n",
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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
