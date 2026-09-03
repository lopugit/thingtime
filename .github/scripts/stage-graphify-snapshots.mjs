#!/usr/bin/env node

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const PORTABLE = new Set([
  "graph.json",
  "manifest.json",
  "GRAPH_REPORT.md",
  "cost.json",
  "snapshot.json",
])
const LEGACY_ROOT = [...PORTABLE].filter((name) => name !== "snapshot.json")
// The only namespace the router prunes. The semantic CAS is append-only and
// must never have deletions staged for it.
const SNAPSHOT_NAMESPACE = "graphify-out/snapshots/v1"

function git(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim()
}

function filesUnder(directory) {
  if (!directory) return []
  const result = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile()) result.push(target)
    }
  }
  try {
    visit(directory)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  return result
}

function addExisting(root, paths, { force = false } = {}) {
  const relative = paths.map((file) => path.relative(root, file))
  for (let index = 0; index < relative.length; index += 100) {
    git(root, [
      "add",
      ...(force ? ["--force"] : []),
      "--",
      ...relative.slice(index, index + 100),
    ])
  }
}

function trackedUnder(root, relativePath) {
  const output = git(root, ["ls-files", "-z", "--", relativePath])
  return output.split("\0").filter(Boolean)
}

function missingFromWorktree(root, relativePaths) {
  return relativePaths.filter((relative) => {
    try {
      lstatSync(path.join(root, relative))
      return false
    } catch (error) {
      if (error.code === "ENOENT") return true
      throw error
    }
  })
}

// Plumbing, deliberately: `git rm` applies worktree safety heuristics and both
// porcelain forms have to negotiate the broad graphify-out ignore rules legacy
// product branches still carry. `update-index --force-remove` records exactly
// the deletion of exactly these paths.
function removeFromIndex(root, relativePaths) {
  for (let index = 0; index < relativePaths.length; index += 100) {
    git(root, [
      "update-index",
      "--force-remove",
      "--",
      ...relativePaths.slice(index, index + 100),
    ])
  }
}

function restoreTrackedFromHead(root, relativePaths) {
  for (let index = 0; index < relativePaths.length; index += 100) {
    git(root, [
      "restore",
      "--source=HEAD",
      "--worktree",
      "--",
      ...relativePaths.slice(index, index + 100),
    ])
  }
}

export function stageGraphifySnapshots(root) {
  const output = path.join(root, "graphify-out")
  const snapshots = filesUnder(path.join(output, "snapshots", "v1")).filter(
    (file) => PORTABLE.has(path.basename(file)),
  )
  const semantic = filesUnder(path.join(output, "cache", "semantic-cas", "v1"))
  const legacy = LEGACY_ROOT.map((name) => path.join(output, name)).filter(
    (file) => {
      try {
        return lstatSync(file).isFile()
      } catch {
        return false
      }
    },
  )
  // Legacy product branches may still carry broad graphify-out/cache or
  // graphify-out/snapshots ignore rules. These paths are already constrained
  // to the trusted immutable allowlists above, so force-add only that CAS
  // material. Keep legacy mutable root outputs on normal Git semantics.
  addExisting(root, [...snapshots, ...semantic], { force: true })
  addExisting(root, legacy)
  // Staging only ever walked files that still exist, so the router's prunes
  // never reached the commit: every controller run re-tracked exactly the trees
  // that had just been pruned and left the removals as unstaged deletions. That
  // is how a promotion branch accumulates one snapshot per merged branch while
  // retention reports itself as enforced. Record the deletions explicitly.
  //
  // Fail closed on an empty namespace. The router always activates a valid
  // snapshot before pruning, so zero remaining portable files means a failed
  // build rather than a legitimate prune, and staging that would delete the
  // only graph the branch has.
  const removed = snapshots.length
    ? missingFromWorktree(root, trackedUnder(root, SNAPSHOT_NAMESPACE))
    : []
  removeFromIndex(root, removed)
  // Product branches predating the CAS migration may still track Graphify's
  // mutable input-key cache. The trusted wrapper ingests and removes it before
  // building so it cannot contaminate extraction. Restore those generated
  // legacy files after staging the immutable CAS; otherwise a controller run
  // would leave unrelated unstaged deletions and fail its clean-tree guard.
  const legacySemantic = trackedUnder(root, "graphify-out/cache/semantic")
  restoreTrackedFromHead(root, legacySemantic)
  return {
    snapshots: snapshots.length,
    semantic: semantic.length,
    legacy: legacy.length,
    legacySemanticRestored: legacySemantic.length,
    removed: removed.length,
  }
}

function selfTest() {
  const root = mkdtempSync(path.join(tmpdir(), "thingtime-graphify-stage-test-"))
  try {
    git(root, ["init", "-q"])
    git(root, ["config", "user.name", "Lopu Test"])
    git(root, ["config", "user.email", "lopu-test@example.invalid"])
    const oldCache = path.join(root, "graphify-out/cache/semantic/old.json")
    mkdirSync(path.dirname(oldCache), { recursive: true })
    writeFileSync(oldCache, "{}\n")
    writeFileSync(
      path.join(root, ".gitignore"),
      "graphify-out/cache/\ngraphify-out/snapshots/\n",
    )
    writeFileSync(path.join(root, "source.txt"), "source\n")
    // A superseded snapshot tree the branch already tracks. The router prunes
    // it from the worktree during the build; staging has to carry that removal
    // into the commit or retention can never land in Git.
    const superseded = path.join(
      root,
      "graphify-out/snapshots/v1/superseded/artifact",
    )
    mkdirSync(superseded, { recursive: true })
    for (const name of PORTABLE) writeFileSync(path.join(superseded, name), "{}\n")
    git(root, ["add", ".gitignore", "source.txt"])
    // Reproduce a legacy branch that tracked mutable semantic cache before a
    // later broad ignore rule covered both old cache and the new CAS layout.
    git(root, ["add", "--force", "graphify-out/cache/semantic/old.json"])
    git(root, ["add", "--force", "graphify-out/snapshots"])
    git(root, ["commit", "-qm", "base"])
    rmSync(oldCache)
    rmSync(path.dirname(superseded), { recursive: true })

    const snapshot = path.join(
      root,
      "graphify-out/snapshots/v1/source/artifact",
    )
    mkdirSync(snapshot, { recursive: true })
    for (const name of PORTABLE) writeFileSync(path.join(snapshot, name), "{}\n")
    writeFileSync(path.join(snapshot, "graph.html"), "local\n")
    const newCache = path.join(
      root,
      "graphify-out/cache/semantic-cas/v1/input/content.json",
    )
    mkdirSync(path.dirname(newCache), { recursive: true })
    writeFileSync(newCache, "{}\n")

    const result = stageGraphifySnapshots(root)
    const staged = git(root, ["diff", "--cached", "--name-only"]).split("\n")
    assert.ok(staged.includes("graphify-out/snapshots/v1/source/artifact/graph.json"))
    assert.ok(staged.includes("graphify-out/snapshots/v1/source/artifact/snapshot.json"))
    assert.ok(staged.includes("graphify-out/cache/semantic-cas/v1/input/content.json"))
    assert.ok(!staged.includes("graphify-out/cache/semantic/old.json"))
    assert.ok(lstatSync(oldCache).isFile())
    assert.ok(!staged.includes("graphify-out/snapshots/v1/source/artifact/graph.html"))

    // The pruned tree must reach the commit as a deletion, and must not be left
    // behind as an unstaged one for the controller's clean-tree guard to trip on.
    // --no-renames: the fixture's trees are byte-identical, so rename detection
    // would pair each prune with the new snapshot and hide the deletion.
    const deleted = git(root, [
      "diff",
      "--cached",
      "--no-renames",
      "--diff-filter=D",
      "--name-only",
    ]).split("\n")
    assert.equal(result.removed, PORTABLE.size)
    for (const name of PORTABLE) {
      assert.ok(
        deleted.includes(
          `graphify-out/snapshots/v1/superseded/artifact/${name}`,
        ),
        `pruned ${name} must be staged as a deletion`,
      )
    }
    git(root, ["commit", "-qm", "controller graphify commit"])
    assert.equal(trackedUnder(root, "graphify-out/snapshots/v1/superseded").length, 0)
    assert.equal(trackedUnder(root, "graphify-out/snapshots/v1/source").length, PORTABLE.size)
    assert.equal(git(root, ["status", "--porcelain", "--", "graphify-out"]), "")

    // Fail closed: an empty snapshot namespace means the build failed before
    // activating anything, not that every snapshot was legitimately pruned.
    rmSync(path.join(root, "graphify-out/snapshots/v1/source"), {
      recursive: true,
    })
    const emptied = stageGraphifySnapshots(root)
    assert.equal(emptied.removed, 0)
    assert.equal(git(root, ["diff", "--cached", "--name-only"]), "")
    console.log("Graphify snapshot staging contract: self-test OK")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])
  const result = stageGraphifySnapshots(root)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
