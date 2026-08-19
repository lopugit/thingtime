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
  "maxEntries": 2000000
}
```

`serve --database <path>` reads one request per line and writes one response
per line. Each request carries an `id`, and each response echoes it, so clients
can safely multiplex queries and long-running scans.
