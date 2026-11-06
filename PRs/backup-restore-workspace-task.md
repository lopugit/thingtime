# Backup workspace implementation state

Starting branch: `codex/backup-restore-workspace`, base
`65d3b7e8e87e6fbb544f0935d6a45328af554dc7`.

The intended product flow is independent snapshot capture, paged review and
explicit destination-bound restore with durable progress after the page closes.
The selected production origin is Vercel. Existing Vercel Workflow continuation
is the supported durable scheduler; an additional privileged forever-running
supervisor is not selected. Browser requests must only admit/control work.

Current engines are trusted long-running Node 24 workers using private SQLite
scratch. Full inventory/preflight/capture/seal cannot be placed wholesale inside
one serverless request. The first implementation prerequisite is independent
destination registration, followed by bounded capture with a durable private
checkpoint. Checkpoints are scheduler-owned state,
never HTTP input or archived authority. Independent destination provisioning,
bounded seal verification and certified writer intents remain separate gates.

Independent destination registration now uses the existing encrypted admin
integration vault's fixed `portable-backup-destinations` label. The AWS OIDC
adapter refuses primary attachment bucket reuse. The read-only destination API
publishes configuration readiness only, never execution/provider proof. Live
separate-bucket/role provisioning and vault registration remain unverified.
No source credentials will be copied into job Things. UI readiness must
accurately expose unavailable storage/worker paths.

All acceptance fixtures must use a separate database/account/backend/browser and
synthetic file bytes. Whole-account readiness remains false.

Destination milestone verification: focused tests 7/7, capability tests 152/152,
raw TypeScript clean, compiled Nitro manifests/docs plus anonymous 401 passed.
The source branch was updated to `origin/main` at `520fb4ec7` before publication.
A scoped semantic Graphify attempt through the local proxy exceeded its bounded
75-second observer before completion; the prior snapshot was preserved. The
structural/code refresh remains usable; changed Markdown semantic coverage is
not claimed.
