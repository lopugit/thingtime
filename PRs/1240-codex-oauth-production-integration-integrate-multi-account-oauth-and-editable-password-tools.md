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
and navigation fencing passes four. Native bridge typechecks pass. Initial full Xcode
attempts stopped at the compiler's nested sandbox. Later canonical Mac/iOS
package-integration and staged-signing results are recorded below; installed
provider acceptance remains separate.

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
that failure. At that initial checkpoint, full native compilation and signed installed-device
acceptance remained open; later canonical/staged results are recorded below. The installed provider is enabled in macOS settings, but a usable
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
remain in its separate private task root. At that adapter checkpoint canonical Xcode package integration remained
unverified; the later canonical results below supersede that compilation gap.
OS/provider behavior and signed installed-device acceptance remain separate.

Current Passwords SwiftPM closure was independently checked against `fd43daf`:
nine selected connection-status/logout tests passed, with zero skips or
failures (26.179 seconds command elapsed). All 14 package files matched the
checkout and immutable snapshot before and after; IPv4/IPv6 controls and owned
cleanup passed. This verifies selected synthetic package behavior, without OS
identity-store, live session, signing or installed-provider acceptance. The
parent-reviewed receipt is `/tmp/oauth-native-passwords-nine-current.json`.

## Canonical native integration and split release preparation — 27 October 2026

The parent independently reviewed canonical Mac and iOS local-package builds at
`00383d797eac1ff2f5346ad0f1a9485403697bf8`. Mac XcodeGen and the actual Xcode
host/provider build passed in 39.673 seconds using the invocation-local shipped
manifest-sandbox override under unchanged outer network denial; its source
closure (25 files), 19 structural graph entries, direct IPv4/IPv6 controls and
owned cleanup passed. The earlier missing-username XcodeGen failure remains
retained separately; supplying explicit nonsecret USER/LOGNAME fixed that
harness prerequisite. Canonical iOS integration was parent-verified separately:
196 files, 12 artifacts and 78.733 seconds. Neither result proves signing,
installation, Keychain/OS-provider behavior or real-account ceremonies.

The opt-in release split preserves the legacy build path. Preparation uses a
fresh private environment and canonical production team/group settings with
signing disabled, retaining real local-package edges. It materializes canonical
entitlements and embeds matching public manual profiles without changing
compiled Info.plists. The reviewed manifest digest binds fixed artifacts,
profile/entitlement/source/tool bytes. A separate signer performs no package or
candidate execution: it revalidates inputs and valid identity metadata, signs
and verifies the extension before the enclosing host, requires secure timestamps
and hardened runtime, and reuses final canonical verification. Verifier options
now accept an explicit sanitized environment and fixed bundle IDs; default
callers keep existing behavior. No key is exported and actual Keychain prompts
remain intact. At that review freeze the main app and standalone installed companion were
unchanged; the later parent-performed standalone installation is recorded below.

Focused safe verification passed 34/34 tests with zero skips/failures, all four
changed/new JavaScript entrypoint syntax checks and `git diff --check`. Regressions
cover profile/certificate/team/expiry/group refusal,
compiled identity/substitution checks, artifact/profile/entitlement mutation,
symlink/hardlink/traversal/new-file refusal, trusted-tool and reviewed-digest
binding, explicit private build settings, extension-first failure handling and
post-sign payload checks. These are synthetic filesystem/mocked-command tests;
at the first review freeze this tooling revision had not yet run preparation or
actual signing. The later parent-reported staged result is recorded below. Exact
commands and fork-safe placeholders are in README. Signed bundle preparation,
backup/designated-requirement comparison, installed verification and real OS
provider acceptance remain distinct next steps. PR1216's occupied main session
must not be replaced or restarted by this companion work.

Independent release review reproduced an unchecked inter-sign window with a
synthetic writer: host bytes changed during extension signing could reach the
host signer. The release now rechecks each expected executable digest immediately
before its system codesign call and includes that exact regression. Claims are
limited to this pre-sign binding plus trusted system codesign; only non-executable
payload is compared byte-for-byte afterward. Normalized post-sign Mach-O payload
equality and isolation from arbitrary same-account concurrent writers are not
provided. Fresh private staging limits access by other accounts, not by the same
UID. No actual preparation or signing was needed for this review/regression.

A second independent review found that normal parent SIGINT/SIGTERM could bypass
cleanup of detached build groups. Preparation now installs scoped cancellation
handlers, forwards TERM to the owned active group, escalates to KILL after five
seconds and reaps before closing listeners/logs and recording failure. Handlers
are removed on every normal/error exit and no signing manifest survives observed
cancellation. Two harmless synthetic supervisor/child tests exercise actual
SIGINT/SIGTERM and an owned child that ignores TERM; no Xcode/signing runs in
these tests. SIGKILL/host loss cannot run JavaScript cleanup and is not claimed.

## Verified signed installed companion — 27 October 2026

The parent executed and independently verified preparation of the exact
`00383d797eac1ff2f5346ad0f1a9485403697bf8` native source with the reviewed split:
23 source hashes, nine prepared artifact hashes, four trusted-tool hashes,
compiled production team/shared-group settings, all six direct IPv4/IPv6
positive/denial controls, actual canonical `BUILD SUCCEEDED`, owned group reap
and listener cleanup passed. Preparation manifest SHA256:
`49aa807d3887dac10857bf6c0a8bfbe35c45f14c8106e73e7ea5b48559ead891`.
Receipt: `/tmp/oauth-password-provider-prepared-verification.json`.

Two full canonical preparations and trusted Developer ID signing runs then
passed with secure timestamps and strict host/provider verification. Their
new designated requirements are identical across the two rebuilds. The new
Developer-ID-only text differs from the previously installed companion's
App-Store-or-Developer-ID disjunction; both new bundles satisfy the corresponding
old requirements through `codesign -R`. This proves checked compatibility and
rebuild stability, not identical old/new text or a protected provider ceremony.
Receipts: `/tmp/oauth-password-provider-signed-verification.json` and
`/tmp/oauth-password-provider-rebuild-stability.json`.

The parent installed the verified v2 bundle from
`/private/tmp/thingtime-passwords-00383-release-signed-v2/stage/Thingtime Passwords.app`
into `/Users/lopu/Applications/Thingtime Passwords.app` using a fresh verified
stage and `ditto`, retaining a verified rollback bundle. Host/provider strict
signatures and the installed executable passed. The exact running installed
executable was confirmed, and the new companion opened its Passwords screen
with “Sign in to unlock your password manager.” This proves installed launch,
not an authenticated account connection. The idle previous installed process
was stopped normally with targeted TERM after Quit had no effect; the Debug
companion and occupied main app/session were preserved. Installation and rollback
paths are recorded in `/tmp/oauth-password-provider-installation.json`.

The installed companion's Open Password AutoFill settings action opened the
correct macOS panel. Thingtime Passwords was listed and already enabled for
passkeys/passwords/codes; no permission toggle changed. A read-only
`pluginkit -m -v -i com.thingtime.passwords.provider` check returned exactly one
selected (`+`) extension at the newly installed companion's
`Contents/PlugIns/ThingtimePasswordProvider.appex` path, rather than the Debug
copy. Settings screenshot: `/tmp/oauth-autofill-enabled-20261027.png`.
These are observed settings/registration and installed-host-launch results.
No real credential retrieval, authenticated provider fill, passkey ceremony or
account connection was demonstrated. The packaged Electron bridge still uses
its separately installed nested helper; replacing the standalone companion did
not replace or establish acceptance of the occupied main app's bridge.

The temporary preparation, signing, and rebuild-stability receipts have expired
and are unavailable for a fresh audit. The durable current-install receipt at
`/Users/lopu/.codex-2/visualizations/2026/10/13/01a1349c-0b75-7d83-87f6-14b3d130a53c/evidence/native-installed-current.json`
confirms current installed signatures, executable hashes, install path, and
selected plugin only; it does not re-establish the earlier build history or a
real provider/passkey ceremony.
