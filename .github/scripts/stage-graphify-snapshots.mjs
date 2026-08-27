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

function addExisting(root, paths) {
  const relative = paths.map((file) => path.relative(root, file))
  for (let index = 0; index < relative.length; index += 100) {
    git(root, ["add", "--", ...relative.slice(index, index + 100)])
  }
}

export function stageGraphifySnapshots(root) {
  const output = path.join(root, "graphify-out")
  const snapshots = filesUnder(path.join(output, "snapshots", "v1")).filter(
    (file) => PORTABLE.has(path.basename(file)),
  )
  const semantic = filesUnder(path.join(output, "cache", "semantic"))
  const legacy = LEGACY_ROOT.map((name) => path.join(output, name)).filter(
    (file) => {
      try {
        return lstatSync(file).isFile()
      } catch {
        return false
      }
    },
  )
  addExisting(root, [...snapshots, ...semantic, ...legacy])
  return { snapshots: snapshots.length, semantic: semantic.length, legacy: legacy.length }
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
    writeFileSync(path.join(root, "source.txt"), "source\n")
    git(root, ["add", "."])
    git(root, ["commit", "-qm", "base"])
    rmSync(oldCache)

    const snapshot = path.join(
      root,
      "graphify-out/snapshots/v1/source/artifact",
    )
    mkdirSync(snapshot, { recursive: true })
    for (const name of PORTABLE) writeFileSync(path.join(snapshot, name), "{}\n")
    writeFileSync(path.join(snapshot, "graph.html"), "local\n")
    const newCache = path.join(root, "graphify-out/cache/semantic/new.json")
    writeFileSync(newCache, "{}\n")

    stageGraphifySnapshots(root)
    const staged = git(root, ["diff", "--cached", "--name-only"]).split("\n")
    assert.ok(staged.includes("graphify-out/snapshots/v1/source/artifact/graph.json"))
    assert.ok(staged.includes("graphify-out/snapshots/v1/source/artifact/snapshot.json"))
    assert.ok(staged.includes("graphify-out/cache/semantic/new.json"))
    assert.ok(!staged.includes("graphify-out/cache/semantic/old.json"))
    assert.ok(!staged.includes("graphify-out/snapshots/v1/source/artifact/graph.html"))
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
