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
- Reconcile disconnected/remapped volumes by pruning only caller-selected
  source namespaces after a wholly successful scan.
- Persist results and per-kind status in SQLite with a name-focused FTS5
  trigram index, shared typo/transposition ranking, and time-bounded coarse-name
  and path fallbacks that cannot monopolize a long-lived client.
- Treat macOS application and document/media package directories as one
  searchable item instead of crawling their private bundle contents.
- Index metadata-only references for extensionless executables, hard links,
  aliases, symbolic links (including broken links), sockets, FIFOs, and device
  nodes without opening their contents or following them by default.
- Serve a typed request/response protocol over JSON Lines for long-lived app
  hosts.
- Run as a standalone CLI for scripts and other Thingtime applications.
- Enforce caller-provided ceilings for traversal threads, parallel directory
  work, open directory handles, total-machine CPU share, and process resident
  memory. Every report includes the effective limits and measured usage.

`maxEntries` is optional: omitted or `null` means unlimited. When a caller sets
a cap and a source reaches it, the scan commits the bounded partial index and
records a visible warning instead of discarding every result from a large
first-time scan. `includeHidden` defaults to `true` when omitted.

## Standalone examples

```sh
commander-indexer index --database ./files.sqlite3 --config ./index.json
commander-indexer query --database ./files.sqlite3 --query invoice --limit 30
commander-indexer query --database ./files.sqlite3 --query '' --kind application --limit all
commander-indexer status --database ./files.sqlite3
```

Queries read the persisted SQLite index; they never run the scanner. There is
no fixed record-count ceiling for any catalogue (apps, files, or directories).
JSONL query `limit: null` / CLI `--limit all` returns all matching records;
omitting the limit defaults to a 50-result output page. A numeric limit controls
the returned page after ranking, not an arbitrary pre-ranking candidate slice.
Typo/path fallback time budgets and explicit indexing resource settings remain
in place to protect responsiveness. The Node client's `catalogue(kinds)` reads
the complete catalogue without being cancelled by newer interactive queries.

An index configuration looks like this:

```json
{
  "sources": [
    {
      "id": "documents",
      "root": "/Users/example/Documents",
      "kinds": ["file", "directory"],
      "respectGitIgnore": true,
      "includeHidden": true,
      "followSymlinks": false
    }
  ],
  "customIgnores": [
    { "kind": "glob", "pattern": "**/node_modules/**" },
    { "kind": "regex", "pattern": "(^|/)scratch-[0-9]+(/|$)" }
  ],
  "maxEntries": null,
  "pruneSourcePrefixes": ["filesystem:"],
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

`pruneSourcePrefixes` is optional. When provided, records whose source IDs
start with one of those prefixes but are absent from the completed source list
are removed atomically. It is useful for mounted-volume inventories: an
unplugged `filesystem:/Volumes/Work` source disappears without affecting a
separate `applications:` namespace. Empty prefixes are rejected.

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
can safely multiplex queries and long-running scans. An index request emits
zero or more correlated `{"id":"…","event":"progress","progress":{…}}`
lines before its single final success/error response; existing hosts can ignore
unknown event lines. Status uses indexed row counts rather than expensive
distinct-path scans; the Node client terminates a timed-out child and starts a
clean replacement on its next request.

## Eligible backup streaming

The `backup` JSONL request accepts optional `streaming: true` alongside
`version: 1`. It defaults to false, preserving the legacy hello and buffering.
A supported streaming run replies with `{"event":"hello","version":1,"streaming":true}`.
Only that explicit acknowledgement allows hosts to act on entries before capture
completion. Setup failure returns an error rather than silently downgrading.

In streaming mode a private temporary SQLite namespace index validates all
siblings and every ancestor before an entry becomes eligible. Names use the
existing NFC/lowercase collision policy. Neither colliding path is emitted;
hardlink identity duplicates preserve the existing first eligible identity and
produce a `duplicate-identity` gap. The index uses a bounded SQLite cache and is
removed when the process exits. Directory enumeration is scoped to ancestors
of the current candidate, rather than requiring the whole tree to finish.

Native filesystem notifications subscribe before traversal. While capture runs,
notifications revalidate already indexed paths and emit the same entry shape
again when its version changes. Newly created paths pass the same ignore,
exclusion, physical-path, and collision gates; newly created directories use a
disk-backed pending queue to discover their contents without a second full walk. Hosts must preserve their stable identity and
accept repeated path/identity rows with a new version. Data changes use exact
indexed-path lookup; namespace changes also revalidate affected indexed siblings
and descendants. macOS uses its recursive event stream; platforms whose
recursive watcher setup would synchronously traverse the tree add nonrecursive
watches as the existing walker reaches each directory. Watch failures, lost
events, new ambiguity, or removed paths produce gaps; they never authorize a
partial-tree deletion or a claim of complete coverage. Previously transferred
immutable versions may be retained. Hosts must persist these gaps and block
full-completion/deletion semantics.

Each streaming event flushes immediately, including the first eligible entry.
After the initial walk, `{"event":"indexed"}` marks the initial inventory
watermark. The CLI keeps its native watcher and stdin open while the consumer
drains transfers. Count every `entry` and `skipped` event decoded, including
duplicate revisions; `hello`, `ignored`, `indexed`, and `complete` do not count.
When its durable queue is drained, the consumer sends
`{"event":"stop","afterSequence":N}` on stdin with that decoded-event count.
After a 200ms notification drain the helper compares its producer count with N.
If they differ, it emits `indexed` again and keeps watching; the consumer must
drain the newly observed work and retry. Only an equal count produces `complete`
and exits. This also covers events already queued in the pipe at stop time.
Closing stdin ends the CLI subscription after traversal; terminating the child
cancels it. The Rust `capture()` convenience API remains finite.

This is a capture-scoped change feed, not a watcher seeded from a previously
sealed inventory. Explicit stop defines the end of observation; the protocol
does not establish a filesystem-wide atomic snapshot.
