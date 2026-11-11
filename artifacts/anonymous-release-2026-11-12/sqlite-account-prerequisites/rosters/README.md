# Native account roster persistence — 12 November 2026

The canonical account-switcher helpers use an explicit home-scoped persistence
repository. Hosted Mongo operation shapes remain unchanged. The native adapter
stores only canonical roster documents and session references in the selected
SQLite profile; it does not issue credentials or authorize access.

Ten focused tests pass with real files: canonical cookie/persist/reopen/delete,
competing version-guarded updates and stale deletion, expired and planted roster
pointers (including Bearer-only requests), profile and lifetime separation (including different files sharing the same home label),
queued/detached write refusal, absence of native-to-Mongo fallback, hostile input rejection, and frozen queued input.
A controlled subprocess proves the Mongo query/update shapes and absence of a
SQLite import on the normal hosted path. This is not a live Mongo DB test.

`verification.json` names exact source hashes. Full native authenticated account
switching and HTTP signup still need entitlement/readiness and the remaining
account adapters. Native TTL cleanup is also unimplemented. No account session,
existing profile or production data was used or modified by these fixtures.
