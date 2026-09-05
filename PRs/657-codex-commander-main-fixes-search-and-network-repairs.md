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
- The main-based canonical `--prepare` build passed full Commander typechecks,
  all 203 TypeScript tests, Rust checks, all 27 Swift tests, and release builds.
  GitHub Web CI build and API suites passed on the initial source commit.
- Production deployment and installed full-ladder acceptance are checked after
  the authorized merge; final runtime evidence is recorded on the PR. This note
  alone does not claim those pending checks have passed.
- Graphify structural outputs are refreshed. Semantic extraction was attempted
  but interrupted after the local service timed out; changed documentation was
  read manually and is not claimed as fully semantically indexed.

Final signing follows the installed copy's identity. A pre-install check found
the newer installed Commander uses Developer ID signing, and the matching local
identity and notarization profile are available. The rebuilt copy will preserve
that designated requirement; final signing and installation evidence is recorded
on the PR. Existing `main` archive and signing fixes remain intact.
