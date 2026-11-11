# Local development and worktrees

## Native web bundle releases

`native-bundles/{release,inventory,host}.cjs` owns signed executable inventories and
runtime compatibility; `package-release.mjs` packages verified immutable releases
from the actual Electron web build. `electron/lib/web-bundle-store.cjs` retains
confirmed versions separately from launch trials. Run
`node --test native-bundles/*.test.cjs electron/test/web-bundle-store.test.cjs electron/test/native-bundle-build.test.cjs`.
The real `build:web`/`verify:web` paths prove build metadata and complete inventory;
unit tests alone do not prove installed updates. See [native web bundles](../native-web-bundles.md)
for the remaining API and iOS work. `electron/lib/web-bundle-launch.cjs`,
`main.cjs` and `desktopRendererReady.ts` gate trial promotion on real server and
renderer startup. `verify-web-bundle-startup.mjs` exercises the installed isolated
development app, including early-import failure and fresh-process rollback;
its React-boundary fixture uses a separate Chromium process. Run launch/host,
renderer-readiness and desktop-shutdown tests with the store checks.
`archive.mjs` streams the shared stored ZIP/ZIP64 format; the registered catalogue
and exact-range content routes are mapped in [API capabilities](api-endpoints-and-capabilities.md#native-web-release-catalogue-and-content).
`web-bundle-download.cjs` negotiates them, resumes exact 2 MiB windows and checks
signed file hashes; `web-bundle-updates.cjs` stages after healthy startup for the
next normal process start, without live-editor reload. Cover both modules' tests
with cancellation/retry/cleanup and keep real selected-origin downloads distinct
from synthetic transport fixtures. Empty shipped trust disables production
background download until supported provisioning.

`iOS/scripts/native-runtime-probe/` preserves the isolated actual Node 24/Nitro
experiment: genuine simulator bcrypt passes, then sharp fails to load; no API or
storage acceptance follows. The checked-in reusable runner was exercised end to end against source
`bab94d1d9`, reproducing that compatibility boundary with verified simulator cleanup. See the [probe runbook](../../iOS/scripts/native-runtime-probe/README.md).

## Agent browser runtime

`electron/lib/agent-browsers/` owns device installations, exclusive leases,
network policy, process ownership and the private Unix control socket. The
shipped `runtime/` recipe bundles Chromium, MongoDB and the packaged app without
worktree credentials. `agentTesting.ts` and `apiFallback.ts` fence the backend;
`electron/scripts/agent-browser.mjs` is the token-file CLI. Setup and acceptance
commands live in [agent-browsers.md](../agent-browsers.md). Run the
`electron/test/agent-browser-*.test.cjs` tests and full-app two-agent acceptance
when changing allocation, networking, startup or cleanup.
`electron/scripts/test-agent-acceptance-viewer.cjs` is an opt-in local test GUI
for that existing isolated session, with fixed IPC and origin/task/tab fencing.
Its supported startup, private-profile cleanup and exclusive credential-entry
phase are in [installed-sync-acceptance.md](../installed-sync-acceptance.md).
Run `node --test electron/test/acceptance-viewer.test.cjs` for its boundary checks;
these do not establish GUI or installed-account sign-in acceptance. Select-all
uses fixed focused-field selection against retained Puppeteer runtimes, and a
refused operation fences input until a successful explicit frame refresh.
`electron/scripts/acceptance-relay-keeper.cjs` derives renewal paths from the
private descriptor, verifies the relay PID, and records bounded lifecycle status;
run `electron/test/acceptance-relay-keeper.test.cjs` for path/failure regressions.
`runtime/prepare-native.cjs` replaces Mac-traced native packages with locked
Linux package trees and loads them during image construction. Keep its runtime
lock synchronized with app native dependency upgrades and exercise a packaged
full-app launch, not only host-side module checks.

## First ten minutes in a fresh checkout or worktree

Development group cleanup in `electron/lib/local-runtime.cjs` requires ESRCH
before deleting temporary state. After a successful SIGKILL, macOS can briefly
return EPERM for a zombie-only group: [XNU's group-signal filter and return
code](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c#L1612-L1621).
Poll only within the existing kill deadline; persistent EPERM and permission
failures before or during signal delivery remain errors. The owned-child zombie
and permission regressions live in `electron/test/local-runtime.test.cjs`.

```sh
npm run worktree-bootstrap          # deps relink, env copy, .claude/launch.json, hooksPath
npm run web-ports                   # this checkout's derived ports + PM2 name
npm run web-pms                     # start/restart the PM2-managed dev stack
```

`remix/scripts/worktree-bootstrap.cjs` is idempotent and also runs from the
tracked `.githooks/post-checkout` the first time a linked worktree is checked
out without `remix/node_modules/.pnpm`; `ensure-dependencies.js` holds an
install lock, so a bootstrap still running in the background and your own
`npm run worktree-setup` never write `node_modules` at once. It copies the
`.env*` entries of `.worktreeinclude` and writes two `.claude/launch.json`
entries: `thingtime-web-<port>` attaches to the PM2 stack, `…-foreground`
owns a fresh stack (only while PM2's is stopped — same ports). Ports come from
`remix/scripts/worktree-ports.cjs` (main checkout: Vite 9999 / HMR 9998 / Nitro
10000; worktrees: a deterministic trio in 11000–19899). `TT_WEB_PORT`,
`TT_HMR_PORT`, `TT_API_PORT` override. Preview tooling that must own the
process can run a second foreground stack: `TT_WEB_PORT=… npm --prefix remix run dev`.

## Environment

| Need | How |
| --- | --- |
| Mongo | local `mongod` on 27017 (`MONGODB_CONNECTION_STRING` in `remix/.env`); collections are versioned (`things_v2`) — always use `getCollection()` |
| Stored attachment bytes | `THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR=.local-attachments` in `remix/.env` (filesystem stand-in for the private bucket; never on Vercel; relative to the dev server's working directory, `~` expands). Add `THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN=http://127.0.0.1:<nitro port>` when a native app or a script (not the browser) must PUT/GET the signed URLs |
| Admin locally | register a user, add it to `ADMIN_USERNAMES` in `remix/.env`, restart |
| Realistic data | `node remix/scripts/seed-fixture.mjs create --files 3 --name demo` → `resume` after enabling uploads → `cleanup remix/.fixtures/demo.json` (real API only, never direct Mongo writes) |
| Branch name / Vercel parity | `remix/.env.auto` is regenerated by `remix/scripts/pre-dev.sh` |
| bcrypt native binding missing | `corepack pnpm --dir remix run ensure-bcrypt`, then restart |

## Tests and checks

| What | Command |
| --- | --- |
| Unit suites (node --test via tsx) | `npm --prefix remix run test:<suite>` — `test:attachments`, `test:things`, `test:feed`, `test:api-capabilities`, `test:acl`, … (`test:unit` runs them all) |
| Local workspace regressions | `corepack pnpm --dir remix run test:local-workspace` discovers TypeScript and MJS tests, then checks the offline shell. Browser tests remain explicit opt-ins; `accountThemeHistoryCustom.browser.test.mjs` uses its own isolated loopback origin, artifact directory and task session settings. |
| Unified Thingtime MCP | `npm --prefix MCP test` includes the artifact extractor and isolated transport regressions. `MCP/test/render-export.integration.test.ts` additionally needs explicit pinned-image/socket settings and `TT_DRAFT_BROWSER_TEST=1`; it verifies actual native crop-enabled/disabled resources. See `MCP/README.md` for host configuration and the desktop acceptance boundary. |
| Headless API suite against a live stack | `npm --prefix remix run test:api -- --base http://127.0.0.1:<nitro>` |
| Editable app composition fixture | `remix/scripts/test-builder-app-local.ts`, with explicit `TT_BUILDER_QA_ORIGIN` and private `TT_BUILDER_QA_SESSION`; loopback-only, real API, stable synthetic IDs. See README "Builder component SDK". |
| Lint changed files | `corepack pnpm --dir remix run lint:files -- <files>` |
| Types | `corepack pnpm --dir remix run typecheck` (raw) and `corepack pnpm --dir remix run typecheck:ratchet` (strict zero-error baseline; never raise it) |
| Full lint | `corepack pnpm --dir remix run lint` (errors fail; warnings have no numeric budget) |
| Gate and legacy-helper regressions | `npm --prefix remix run test:typecheck-ratchet`; `npm --prefix remix run test:smarts` |
| Vercel output contract | `npm --prefix remix run verify:vercel-output` |
| Graphify | `scripts/graphify update .` after code changes; `npm run test:graphify-cas` for the wrapper |
| Electron restart storage | `corepack pnpm --dir electron run verify:renderer-restart` after `build:web` + `verify:web`; isolated multi-process Chromium acceptance of `electron/lib/renderer-server.cjs`, shared journal and drafts. Nitro uses `node_middleware`; the profile owns a stable, collision-checked origin. See `electron/README.md`. |
| Sync settings continuity | `node remix/scripts/test-sync-continuity-ui.mjs` exercises actual retry/scheduled discovery against synthetic native/API replies; `node remix/scripts/test-device-sync-resources-ui.mjs` covers desktop/mobile retained measurements and draft boundaries. These isolated browser checks do not prove installed native transfers. |
| Native upload admission/recovery | With `THINGTIME_TEST_COMMANDER_INDEXER` set to the built disposable Rust helper, run `swift test --package-path macos/ThingtimeNode --filter MacUploadBatchOperationTests`. The peer verifies only submitted receipt subsets; 256-file completion spans fresh bounded windows with no repeated PUTs. Run `node --import tsx --test app/fileSync/uploadBatchJournal.test.ts` from `remix` for canonical individual-recovery and original-ID journal coverage. |
| Mac native sync fixtures | `macos/ThingtimeNode/scripts/test-commander-backup.sh` builds the isolated Rust helper, exports `THINGTIME_TEST_COMMANDER_INDEXER`, and runs folder, photo-original and remote-filesystem regressions. A clean full `swift test --package-path macos/ThingtimeNode` must also compile its executable dependency; the `@main` entry is `ThingtimeNodeApplication.swift`. |
| Local Electron bundle | `corepack pnpm --dir electron run build` runs `npm ci` for the separately locked `MCP/` helper before the web/native build and preserves an available installed app signing identity; a fresh worktree needs no manual MCP dependency install |
| Retained development app | `corepack pnpm@10.12.1 --dir electron dev:parallel --workspace=<task> --prepare-only` snapshots the canonical runtime into a named development app with independent dependencies/profile/managed replica/ports. `dev-workspace.mjs` owns transactional preparation and process ownership; `--stop-workspace` stops its verified group while preserving state. Never install an unmerged candidate over stable. See `electron/README.md` and `electron/test/dev-workspace.test.cjs`. |

See [static analysis baselines](../static-analysis-baselines.md) for the audit,
workspace coverage and formatter/CI limitations. A compiler launch failure is
not a clean run and cannot justify rewriting the baseline.

## Graphify snapshots and hooks

- `scripts/graphify` wraps every mutation into immutable content-addressed
  snapshots under `graphify-out/snapshots/v1/` and refreshes ignored root
  aliases (`graphify-out/graph.json` etc. are symlinks). Snapshot files are
  marked read-only on activation so an older upstream hook writing through an
  alias fails instead of mutating committed bytes. Commit the snapshot
  directory the wrapper selected; never the root aliases.
- Hooks are opt-in per checkout: `npm run install-git-hooks` sets the
  relative `core.hooksPath .githooks` (the bootstrap does the same per
  worktree). Never point `core.hooksPath` at another checkout's absolute path.
- Design: [`docs/graphify-content-addressed-snapshots.md`](../graphify-content-addressed-snapshots.md).

## Browser verification

Use the in-app Browser pane with the checkout's `.claude/launch.json` entry
(`thingtime-web-<port>`), or a Chrome tab. Check desktop and 375 px, scroll to
the bottom, open menus/dialogs. When the pane is hidden, pointer actions time
out — probe with `javascript_tool` (`getBoundingClientRect`, `.click()`).

## Publishing

Feature/fix/docs PRs target `develop`; `main` only with explicit authorization
for that exact PR. Report the pushed branch, PR URL and the Vercel preview
(`pr-<n>.previews.dev.thingtime.com`). Add a `remix/CHANGELOG.md` entry under
`[Unreleased]`, a `PRs/<number>-<branch-slug>--<title-slug>.md` note for large
PRs (rename it once the PR number exists), `TESTING.md` lines for new bug
classes, and refresh the Graphify snapshot before the final commit.

The Web Platform runner is built by `build:platform` into `dist/platform`. Its
HTML references the exact JavaScript digest, and Vite/Vercel serve both assets
with no-store. Keep these outputs together when copying a runtime for testing;
`verify:vercel-output` checks the digest, isolated CSP and cache-header order.

Mac voice input follows `electron/lib/speech-recognition.cjs` → the signed
`macos/ThingtimeNode/Sources/ThingtimeSpeech` helper →
`remix/app/components/Lopu/desktopSpeechRecognition.ts` → the shared Lopu voice
engine. Packaging and permission setup are in `electron/README.md`; the desktop
mesh section of `TESTING.md` includes the installed-app acceptance checklist.

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.

`build:draft` builds the isolated native renderer into `dist/draft-preview`;
normal client builds and PM2 development include it. The generated policy is
shared by Vite/Vercel headers and the offline MCP capture process. See
[no-login draft setup](../no-login-draft-preview.md); its QA uses a uniquely
named canonical PM2 app on ports 22460–22462 and a new disposable replica.


`electron test/fixtures/folder-sync-host.cjs` is an isolated desktop folder-host
check: new temporary profile, real Chromium session/IPC, synthetic native dispatch.
It never registers or reconfigures the installed Node. The shared browser fixture
`/scripts/mobile-sync-editor.browser.html?platform=desktop` exercises the actual
editor with synthetic native/API replies. Neither proves signed installed Mac
transfers, restart journal recovery or native streaming throughput.
## Local API isolation

Vite always forwards to this checkout’s Nitro port. Missing Mongo/signing settings
return `503 LOCAL_API_NOT_CONFIGURED`; neither server selects production implicitly.
`remix/scripts/local-api-isolation-smoke.mjs` exercises built Nitro and Vite under
a macOS OS network sandbox, including direct-IP and redirect denial. Fixture
requests accept only a literal loopback HTTP origin and same-origin uploads.
Keep dedicated test credentials in place. Backend/browser network isolation is
optional and is not required for AI-agent work.


The no-login draft host uses `draftPreviewCsp` in Vite, Nitro `routeRules` and
Vercel output headers. Keep all three serving paths aligned; HTML meta CSP
cannot provide the opaque-origin sandbox. `MCP/test/render-export.integration.test.ts`
checks the real response and storage denial; `TT_DRAFT_TEST_SESSION` permits the
explicit isolated runtime origin after health/session verification. See
[no-login draft preview](../no-login-draft-preview.md).

## Isolated Linux browser acceptance

`remix/scripts/isolated-linux-browser.mjs` runs the packaged `node-server` build
through the existing agent-browser `application.cjs` adapter on Linux. It uses
Bubblewrap user/network/PID/mount namespaces, a fresh Mongo replica and generated
signing material. `copyApplication` snapshots the packaged server/client before
launch; `artifacts/build.json` records its aggregate content hash. Subsequent
worktree builds cannot change the running fixture. The only network is task-local
loopback. Explicit source and
runtime mounts omit host profiles, project config and credentials; nested dotenv
files are masked. `run` verifies the owning process/namespace and admits only
listed fixture URLs, artifact paths and generated session IDs. Browser tests keep
Chromium's sandbox enabled. `inside-check` proves browser/backend direct-IP,
hostname and redirect refusal plus missing host state; `stop` removes private
browser/database state and records cleanup while retaining artifacts.
The exact read-only `memory.current` and `memory.events` diagnostics cover the
managed workspace cgroup, including concurrent jobs; they are not per-fixture
memory or OOM counters.

Optional `start ... --admin-fixture` first registers an ordinary generated account
through the real API, then restarts only its owned server with that exact username
allowlisted. It enables the existing private local attachment store and verifies
the same account's administrator login. Its mode-0600 credential file lives under
the disposable private home, never artifacts; only the exact
`TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE` path is admitted by `run`. Guest and ordinary
accounts still cannot grant upload access. `--vault-fixture` separately generates
a new 32-byte server vault key for encrypted settings tests. No inherited admin,
storage or vault configuration is accepted. Cleanup removes the private files,
local objects and database together.

`application.cjs::verifyApplicationAssets` requires JavaScript responses for
the draft-preview, platform, library and embed bundles as well as the matching
SPA entry. A partial main-only Vite build that returns HTML 200 for a missing
bundle fails preflight. `agent-browser-application.test.cjs` covers that refusal.

Build client, offline shell, Nitro template and `NITRO_PRESET=node-server` server
first, without loading real configuration. Pass an independently verified local
`mongod` executable to `start`; no production database is accepted. See TESTING's
**Linux isolated anonymous/offline acceptance** for commands and prerequisites.
This proves the native web renderer in an isolated Linux browser. Installed Mac
app controls, native runtime claims and deployed previews need separate evidence.

The offline service worker serves a previous complete shell when a replacement
worker activates before its new cache is ready. Both document and asset reads
check the cache completion marker. Run `node --test remix/scripts/offline-shell.test.mjs`
and verify the worker controller, cached document and shell assets before taking
the transport offline in browser acceptance.
## Commander native background indexing

`Commander/apps/daemon/src/services/indexing.ts` schedules coalesced subtree updates and periodic full reconciliation;
`filesystem-indexer/crates/indexer` owns transactional SQLite/WAL snapshots, ignore traversal and unique counters.
`Commander/script/dev-parallel.sh` runs an isolated native development bundle beside the installed app;
`Commander/script/verify-background-index.mjs` verifies its real bundled daemon against disposable filesystem events.
Run Commander typecheck/tests, both Rust crates and the native checks in `Commander/docs/TESTING.md`. Index status
changes negotiate the daemon's `commander.index-status` capability; no Thingtime data API is added by this lane.

## Shared Rust filesystem workspace

`filesystem-indexer/Cargo.toml` owns the local `core`, `indexer` and `ffi` crates
and one lockfile. Native build scripts reference these paths directly; no
registry release is required. `filesystem-indexer/README.md` documents consumers,
iOS toolchains and isolated build outputs. Run workspace Cargo tests, the linked
Swift/Rust fixture (`apple/FileSync/test-embedded-rust.sh`) and affected native
host suites before signing and installing. Release listeners include changes in
this directory for every consuming app.

The iOS TestFlight workflow resolves the stable Cargo executable through rustup,
preserves custom toolchain homes and installs device plus arm64/x86_64 simulator
targets before its pre-credential native tests. Its executable setup regression
is `node --test iOS/scripts/tests/rust-release-toolchain.test.mjs`; the fixture
runs the actual workflow step without downloading a toolchain or using secrets.

The early Mac sync fixture uses `scripts/mac-fixture-tls.mjs` and the test-only
`mac-fixture-worker-trust.cjs` preload for ephemeral HTTPS byte storage on 28313.
API/native identity remain on 28311; only the exact canonical transfer-worker
child receives the public test CA. `mac-fixture-tls.test.mjs` covers correct,
wrong and missing CA trust plus unrelated-child isolation. No OS trust changes.

Native Release packaging uses the explicit shipping-product set in
`macos/ThingtimeNode/scripts/build-bundle.sh`, shared by build, executable checks
and copying. Test-only Swift fixtures remain in the debug lane. Run
`electron/test/native-bundle-build.test.cjs` for required-product failure/missing
executable refusal before staging, then the canonical signed bundle verification.

Fixture phase evidence uses `FixtureReceiptObservations` and request timing in
`mac-fixture-transport.mjs`; native clock provenance lives only in the
`Tests/MacFolderSyncFixture` executable (`--self-test-timing`). Proof observers
must drain before success/resume while leaving the consumer unblocked. Shipping
Swift sources, authorization, rates and native active-slot policy are unchanged.

## Encrypted attachment download CORS regression

`remix/scripts/test-password-file-download.mjs` exercises the real password
attachment UI against a separate synthetic storage origin. It rejects missing
GET CORS, then verifies an exact-origin response downloads decrypted bytes at
desktop and mobile widths. See TESTING.md for invocation and production checks.

### Native bundle activation verification

`electron/lib/web-bundle-activation.cjs` owns close/relaunch reservations;
`renderer-server.cjs` fences live HTTP/stream/websocket work and the Nitro
ChatGPT runtime plugin exposes an in-process queue/OAuth reservation. Renderer
persistence participants live in `desktopBundleSafety.ts`. Full local API mode
remains pending until detached background work participates. Run the Electron
unit suite, renderer safety/persistence and ChatGPT runtime tests, then the
separate development startup verifier. Positive remote-mode automatic activation
still needs its own real downloader/dirty-edit/relaunch acceptance fixture; see
`docs/native-web-bundles.md`.
