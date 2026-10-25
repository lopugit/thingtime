# Anonymous local-first continuation — 25 October 2026

This evidence continues from `5ab9283a19feca1a8328aa066ed037435032a9e8`, integrating `develop` at `f41cf65629fe98423405de4bea4e5894f59ccb46` in the existing `codex/anonymous-local-first` branch and PR #1000. No protected-branch merge, manual deployment, or real-account mutation is claimed or authorized.

## Current verification

The local-workspace suite passes **827 tests**, with **96 opt-in browser tests skipped**; the offline-shell suite passes **4/4**. The attachment suite passes **360/360**, with **12 separate attachment prechecks**. Capability tests pass **133/133**. These focused counts overlap the larger suites and are not additive. Current lint has **0 errors and 3 baseline warnings**. TypeScript reports the same **91 diagnostics as the normalized baseline**, with **0 added and 0 removed**. See the [checks summary](checks/CHECKS.md) and retained logs.

MCP security package validation: build succeeds; tests report 42 passed, 3 skipped, 0 failed; extractor tests report 3 passed, 0 skipped, 0 failed; the current npm audit report has 0 vulnerabilities. The three skipped tests require external runtime surfaces and are not treated as passed acceptance.

An actual ephemeral Codex CLI agent connected to the configured `thingtime-drafts` host, queried capabilities, completed a valid render/export, and submitted an invalid request that was rejected without artifacts. The host-extracted JSON and PNG resources were hashed and dimensions checked. The canonical JSON hash is `a251642fe58ef5b1a2f32f8414591e02d6d52ebd2a50293f6b14c12464d4a06c`; screenshots cover 1440×1000, 390×844, 320×844, and a 400×560 card crop, with no reported overflow. This proves the CLI agent-host path only; the current desktop chat's MCP reload remains unverified. See [CLI host proof](cli-agent-host/host-proof.json), [artifact verification](cli-agent-host/verification.json), and [screenshots and extracted files](cli-agent-host/).

The CLI run did **not** prove automatic cleanup. After inspecting the exact task-owned runtime, its exact container and volume were explicitly removed and verified absent; no global prune was used. A detached guardian now verifies exact UUID ownership before cleanup, including process-group loss, and an independent container timeout bounds execution. Five focused cleanup tests pass. Actual Docker lifecycle acceptance remains blocked by the dedicated daemon’s full 20 GiB data disk; no global prune or restart was performed. See [cleanup evidence](cli-agent-host/cleanup.json); do not read its explicit cleanup record as proof that automatic cleanup succeeded.

## Native acceptance boundaries

Each scenario has its own package identity and evidence. The tar hashes below identify the exact sanitized application package used by that scenario; evidence should not be generalized across different hashes.

| Scenario | Verified scope | Application tar SHA-256 |
|---|---|---|
| [Builder](builder/verification.json) | Individually editable controls and offline reload at 1440, 390, and 320 px | `234bc39ef967bd4f6793b49581ebc69fb9e0be0119da7412c6c48a6ad6a32d26` |
| [Protected recovery](protected/verification.json) | Theme and algorithm recovery through History; private intent, selection preservation, offline reload | `f1e28eaa06be50d45e90e3243c337c2a6eccaee708089374c5fadb964cd79844` |
| [Shared Copy](shared/verification.json) | Authorized public fixture export into an anonymous device workspace; 17 MiB plus 3 exact bytes, fresh IDs, edited heading, offline reload; no source mutation or account writes | `33eecd46e01a62448d4ccc17ad1f573d5e6f2d83a9101520ab74948860762084` |
| [Renderer/import](render/verification.json) | Native render at desktop/mobile widths; normal importer round-trip and clean-browser no-API checks | `234bc39ef967bd4f6793b49581ebc69fb9e0be0119da7412c6c48a6ad6a32d26` |

The Builder and renderer rows share the same tar hash because they used the same sanitized package; protected recovery and Shared Copy used different package hashes. Each scenario retains boundary, network, resource, and cleanup evidence where applicable. These Linux isolated fixtures are not evidence about the installed macOS app or real provider/device sessions.

## Known failures and remaining work

The normal instructions Settings flow passes with a 119,104-byte Unicode paragraph: exact cold offline retention, unchanged account content, zero repeated requests over 65,008 ms, and successful account synchronization after shortening. See the [behavioral proof](instructions-paragraph-behavior-pass-clipped-guidance/verification.json). Its 390 px guidance screenshot clipped the first line under the fixed header, so it is not final visual acceptance. The revised test centers the status and checks all lines; its rerun is pending disk recovery. The earlier `networkidle` failure and unresponsive 12,000-line input case remain archived separately; the latter is an unverified performance limit. Actual guardian lifecycle acceptance is also pending disk recovery. Broader transfer/catalogue/instruction contracts, other managed adapters, and provider/device/identity-transition acceptance remain incomplete. These gaps are intentionally not relabeled as passing.

The original desktop chat has not reloaded its MCP tools; Computer Use refused that settings path, and no bypass or app restart was attempted. Real chat-host transport is distinct from the verified CLI agent-host connection. Private Character/Agent reporting is unavailable from the signed-out session; public capability discovery does not establish private workspace access, and no coordination write is claimed.

The current branch/PR, preview, and CI states are maintained separately from these local and native results. Historical evidence remains in [the 23 October report](../anonymous-local-first-2026-10-23/README.md) and keeps its own immutable package boundaries.

Graphify’s nominal incremental semantic scan treated the entire corpus as changed and was stopped during AST work. The approved local proxy was healthy. Structural generation passes with 69,599 nodes and regenerated portable outputs; the final source fingerprint is checked before push, but document/image semantic freshness is not claimed; see [the refresh record](checks/graph-refresh.json).
