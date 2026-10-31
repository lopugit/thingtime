# PR #1015 — Complete 1PUX imports and encrypted password attachments

Branch: `codex/password-import-fix` → `develop`.

## Problem and coverage

A legitimate 43.5 MB export was rejected by the 20 MiB import cap. The old importer
also dropped attachments and richer item data. The replacement streams ZIP/JSON/CSV
and retains all 1PUX v3 member bytes. Known category/field types become editable
Thing fields; unknown data, original account/vault/item metadata, history, icons,
and documents remain recoverable. Editing does not overwrite the original snapshot.

No arbitrary archive, expanded-byte, entry-count, field-count, label, or value caps
remain in this path. The shared canonical AI_ALL.md policy now requires streaming,
pagination, and backpressure instead of arbitrary product caps; AGENTS.md and
CLAUDE.md both point to that file.

## Storage and security

Files are relational Things using the existing multipart private attachment
lifecycle, accounting, leases and cleanup. Browser AES-256-GCM frames encrypt file
bytes; the existing server-assisted account vault encrypts file names, keys, nonce
prefixes, and source paths. Full live sessions and the expected owner fence every
operation. Generic attachment reads/mutations/copy and external moderation cannot
process password files. Tombstoning the parent blocks new bindings before cleanup.

1PUX backups retain source files through an explicit Thingtime extension, remap
owner-local identities on restore, and rebase standard document/icon references.
The extension preserves original metadata independently of edits. Native provider
release and desktop passkey transfer are outside this PR; absent source keys cannot
be reconstructed from a desktop export.

## Verification — 2026-10-17

- 47 password/import/encryption tests; 77 attachment/route tests; 59 capability tests; 265 schema tests after integrating current develop.
- 31 live password API checks; 35 live encrypted-file checks on a disposable
  localhost replica, with three API-created users. No direct database test seeding.
- Full production build and Vercel output validation passed.
- TypeScript reported 91 existing diagnostics, none in changed files.
- Real local export: 1,598 entries and 25 file members previewed without uploading
  personal data. The fixture contents and account secrets are not in the PR.
- Browser: synthetic all-field import, edit structured address, export, compare
  all five original members byte-for-byte, verify history and document references,
  reimport with fresh IDs, inspect related files, and add a new binary attachment.
- Desktop 1280px and mobile 390px: scroll width equals viewport width; full page
  inspected through footer. StrictMode attachment effects were corrected and checked.

MongoDB's 16 MiB BSON document ceiling, deployment transport ceilings, S3 protocol
constraints, and browser memory remain physical limitations. The final browser ZIP
is a Blob; this is not a claim of unlimited hardware capacity or full 1Password UI
feature parity. CSV remains a lossy transfer format; use 1PUX for complete backups.

Preview and merge status are recorded on the PR. This is not deployed to production.

The latest develop integration preserved the Gmail changes and resolved only
additive checklist/changelog conflicts. Graphify's structural graph is refreshed.
The semantic refresh expanded to 125 chunks across the large existing corpus and
was stopped after partial progress; documentation semantic freshness is unverified.
