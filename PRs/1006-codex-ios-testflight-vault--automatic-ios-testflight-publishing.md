# PR #1006 — Automatic iOS TestFlight publishing with admin vault credentials

PR: https://github.com/lopugit/thingtime/pull/1006
Branch: `codex/ios-testflight-vault`

The widget source reached main in PR #780, but the last verified TestFlight build
predated it. Native main pushes now trigger the existing iOS workflow; web-only
changes do not. Main-only admission, serialized build allocation, unsigned native
tests, matching phone/Watch/widget versions, signed App Group checks, and exact
App Store Connect tester status precede a successful release result.

Fastlane builds, verifies and uploads in one process so the provisioning profile
names selected during signing remain available to the export/upload path.

Apple release credentials can move from GitHub into the existing encrypted admin
integration secret store. Explicit create-only migration is distinct from fetching.
Production-only GitHub OIDC verifies immutable repository and owner IDs, exact
main workflow/source/event, issuer/audience/freshness, subject and one-use identity.
A current vault policy is rechecked before disclosure. Normal lists, verified
reveals, existing AI credentials and all unrelated secrets retain their boundaries.

## Validation — 2026-10-17

- Nine release identity/route/cryptographic tests and three client transport,
  origin, masking and migration tests pass. Existing capability, integration,
  credential and fallback suites pass, including a real catch-all fallback refusal.
- Four package regressions and two Ruby build-number tests pass.
- `actionlint`, Bash/YAML parsing, Ruby/Node/Python syntax and targeted ESLint pass.
- Nitro server build passes. The compiled handler serves both manifests and real
  endpoint docs, and denies preview release delivery with private/no-store headers.
- XcodeGen + unsigned iOS Simulator build passed on local Xcode 27 beta. Inspected
  the compiled phone, embedded Watch and WidgetKit extension plists: matching build
  numbers and the WidgetKit extension point. This does not establish signed
  archive, GitHub Xcode 26.2, physical-device or TestFlight acceptance.
- Raw TypeScript reports the same 91 diagnostics on the base commit and this
  branch with identical installed dependencies; no new diagnostics or baseline
  increase. This is not a clean full-project typecheck.
- Semantic graph extraction hit its existing shrink guard for iOS/README.md;
  structural refresh is used instead. Updated documentation semantic indexing
  remains incomplete.

## Required rollout

The user approved PR #1006 for main on 2026-10-17. The PR was retargeted to main
and reconciled with the newer settings/model changes. Production rollout is pending:
deploy the endpoint/workflow, create the non-secret release policy in Admin System,
run the one-time migration, select vault mode, and verify a signed upload and
internal tester availability. Confirm widget placement on an actual iPhone.

The existing GitHub Apple secrets remain available for deliberate rollback until
vault-backed acceptance passes. A failed vault fetch never silently uses them.
See [the full setup and recovery runbook](../docs/ios-automatic-testflight.md).
