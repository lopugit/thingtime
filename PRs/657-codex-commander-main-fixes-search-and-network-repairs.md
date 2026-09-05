# PR #657: Commander search and network repairs

2026-09-05. User-authorized promotion to `main` from
`codex/commander-main-fixes`. Only the Commander changes from #652 and its
speed-test follow-up are promoted; unrelated `develop` commits are excluded.

## Scope

- Complete app/file/folder catalogues, no arbitrary candidate-count truncation,
  independent index maintenance, improved complete app-name word ranking, and
  the pin menu's `Open New Windows Pinned` setting shortcut.
- Proxy-safe upload byte validation, upload v2 chunks at most 2 MiB, explicit
  origin-scoped capability negotiation, and bounded serial traffic preserving
  the existing 17.6 MiB each-way sample ladder.
- Single-flight speed tests across windows, retained partial samples and
  cooldown messages, and latency refreshes that preserve throughput readings.

Implementation and earlier installed catalogue/menu evidence are recorded in
[PR #652's note](652-codex-commander-app-name-ranking-complete-search-catalogues-and-pin-toggle.md).

## Validation and rollout

- Feature branch: 203 Commander TypeScript tests and full typecheck/build
  passed; 15 targeted server/rate-limit/capability tests passed.
- Main-based branch: 68 Rust tests, 27 Swift tests, and 13 targeted server tests
  passed (the main branch has two fewer unrelated capability tests).
- Main-based Vercel server build and both built capability endpoints passed;
  both advertise `api.network-probe-upload` version `2.0.0`.
- Canonical native build, CI, production deployment, and installed full-ladder
  acceptance are being checked before final handoff. Do not treat this note as
  proof of those pending runtime checks.
- Graphify structural outputs are refreshed. Semantic extraction was attempted
  but interrupted after the local service timed out; changed documentation was
  read manually and is not claimed as fully semantically indexed.

This is a local Apple Development-signed installation, not a new notarized
public distribution release. Existing `main` archive and signing fixes remain
intact.
