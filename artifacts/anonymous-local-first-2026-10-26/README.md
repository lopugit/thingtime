# 26 October — unified Thingtime MCP and native acceptance

The installed connection is now **`thingtime`**, using the existing normal MCP entry point with all nine tools. Rendering delegates lazily to the existing isolated worker; it never receives account credentials, import roots or staged chat data. The duplicate `thingtime-drafts` configuration entry was removed after successful unified CLI-host verification. Desktop discovery of the new namespace still needs its own host reload; no settings restriction was bypassed.

## Downloadable native artifacts

- [Canonical portable JSON](unified-cli-host/thingtime-draft.json)
- [Desktop 1440×1000](unified-cli-host/viewport-1440x1000.png)
- [Mobile 390×844](unified-cli-host/viewport-390x844.png)
- [Narrow 320×844](unified-cli-host/viewport-320x844.png)
- [Card crop 400×560](unified-cli-host/card.png)
- [Actual unified agent-host proof](unified-cli-host/host-proof.json) and [artifact integrity](unified-cli-host/verification.json)

Canonical SHA-256: `a251642fe58ef5b1a2f32f8414591e02d6d52ebd2a50293f6b14c12464d4a06c`.
These are exact MCP-returned resource bytes, not a separate mockup or reconstructed image.

[Progress plan browser checks](plan/verification.json) cover all status filters, case-insensitive and empty search, full scroll, desktop/390/320px bounds and scoped cleanup.

## Verification boundaries

- The current desktop chat called the prior render-only connection successfully: [desktop proof](desktop-host/host-proof.json). The new unified connection passed through an actual ephemeral Codex CLI agent using the installed configuration; [native SDK checks](unified-sdk/verification.json) separately cover negative cases and concurrency.
- [Docker lifecycle](renderer-lifecycle/verification.json) now passes. The daemon had free space when checked; this task did not resize, restart or prune shared resources. Earlier cleanup failures remain historical evidence.
- [Normal account instructions](instructions/verification.json) pass in a disposable, network-isolated app/backend. Exact 119,104-byte Unicode paragraph survives offline reload; no repeated request occurs across a measured 64,882 ms window; shortening resumes account sync. All nine guidance hit-points are unobscured at each of 1440, 390 and 320px. [390px screenshot](instructions/instructions-capacity-guidance-390.png), [320px screenshot](instructions/instructions-capacity-guidance-320.png). Package SHA-256: `528e03644a730a137c9563d62b2665934370182b4c0ac9a50f526096bbcbc05a`. This closes the prior clipped guidance capture, not the 12,000-hard-line performance case or larger remote transport.
- [Focused and full-unit boundaries](checks/CHECKS.md). Earlier normal-importer remapping and individually editable Builder evidence remain in the [25 October package](../anonymous-local-first-2026-10-25/README.md).
- No localhost/Funnel endpoint was exposed: browser and backend ran inside a network-none task container. No merge, manual deployment, public publishing or existing-account mutation occurred. Private Character/overview reporting still lacks an authenticated session; no coordination write is claimed.
- The broader coverage matrix remains open in the [progress plan](../../docs/progress/anonymous-local-first.html). Local, agent-host, CI, preview identity and deployed functional acceptance are separate.
