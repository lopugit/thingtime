# Matching hosted renderer preflight — 10 November 2026

The live provider preflight passed for published source `4492bc7eaf8fdf577c88af513c03a98ccca984ae`
and native renderer `021173e86f867265b34e6b555392b7c66b142e630883c0739b9abf0aa5eea2e4`.
This is provider execution evidence, not a call through the connected chat host
or production activation. [Safe receipt](verification.json).

The positive job returned these actual files from Thingtime's renderer:

- [Canonical editable JSON](thingtime-draft.json), with the root and Component dependency.
- [Desktop 1440×1000](viewport-1440x1000.png).
- [Mobile 390×844](viewport-390x844.png).
- [Narrow 320×844](viewport-320x844.png).
- [Card only 400×560](card.png).

The receipt records every byte count, PNG dimension and SHA-256. The JSON hash
is `9707745a860b84a11abf034e85f02d9850cfa2f2abbe021683fe133b3b711af4`;
the exact wording and line breaks match the acceptance fixture. The card and
320px view were independently visually inspected. An invalid crop returned no
artifacts. The bootstrap and both render VMs were independently confirmed deleted
before accepting results. Non-root identity, dropped capabilities, the Chromium
sandbox and the isolated execution policy passed verification.

The new private snapshot has 30-day retention, expiring 9 December 2026 at
17:01:41 UTC. Only its accepted image/snapshot remain; superseded task resources
were retired. The activation descriptor remains private outside the repository.
No production vault configuration, deployment, account content or stable app was
changed. Activation still requires the task's separate release approval.

For actual agent usage, follow the [canonical Thingtime MCP connection and tool
examples](../../../docs/no-login-draft-preview.md). The tool
accepts JSON content, a bundle-local root reference, viewports and crop options.
Its embedded JSON/PNG resources require the host's resource-to-download support;
an HTTP endpoint or this provider receipt alone does not prove that connection.
Do not register a second feature-specific MCP.
