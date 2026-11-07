# Search, post privacy and audio integration — 27 October 2026

This checkpoint combines the normal account Search cached-result status, offline
post editing/privacy acceptance and the scoped V2 audio cache repair. It continues
PR 1000 on `codex/anonymous-local-first`; it does not complete the wider matrix.

## Local verification

- [Search](../anonymous-account-search-discovery-2026-10-27/README.md): normal People, Subspaces and private Things retain explicit partial/previous-query provenance after cold offline reload; logout isolation, 1440/390/320px scrolling and 6.517:1 status contrast pass. Five relevant client modules match that run's archive. The later test-only `replaceAll` compatibility correction has exact executed/current-source provenance.
- [Post privacy](../anonymous-account-post-privacy-2026-10-27/README.md): normal offline Public-to-Private selection and body save, cold reload, exact canonical reconnect and separate reader/guest refusal pass at all three widths. Eleven relevant client modules match its earlier archive.
- [Audio](../anonymous-audio-cache-2026-10-27/README.md): attempt 11 passes against the reviewed package: canonical validate/original-byte contract, track/account late-save fences, retired native media state, exact WAV decode/play, anonymous public save, cold offline reload, account cache return/removal and full scrolling at 1440/390/320px. All 401 loaded JS/CSS responses match archived bytes; network isolation, sandbox and cleanup pass. The first four attempts used the wrong archive and establish no acceptance. The Chromium mechanism check distinguishes historical currentSrc from actual paused/no-source/no-data state.
- `attachments.log`: 12 and 369 tests pass in the existing attachment suite, with zero failures/skips. Focused audio tests are recorded separately and overlap must not be counted as a unique combined test total. Search's two focused provenance tests pass in its artifact directory.
- `search-privacy-lint.log`: scoped lint passes. Audio keeps its own final lint record.
- `typecheck-comparison.json`: 91 unchanged normalized baseline diagnostics, none added/removed. Exit code 2; this is not a clean typecheck. Later audio-fixture guards have their own lint/native provenance.
- `reviewed-build-result.json` and `reviewed-build.log`: client, template sync and Node server build passed with an allowlisted environment, empty npm user/global configs and safe dotenv restoration. `reviewed-build-source.json` records source hashes at build time; the native test fixture is versioned separately. `reviewed-package.json` identifies archive `aea7f888d84c7976add09f1d1c5dff646677f086ff2d499ac39e3b466f7a4217`.

Log copies in this directory normalize ANSI escapes/trailing whitespace; source,
PNG, JSON and executed bundle bytes retain their recorded hashes. Private
Character/Agent Overview access was unavailable; these are parent-reported local
records, not authenticated private-workspace updates.

## Published checkpoint boundaries

The `prior-head-*` files refer only to pushed `50cb1f957dd907a14ad02346c06f3b004ffa4ccd`.
Web CI and CodeQL passed. Immutable and alias preview HTTP checks returned the app
shell, matching boot/main assets and origin-scoped capability manifests. Source
association comes from GitHub deployment metadata; no in-page SHA marker exists.
Those checks do not establish this later source's CI or deployed functionality.

The original no-login workflow's actual [desktop MCP JSON and native PNG proof](../anonymous-local-first-2026-10-26-desktop-mcp/README.md)
retains its own package boundary and was not rerun for these unrelated audio and
Search edits. Installed macOS/device/provider and wider account/Character/origin/
plane acceptance remain open. No merge, manual deployment, existing-account
mutation, shared proxy/key/service or VM configuration change was made.

## Progress plan

`plan/verification.json` passes filters, search, empty results and full top-to-bottom
scrolling at 1440/390/320px with no document overflow. It verifies 89 rows: 65
completed checkpoints, 20 partial rows and four planned items. The root inspected
the 320px plan, audio and Search notice captures. `plan/cleanup.json` confirms no
owned runtime remains. `run-plan.cjs` preserves the isolated static-page runner;
it does not follow external or artifact links.

Graphify refresh is structural only; new document/image semantic indexing is not
claimed. The graph/source fingerprint and local HTML output are checked before
push. Current fixture changes after native execution are documented alongside
exact executed sources, not silently substituted into historical proof.
