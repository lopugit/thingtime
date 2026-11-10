# Exact-head deployed preview — 9 November 2026

The GitHub preview status associates commit
`af8c52540cb3dd81d962feb7897168d6da81ae7c` with the
[Vercel preview](https://thingtime-pis7pbt63-lopugits-projects.vercel.app/draft-preview/index.html).
Its renderer is byte-identical to the locally tested bundle:
`cef2879afcf223ab766a9e486492573f7f7931f0ab53ef19c6a8f62d5762d9df`.
This identifies a tested checkpoint; later source changes need their own proof.

An isolated Chromium with its normal sandbox exercised the actual Render draft
and Download JSON controls. The [receipt](verification.json) records exact
viewport/card bounds, all document/runner requests, no API requests or page
errors, invalid JSON refusal and clearing the in-memory draft on reload.

- [Canonical editable transfer JSON](thingtime-draft.json), two Things with the
  page/Component dependency and exact affirmation text and line breaks.
  SHA-256: `9707745a860b84a11abf034e85f02d9850cfa2f2abbe021683fe133b3b711af4`.
- [Desktop 1440×1000](viewport-1440x1000.png).
- [Mobile 390×844](viewport-390x844.png).
- [Narrow 320×844](viewport-320x844.png).
- [Card-only 400×560](card.png).

The screenshots were visually checked. The phone card has 24px margins, no
horizontal overflow, and remains completely inside each viewport. Invalid JSON
retains the last good preview but disables export. Reload discards the draft.
The owned browser/profile was closed and no account or public content was saved.

This proves deployed preview-browser rendering and JSON download, not hosted
MCP downloadable artifacts. Public manifests reported `api.chatgpt-mcp` 2.2.0,
`api.things` 1.58.0 and `api.actions-run` 1.45.0, but no
`chatgpt.render-export`. Anonymous MCP initialization returned HTTP 409
`ENVIRONMENT_GATEWAY_CAPABILITY`; no hosted job was submitted. Production
activation and actual agent-host artifact delivery remain separate open gates.

Required CI passed on this commit. The native CI run failed during checkout
with GitHub DNS/connectivity errors, before compilation; the preceding
implementation commit's native compilation and separate Mac development-app
acceptance passed. No manual deployment or main-branch merge was performed.
