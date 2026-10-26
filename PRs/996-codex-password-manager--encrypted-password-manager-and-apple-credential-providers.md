# PR #996 — Encrypted password manager and Apple credential providers

PR: https://github.com/lopugit/thingtime/pull/996
Branch: `codex/password-manager` (base `develop`)

## Environment gateway and index lifecycle — 26 October 2026

This branch now integrates the environment-scoped API gateway and coordinated
index lifecycle. Configured followers negotiate the stable gateway and each
operation before forwarding HTTP work, without opening MongoDB themselves.
Signed one-hop relays retain normal user authentication, origin/CSRF checks,
cookies, streaming and selected data-plane authority. Alias promotion and
rollback drain admitted background/request work before closing old pools.
Durable index readiness and fenced leases bound DDL work and preserve the
read/authentication and authenticated admin repair paths after a failed plan.
The existing password contract remains `api.passwords` 1.2.1; compatible newer
minor versions are accepted, older/missing/breaking contracts fail closed.

Validation: 278 focused regressions and all 26 TS/TSX lint targets passed.
The sanitized built server passed a real synthetic macOS OS-sandboxed gateway
runner covering registration, cookie writes, cross-site refusal, promotion,
rollback and zero follower MongoDB dials. Independent review found no actionable
findings. TypeScript retains 96 pre-existing diagnostics, with none added or on
modified lines; the current ESLint parser does not support the `.mts` targets.
No existing test suite was rerun solely for publication. These checks establish
local built transport behavior; shared-environment rollout, real sessions and
installed native/provider acceptance remain separate open gates. No production
configuration or credentials were changed by this source publication.

## Structured imported-field editing — 26 October 2026

Imported addresses, SSH keys and other supported structured fields previously
required editing a whole JSON string. Reusable field templates now expose
individual string, number and boolean leaves, including nested arrays and unknown
members. Nulls and empty containers retain explicit type labels and a JSON mode
for structural changes. Unsupported or unsafe data stays in the masked JSON
editor. Existing customized layouts receive the additional editable templates
without replacing their original controls or restoring deliberately deleted ones.

Private property labels and values remain in the transient editor adapter and
live DOM. Saved Builder documents and display scope carry only opaque field/path
identifiers and control metadata. Focus loss, account changes and unmount clear
the private presentation. Property generation checks reject old position bindings
after the JSON shape changes, and patching cannot traverse prototype properties.
Numeric preservation checks protect untouched JSON siblings from rounding or
overflow during a leaf edit. Duplicate keys, including escaped equivalent names,
also retain their raw representation rather than collapsing during editing.

The isolated browser test caught a renderer allowlist omission that stripped
private labels. An independent review also caught potential numeric sibling
corruption. Both fixes passed focused regressions and a second independent review.
The final run passed all 19 browser groups with zero page errors, covering the
real editor and Builder at 1440px and 390px with synthetic vault/clipboard/native
adapters. It verifies separate property editing, invalid numeric input blocking
Save, same-type array and object-key stale-binding rejection, masking and label
clearing, save/reopen, and correct targets after nested Builder edits and reload.
Screenshots were visually reviewed. Browser and backend shared a network-none
container with no mounts or exposed ports, a read-only root, dropped capabilities
and the Chromium sandbox enabled. Direct-IP and redirect probes were refused.

All 94 JavaScript password-suite tests passed under network denial. The separate
43-test focused renderer/settings/structured-field suite passed too (these suites
overlap). Targeted lint and syntax checks passed; two pre-existing `resetCopy`
dependency warnings remain. The unchanged native gate was not rerun for these web
editor changes. Installed/deployed private-data acceptance, live OAuth and OS
passkey ceremonies remain open.

## Develop preview publication recovery — 26 October 2026

The trusted preview publisher refused publication because its required scoped
bootstrap was absent. An authorized Vercel API update created one encrypted
`THINGTIME_GATEWAY_SECRET` scoped only to custom develop. Metadata for all 74
existing environment-variable records remained unchanged. Production settings
and aliases were unchanged; no shared develop gateway rollout was performed.
No secret values were retained in this report, and no Google secret or passkey
was created.

The failed protected publishers were retried after that scoped repair. Exact-head
[PR #996 preview](https://pr-996.previews.dev.thingtime.com) and
[PR #992 preview](https://pr-992.previews.dev.thingtime.com) then published
successfully at PR #996 source `00b073515ac906fc97a819bd259c293a4c15cbff`
and PR #992 source `21a2f8c2803c316e1e87383a4c1c7dc8a124fb9f`.
Live page, root-data and capability-manifest requests returned HTTP 200,
root-data identified those source SHAs, and manifest origins matched their
preview URLs. This later documentation revision was not part of those builds. The previews advertised `api.passwords` 1.2.1 and
`api.connections` 2.0.0 respectively. This verifies preview publication and public
compatibility discovery; it does not establish real-account OAuth, installed
native fill/passkey acceptance or gateway isolation for pre-gateway source.

## Structural Builder acceptance — 26 October 2026

The isolated password browser harness now uses the actual Builder inspector and
context menu to style/reorder a repeated field caption, duplicate it, and delete
only the duplicate. Save/reload preserves the authored style/order; original
username input, Copy and Save still target the right field, other field values
remain unchanged, and saved layouts exclude private values. Desktop/mobile
checks scroll the document and verify the focused inspector input is visible,
unobscured and visibly indicated. Saved-layout and inspector screenshots were
visually reviewed.

All 15 browser groups passed with zero page errors using immutable runtime image
`sha256:51f594d897c72bdb47d90e2da9141dee5b1ccc5bc32b0b1439852d3d2a0dac4b`
and the installed Chromium seccomp profile. Docker inspection verified network
none, no host mounts/published ports, read-only root, all capabilities dropped
and no-new-privileges; the Chromium sandbox stayed enabled. Direct-IP and browser
redirect probes were blocked. The exact container was removed after execution.

An initial harness attempt clicked canvas content underneath the open inspector.
The corrected path closes that inspector through its normal control before
canvas actions; no product fix or security-policy change was needed. These are
real Builder interactions with synthetic vault/clipboard/native boundaries,
not installed/deployed or real-account acceptance.

## Automatic native interoperability gate — 26 October 2026

The public Swift WebAuthn fixture previously required a manually supplied output
path and was skipped by ordinary package tests. `test:passwords` and the native
provider build now run a macOS gate before signing: one selected Swift test
exports only public ceremony bytes, then the existing independent WebAuthn server
verifies registration, assertion, UV, synchronized backup flags and wrong-RP
rejection. No session, Keychain, device-presence prompt or live endpoint is used.
The gate denies network access to both processes and removes its private fixture
and build scratch on success or failure. SwiftPM's nested sandbox is disabled
inside that outer sandbox because macOS rejects nested `sandbox_apply`.
Unsupported operating systems explicitly skip; supported macOS failures do not.

Regression coverage exercises cleanup and failure propagation, missing fixture
output, and real-verifier rejection of altered challenge, origin, signature and
UV flags. This protocol check does not replace signed OS, vault persistence or
Google/GitHub acceptance. The JavaScript workflow remains portable to Linux;
the automatic native step runs only on macOS with Xcode.

Validation: all eight focused runner/verifier regressions passed, the new real
macOS gate passed from fresh scratch, targeted ESLint and JavaScript syntax
checks passed, and `git diff --check` was clean. The broader password suite and
app packaging were not rerun for this gate-only change.

## Release split

The web vault was merged into main at `998bdb83c` by [PR #997](https://github.com/lopugit/thingtime/pull/997). This branch incorporates that web base and retains the Apple providers, native packaging and signing setup. It is open for review. The 26 October local continuation ran Xcode checks and updated the signed macOS companion; the earlier cloud-only checkpoints remain historical evidence. Actual OS fill/passkey ceremonies remain acceptance gates. The evidence below includes the shared web prerequisite.

## Native TOTP setup intake — 26 October 2026

The installed provider was enabled for AutoFill but absent from **Set Up Codes
In**. The native hosts now declare only the implemented `otpauth` scheme and
route received TOTP setup into an owner/document-bound, memory-only inbox.
HOTP, migration and pairing payloads are rejected. Shared validation checks
query uniqueness, parameters, Base32 padding and residual bits.

The separate macOS companion hosts the existing editable password editor in a
nonpersistent WKWebView with normal sign-in; its native provider connection
supplies destination/owner metadata only. Locked metadata fails closed and input
is retained until retry/expiry. The host never imports native credentials into
that web session. No Electron changes or new server endpoints are included.

Main-frame, exact origin/path, home data-plane, server owner and cookie checks
precede explicit consumption. Captured WebKit frames plus execution-time
immutable document/editor-scope checks fence delayed callbacks. Setup remains
outside URLs, generic Action/bridge logs and persisted layouts. The notice and
create/attach/cancel controls are individual Builder blocks. Warm intake preserves
an existing draft, and only the existing revision-aware Save writes an entry.

Validation and signed installation/OS acceptance are recorded separately below;
unsigned builds and model tests alone do not establish system-menu, QR, native
login or real-provider acceptance.

Final local checkpoint: ten synthetic native XCTest cases passed under denied
network, and 76 password-suite tests passed with zero skips after the QR follow-up.
The actual injected
native JavaScript is executed in model tests for delayed navigation, changed
owner/document and persistence refusal. Both unsigned macOS companion and full
iOS Simulator builds passed. Fourteen isolated Chromium acceptance groups passed,
including setup creation/attachment/cancel/expiry, no automatic save, cold login,
unconfigured-vault recovery, independent Builder save/reload and 1440px/390px
full-page scrolling. The container had no external network, mounts or published
ports and retained Chromium's sandbox. Full typecheck still reports unrelated
existing errors; changed password/setup/bridge files had no diagnostics. Lint has
zero errors and two existing hook-dependency warnings. The canonical production
web build and Vercel output verification passed.

The canonical companion archive/export passed with the existing Developer ID
identity. Both host and extension preserved their installed designated
requirements, bundle IDs, shared Keychain groups and AutoFill entitlements;
secure timestamps and strict signatures verified. Only the companion was
installed, with a recoverable backup. Its running executable is the installed
copy. AutoFill remained enabled, and after reopening System Settings,
**Thingtime Passwords appeared in Set Up Codes In**. The existing default was
unchanged. The main Electron app was not replaced. Normal companion sign-in,
real setup-to-save, native fill/passkey ceremonies and physical iPhone acceptance
remain pending; the companion currently shows the deployed production login UI.

## QR upload capacity and capture cleanup — 26 October 2026

Removed the remaining 12 MiB upload and 20 megapixel rejection caps. Progressive
overlapping scans reach original resolution with a bounded working canvas and
yield for cancellation between scans. Browser/device decoding capacity remains a
natural constraint. Screen capture stops after taking one immutable frame,
before scanning, and late bitmaps are closed when the editor cancels.

The real decoder and editable password UI accepted a valid 24-megapixel PNG over
14 MiB containing a small off-centre synthetic TOTP code. The fourteen browser
groups passed after this change; eight QR image unit tests verify cancellation,
bounded pixel memory, stopped capture and late-bitmap cleanup. The final review
caught an abort between promise callbacks that could orphan a bitmap or stream;
four new regressions failed before the ownership fix and passed afterward.
Real OS chooser
acceptance remains pending: the browser tool rejected opening the local synthetic
fixture and explicitly prohibited indirect/alternate-surface workarounds.

The final documentation semantic refresh encountered repeated hollow responses
from the configured local LLM proxy and was stopped without publishing partial
semantic state. The structural snapshot/report/HTML refresh is retained as the
fallback; documentation semantic freshness is not claimed.

## Password Copy controls — 26 October 2026

Added independently editable field Copy buttons and status blocks. The transient
binding carries only a field ID; values remain in the adapter closure. Concealed
passwords copy while masked, TOTP Copy returns the current code rather than its
seed/countdown, and passkey entries cannot copy signing fields. Clipboard errors
use fixed non-secret text. Entry edits, masking, entry/account/data-plane changes
and Builder mode invalidate pending work and feedback. Submitted clipboard
writes cannot be revoked; late completion cannot show stale status.

The current `npm --prefix remix run test:passwords` run passed 56 tests with zero
skips, including editable Copy bindings and passkey/TOTP display contracts.
The isolated Chromium run passed all 11 acceptance groups, including masked
copying, TOTP codes, sanitized rejection, late feedback and independent Copy-label
save/reload. Desktop (1440px) and mobile (390px) layouts were scrolled from top to
bottom and inspected. The browser and synthetic backend had no external network,
no host mounts or published ports, and retained the Chromium sandbox. The native
manager control session could not be claimed reliably, so the existing
network-none harness supplied the task-owned fallback. Real clipboard delivery,
installed/native and production acceptance of Copy remain pending. This change
is not yet deployed or installed.

## Local native verification — 25 October 2026

Rechecked cloud head `ab9d39965d8bc94a2063bfcf6ffc862a2289cb91` in an isolated
checkout. Xcode 27.0 (27A5194q) exposed a shared-test compilation failure:
`MobileFolderIgnoreRulesTests` invoked Foundation `Process`, unavailable on iOS.
Only the live Git-oracle helper/case is now macOS-gated; iOS retains the shared
fixture tests and reports an explicit skip for the unsupported live oracle.

- `swift test --package-path apple/Passwords`: seven passes, two explicit skips
  (optional HTTPS preview session and WebAuthn interoperability export).
- The four unchanged `DestinationNavigationFenceTests` pass on macOS against
  the exact production state-machine declaration compiled in a temporary Swift
  package. This is state-machine execution, not an iOS UI/Keychain ceremony.
- `swift test --package-path apple/FileSync --filter MobileFolderIgnoreRulesTests`:
  four passes, including the real Git oracle and shared corpus.
- XcodeGen regeneration followed by the full `Thingtime` scheme's iOS Simulator
  `build-for-testing` passes with signing disabled. The compiled Info.plist
  retains the explicit loopback destination. No simulator app was launched,
  no physical-device test ran, and the installed user app was not replaced.
- [CodeQL alert #140](https://github.com/lopugit/thingtime/security/code-scanning/140)
  was reviewed and dismissed as a false positive. The reported getItem/setItem
  flow copies synthetic Builder layouts; vault entries remain in a separate
  in-memory map and the harness checks exclusion of private values, source,
  history, TOTP and attachment keys/nonces. No production rule or query was
  disabled. GitHub confirmed the disposition on 25 October.

The installed Thingtime window is now available, but displays another workstream
(`codex/device-activity-library`, `4a27f52e3`). Current signed-provider, real OAuth,
actual AutoFill/passkey and screen-chooser acceptance remain open. The assigned
Chrome profile was visibly verified as the Thingtime account; tab-bound actions
timed out and native focus moved between profiles, so credential entry stopped.
The public production/preview manifests remain reachable; public discovery does
not establish authenticated Character or private task-workspace access.
Graphify semantic refresh returned empty extraction payloads and was stopped;
its prior semantic data is retained. Structural outputs are refreshed separately,
so updated documentation semantics are not claimed as re-indexed.

## Cloud reconciliation — 23 October 2026

Integrated develop `f41cf65629fe98423405de4bea4e5894f59ccb46` into the existing
PR history. Preserve its strict native capability origin/schema checks, throwing
Keychain deletion, runtime restart fencing, streamed requests and selected-API
preconditions alongside this branch's full-catalog cursor-cycle guard, iOS
provider packaging, and private password/mail capability negotiation. Both
AppleFileSync and ThingtimePasswordCore remain in the XcodeGen package map.
The iOS bridge reports a failed Keychain clear instead of claiming disconnect;
a failed clear prevents navigation to another account endpoint. Destination selection is transactional: the current authority remains selected, the drawer explains unlock/retry, and a failed target is fenced until explicit retry or a new selection. Four native XCTest scenarios were added for the fence; they have not executed on this Linux host.

Fresh cloud checks use synthetic data only. Focused Node suites ran inside an OS
loopback-only network namespace; the broader Electron run below was an earlier
Linux compatibility check:

- Password suite: 54 passed, zero skips, inside an OS loopback-only network namespace. Includes editable-layout sanitization and explicit private-display projections.
- Editable-layout/transient/settings suite: 18 passed, zero skips; changed UI lint has zero errors or warnings.
- TypeScript: 92 diagnostics, exactly matching clean develop after normalizing line numbers; no added diagnostics.
- Isolated Chromium: ten acceptance groups pass at 1440px and 390px with zero
  runtime errors. Physical typing/reveal/save, one write under rapid click/Enter,
  focus masking and live TOTP, real synthetic QR decoding, four independently
  edited/reloaded layouts, private-data exclusion, source/history reveal/hide,
  attachment removal, synthetic CSV preview/import/export and delayed read /
  capability cancellation all pass. The native bridge and screen-chooser
  cancellation are fixtures; they do not establish OS acceptance.
- Production client/server packaging and final Vercel output verification pass.
- API capability suite: 113 passed, zero skips.
- Proxy/capability files: 93 passed, zero skips, including six real Nitro HTTP
  request forwards and a delayed password-manifest/endpoint-change regression.
- Electron password and bundled-renderer tests: 15 passed, zero skips. The six
  former Darwin-only mock-helper tests now execute in an isolated VM on every
  host; the production platform gate is unchanged. This is bridge evidence,
  not macOS provider evidence.
- Full Electron suite: 322 passed, three failed, one skipped. Two unchanged
  release-cache tests require macOS `/usr/bin/ditto`; the unchanged owned-process
  cleanup test also fails alone on this Linux host. No clean full-suite pass is
  claimed. iOS release/configuration Node checks pass 12/12; four changed Swift
  files parse with the Swift tree-sitter grammar. Neither is Swift compilation
  or native execution. Swift/Xcode and signed macOS/iOS builds cannot run on this executor.

Public deployment readback on 23 October: production reports main
`83a709cfa0df49a7bbc74018f7f43f6f9066c29a`, with `api.passwords` 1.2.0.
The reachable [PR preview](https://pr-996.previews.dev.thingtime.com) advertises
1.2.1; the deployment list correlates its old head
`8ad72b435da76b9947bfcb77047e5b4f15a30715` with ready deployment
`dpl_ACpnr3wMuL4V3yqFoZxhyLB96LSH`. This does not establish deployment of the
new integration. Current Character discovery succeeds for the selected
`https://thingtime.com` origin, but private membership/authentication and task
writes have not been verified from cloud. The previous 1PUX import was not repeated.

Remaining device acceptance requires authorized access to the executing Mac and
physical iPhone, with the supported Thingtime password manager on each device:

1. Coordinate with the owner of the current installed app before replacing it.
   Build/verify the final signed host and extension, preserve the installed app
   and its data, and confirm selected origin, shared Keychain group and provider
   registration. Do not treat the historical installation below as current.
2. Select Thingtime in actual OS AutoFill settings. With disposable exact-origin
   login records, fill password and TOTP, create a passkey, reload/sign out and
   later assert that same passkey. The OS chooser and device-owner verification
   require user presence; simulator compilation does not satisfy this gate.
3. Refuse wrong origins/RPs, canceled verification, revoked sessions and stale
   account/endpoint operations. Remove one account and prove the other remains
   usable. Confirm Keychain-clear failure stays visible and recoverable after
   unlocking; a failed destination change must not misrepresent the active API.
4. Exercise the real screen-sharing chooser with a synthetic TOTP QR: accept,
   deny, cancel, close the editor, and allow a late chooser completion. Confirm
   the capture indicator/tracks stop immediately. Reject FIDO handoff images as
   TOTP/passkey-key imports. No screen or credential capture ran in cloud.

## Product and security contract

The signed-in user can own multiple independent credential Things for one
service, using ordinary editable block templates and the protected password-entry
schema. Header, list cards, fields, reveal/reorder controls, QR/native controls,
transfer dialogs, source/history and attachment panels are independently
authored blocks. Decrypted values are hydrated only into named live controls;
private values are absent from scope data, saved layouts and generic Action
history. Editing, owner/origin changes, hide and background events fence the
private controls and in-flight operations. Field definitions/values are encrypted with a per-owner data key;
password/session wrappers and the explicitly approved server recovery wrapper
preserve credentials across password recovery. See [the complete contract](../docs/password-manager.md).

The Swift provider implements password/OTP selection and ES256 passkey
registration/assertion. OS selection, secure Keychain session sharing and device
verification are required. Uploaded FIDO QR images are device-handoff requests;
they do not import private passkey keys. TOTP QR uploads and selected-screen
capture are decoded locally. Transfers support 1PUX and the three CSV dialects;
large backups split into individually restorable parts.

## Evidence — 2026-10-15

- Full unit suite passed during implementation: 4,453 tests, 9 skipped.
- Final focused password tests: 36 pass, including 2,001-account backup restore.
- Schema 265, capability 94, collections 60, Vercel 16 and desktop bridge 2 pass.
- Live HTTP-only replica fixture: 31 checks, including two owners, 52-entry
  pagination, catalog/export, deletion isolation, password recovery and logout.
- Browser: CRUD/reordered custom fields, QR upload with live TOTP, Chrome/Apple
  CSV and 1PUX imports; downloaded 1PUX restores all four synthetic entries.
- Shared Swift tests: 6 pass, including a real HTTPS preview client test that
  saves a native passkey, reads its encrypted fields back and refreshes catalog. Independent `@simplewebauthn/server` verification
  accepts native ES256 registration/assertion and rejects a wrong RP.
- Full iOS/Watch simulator and macOS provider builds pass. iOS simulator bundle
  installed on iPhone 17 Pro / iOS 26.5. Simulator Settings did not list the
  provider; physical-device signed testing is still required. See the [provider
  example device requirement](https://github.com/Dashlane/apple-credential-provider-example#requirements).
- Full web production build and emitted Vercel artifact checks pass. The native
  image package fix reduces emitted server/Workflow functions to 142.5/178.1 MiB
  on the local macOS build; Linux CI validates the deployment platform.
- Existing lint baseline: 7 import-order errors in remindersCore/kindRegistry,
  plus warnings. Typecheck ratchet reports 91 diagnostics versus stored 89;
  password additions have no new diagnostics. It is not a clean raw typecheck.
- Graphify query/update attempts hit the existing guard for five absent saved
  semantic nodes. No partial graph/manifest pair is committed.
- Web CI build/unit and HTTP API suites pass; CodeQL actions/TypeScript pass.
- GitGuardian flags Swift type declarations and public RFC TOTP test vectors.
  These are not account credentials. No deployment keys or real provider
  credentials are in this PR.

## Outstanding gates

### Current recheck — 2026-10-18

- The former Apple agreement failure did not recur. The development Mac was
  registered through Xcode's provisioning flow, and a signed development build
  succeeded. No legal agreement or privacy prompt was accepted automatically.
- Reproduced and fixed the distribution build failure caused by combining
  automatic signing with a Developer ID build identity. The canonical helper
  build now archives using Xcode development signing, then exports with the
  explicitly requested Developer ID identity. Manual host/extension profile
  overrides must be supplied together.
- Two independent Developer ID exports pass signature, timestamp, team,
  bundle-specific AutoFill profile and shared-Keychain verification. Their
  designated requirement is identical. An incorrect expected signer is rejected.
  Export verification happens before replacing the prior staged helper.
- The verified helper is installed at `~/Applications/Thingtime Passwords.app`.
  Its installed signature and executable pass; it launches, and macOS lists
  Thingtime Passwords for passkeys, passwords and codes in AutoFill settings.
  The user approved enablement, and the macOS AutoFill switch is on for
  passkeys, passwords and codes. The actual extension configuration sheet opens
  successfully. The installed multiline setup text is visually verified after
  rebuilding and relaunching; enablement survives that signed update.
  Password/code fill and passkey ceremonies remain unverified.
- Six Swift tests pass with the independent WebAuthn fixture enabled; the
  HTTPS client integration remains explicitly skipped in this fresh run.
  Independent registration/assertion verification and wrong-RP rejection pass,
  as do both desktop bridge origin/ordering tests.
- Current main is integrated, preserving native mail IPC and iOS widget signing
  alongside the password provider. The full iOS/Watch/widget/provider simulator
  build passes with the built HTTPS endpoint verified. All 109 Electron tests
  pass, including helper packaging and selected-origin isolation. The full
  desktop resources build and final signed packaging pass. The staged and
  installed app signatures verify, and its running executable is the installed
  `~/Applications/Thingtime.app` copy.
- The user explicitly approved replacing the running `codex/mobile-file-sync`
  app for acceptance. Its verified bundle was backed up before replacement;
  application data was preserved. The installed password build connected the
  provider through its supported current-session handoff.
- Installed acceptance then caught a desktop-only HTTP 500: cloning Nitro
  server requests with `new Request(event.req)` violates the native Request
  internal brand. Real Nitro GET/POST regression coverage reproduces the
  failure and passes after copying only upstream headers. Origin checks remain
  enforced; shared password/mail bridge contracts receive PATCH versions.
  The selected HTTPS server is now negotiated before private forwarding, so a
  newer bundled UI cannot silently search against an older listing contract.
  Nine proxy tests cover real Nitro requests, version rejection, wrong-origin
  manifests and no credential/body forwarding before compatibility succeeds.
  The repaired signed bundle (`1851b2e7c`) passes canonical verification and is
  installed in `~/Applications/Thingtime.app`. Installed signatures and running
  executable paths verify, the designated requirement remains stable, and real
  vault metadata now loads through the selected production server.
- Passwords was absent from sidebar and Commander navigation. Both existing
  catalogues now include the page. Installed Commander, sidebar and Security
  settings destinations pass. An isolated Chromium run verifies the Commander
  destination and the complete search regression flow at 1280px and 390px,
  including full-page scrolling, editor closure, retry and session expiry.
- The signed iOS device build also passes with the production HTTPS endpoint;
  no physical iPhone installation or OS acceptance is claimed.
- The final compiled server under Electron Node passes six real GET/POST
  bridge checks and manifest versions, inside an OS network sandbox. It rejects
  unavailable selected-server capabilities before forwarding private requests.
  All 101 focused password/capability/proxy checks pass.
- Live passkey registration on WebAuthn.io is awaiting user-controlled new
  credential creation and device verification. No private keys or real-account
  sessions were copied into test tools.

The entries below are historical evidence from October 15; their agreement and
profile failures are superseded by the current recheck above.

- Follow-up native audit fixed a macOS Keychain integration bug: all session
  operations now explicitly target the data-protection Keychain with the shared
  access group and synchronization disabled. Missing/unexpanded group settings
  fail closed. Apple's [Keychain documentation](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
  explains why the macOS legacy store cannot enforce these attributes.
  The updated Swift run has six passes and one explicit HTTPS-fixture skip;
  independent WebAuthn verification, the full macOS provider build and the full
  iOS/Watch simulator build pass. The rebuilt iOS app was installed and launched
  on iPhone 17 Pro with its built `ThingtimeWebURL` verified as
  `https://thingtime.com`. The optional fixture reports a skip when absent.
  A fresh signed build still fails with `PLA Update available` and missing host
  and extension provisioning profiles; no unsigned build replaces the installed app.

- Apple signing returned `PLA Update available`: account holder must review the
  latest Apple Developer Program License Agreement. No signed provider install,
  system-provider registration or live password/OTP/passkey ceremony claimed.
- HTTPS preview is verified at https://pr-996.previews.dev.thingtime.com
  (`196a9884f`): configured encryption, synthetic account save/read/catalog and
  Swift native passkey persistence pass. Responsive/capture fixes are deployed.
- 390px/1280px rendered QA passes after fixing fixed-nav clearance and centered
  width; controls do not overflow. A controlled browser canvas/video capture passes
  real TOTP QR decoding, blank-frame error cleanup, and cancellation/late-stream
  cleanup. The media picker is stubbed only inside the disposable QA page; this
  does not claim the OS screen-sharing permission picker was exercised. The
  blocked Chrome picker was closed. QR file upload is separately browser-tested.
- Editor closure now aborts capture and stops streams arriving from a late picker;
  video playback/frame waits time out together. Three regression tests pass.
- Native catalog sync refreshes after save/import/delete; the macOS companion
  opens the installed desktop app by bundle ID. The final macOS rebuild passes.
- Native identity writes now run in order, including logout after an outstanding
  catalog sync. A regression test also verifies the queue continues after failure.
  Background iOS sync does not interrupt an in-progress connection for the same
  owner; account changes cancel it and replaced requests settle promptly.
  Updated iOS/Watch and macOS builds, six Swift tests, HTTPS persistence and
  independent WebAuthn verification pass.
- Web prerequisite #997 is merged at `998bdb83c` and production-verified at
  https://thingtime.com/passwords: synthetic two-account encrypted round trips,
  catalog privacy and isolated deletion pass; test entries were removed.
  Native merge, signed release and device ceremonies remain pending.

The separate third-party OAuth implementation remains in PR #992. Real user
credentials should be added only after the password manager is delivered and
its production/native gates are verified.
