# PR #1240 — Multi-account OAuth and editable password tools

PR: https://github.com/lopugit/thingtime/pull/1240
Branch: `codex/oauth-production-integration`
Base: `main` at `d7cca44373ac42bf014ea5949e99d67d296b54ec`

The integration applies the feature changes from PRs #992 and #996 without
importing unrelated develop history. It preserves main's password generator,
icons, passkey guide, editable drawer and explicit render-component persistence.
The original worktree started at `d4d885c`; its parent was advanced to `d7cca443`
while preserving the reviewed application files. Both main graph histories remain.

## Security and compatibility

- Each provider account has independent encrypted credentials and removal.
- Selected desktop APIs must satisfy passwords 1.3 and all six Connections 2
  contracts before credential request bodies are forwarded, in both proxy modes.
- Uncapped data writes negotiate Things 1.43 / update 1.14. Render-only writers
  retain the already-deployed 1.42 / 1.13 floors.
- Private icons use transient image slots. Authored layouts cannot persist their
  `src`/`srcSet`, and private URLs clear on suspension, editing and account changes.

## Verification on 27 October 2026

The reviewed application source passes TypeScript with zero errors, lint, focused
service/password/schema/settings/gateway suites, five client builds, both Nitro
presets, Vercel output verification, compiled manifests and synthetic HTTP OAuth
and gateway checks. The independent compatibility matrix passes 296 assertions.

Task-owned, network-isolated Chromium passes 28 password-manager milestones and
nine service-catalog groups with no page errors. This includes desktop/mobile,
Builder editing, transfers, account switching, generator/icons/passkey controls,
a synthetic QR image exceeding 14 MiB, and post-reload structured-field edits
saved and reopened through the UI before same-item 1PUX export/reimport comparison
and transfer completion. The password flow uses a synthetic in-memory API, vault
and native bridge; it proves parser/export/UI behavior, not hosted or installed
provider acceptance. Browser timeouts and nonterminal reports fail verification.
No personal browser profile or production credential is copied.

Swift core passes 17 tests with two opt-in skips, Electron bridge passes nine,
and navigation fencing passes four. Native bridge typechecks pass. Full Xcode
builds remain unverified because the local environment refuses the compiler's
nested sandbox; compile-only hosted recovery is being prepared separately.

At revision `6b672f9e24f1971913aa3163957eb2157cc49066`, hosted Web CI
(build/typecheck and API suite), both CodeQL analyses, and GitGuardian pass.
The [PR preview](https://pr-1240.previews.dev.thingtime.com) serves the expected
origin manifest with passwords 1.3 and Connections 2. Its selected shared master
API remains older, so root-data correctly refuses with
`409 ENVIRONMENT_GATEWAY_CAPABILITY`. This is not hosted account acceptance.
The receipt and GitHub deployment associate the feature revision with the preview;
the separate generic Vercel status URL points to a different deployment.

Independent review rejected the initial native CI proposal before publication:
candidate-owned code would have run with runner/root privileges before isolation.
The replacement uses independently reviewed control-plane code; candidate source
must remain data until unprivileged isolated execution. No privileged operation
from the rejected proposal ran on the user machine or a hosted runner.

## Remaining acceptance

Hosted checks and previews must match the latest pushed revision. Real provider
consent/callbacks, the additional Google secret in the encrypted production vault,
hosted ChatGPT client approval, production rollout, and signed installed-device
passkey/AutoFill/TOTP ceremonies remain distinct gates. No native installation or
real-account authentication is established by the synthetic tests.

The code-only structural refresh completed at 65,887 nodes and regenerated the
aggregated HTML view. Changed documentation was not semantically reindexed: the
supported wrapper update is code-only, and the earlier non-code attempt stopped
before semantic dispatch. All existing snapshot directories remain preserved;
the wrapper's tracked-path retention behavior is recorded as a tooling limitation.

## AutoFill connection status correction — 27 October 2026

Linking a Thingtime session no longer implies that the operating system accepted
its password suggestions. The native bridge now distinguishes a synchronized
index, a linked account awaiting synchronization, and an unverifiable legacy
result. A failed index replacement preserves the account link, clears stale
suggestions when possible, and offers a retry. Both native platforms serialize
index work and reject results after the account, origin or session changes.
The passkey guide only reports readiness after synchronization succeeds.

The additive bridge fields retain the deployed `passwordsVersion: 1.0.0`
contract. Detailed macOS helper exit codes require an explicit new-caller flag;
older callers keep their legacy exit behavior, and newer callers treat an old
helper's generic success as unverified.

Validation for this correction: 14 Electron tests, eight web projection tests,
eight Swift state-transition tests, focused lint, independent source review,
and 29 network-isolated browser milestones passed. The browser run includes
390px and 1440px screenshots for all three connection states, real editable
password components, and synthetic native/vault responses with zero page errors.
Its container was removed after the evidence was retained.

Unsigned native project generation passed from a frozen 195-file source
snapshot. The macOS Xcode build stopped before compilation when local package
resolution attempted a nested sandbox inside the enforced network-denial
sandbox. No network policy was relaxed; iOS compilation was not started after
that failure. Full native compilation and signed installed-device acceptance
remain open. The installed provider is enabled in macOS settings, but a usable
Thingtime choice in Chrome's passkey prompt has not been demonstrated. No Google
client secret or live Google/GitHub passkey was created by these checks.


## Effective preview capability discovery —2026-10-27

Read-only release checks linked the exactfb712 frontend artifact to both preview
URLs through the GitHub artifact digest, static index,119 direct assets and the
passwords lazy bundle. This did not prove backend rollout: the shared preview
master executes main0658 and publicly advertises Connections1.0, while the
frontend-local discovery claimed2.0/request2.0/filters1.1. Public Connections docs
returned409 from the follower's existing semantic gate. Passwords1.3 agreed.

This correction projects follower discovery through that same bounded authority
and shared feature/path/method gate. A whole semantic feature and its operations
are omitted if any forwarded operation is missing/incompatible; it never
advertises an older contract the local runtime refuses. Canonical alias bootstrap
avoids self-fetch recursion; standalone/dedicated/verified owner behavior remains
local. Fixed503/no-store failures expose no raw error or deployment configuration.
The gateway feature deliberately advances to1.2; backend routing, minimum owner
protocol and operation refusal remain unchanged. This source correction has not
been deployed or accepted against a real account. Connections2 gateway rollout,
native builds/provider/credential behavior and overall feature acceptance remain
open; the capability repair cannot implement a missing backend.

Focused source verification:64 environment-gateway/handler checks (including
nine new effective-discovery cases) and122 API registry/client capability checks
passed with no skipped cases. Targeted lint passed with two pre-existing
`apiDocs.ts` literal-concatenation warnings; no new lint errors. Tests use in-process
public Nitro requests and synthetic authority responses, without authentication,
production requests or a database. No graph refresh, staging or publication is
part of this review freeze.

## Restore shared-test platform guards — 27 October 2026

The frozen native source at `fd43daf` passed an actual unsigned macOS
host/provider build through the reviewed snapshot-only static-target adapter.
The iOS build first exposed the standard `@TaskLocal` compiler macro's nested
sandbox limitation. One reviewed retry omitted only the compiler's additional
inner macro sandbox while retaining the enforced outer network denial. It
reached all seven target compile paths, then failed in the shared ignore-rule
test's unguarded `Foundation.Process` use. No full iOS success, signing,
installation, app launch or provider ceremony is implied by those observations.

Port only the existing seven-line correction from retained password-manager
source `faf13e6`: compile the Git helper and oracle body on macOS and explicitly
skip that one unsupported live oracle on iOS. All three portable test methods
remain byte-identical.

The fresh `fd43daf` plus exact native patch snapshot includes the tracked shared
Git fixture from the same base. The actual macOS XCTest suite passed 4/4,
including the live Git oracle and fixture case (36.653 seconds command elapsed;
4.597 seconds reported XCTest duration). The once-only unsigned iOS
`build-for-testing` passed the previous `Process` failure but exited 65 after
67.376 seconds while linking `ThingtimeTests` for arm64/x86_64. Its unresolved
AppleFileSync symbols include `MobileFolderBulkReader.read`/`Payload`/`validate`
and `MobileFolderBatchValidator.check`/`validate`. That failed run is retained separately; it did not establish full iOS
compilation success.

Both checks retained the enforced outer deny-network sandbox and private
outputs; direct IPv4/IPv6 controls passed before and after. Owned process groups
were reaped and listeners closed. The iOS compiler used the reviewed
`OTHER_SWIFT_FLAGS=$(inherited) -disable-sandbox` setting for shipped standard
macros, omitting only their extra inner sandbox. That run performed no signing, installation, simulator/app launch or provider
ceremony. Its local receipt is `/tmp/oauth-native-ios-guard-validation.json`;
logs and xcresult are retained under the receipt's private task root.

Read-only link diagnosis found the test target directly compiled AppleFileSync
shared tests but declared only its host dependency. The built archive contained
all five missing symbol definitions for both architectures, while the test
link command omitted it. Add the canonical `package: AppleFileSync` dependency
to `ThingtimeTests` in `iOS/project.yml`; the unchanged adapter maps that explicit
edge to its static library. All four old/new baseline/adapted graph comparisons
permit only this added test dependency and framework-link entry, preserving
sources, settings, schemes, resources and entitlements.

One approved fresh unsigned iOS `build-for-testing` then passed all seven
targets with `** TEST BUILD SUCCEEDED **` (79.610 seconds command elapsed).
Readback found arm64/x86_64 host, provider, widget, Watch-target and XCTest
binaries, both library archives and the generated xctestrun. The 196-file
snapshot binds `fd43daf` plus the exact eight-insertion native diff and shared
Git fixture. All source/graph pins, direct IPv4/IPv6 controls, owned-group reap
and listener cleanup passed. The same private environment, outer network denial,
reviewed standard-macro setting and signing-disabled flags were retained.
No Mac build/test rerun, test/simulator/app launch, signing or installation took
place. Receipt: `/tmp/oauth-native-ios-link-validation.json`; log and xcresult
remain in its separate private task root. Canonical Xcode package integration,
OS/provider behavior and signed installed-device acceptance remain unverified.

Current Passwords SwiftPM closure was independently checked against `fd43daf`:
nine selected connection-status/logout tests passed, with zero skips or
failures (26.179 seconds command elapsed). All 14 package files matched the
checkout and immutable snapshot before and after; IPv4/IPv6 controls and owned
cleanup passed. This verifies selected synthetic package behavior, without OS
identity-store, live session, signing or installed-provider acceptance. The
parent-reviewed receipt is `/tmp/oauth-native-passwords-nine-current.json`.
