# Commander Filesystem Indexer

`commander-indexer` is Commander's reusable, local-only filesystem metadata
index. It is deliberately a separate Rust process so Commander, a future
Thingtime Electron app, or any other desktop host can share the same scanner
without embedding platform-specific code.

The index stores names, paths, kinds, modification times, and sizes in a
private SQLite database. It never reads or stores file contents.

## Capabilities

- Index applications, files, and directories independently or in one walk.
- Inherit `.gitignore`, `.git/info/exclude`, and Git's global excludes,
  including ignore files above a configured root.
- Apply additional wildcard (`glob`) and regular-expression (`regex`) ignore
  rules. A descendant glob such as `**/node_modules/**` also prunes the
  matching directory instead of walking every ignored child.
- Persist results and per-kind status in SQLite with a name-focused FTS5
  trigram index and an on-demand path fallback.
- Treat macOS application and document/media package directories as one
  searchable item instead of crawling their private bundle contents.
- Serve a typed request/response protocol over JSON Lines for long-lived app
  hosts.
- Run as a standalone CLI for scripts and other Thingtime applications.
- Enforce caller-provided ceilings for traversal threads, parallel directory
  work, open directory handles, total-machine CPU share, and process resident
  memory. Every report includes the effective limits and measured usage.

When a source reaches `maxEntries`, the scan commits the bounded partial index
and records a visible warning instead of discarding every result from a large
first-time scan.

## Standalone examples

```sh
commander-indexer index --database ./files.sqlite3 --config ./index.json
commander-indexer query --database ./files.sqlite3 --query invoice --limit 30
commander-indexer status --database ./files.sqlite3
```

An index configuration looks like this:

```json
{
  "sources": [
    {
      "id": "documents",
      "root": "/Users/example/Documents",
      "kinds": ["file", "directory"],
      "respectGitIgnore": true,
      "includeHidden": false,
      "followSymlinks": false
    }
  ],
  "customIgnores": [
    { "kind": "glob", "pattern": "**/node_modules/**" },
    { "kind": "regex", "pattern": "(^|/)scratch-[0-9]+(/|$)" }
  ],
  "maxEntries": 2000000,
  "resourceLimits": {
    "maxThreads": 2,
    "maxParallelism": 2,
    "maxOpenDirectories": 16,
    "maxCpuPercent": 60,
    "maxMemoryMiB": 512
  }
}
```

`maxThreads` limits Rust traversal workers (not the mandatory process main/writer
and walker-coordinator threads); `maxParallelism` limits simultaneous directory
work; `maxOpenDirectories` limits directory iterators. The scanner
uses the strictest of those three values and the machine's logical CPU count.
It never opens file contents. `maxCpuPercent` is a share of the machine's total
logical-CPU capacity, sampled from process CPU time and enforced with a
process-wide duty-cycle gate. `maxMemoryMiB` is a hard resident-memory limit;
the channel and SQLite cache are also derived from it. Crossing the memory
limit aborts the transaction and leaves the previous searchable snapshot
untouched. If the operating system cannot provide CPU or resident-memory
counters, indexing fails closed instead of silently ignoring the requested
ceiling.

Measured balanced defaults are 2 threads, 2 parallel tasks, 16 open directories, 60%
total-machine CPU, and 512 MiB RAM. Supported ranges are 1–64 threads/tasks,
1–256 open directories, 5–100% CPU, and 32–131072 MiB RAM. Omitted
`resourceLimits` receive the defaults for backwards compatibility.

Schema 3 upgrades existing databases transactionally and changes the FTS update
trigger to run only when an indexed name changes. Scheduled reconciliations can
still advance each record generation and remove disappeared paths without
rewriting unchanged trigram rows.

`serve --database <path>` reads one request per line and writes one response
per line. Each request carries an `id`, and each response echoes it, so clients
can safely multiplex queries and long-running scans.
