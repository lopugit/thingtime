# Agent browsers and task space

Open **Lopu → Agent browsers and tasks** in Thingtime for Mac. Install the
editable task space, create a task, then open its **Browser controls**. Tasks,
todos and progress updates are private Data Things with editable Schemas,
Components, Actions and Pages. Child records use `parentId`; lists use cursors.
The native adapter owns only device runtime installations and browser claims.

## Device setup

The isolated runtime uses Colima and the Docker CLI installed on the executing
Mac (Homebrew: `brew install colima docker`). No registry login or provider key
is required. Choose **Start isolated runtime** in the app. It starts the dedicated
`thingtime-agents` profile using Apple virtualization, two CPUs, 4 GiB memory
and a 20 GiB disk, without host mounts, SSH-agent forwarding, port forwarding,
or switching the user's Docker context. Other Colima profiles are untouched.
The initial download and image build need internet access on the host.

**Install Chromium runtime** builds the shipped pinned Playwright Chromium,
MongoDB and packaged Thingtime client/server. Only those packaged build outputs
enter the image; worktrees, `.env` files, device settings and credentials do not.
The MongoDB server and Linux native addons run as the image's non-root task user.
Image construction replaces the Mac-traced bcrypt, Sharp/libvips, resvg and
cbor-extract packages with the same locked versions installed for Linux, then
loads them through the app resolver. Keep the runtime lock in sync when updating
these app dependencies; version drift or an unloadable binary fails the build.
Internal dependency links are copied; links escaping the build are refused.

Each claim starts a separate container with a read-only root, no capabilities,
no new privileges, Chromium's sandbox, no host bind mounts or published ports,
and private temporary profile, downloads and database. The default network has
only loopback. A fresh local replica set and signing secret are generated for
that session. The app refuses missing test configuration and production API
fallback. Use the app's normal temporary-account sign-in API for test identities.
Neither a production credential nor a personal browser profile is needed.

Native **Chrome for Testing** and **Chromium** downloads are also available.
Publisher archive checksums and installed tree hashes are verified; `ditto`
preserves the original signature. Official testing archives can be publisher
ad-hoc signed; the app records that provenance without re-signing them. Each
duplicate lives under `~/Applications/Thingtime Browsers/<install-id>/` and gets
a fresh profile when claimed. Native copies support unrestricted sessions only.

## Security settings

The device default is in **Settings → Things → Agent browsers**. The task's
**General security settings** link opens that disclosure directly.
Each task has a **Use custom security settings** checkbox:

| Mode | Boundary |
| --- | --- |
| Isolated testing | Browser and backend have no external network interface or route. |
| Restricted network | A per-task kernel firewall permits only literal IPv4/IPv6 addresses or CIDRs, optional TCP/UDP ports. Other traffic, including external DNS, is dropped. |
| Allow all network traffic | External and production services may be reachable. |

Restricted and unrestricted modes are never described as production-isolated.
Rules cover the browser, redirects, direct-IP traffic and backend processes.
Docker's embedded DNS is blocked before its address translation. The temporary
firewall helper has `NET_ADMIN`; it exits before the browser/app starts, and
the task never receives that capability. Browser request interception is not
the network boundary. No failed launch falls back to a broader policy.

The effective policy is frozen when claimed. Editing a task or device default
affects the next claim. Release the old claim before applying the new policy.
One install and one task can have only one claim. Duplicate the immutable
runtime or native bundle for another concurrent agent.

## Agent connection

The app displays its private Unix socket path. Each app profile has its own
manager, socket and inventory. The socket directory is device-user-only; the
socket is mode `0600`. The shipped CLI is
`~/Applications/Thingtime.app/Contents/Resources/agent-browser.mjs` and uses Node.
Source checkouts use `electron/scripts/agent-browser.mjs`.

Open the task's browser controls once to register its saved policy. Call
`manifest` and check `agent.browsers` and `agent.network-policy` major version 1.
Then call `status` to find registered `tasks` and installed browser IDs. The task
identity includes its selected API origin, database identity, owner and Data Thing ID.
The bundled desktop window origin is not used as the API identity. The agent
connection does not expose security changes or executable installation, and
requires the owning handle for claim controls. The container isolates its browser
and backend; it does not sandbox an agent's other host tools or shell access.

Send JSON parameters on stdin. For example, using task-local variables:

```bash
node "$agent_cli" status --socket "$agent_socket" </dev/null
printf '%s' '{"taskId":"<registered-task>","installId":"<install>","agentId":"<agent>"}' |
  node "$agent_cli" claim --socket "$agent_socket" --lease-file "$agent_lease"
node "$agent_cli" launch --socket "$agent_socket" --lease-file "$agent_lease" </dev/null
printf '%s' '{"operation":"tabs"}' |
  node "$agent_cli" browser --socket "$agent_socket" --lease-file "$agent_lease"
node "$agent_cli" release --socket "$agent_socket" --lease-file "$agent_lease" </dev/null
```

Use an absolute lease-file path in your private task directory. The CLI saves
the handle with exclusive creation and mode `0600`; it never prints its token.
Do not share, commit or display the file. Renew at least once every 15 minutes;
the GUI renews its own claim every minute. Operations include `tabs`, `newPage`,
`navigate`, `frame`, `click`, `type`, `key`, `scroll`, `viewport`, `evaluate` and
`closePage`. Page operations take `args.pageId`; `navigate` also takes `args.url`.
`frame` returns a JPEG for the live viewer. Keep evidence task-owned and exclude
credentials, tokens and private page contents from screenshots or logs.

The viewer can observe an agent's browser without taking its control handle.
A claim started from the GUI also offers navigation, typing, scrolling and
desktop/mobile sizes. Release removes only that claim's processes, profiles,
downloads and temporary database. Expiry stops the browser; the owner can still
release it, or the GUI can explicitly clear an expired claim. App shutdown
releases sessions. A process lock prevents two controllers sharing one state
directory; restart cleanup checks the exact manager ownership labels before
removing abandoned containers or networks.
If the container daemon is unavailable during release, the claim stays owned
and cleanup remains retryable. A connection error is never treated as evidence
that a container was removed. Shutdown also waits for native installation and
duplication, including their preparation stage.

## Credentials

For an authorized task requiring a password or passkey, use the Thingtime
password manager **on the executing device**, matching service origin and
account. Reuse an authorized session when sufficient. Use supported retrieval,
autofill or sign-in interfaces; passkeys require their supported flow and any
user presence. Never extract private keys, copy another browser's credentials,
bypass a vault lock, or ask for a password pasted into chat. Missing integration
blocks only the dependent action. Isolated tests use only their own test
identities and never relax network restrictions to obtain authentication.

## Verification

Run `node --test electron/test/agent-browser-*.test.cjs`, the agent-test backend
and API-fallback tests, capability coverage, and suite materialization tests.
The opt-in `electron/scripts/test-agent-browser-host.cjs` accepts absolute state,
socket and Docker-socket paths plus an immutable full-app image ID. Without the
image argument it uses the older tiny HTTP fixture; that proves fixture
separation only. Full-app acceptance must additionally exercise temporary
sign-in, normal Thing writes/readback, editable task controls, and reload.

Verify two simultaneous claims, independent records/storage, cross-claim
refusal, public IPv4/IPv6 and redirect failures, restricted-port behavior,
policy freezing, teardown, and installed-app/live-viewer behavior. A passed
fixture or image build is not evidence of a completed desktop acceptance check.

For desktop development acceptance, `test-agent-desktop-relay.cjs` takes a
private state directory, immutable full-app image ID and unused loopback port.
It transports HTTP over the container's stdio without publishing a container
port. Use its origin as `THINGTIME_DESKTOP_DEV_TEST_ORIGIN` with the existing
`dev:parallel` command. For task-owned automated UI checks, `--inspect-ui=<unused-port>` enables a loopback Chromium inspector only in this temporary development app. This opt-in development path verifies the test health
marker, skips host environment loading and production endpoint checks, and
loads the real private app through the normal Electron preload. It is disabled
in packaged builds. The relay is temporary test tooling, not a public dev
server; never publish it through Funnel or Vercel. Stop it after acceptance.
