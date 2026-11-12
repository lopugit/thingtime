# PR1052 — Commander Rust indexing and resilient Mac backup verification

[Pull request](https://github.com/lopugit/thingtime/pull/1052) · branch `codex/commander-backup-indexer`

## Problem and result

A timeout while verifying the native folder grant cancelled a long-running home capture before payload upload. The native worker now distinguishes transient transport failures from actual authority loss. It retains private work and retries verification with capped backoff, but does not disclose inventory or transfer bytes without current authorization.

Mac backups now reuse Commander’s parallel Rust walker and resource governor. A signed helper reads its task configuration through stdin and streams versioned JSONL into the existing SQLite inventory. It does not reuse Commander’s search database. No-follow descriptor-relative reads, current identity/version checks, canonical multipart fingerprints and exact saved Gitignore rules preserve the backup contract. iOS retains Swift traversal.

## Review and validation

- Independent review reproduced nested-folder mutation escaping coverage and an unbounded child-exit wait. Both were fixed and regression-tested.
- 39 Rust tests; 96 Apple library tests, including 5 real cross-language integration tests.
- 195 Mac tests: zero failures, 2 optional checks skipped.
- 397 shared sync tests and 235 Electron tests pass.
- Graphify structural snapshot refreshed. Documentation semantic freshness is not asserted.
- Signed packaging and actual installed home upload acceptance are in progress; no payload receipt or completed backup is claimed yet.

## Coverage boundaries

Saved home exclusions and dependency ignores remain authoritative. Symlinks, sockets, FIFOs and other unsupported entries remain visible partial-coverage gaps; this PR does not claim their preservation. Directory indexing also reads file contents to produce backup hashes, so search-only metadata traversal is not a throughput benchmark. Android remains deferred. Timeline restoration and independent snapshot/export work remain separate unfinished checklist items.
