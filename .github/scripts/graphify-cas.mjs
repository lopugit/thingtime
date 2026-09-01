#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync, spawnSync } from "node:child_process"

export const SNAPSHOT_SCHEMA = "thingtime.graphify-snapshot.v1"
export const DEFAULT_SNAPSHOT_RETENTION = 1
export const PORTABLE_FILES = [
  "graph.json",
  "manifest.json",
  "GRAPH_REPORT.md",
  "cost.json",
]
export const REQUIRED_FILES = [
  "graph.json",
  "manifest.json",
  "GRAPH_REPORT.md",
]
const LOCAL_DERIVED_FILES = [
  "graph.html",
  ".graphify_analysis.json",
  ".graphify_labels.json",
]
const SNAPSHOT_FILES = new Set([
  ...PORTABLE_FILES,
  ...LOCAL_DERIVED_FILES,
  "snapshot.json",
])

const MUTATING_COMMANDS = new Set(["update", "extract", "cluster-only"])
const INTERNAL_COMMANDS = new Set([
  "cache-migrate",
  "ensure",
  "fingerprint",
  "prune",
  "snapshot",
])
const DEFAULT_LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000

function fail(message) {
  throw new Error(message)
}

export function normalizeGraphifyScopeArgs(root, args) {
  const forwarded = []
  const exclusions = []
  const seen = new Set()

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    let requested = null
    if (arg === "--exclude") {
      index += 1
      requested = args[index]
      if (!requested) fail("graphify-cas --exclude requires a repository-relative path")
    } else if (arg.startsWith("--exclude=")) {
      requested = arg.slice("--exclude=".length)
      if (!requested) fail("graphify-cas --exclude requires a repository-relative path")
    } else {
      forwarded.push(arg)
      continue
    }

    if (path.isAbsolute(requested)) {
      fail("graphify-cas --exclude paths must be repository-relative")
    }
    const absolute = path.resolve(root, requested)
    const relative = path.relative(root, absolute)
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      fail("graphify-cas --exclude paths must stay inside the repository")
    }
    if (
      relative === "graphify-out" ||
      relative.startsWith(`graphify-out${path.sep}`)
    ) {
      fail("graphify-cas cannot exclude its own graphify-out state")
    }
    if (seen.has(relative)) continue
    seen.add(relative)
    exclusions.push({ absolute, relative })
  }

  const minimalExclusions = exclusions.filter(
    (candidate) =>
      !exclusions.some(
        (other) =>
          other !== candidate &&
          candidate.relative.startsWith(`${other.relative}${path.sep}`),
      ),
  )
  return { args: forwarded, exclusions: minimalExclusions }
}

export function withHiddenGraphifyPaths(root, exclusions, callback) {
  const present = exclusions.filter(({ absolute }) => existsSync(absolute))
  if (present.length === 0) return callback()

  // Graphify 0.9.4 has no update/extract --exclude option. Move only the
  // explicitly validated paths to an atomic sibling directory for the child
  // process, then restore them before this trusted wrapper returns. A sibling
  // keeps rename on the same filesystem and outside Graphify's scan root.
  const hiddenRoot = mkdtempSync(
    path.join(path.dirname(root), ".thingtime-graphify-excluded-"),
  )
  const moved = []
  let restoreConflict = null
  try {
    for (const [index, exclusion] of present.entries()) {
      const hidden = path.join(hiddenRoot, String(index))
      renameSync(exclusion.absolute, hidden)
      moved.push({ ...exclusion, hidden })
    }
    return callback()
  } finally {
    for (const entry of moved.reverse()) {
      if (existsSync(entry.absolute)) {
        const unexpected = path.join(
          hiddenRoot,
          `unexpected-${path.basename(entry.relative)}-${randomUUID()}`,
        )
        renameSync(entry.absolute, unexpected)
        restoreConflict =
          restoreConflict ??
          `Graphify recreated excluded path ${entry.relative}; preserved unexpected output at ${unexpected}`
      }
      renameSync(entry.hidden, entry.absolute)
    }
    if (restoreConflict) fail(restoreConflict)
    rmSync(hiddenRoot, { recursive: true, force: true })
  }
}

function runGit(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  }).trim()
}

export function resolveRepoRoot(cwd = process.cwd()) {
  return runGit(cwd, ["rev-parse", "--show-toplevel"])
}

function sha256Parts(parts) {
  const hash = createHash("sha256")
  for (const part of parts) {
    hash.update(part)
  }
  return hash.digest("hex")
}

/**
 * Drop nested-repository gitlinks from the scratch fingerprint index.
 *
 * Controller jobs check a second copy of this repository out at ./trusted,
 * inside the product worktree and matched by no ignore rule. `git add -A`
 * records that directory as a mode-160000 gitlink whose SHA is the control
 * plane's own HEAD, so the source key moved with every unrelated control-plane
 * commit and no ordinary checkout could reproduce it. This repository has no
 * submodules: a gitlink here is always a co-located checkout, never source.
 */
function dropNestedRepositories(root, env) {
  // This is the only git call here that captures a whole index rather than a
  // single line, and execFileSync throws ENOBUFS past its 1 MiB default. One
  // entry costs 50 bytes plus its path, so the default ceiling would start
  // failing every fingerprint — not just missing the cache — on a large tree.
  // 64 MiB is what the other whole-tree control-plane readers already use.
  const staged = runGit(root, ["ls-files", "--stage", "-z"], {
    env,
    maxBuffer: 64 * 1024 * 1024,
  })
  const links = staged
    .split("\0")
    .filter((entry) => entry.startsWith("160000 "))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    .filter(Boolean)
  for (let index = 0; index < links.length; index += 100) {
    runGit(
      root,
      ["update-index", "--force-remove", "--", ...links.slice(index, index + 100)],
      { env },
    )
  }
  return links
}

/**
 * Build a Git tree from the actual worktree/index while excluding graphify-out.
 *
 * A commit SHA cannot key its own generated output: committing that output
 * changes the commit SHA. This source tree is the stable action key instead.
 * A temporary index keeps the real index untouched and includes tracked edits
 * plus non-ignored untracked source files.
 */
export function computeSourceFingerprint(root) {
  const scratch = mkdtempSync(path.join(tmpdir(), "thingtime-graphify-index-"))
  const indexPath = path.join(scratch, "index")
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
  }

  try {
    runGit(root, ["read-tree", "--empty"], { env })
    runGit(
      root,
      ["add", "-A", "--", ".", ":(exclude)graphify-out"],
      { env },
    )
    dropNestedRepositories(root, env)
    const sourceTree = runGit(root, ["write-tree"], { env })
    const sourceFingerprint = sha256Parts([
      `${SNAPSHOT_SCHEMA}\0`,
      sourceTree,
      "\0",
    ])
    return { sourceFingerprint, sourceTree }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function graphifyRoot(root) {
  return path.join(root, "graphify-out")
}

function sleep(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, milliseconds)
}

function lockOwnerAlive(lockPath) {
  const owner = safeJson(path.join(lockPath, "owner.json"))
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    // Another writer can observe the directory between atomic mkdir and the
    // owner-file write. Give that tiny acquisition window time to settle.
    try {
      return Date.now() - statSync(lockPath).mtimeMs < 30_000
    } catch {
      return false
    }
  }
  try {
    process.kill(owner.pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

export function withRepositoryLock(root, callback) {
  const lockPath = path.join(graphifyRoot(root), ".locks", "writer")
  const timeout = Number(
    process.env.GRAPHIFY_CAS_LOCK_TIMEOUT_MS || DEFAULT_LOCK_TIMEOUT_MS,
  )
  const deadline = Date.now() + timeout
  mkdirSync(path.dirname(lockPath), { recursive: true })

  while (true) {
    try {
      mkdirSync(lockPath)
      writeFileSync(
        path.join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid })}\n`,
      )
      break
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      if (!lockOwnerAlive(lockPath)) {
        rmSync(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() >= deadline) {
        fail(`Timed out waiting for Graphify snapshot writer ${lockPath}`)
      }
      sleep(250)
    }
  }

  try {
    return callback()
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

function snapshotSourceRoot(root, sourceFingerprint) {
  return path.join(
    graphifyRoot(root),
    "snapshots",
    "v1",
    sourceFingerprint,
  )
}

function safeJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function semanticCacheRoot(root) {
  return path.join(graphifyRoot(root), "cache", "semantic")
}

function semanticCasRoot(root) {
  return path.join(graphifyRoot(root), "cache", "semantic-cas", "v1")
}

function semanticRichness(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return -1
  const collections = ["nodes", "edges", "links", "hyperedges"]
  return collections.reduce(
    (total, key) => total + (Array.isArray(value[key]) ? value[key].length : 0),
    0,
  )
}

function semanticCacheEntries(cachePath) {
  if (!existsSync(cachePath)) return []
  return readdirSync(cachePath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^[0-9a-f]{64}\.json$/.test(entry.name),
    )
    .map((entry) => ({
      inputKey: entry.name.slice(0, -5),
      path: path.join(cachePath, entry.name),
    }))
}

/**
 * Preserve Graphify's mutable input-keyed semantic cache as immutable variants.
 *
 * Upstream may write different valid bytes to the same input-key filename.
 * Keying the committed copy by both input key and exact content hash makes
 * concurrent branch results additive instead of merge-conflicting.
 */
export function ingestSemanticCache(
  root,
  mutableCache = semanticCacheRoot(root),
) {
  const stored = []
  for (const entry of semanticCacheEntries(mutableCache)) {
    const bytes = readFileSync(entry.path)
    const parsed = safeJson(entry.path)
    if (semanticRichness(parsed) < 0) {
      fail(`Invalid Graphify semantic cache entry: ${entry.path}`)
    }
    const contentHash = sha256Parts([bytes])
    const destination = path.join(
      semanticCasRoot(root),
      entry.inputKey,
      `${contentHash}.json`,
    )
    if (existsSync(destination)) {
      if (!readFileSync(destination).equals(bytes)) {
        fail(`Semantic cache content-address invariant failed: ${destination}`)
      }
    } else {
      mkdirSync(path.dirname(destination), { recursive: true })
      writeFileSync(destination, bytes)
    }
    stored.push(destination)
  }
  return stored
}

/** Hydrate Graphify's mutable cache with the richest valid immutable variant. */
export function hydrateSemanticCache(
  root,
  mutableCache = semanticCacheRoot(root),
) {
  const casRoot = semanticCasRoot(root)
  mkdirSync(mutableCache, { recursive: true })
  if (!existsSync(casRoot)) return []

  const hydrated = []
  for (const inputKey of readdirSync(casRoot).sort()) {
    if (!/^[0-9a-f]{64}$/.test(inputKey)) continue
    const inputRoot = path.join(casRoot, inputKey)
    if (!statSync(inputRoot).isDirectory()) continue
    const candidates = []
    for (const name of readdirSync(inputRoot).sort()) {
      if (!/^[0-9a-f]{64}\.json$/.test(name)) continue
      const candidatePath = path.join(inputRoot, name)
      const bytes = readFileSync(candidatePath)
      const contentHash = sha256Parts([bytes])
      if (name !== `${contentHash}.json`) {
        fail(`Corrupt Graphify semantic cache variant: ${candidatePath}`)
      }
      const parsed = safeJson(candidatePath)
      const richness = semanticRichness(parsed)
      if (richness < 0) {
        fail(`Invalid Graphify semantic cache variant: ${candidatePath}`)
      }
      candidates.push({ bytes, contentHash, richness })
    }
    candidates.sort(
      (left, right) =>
        right.richness - left.richness ||
        left.contentHash.localeCompare(right.contentHash),
    )
    if (candidates.length === 0) continue
    const destination = path.join(mutableCache, `${inputKey}.json`)
    writeFileSync(destination, candidates[0].bytes)
    hydrated.push(destination)
  }
  return hydrated
}

function snapshotRecord(snapshotPath) {
  const metadata = safeJson(path.join(snapshotPath, "snapshot.json"))
  if (
    !metadata ||
    metadata.schema !== SNAPSHOT_SCHEMA ||
    metadata.artifact_hash !== path.basename(snapshotPath) ||
    REQUIRED_FILES.some((name) => !existsSync(path.join(snapshotPath, name)))
  ) {
    return null
  }
  if (
    readdirSync(snapshotPath).some((name) => !SNAPSHOT_FILES.has(name))
  ) {
    return null
  }
  return { path: snapshotPath, metadata }
}

export function listSnapshots(root, sourceFingerprint = null) {
  const snapshotsRoot = path.join(graphifyRoot(root), "snapshots", "v1")
  if (!existsSync(snapshotsRoot)) return []

  const sourceNames = sourceFingerprint
    ? [sourceFingerprint]
    : readdirSync(snapshotsRoot).sort()
  const records = []
  for (const sourceName of sourceNames) {
    const sourceRoot = path.join(snapshotsRoot, sourceName)
    if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) continue
    for (const artifactName of readdirSync(sourceRoot).sort()) {
      if (!/^[0-9a-f]{64}$/.test(artifactName)) continue
      const record = snapshotRecord(path.join(sourceRoot, artifactName))
      if (record) records.push(record)
    }
  }
  return records
}

function compareSnapshotQuality(left, right) {
  const nodeDelta =
    Number(right.metadata.node_count ?? 0) -
    Number(left.metadata.node_count ?? 0)
  if (nodeDelta !== 0) return nodeDelta
  const linkDelta =
    Number(right.metadata.link_count ?? 0) -
    Number(left.metadata.link_count ?? 0)
  if (linkDelta !== 0) return linkDelta
  return right.metadata.artifact_hash.localeCompare(
    left.metadata.artifact_hash,
  )
}

export function selectSnapshot(root, sourceFingerprint = null) {
  const records = listSnapshots(root, sourceFingerprint)
  records.sort(compareSnapshotQuality)
  return records[0] ?? null
}

export function snapshotRetentionLimit(
  value = process.env.GRAPHIFY_SNAPSHOT_RETENTION,
) {
  if (value === undefined || String(value).trim() === "") {
    return DEFAULT_SNAPSHOT_RETENTION
  }
  const normalized = String(value).trim()
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    fail(
      `GRAPHIFY_SNAPSHOT_RETENTION must be a positive integer, received ${JSON.stringify(value)}`,
    )
  }
  const retention = Number(normalized)
  if (!Number.isSafeInteger(retention)) {
    fail("GRAPHIFY_SNAPSHOT_RETENTION exceeds JavaScript's safe integer range")
  }
  return retention
}

/**
 * Bound portable snapshots in the current Git tree while keeping the active
 * source snapshot. Removed snapshots remain recoverable from Git history and
 * from any branch ref that still points to them.
 */
export function pruneSnapshots(
  root,
  activeSnapshot,
  retention = snapshotRetentionLimit(),
) {
  if (!activeSnapshot?.path) fail("Cannot prune without an active snapshot")
  if (!Number.isSafeInteger(retention) || retention < 1) {
    fail("Snapshot retention must be a positive integer")
  }

  const records = listSnapshots(root)
  const activePath = path.resolve(activeSnapshot.path)
  if (!records.some((record) => path.resolve(record.path) === activePath)) {
    fail(`Active snapshot is not a valid snapshot record: ${activePath}`)
  }

  records.sort((left, right) => {
    const leftActive = path.resolve(left.path) === activePath
    const rightActive = path.resolve(right.path) === activePath
    if (leftActive !== rightActive) return leftActive ? -1 : 1
    return compareSnapshotQuality(left, right)
  })

  const retained = records.slice(0, retention)
  const retainedPaths = new Set(
    retained.map((record) => path.resolve(record.path)),
  )
  const removed = []
  for (const record of records) {
    if (retainedPaths.has(path.resolve(record.path))) continue
    rmSync(record.path, { recursive: true, force: true })
    removed.push(record.path)
  }

  const snapshotsRoot = path.join(graphifyRoot(root), "snapshots", "v1")
  if (existsSync(snapshotsRoot)) {
    for (const sourceName of readdirSync(snapshotsRoot)) {
      const sourceRoot = path.join(snapshotsRoot, sourceName)
      if (
        statSync(sourceRoot).isDirectory() &&
        readdirSync(sourceRoot).length === 0
      ) {
        rmdirSync(sourceRoot)
      }
    }
  }

  return {
    retention,
    retained: retained.map((record) => record.path),
    removed,
  }
}

function copyPortableFiles(from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of PORTABLE_FILES) {
    const source = path.join(from, name)
    if (existsSync(source)) {
      const target = path.join(to, name)
      cpSync(source, target)
      // Immutable snapshots are 0444 so legacy writers cannot mutate them
      // through compatibility aliases. A private mutation workspace is the
      // opposite boundary: Graphify must be able to replace every portable
      // output while building the next content-addressed snapshot.
      chmodSync(target, 0o644)
    }
  }
  for (const name of [".graphify_analysis.json", ".graphify_labels.json"]) {
    const source = path.join(from, name)
    if (existsSync(source)) {
      const target = path.join(to, name)
      cpSync(source, target)
      chmodSync(target, 0o644)
    }
  }
}

function legacyOutputAvailable(root) {
  const graphPath = path.join(graphifyRoot(root), "graph.json")
  return existsSync(graphPath) && !lstatSync(graphPath).isSymbolicLink()
}

function baselineNodeCount(root, sourceFingerprint) {
  const snapshot =
    selectSnapshot(root, sourceFingerprint) ?? selectSnapshot(root)
  if (snapshot) return Number(snapshot.metadata.node_count ?? 0)
  if (!legacyOutputAvailable(root)) return 0
  const graph = safeJson(path.join(graphifyRoot(root), "graph.json"))
  return Array.isArray(graph?.nodes) ? graph.nodes.length : 0
}

function graphifyVersion() {
  const result = spawnSync("graphify", ["--version"], {
    encoding: "utf8",
    env: { ...process.env, THINGTIME_GRAPHIFY_CAS_CHILD: "1" },
  })
  if (result.status !== 0) return "unknown"
  return (result.stdout || result.stderr || "unknown").trim()
}

export function prepareWorkingOutput(root, sourceFingerprint) {
  const workRoot = path.join(
    graphifyRoot(root),
    ".work",
    "v1",
    sourceFingerprint,
    randomUUID(),
  )
  mkdirSync(workRoot, { recursive: true })

  const exact = selectSnapshot(root, sourceFingerprint)
  const fallback = exact ?? selectSnapshot(root)
  if (fallback) {
    copyPortableFiles(fallback.path, workRoot)
  } else if (legacyOutputAvailable(root)) {
    copyPortableFiles(graphifyRoot(root), workRoot)
  }

  // A failed/partial semantic extraction must never mutate committed state.
  // Hydrate a private work cache, then ingest only after Graphify succeeds.
  ingestSemanticCache(root)
  rmSync(semanticCacheRoot(root), { recursive: true, force: true })
  const workCache = path.join(workRoot, "cache")
  mkdirSync(workCache, { recursive: true })
  hydrateSemanticCache(root, path.join(workCache, "semantic"))

  // AST cache is deterministic and machine-local; sharing it avoids needless
  // parsing without exposing the immutable semantic CAS to upstream writes.
  const sharedAst = path.join(graphifyRoot(root), "cache", "ast")
  mkdirSync(sharedAst, { recursive: true })
  symlinkSync(
    path.relative(workCache, sharedAst),
    path.join(workCache, "ast"),
    "dir",
  )
  return workRoot
}

function invokeGraphify(root, outputPath, args) {
  const env = {
    ...process.env,
    GRAPHIFY_OUT: outputPath,
    GRAPHIFY_VIZ_NODE_LIMIT:
      process.env.GRAPHIFY_VIZ_NODE_LIMIT || "1000000",
    THINGTIME_GRAPHIFY_CAS_CHILD: "1",
  }
  const result = spawnSync("graphify", args, {
    cwd: root,
    env,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    fail(`graphify ${args.join(" ")} exited with ${result.status}`)
  }
}

function validatePortableOutput(outputPath) {
  for (const name of REQUIRED_FILES) {
    const target = path.join(outputPath, name)
    if (!existsSync(target)) fail(`Graphify output is missing ${name}`)
  }
  const graph = safeJson(path.join(outputPath, "graph.json"))
  const manifest = safeJson(path.join(outputPath, "manifest.json"))
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    fail("Graphify graph.json is not a valid node-link graph")
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    fail("Graphify manifest.json is not a valid object")
  }
  return graph
}

function nodeCountsBySource(graph) {
  const counts = new Map()
  for (const node of graph.nodes) {
    if (typeof node?.source_file !== "string" || !node.source_file) continue
    counts.set(node.source_file, (counts.get(node.source_file) ?? 0) + 1)
  }
  return counts
}

function unchangedManifestEntry(before, after) {
  if (
    !before ||
    Array.isArray(before) ||
    typeof before !== "object" ||
    !after ||
    Array.isArray(after) ||
    typeof after !== "object"
  ) {
    return false
  }
  const beforeAst = before.ast_hash
  const beforeSemantic = before.semantic_hash
  return (
    typeof beforeAst === "string" &&
    beforeAst.length > 0 &&
    typeof beforeSemantic === "string" &&
    beforeSemantic.length > 0 &&
    beforeAst === after.ast_hash &&
    beforeSemantic === after.semantic_hash
  )
}

/**
 * Detect a poisoned incremental result that silently loses symbols for source
 * files Graphify's own manifest says are unchanged. A one-node difference is
 * tolerated for upstream extractor jitter; losing two or more is rejected.
 */
export function findPoisonedGraphFiles(baselinePath, candidatePath) {
  const baselineGraph = safeJson(path.join(baselinePath, "graph.json"))
  const candidateGraph = safeJson(path.join(candidatePath, "graph.json"))
  const baselineManifest = safeJson(path.join(baselinePath, "manifest.json"))
  const candidateManifest = safeJson(path.join(candidatePath, "manifest.json"))
  if (
    !Array.isArray(baselineGraph?.nodes) ||
    !Array.isArray(candidateGraph?.nodes) ||
    !baselineManifest ||
    Array.isArray(baselineManifest) ||
    typeof baselineManifest !== "object" ||
    !candidateManifest ||
    Array.isArray(candidateManifest) ||
    typeof candidateManifest !== "object"
  ) {
    return []
  }

  const beforeCounts = nodeCountsBySource(baselineGraph)
  const afterCounts = nodeCountsBySource(candidateGraph)
  const poisoned = []
  for (const sourceFile of Object.keys(baselineManifest).sort()) {
    if (
      !unchangedManifestEntry(
        baselineManifest[sourceFile],
        candidateManifest[sourceFile],
      )
    ) {
      continue
    }
    const before = beforeCounts.get(sourceFile) ?? 0
    const after = afterCounts.get(sourceFile) ?? 0
    if (before - after >= 2) poisoned.push({ sourceFile, before, after })
  }
  return poisoned
}

function artifactHash(outputPath, version) {
  const parts = [`${SNAPSHOT_SCHEMA}\0`, version, "\0"]
  for (const name of PORTABLE_FILES) {
    const target = path.join(outputPath, name)
    if (!existsSync(target)) continue
    parts.push(name, "\0", readFileSync(target), "\0")
  }
  return sha256Parts(parts)
}

function removeCacheLink(outputPath) {
  const cachePath = path.join(outputPath, "cache")
  if (existsSync(cachePath) && lstatSync(cachePath).isSymbolicLink()) {
    rmSync(cachePath)
  }
}

function protectSnapshotFiles(snapshotPath) {
  for (const name of SNAPSHOT_FILES) {
    const target = path.join(snapshotPath, name)
    if (existsSync(target) && lstatSync(target).isFile()) {
      chmodSync(target, 0o444)
    }
  }
}

export function finalizeSnapshot(
  root,
  workingOutput,
  {
    sourceFingerprint,
    sourceTree,
    version = graphifyVersion(),
    minimumNodeCount = 0,
  },
) {
  const graph = validatePortableOutput(workingOutput)
  if (
    minimumNodeCount > 0 &&
    graph.nodes.length < Math.floor(minimumNodeCount / 2)
  ) {
    fail(
      `Graphify output collapsed from ${minimumNodeCount} to ${graph.nodes.length} nodes; rerun an intentional large deletion with --force`,
    )
  }
  const baseline = selectSnapshot(root, sourceFingerprint)
  if (baseline) {
    const poisoned = findPoisonedGraphFiles(baseline.path, workingOutput)
    if (poisoned.length > 0) {
      const details = poisoned
        .slice(0, 20)
        .map(
          ({ sourceFile, before, after }) =>
            `${sourceFile} (${before} -> ${after} nodes)`,
        )
        .join(", ")
      const remainder =
        poisoned.length > 20 ? `, plus ${poisoned.length - 20} more` : ""
      fail(
        `Graphify output dropped symbols for unchanged files: ${details}${remainder}`,
      )
    }
  }
  removeCacheLink(workingOutput)
  const digest = artifactHash(workingOutput, version)
  const sourceRoot = snapshotSourceRoot(root, sourceFingerprint)
  const destination = path.join(sourceRoot, digest)
  const staging = path.join(sourceRoot, `.staging-${randomUUID()}`)
  const metadata = {
    schema: SNAPSHOT_SCHEMA,
    source_fingerprint: sourceFingerprint,
    source_tree: sourceTree,
    artifact_hash: digest,
    graphify_version: version,
    node_count: graph.nodes.length,
    link_count: graph.links.length,
  }

  mkdirSync(staging, { recursive: true })
  for (const name of [...PORTABLE_FILES, ...LOCAL_DERIVED_FILES]) {
    const source = path.join(workingOutput, name)
    if (existsSync(source)) cpSync(source, path.join(staging, name))
  }
  writeFileSync(
    path.join(staging, "snapshot.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  )

  try {
    if (existsSync(destination)) {
      const existing = snapshotRecord(destination)
      if (!existing) fail(`Existing snapshot is invalid: ${destination}`)
      const existingDigest = artifactHash(
        destination,
        existing.metadata.graphify_version,
      )
      if (
        existingDigest !== digest ||
        existing.metadata.source_fingerprint !== sourceFingerprint ||
        existing.metadata.source_tree !== sourceTree
      ) {
        fail(`Content-addressed snapshot invariant failed: ${destination}`)
      }
    } else {
      renameSync(staging, destination)
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(workingOutput, { recursive: true, force: true })
  }
  // Compatibility aliases are intentionally ordinary filesystem symlinks.
  // Make their immutable targets read-only so a legacy raw Graphify hook
  // cannot follow an alias and rewrite a content-addressed artifact in place.
  protectSnapshotFiles(destination)
  return snapshotRecord(destination)
}

function isTracked(root, relativePath) {
  try {
    runGit(root, ["ls-files", "--error-unmatch", "--", relativePath])
    return true
  } catch {
    return false
  }
}

function isIgnored(root, relativePath) {
  try {
    runGit(root, ["check-ignore", "-q", "--", relativePath])
    return true
  } catch {
    return false
  }
}

/** Materialize compatibility aliases without putting mutable pointers in Git. */
export function activateSnapshot(root, snapshot) {
  protectSnapshotFiles(snapshot.path)
  const outputRoot = graphifyRoot(root)
  mkdirSync(outputRoot, { recursive: true })
  const names = [...PORTABLE_FILES, "graph.html"]
  for (const name of names) {
    const source = path.join(snapshot.path, name)
    if (!existsSync(source)) continue
    const alias = path.join(outputRoot, name)
    const relativeAlias = path.relative(root, alias)
    let stat = null
    try {
      stat = lstatSync(alias)
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    if (stat) {
      if (stat.isSymbolicLink()) {
        const current = readlinkSync(alias)
        const desired = path.relative(outputRoot, source)
        if (current === desired) continue
        rmSync(alias)
      } else if (isTracked(root, relativeAlias)) {
        // Migration mode: never replace a still-tracked portable output.
        continue
      } else if (isIgnored(root, relativeAlias)) {
        // Older upstream hooks can materialize an ignored regular file at a
        // fixed compatibility path. It is generated, recoverable, and safe to
        // replace; unrelated untracked files still fail closed below.
        rmSync(alias)
      } else {
        // Legacy/raw Graphify can unlink a compatibility symlink and write a
        // regular generated file at the ignored root alias. The immutable
        // snapshot remains protected; reclaim this exact generated pathname.
        rmSync(alias)
      }
    }
    symlinkSync(path.relative(outputRoot, source), alias)
  }
}

function runMutation(root, args) {
  const retention = snapshotRetentionLimit()
  return withRepositoryLock(root, () => {
    const scoped = normalizeGraphifyScopeArgs(root, args)
    const fingerprint = computeSourceFingerprint(root)
    const minimumNodeCount = scoped.args.includes("--force")
      ? 0
      : baselineNodeCount(root, fingerprint.sourceFingerprint)
    return withHiddenGraphifyPaths(root, scoped.exclusions, () => {
      const workingOutput = prepareWorkingOutput(
        root,
        fingerprint.sourceFingerprint,
      )
      try {
        invokeGraphify(root, workingOutput, scoped.args)
        if (scoped.args[0] === "extract") {
          invokeGraphify(root, workingOutput, ["cluster-only", root])
        }
        invokeGraphify(root, workingOutput, ["export", "html"])
        ingestSemanticCache(
          root,
          path.join(workingOutput, "cache", "semantic"),
        )
        const snapshot = finalizeSnapshot(root, workingOutput, {
          ...fingerprint,
          minimumNodeCount,
        })
        activateSnapshot(root, snapshot)
        pruneSnapshots(root, snapshot, retention)
        process.stdout.write(`${snapshot.path}\n`)
        return snapshot
      } catch (error) {
        rmSync(workingOutput, { recursive: true, force: true })
        throw error
      }
    })
  })
}

function ensureSnapshot(root) {
  const retention = snapshotRetentionLimit()
  return withRepositoryLock(root, () => {
    const current = computeSourceFingerprint(root)
    const existing = selectSnapshot(root, current.sourceFingerprint)
    if (existing) {
      activateSnapshot(root, existing)
      pruneSnapshots(root, existing, retention)
      return existing
    }

    const workingOutput = prepareWorkingOutput(
      root,
      current.sourceFingerprint,
    )
    const minimumNodeCount = baselineNodeCount(
      root,
      current.sourceFingerprint,
    )
    try {
      invokeGraphify(root, workingOutput, ["update", root])
      invokeGraphify(root, workingOutput, ["export", "html"])
      ingestSemanticCache(
        root,
        path.join(workingOutput, "cache", "semantic"),
      )
      const snapshot = finalizeSnapshot(root, workingOutput, {
        ...current,
        minimumNodeCount,
      })
      activateSnapshot(root, snapshot)
      pruneSnapshots(root, snapshot, retention)
      return snapshot
    } catch (error) {
      rmSync(workingOutput, { recursive: true, force: true })
      throw error
    }
  })
}

function pruneSnapshotStore(root) {
  const retention = snapshotRetentionLimit()
  return withRepositoryLock(root, () => {
    const current = computeSourceFingerprint(root)
    const snapshot =
      selectSnapshot(root, current.sourceFingerprint) ?? selectSnapshot(root)
    if (!snapshot) fail("No valid Graphify snapshot is available to retain")
    activateSnapshot(root, snapshot)
    const result = pruneSnapshots(root, snapshot, retention)
    return { snapshot, ...result }
  })
}

function runRouted(root, args) {
  if (args.length === 0) {
    invokeGraphify(root, graphifyRoot(root), ["--help"])
    return
  }
  if (args.includes("--no-cluster") && args[0] === "extract") {
    fail("Thingtime refuses graphify extract --no-cluster because it can shrink the graph")
  }
  if (MUTATING_COMMANDS.has(args[0])) {
    runMutation(root, args)
    return
  }
  if (args[0] === "ensure") {
    const snapshot = ensureSnapshot(root)
    process.stdout.write(`${snapshot.path}\n`)
    return
  }
  if (args[0] === "fingerprint") {
    process.stdout.write(`${JSON.stringify(computeSourceFingerprint(root))}\n`)
    return
  }
  if (args[0] === "prune") {
    const result = pruneSnapshotStore(root)
    process.stdout.write(
      `${JSON.stringify({
        active: path.relative(root, result.snapshot.path),
        retention: result.retention,
        retained: result.retained.length,
        removed: result.removed.length,
      })}\n`,
    )
    return
  }
  if (args[0] === "snapshot") {
    const fingerprint = computeSourceFingerprint(root)
    const snapshot = selectSnapshot(root, fingerprint.sourceFingerprint)
    if (!snapshot) process.exitCode = 1
    else process.stdout.write(`${snapshot.path}\n`)
    return
  }
  if (args[0] === "cache-migrate") {
    const result = withRepositoryLock(root, () => {
      const stored = ingestSemanticCache(root)
      const legacyEntries = semanticCacheEntries(semanticCacheRoot(root)).length
      rmSync(semanticCacheRoot(root), { recursive: true, force: true })
      return { stored: stored.length, removed: legacyEntries }
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }

  // Hook management configures Graphify itself and must not be redirected.
  if (args[0] === "hook" || args[0] === "install") {
    invokeGraphify(root, graphifyRoot(root), args)
    return
  }

  const snapshot = ensureSnapshot(root)
  activateSnapshot(root, snapshot)
  invokeGraphify(root, snapshot.path, args)
}

export function main(argv = process.argv.slice(2)) {
  const root = resolveRepoRoot()
  const separator = argv.indexOf("--")
  const args = separator >= 0 ? argv.slice(separator + 1) : argv
  if (args[0] === "run") args.shift()
  if (INTERNAL_COMMANDS.has(args[0])) {
    runRouted(root, args)
    return
  }
  runRouted(root, args)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ""
if (import.meta.url === entry) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`graphify-cas: ${error.message}\n`)
    process.exitCode = 1
  }
}
