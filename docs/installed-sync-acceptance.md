# Signed Mac sync acceptance with a private backend

This opt-in harness runs the real packaged backend, fresh Mongo replica, local
attachment bytes and task-owned Chromium in **one** enforced network-isolated
container. The installed signed Mac app remains outside that namespace and
connects to a loopback HTTP relay over Docker stdio. The native app itself is
not network-sandboxed; this harness does not claim to isolate its other host
services. Only synthetic files and the synthetic account belong in this run.
No personal browser, account session, vault or profile is copied into it.

The container retains `network=none`, no host mounts, no published ports and its
normal browser sandbox. Both the browser and installed Node use the identical
`http://127.0.0.1:<test-port>` origin: that port is independently bound on host
loopback and container loopback. The optional test authority is rejected for
non-isolated runtimes. The backend publishes a custom data-environment identity
and stores attachment bytes privately under `/home/pwuser/attachments`.
Existing ordinary browser-runtime launches keep their current defaults.

## Build the immutable full-app image

Start the dedicated `thingtime-agents` runtime through Thingtime's supported
controls first. Reuse the canonical verified current-branch packaged web output
(`server/index.mjs` and `public/index.html`). Build an image after changing
runtime scripts; an old immutable image does not acquire checkout changes.
Run from the repository root, with separate private directories for build and
acceptance state:

```sh
node electron/scripts/build-agent-desktop-acceptance-image.cjs \
  /absolute/private/build-state /absolute/current-packaged/.output
```

This reuses `BrowserImages.install`, pinned publisher dependencies and the
configured `~/.colima/thingtime-agents/docker.sock`; it does not use the default
Docker context. It prints only the immutable `sha256:...` image ID and readiness.
No installed app is rebuilt, launched or replaced by this command.

## Start and control the same browser/backend

Check the selected host port is unused. Pass a fresh empty mode-0700 private
state directory and the image ID returned by the builder:

```sh
node electron/scripts/test-agent-desktop-relay.cjs \
  /absolute/private/acceptance-state sha256:REPLACE_WITH_IMAGE_ID 28671
```

The process remains running. Its single readiness message names `relay.json`,
`browser.sock` and `browser-lease.json` in that directory. The descriptor contains
public task/session IDs, boundary proof and browser tab IDs. The lease is a
private mode-0600 control handle: do not print or share its contents. Readiness
requires actual isolated preflight, full-app startup, matching native capability
and public sync manifests, and the exact shared custom authority origin. An old
image or incompatible packaged backend fails closed.

Use the existing CLI, including its private lease-file support:

```sh
node electron/scripts/agent-browser.mjs manifest \
  --socket /absolute/private/acceptance-state/browser.sock </dev/null
printf '%s' '{"operation":"tabs"}' | node electron/scripts/agent-browser.mjs browser \
  --socket /absolute/private/acceptance-state/browser.sock \
  --lease-file /absolute/private/acceptance-state/browser-lease.json
```

Existing operations (`navigate`, `frame`, `click`, `type`, `key`, `viewport`,
`evaluate`, etc.) control this same container browser. Renew its lease with the
CLI `renew` command before fifteen minutes. Expiry/release closes only the owned
namespace and makes the relay refuse requests. Never claim a second browser to
reach this backend, broaden network policy, publish the relay, or reuse a
personal Chrome profile.

### Task-owned native viewer for approved test credential entry

The opt-in local Electron GUI controls the same already-running isolated
Chromium through its existing private socket. It introduces no HTTP listener,
password-export interface or second browser. Start with the official Electron
dependency from this checkout, after the relay reports ready on port **28671**:
Use a canonical physical state path for both commands; on macOS use
`/private/tmp/...` rather than its `/tmp/...` symlink. Symlinked state paths are
rejected, including otherwise-private aliases.

```sh
electron/node_modules/.bin/electron electron/scripts/test-agent-acceptance-viewer.cjs \
  /absolute/private/acceptance-state
```

The viewer binds the private descriptor's task, session and first existing tab.
Its entry check supports Electron's CommonJS launcher, which owns `require.main`;
an explicit script argument starts the GUI while importing the helper stays
side-effect free. Run the actual viewer once as well as its Node tests: a passing
import-based test does not establish that Electron executed the entry point.
It negotiates browser/network-policy major 1 and checks lease ownership, active
session, isolated policy and exact application origin before every operation.
Only `http://127.0.0.1:28671` pages accept input; an initial `about:blank` may
only be viewed or navigated to that origin. It cannot create or switch tabs.
Keep all other controllers idle during this viewer's credential phase: the
existing browser protocol performs a current-tab origin check before typing,
and does not provide an atomic origin-and-type transaction against concurrent
navigation by another controller.

Use supported on-device password-manager retrieval/autofill and native Computer
Use keyboard entry into the GUI's masked field. Select the actual destination
password field in the live frame first. The GUI clears its entry immediately
on submission or focus loss; errors are fixed messages, and responses omit
credentials, control handles and raw server errors. Do not capture a secret
reveal, type credentials through CLI arguments, or send a password to a text
field that displays it visibly. The renderer has only fixed tabs/frame/click/
type/key/scroll/viewport/navigate controls, no evaluate or generic IPC API.

The local renderer uses sandbox/context isolation/web security, denies external
requests, navigation, popups, downloads and permissions, and uses a private
temporary profile/session. Quitting removes that profile and leaves the
existing relay/lease running for installed-app acceptance. It never modifies
or launches the production app. Frames refresh on explicit actions only; this
is a test operator GUI, not a shipped Builder page. Visual and real sign-in
acceptance still require exercising this actual GUI and installed app.

## Synthetic identity and real native acceptance

Use canonical full-account registration (`/register`, backed by
`POST /api/v1/auth/register`) and ordinary sign-in. The existing
`remix/scripts/device-sync-control.integration.mjs` demonstrates disposable
full-account signup with freshly generated test-only credentials; its fabricated
pairing is **not** suitable for this installed-device run. Temporary account
sign-in is insufficient because remote sync workers require a full user.

Before native pairing or positive transfer tests, negotiate the selected local
origin's `api.auth-me` capability and check its authenticated `/api/v1/auth/me`
projection: the identity must be the intended full user and
`privateUploadsEnabled` must be true. Registration alone does not approve uploads.
Provision private-upload approval through the documented local admin flow
(`api.admin-users-public-uploads` 1.0.0 and
`POST /api/v1/admin/users/public-uploads`, with `scope: "private"`), using only
an authorized isolated administrator. Verify the test user is non-admin before
acceptance. Do not directly modify encrypted account data or relax upload gates.

For this eligibility prerequisite, the relay accepts an optional fourth argument:

```sh
node electron/scripts/test-agent-desktop-relay.cjs \
  /private/tmp/ACCEPTANCE_STATE sha256:REPLACE_WITH_IMAGE_ID 28671 pr1216-test-user
```

The username is non-secret and must exactly match the account subsequently
registered through the isolated browser UI using its approved on-device password
manager entry. Rebuild the immutable image first; an older runtime cannot acquire
this support. The option is refused unless the runtime's actual network preflight
proves isolation and an explicit loopback application authority is selected.

The opt-in runtime registers a separate generated bootstrap administrator through
the canonical registration API, then performs one supervised API-only restart,
retaining the namespace database and signing material. Only this intentional exit
is exempt from the normal child-failure teardown. It verifies the retained admin
session and negotiated capabilities before looking for the exact named test user.
It waits with fifteen-second to sixty-second backoff for up to thirty minutes; after registration it
refuses an admin target and approves **private uploads only** through the ordinary
admin API. It verifies the approval response leaves public uploads withheld, then
drops its bootstrap session handle. Passwords and sessions never leave the
namespace or appear in CLI arguments, descriptors or output. Readiness alone does
not establish that the later UI-registered user has been approved: independently
check that user's authenticated `/api/v1/auth/me` before pairing or transfer.

Any bootstrap/API/identity failure or registration timeout terminates the fixture.
Ordinary launches without the username retain their existing behavior and upload
refusal coverage. There is no general restart, admin or password-export interface.
Do not kill the API manually, extract signing secrets or relax upload gates.

Provision/access the disposable credentials through approved test-fixture
handling or the executing device's supported Thingtime password-manager
interface. Keep credentials out of CLI JSON echoed to stdout, browser screenshots,
traces, task notes and shell history. This harness neither exports credentials nor
introduces a password/autofill API; account creation and native sign-in are not
claimed complete by the readiness marker. Do not request or copy production
credentials to complete setup. Any native sign-in limitation must be recorded
separately from backend/browser readiness.

In the installed app, record the original endpoint and verify personal jobs are
paused. Add/select the exact loopback origin through **Settings → Things →
Thingtime desktop → API endpoint**, then use **Switch and Restart**. Sign into
the same full synthetic account and pair the actual installed Node through its
normal UI and native confirmation. This gives a distinct origin/account draft
scope; leave personal Home drafts and grants untouched.

From the isolated browser, manage that genuinely paired device. Select only the
explicit synthetic fixture in the native picker; create a private test cloud
folder/connection. Exercise real upload/download bytes and compare independent
hashes, Pause/resume, recovery, intervals and window-close behavior. Browser
screenshots, command receipts and native signatures are separate evidence;
none alone establishes file-transfer acceptance. Verify upload eligibility and
storage readiness for the synthetic account rather than silently bypassing them.

Restore the original endpoint through normal installed-app controls and verify
its account, preserved draft and paused personal jobs **before** releasing the
browser lease or terminating the relay. Stop the exact harness process with
SIGTERM; its cleanup closes its socket/browser/container and removes readiness
and lease files. A failed test is not permission to reset user data, change
permissions, copy credentials or widen the namespace's network.

## Focused regression checks

```sh
node --test electron/test/agent-browser-application.test.cjs \
  electron/test/agent-desktop-relay.test.cjs electron/test/agent-browser-manager.test.cjs \
  electron/test/acceptance-viewer.test.cjs
```

These checks cover origin validation, manifest configuration inputs, actual HTTP
relay authority/ownership fencing and existing lease behavior. They do not claim
a running Docker image, actual native pairing or installed real-byte acceptance.

Build/start failures write a bounded mode-0600 `failure-<id>.json` artifact in
the private state directory and print only its path. Inspect that artifact
locally for the actual cause; do not publish raw diagnostics without checking
for sensitive content. The image builder retains the underlying build job's
failure rather than replacing it with a generic message. If the state directory
is not private and device-user-owned, diagnostics refuse to write there.
