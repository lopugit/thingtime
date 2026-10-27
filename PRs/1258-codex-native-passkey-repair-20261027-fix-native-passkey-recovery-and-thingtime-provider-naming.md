# PR 1258 — Native passkey flow and AutoFill connection controls

[Pull request](https://github.com/lopugit/thingtime/pull/1258)

The native macOS provider now shows closed progress/error categories instead of
an indistinct busy screen and generic failure. The provider/host display Thingtime;
bundle identifiers, Keychain group and packaging paths remain stable. No confirmed
server mismatch or underlying cause of the historical installed failure is claimed.

Retry retains one registration key, credential, record and write identity. Request
fences reject queued clicks and stale completions. A changed session requires
Cancel/start again from the relying party; it cannot reuse the existing ceremony.
Catalog traversal has no arbitrary entry cap and refuses repeated cursors. Isolated
native build overrides must specify the complete distinct identity/output set.

The shared editable native connection control uses desktop `passwordsVersion`
1.1.0 and a read-only host `--status` operation. Only a matching saved owner/origin
link shows Disconnect; absent/different links show Connect, failed reads show Retry,
and older bridges show Update Thingtime. Status does not probe the network or
claim that macOS enabled AutoFill. The checkout has no iOS native-password bridge.

Validation reported by the parent/cooperating agents on 2026-10-27: 102 password
checks, 11 Electron checks and Swift connection-status checks passed; TypeScript
and its zero-baseline ratchet passed; full lint had zero errors and 386 warnings.
The final Swift suite executed 24 tests with two explicit opt-in skips and zero
failures. An opt-in public crypto fixture plus independent SimpleWebAuthn 13.3.2
registration/assertion verification passed. These fixture results do not establish
an installed OS ceremony. Actual ProviderView busy and error layouts were inspected
at compact/wide sizes; Cancel remained reachable.

Native logs at 20:09:59 showed Chrome receiving an
`ASAuthorizationPlatformPublicKeyCredentialRegistration` before the later installed
component upgrade. A later code-2 cleanup was not established as the cause.
The historical cause remains unknown; a successful retry cannot identify which
change, if any, resolved it.

At 20:27 the parent upgraded signed components in the standalone installed
`~/Applications/Thingtime Passwords.app`, preserving its existing custom OAuth host,
normalized host executable bytes, exact entitlements and designated requirement.
Visible name: Thingtime; retained host version/build 1.0/1, provider 1.0.1/2.
The stable `~/Applications/Thingtime.app` was unchanged. Evidence is retained in
`/tmp/thingtime-passkey-repair-v2/installed-evidence.json`. The user then confirmed
that the real GitHub passkey flow succeeded; subsequent sign-in has not been
independently verified in this report. The preserved old helper host lacks
`--status`, so the new installed connection-control UI is not accepted yet and
requires the corresponding full Electron/host update.

The final provider starts registration once when its view becomes visible after
OS selection, automatically beginning device verification without a second Create
button. LocalAuthentication, cancellation, explicit retry and request/session
fences remain. Source versions: package 0.1.2, provider 1.0.2/build 3. Installation
and real ceremony acceptance for this final version remain separate from the
previous user-confirmed GitHub flow and rendered fixture checks above.

Graphify structural output was refreshed. Semantic extraction through the local
proxy exceeded a bounded 120-second deadline after partial chunk processing; its
task-owned process group was stopped, and changed Markdown semantic coverage is
not claimed. Structural fallback still regenerated portable report/graph/HTML.
