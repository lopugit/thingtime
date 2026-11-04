# Linux and Windows desktop password bridge

The Electron app exposes `native.passwords` 1.0.0 through a private local socket
(Linux) or named pipe (Windows). The shipped `resources/password-agent.mjs` CLI
negotiates that profile's manifest before every operation. Desktop renderer bridge
1.3.0 reports `scopedDesktop`; the macOS Apple provider remains on bridge 1.2.0.

This bridge generates and saves passwords in the signed-in Thingtime vault, then
delivers a selected credential directly to a task-owned browser or a specifically
supported local consumer. It never returns passwords, authentication cookies,
passkey material or grant tokens on stdout. Existing browser extension autofill
continues to work independently. System-wide autofill, arbitrary application
typing, password export and Windows local-app consumers are not supported.

## Prerequisites and first sign-in

Run the app on the device performing the task. Sign in to the intended account,
select its API endpoint and use **Connect Password AutoFill** in Passwords. The
selected endpoint must advertise `api.passwords` **1.7.0** (or compatible 1.x):
the catalog now supplies canonical exact `origins`, including nondefault ports,
so discovery does not require decrypting credentials. Older clients can continue
using the existing catalog fields and 1.6 contracts.

Windows uses Electron safeStorage/DPAPI. Linux requires an available OS secret
store (`gnome_libsecret`, KWallet, KWallet5 or KWallet6); `basic_text`, unknown and
unavailable backends fail closed. The connection and interrupted-save journal
are OS-encrypted. No vault session is persisted. An interrupted generated save
keeps its password encrypted only until the same save is confirmed or removed.
Grant/runtime files are private to the OS account; Windows verifies the actual
owner/DACL, rejects reparse points and requires paths inside that user's profile.

This is not a first-sign-in handoff. A signed-out guest still needs its supported
Thingtime sign-in, including any required passkey presence. An uninitialized or
locked OS keyring may need normal desktop setup/unlock before safeStorage can
open. The bridge does not copy another device's vault or session and cannot use
an unavailable keyring to bootstrap its own encryption. `status` reports those
dependencies separately from a connected account.

## CLI contract

Use Node 22 or newer and the CLI shipped with the installed app. Run that app's
executable with `--password-agent-info` to print only its computed profile and CLI
paths, before any settings/session/vault files are opened. For example:
`/opt/thingtime/thingtime-electron --password-agent-info` (Linux), or
`Thingtime.exe --password-agent-info` (Windows). The app exits without opening a
window or forwarding to the running instance. Use the returned exact profile
path with `--profile`; packaging can change the default app name.
Keep grant files in a private directory inside
your OS account; never print, attach or commit them. Input is a JSON object on
stdin containing **non-secret parameters only**. Shell examples below use POSIX
syntax; PowerShell can pipe the same JSON into `node`.

```sh
profile="<absolute profile returned by --password-agent-info>"
node /opt/thingtime/resources/password-agent.mjs manifest --profile "$profile"
printf '%s' '{"ownerId":"<current-account-id>"}' |
  node /opt/thingtime/resources/password-agent.mjs status --profile "$profile"
```

`authorize` binds an exact vault origin, account, stable task ID and target. It
shows an in-app consent dialog. Its random 15-minute grant goes directly to a
new `--grant-file`; stdout contains only scope metadata. The file is never
overwritten. Sign-out, account/endpoint change, disconnect, expiry and app exit
invalidate grants and close their isolated browsers.

```json
{"origin":"https://thingtime.com","ownerId":"<current-account-id>","taskId":"<task-id>","target":{"kind":"website","origin":"https://service.example"}}
```

Pass that JSON to `authorize --profile <absolute-profile> --grant-file
<absolute-new-private-file>`. All following scoped operations use the same two
arguments:

| Method | Non-secret input | Result |
| --- | --- | --- |
| `catalog` | Optional `cursor` | Eligible exact-origin entry IDs, titles, usernames and next cursor; no credential fields |
| `generate` | Stable UUID v4 `requestId`, `title`, `username` | Vault entry ID and confirmed `saved`; 32 random characters generated inside the broker |
| `open-browser` | `url` on the authorized HTTPS origin | A new isolated system Chromium/Chrome/Edge profile with normal networking and the Chromium sandbox |
| `fill` | `entryId`, `selectors.password`, optional `selectors.username` | Direct delivery confirmation; never submits the form |
| `unlock-keyring` | `entryId`, explicitly authorized Linux local-app scope | Verified existing GNOME login keyring result |
| `release` | `{}` | Closes the task browser, revokes the grant and deletes its grant file |

Retry an interrupted generation with the **same request ID and parameters**.
The OS-encrypted pending journal preserves the same password and write ID, and
the vault's idempotent save/readback prevents a second credential being silently
created. Do not create the external account until `saved: true` is confirmed.

Every `fill` opens a separate sandboxed Thingtime approval window showing the
target, selected saved account and vault account. It obeys the entry's existing
verification policy, including a current-password prompt when required. Only
the exact window/frame can return the request/entry/origin-bound proof, and that
window accepts one response before closing. The broker never accepts proofs
from CLI parameters and starts a fresh approval for each delivery. The protected
vault `fill` API retains its existing bounded same-request retry semantics; a
vault lock revokes pending authority. Broad task consent does not replace
per-entry verification.

Only the top-level document and uniquely selected, visible username/password
inputs are supported. The broker binds the actual document and elements in a
Chromium isolated world, rechecks the HTTPS origin and same-origin form action
immediately before delivery, and refuses navigation/replacement. Cross-origin
iframes, ambiguous fields and unsupported native apps require another supported
integration. The destination website necessarily receives a filled password;
the requesting agent does not. No browser profile, cookie or session is imported.
Ubuntu's Snap Chromium uses a unique task directory under
`~/snap/chromium/common/thingtime-native-passwords`, within its existing
confinement. Release removes that task directory; existing Chromium profiles
remain separate.

## GNOME login keyring consumer

Linux additionally accepts `target: {"kind":"local-app","id":"org.gnome.keyring"}`.
Generate in that scope, or use an existing password entry explicitly carrying a
plain `native-consumer` field with that exact ID. Unlock requires a fresh
Thingtime account-password verification; an already-unlocked keyring returns
without reading a credential.

This consumer requires `/usr/bin/gdbus`, `/usr/bin/gnome-keyring-daemon` and
`/usr/bin/python3`, installed and owned by root. It uses GNOME's existing
[PAM unlock control operation](https://github.com/GNOME/gnome-keyring/blob/master/daemon/control/gkd-control-client.c),
with a private daemon-owned control socket, exact D-Bus owner, process ID,
executable and Unix peer credentials. It rechecks the live grant immediately
before delivery and verifies the same daemon changed from locked to unlocked.
It does not start/replace a daemon, create a keyring or change its password.
Socket activation whose peer cannot be verified as that exact daemon fails
closed. KWallet and Windows app-password consumers are not implemented.

## Build, install and evidence

Use a native Linux or Windows host with Node 24 and pnpm 10.12.1:

```sh
pnpm --dir remix install --frozen-lockfile
pnpm --dir electron install --frozen-lockfile
node electron/node_modules/electron/install.js
pnpm --dir electron run build:portable
```

The output is `electron/release-linux-<arch>/linux[-arm64]-unpacked` or
`electron/release-win32-<arch>/win[-arm64]-unpacked`. `--staged` skips rebuilding
web resources but still verifies them; use it only for resources built on that
same platform/architecture from the intended source. Apple helpers are excluded;
macOS continues through its existing signed build. These are unsigned directory
packages, not signed Windows installers or public distribution releases.

Quit the previous app normally, preserve its user-data directory, and install
the complete package in the chosen app directory. On Linux the system installer
must preserve the root-owned `chrome-sandbox` helper with mode `4755`; never add
`--no-sandbox` to make a package launch. On Windows keep the profile/grants under
the current user's protected profile. Launch the installed app, reconnect its
vault through the supported UI, and negotiate the installed CLI manifest before
performing credential actions. Do not copy profile files between devices.

`native-passwords-ci.yml` runs real Electron OS encryption, transport/CLI and
Chromium delivery fixtures on Linux and Windows, plus builds a Windows directory
artifact. `test-native-password-session.cjs` uses a private profile and (Linux)
a separate D-Bus/HOME/keyring. `native-password-keyring.test.cjs` additionally
proves existing-keyring locked-to-unlocked behavior, wrong-password refusal and
revoked-grant refusal. Their output contains booleans only; fixture screenshots
show masked inputs. `password-native-approval-ui.integration.ts` exercises the
actual editable React approval and protected production API handlers in an
isolated database, with an explicit fixture IPC adapter.
`THINGTIME_TEST_NATIVE_SNAP=1 node --test electron/test/native-password-snap.test.cjs`
separately exercises installed Snap Chromium in its normal desktop user session,
with only a new task profile and synthetic loopback form. Snap requires that
session's systemd service, so it cannot run inside the private D-Bus keyring
fixture. It verifies delivery, target changes, sandbox flags and profile cleanup.

These checks do not prove a personal account's installed GUI ceremony, external
service login, passkey operation or Windows signing. Record those separately in
the [acceptance checklist](../TESTING.md), using on-device supported vault access.
