# PR #997 — Encrypted web password manager

PR: https://github.com/lopugit/thingtime/pull/997  
Branch: `codex/password-manager-web` → `main`

## Scope

Deliver `/passwords` without requiring new Apple provisioning. Multiple entries
per service use protected credential Things, ordered/custom field mods, masked
values, session unlock and server-assisted recovery. Local QR decoding supports
TOTP upload/capture. Transfers support 1Password 1PUX/CSV, Chrome CSV and Apple
Passwords CSV, including multipart large backups. See the
[security and storage contract](../docs/password-manager.md).

The authenticated native catalog and optional bridge negotiation are included.
Native provider implementation, signed packaging, OS selection and ceremonies
remain in [PR #996](https://github.com/lopugit/thingtime/pull/996). Existing
Electron/iOS build and signing requirements are unchanged by this web PR.
Third-party OAuth work remains in [PR #992](https://github.com/lopugit/thingtime/pull/992).

## Verification — 2026-10-15

- This web branch: 35 focused password tests pass. Focused lint has zero errors
  and two ref-cleanup warnings. No private env files or real credentials added.
- The equivalent web implementation in #996 passed the complete Web CI build,
  typecheck ratchet, unit and HTTP API suites, plus both CodeQL analyses.
  This PR runs its own required checks before merge.
- Live disposable HTTP replica: 31 checks, including two owners, 52 entries,
  catalog/export pagination, owner isolation, retry/revision fencing, deletion
  isolation, password recovery, logout and immediate session revocation.
- Rendered browser: create/edit/reorder custom fields, mask/reveal, QR upload and
  rotating TOTP, Chrome/Apple CSV and 1PUX import. Downloaded 1PUX restores all
  four synthetic accounts. Desktop 1280px and mobile 390px have no overflow and
  clear the fixed navigation.
- HTTPS preview: synthetic login, encrypted entry read, custom-field save and
  close/reopen persistence pass. Native Swift client independently saves and
  reads encrypted passkey material through the same API.
- Controlled browser capture uses synthetic canvas video, not desktop capture:
  real QR decoding, blank-frame cleanup and cancellation/late-stream cleanup
  pass. The OS sharing chooser is not claimed as tested. Regression tests cover
  cancellation during picker/playback and capture denial.
- Vercel target-platform pruning preserves needed image wrappers/native binaries
  while removing other platforms; the equivalent full production build emitted
  142.5/178.1 MiB server/Workflow functions locally and deployed successfully.
- Existing baseline: full lint has seven import-order errors outside this work;
  raw TypeScript has 91 diagnostics versus stored 89, none in password files.
  The ratchet is not a claim of a clean raw typecheck.
- Graphify query/update hits its existing missing-semantic-node guard. The saved
  graph/manifest pair is preserved instead of committing partial output.
- GitGuardian reports on published RFC TOTP vectors and source identifiers are
  reviewed false positives. No scanning rules are disabled or widened.

Exact-head preview, merge and production verification are recorded in the PR
body and delivery response when complete. Real passwords are never used in QA.
