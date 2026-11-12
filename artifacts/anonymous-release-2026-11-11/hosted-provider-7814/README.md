# Hosted renderer provider verification — 11 November 2026

Built the canonical worker and native renderer from source checkpoint 7814f1c56,
then pushed its allowlisted Linux image to the authorized project's private
Vercel Container Registry. Anonymous registry access returns 401. The immutable
OCI digest is recorded in `provision-verification.json`.

The real provider VM verified the locked nonroot identity, no privileges, empty
caller state, exact renderer hash, no exposed routes, nonpersistent lifecycle
and deny-all renderer networking. A fresh snapshot has 30-day expiry; the builder
VM was deleted. No credentials or account files enter the image or VM.

The real canonical preflight then rendered the affirmation, decoded all 5 files,
verified exact text/hash, and rejected a nonexistent crop with no partial files.
Both jobs must stop/delete successfully before the helper reports success.
Artifacts in `render/` are genuine native-renderer output from that provider.
The operator helper now accepts an already authorized explicit SDK identity
through protected environment; credentials remain only in control-plane calls.
Deployed execution still uses project OIDC. The artifact saver refuses existing
directories and validates bytes before saving.

- [Canonical editable JSON](render/thingtime-draft.json)
- [Desktop 1440×1000](render/viewport-1440x1000.png)
- [Phone 390×844](render/viewport-390x844.png)
- [Narrow 320×844](render/viewport-320x844.png)
- [Card 400×560](render/card.png)
- [Artifact hashes and viewport metadata](render/verification.json)

`activation-descriptor.json` is prepared for the exact production origin. It
contains no credential and has **not** been saved to the production vault.
Production still advertises api.chatgpt-mcp 2.2.0 without render/export. A real
canonical connected-host tool call is still required after source release and
supported activation; these provider receipts do not establish that host step.

Sources: [Vercel project-scoped registry](https://vercel.com/kb/guide/docker),
[Sandbox snapshots and expiry](https://vercel.com/docs/sandbox/concepts/snapshots).
