# Portable ChatGPT plan connections and Electron local runtime

## Behavior

Thingtime can explicitly enable a local Electron account API backed by an app-owned authenticated MongoDB replica set, or a configured remote database. Existing installations retain their endpoint selection until the user opts in. Local accounts are independent of cloud accounts. Generated signing/database/vault secrets use OS credential protection; ChatGPT records use encrypted Mongo storage.

The public dynamic-registration OAuth flow uses loopback, PKCE and verified OIDC identity. Lopu uses discovered account models, streaming Responses and existing tool permissions. Both explicit and saved plan selections fail closed instead of switching to API billing. Disconnect/move abort active inference and subsequent tool work.

A destination generates an expiring, account/origin/session-bound recipient code. The source seals one connection to the destination public key, durably disables source use and returns only ciphertext. Retriable receipts recover interrupted delivery; imports retain the receiving runtime host identity and enforce one refresh authority. A remote self-hosted GUI can manage and use imported connections; initial consent stays local. Generic content-database switching never relocates credentials.

Desktop API changes apply on restart with endpoint-specific browser sessions. Shared connection controls remain accessible from session recovery, so a fresh or offline installation can enable its local backend without a cloud sign-in. The proxy pins the negotiated target, rejects changes during requests, strips forwarded-origin metadata for private operations and propagates streaming/cancellation.

## Scope and acceptance

- Local MongoDB execution is optional. New macOS builds include pinned Community Server 8.0.34, upstream source and notices; fresh profiles prefer the included executable and existing selections remain intact. No Homebrew mutation or system service installation is included.
- Persistent self-hosted runtimes and encrypted database storage are supported; ephemeral serverless execution and automatic cloud-to-desktop job relay are not implemented.
- Public OpenAI docs explicitly describe self-hosted remote VMs. The implementation does not claim partner status or approval for every hosted service.
- On installed source `6de54fb70`, real local signup and user-approved OpenAI consent completed; the account connected and discovered GPT-6.1-Sol. Normal Quit stopped local API/Mongo; reopen preserved the local session and connection, and model refresh succeeded with saved credentials.
- First inference exposed the unverified-local-account admission bug. The follow-up adds a full-session, live owned-plan text-only exception and owner-bound persistence proof; installed inference and new picker-state acceptance remain pending the rebuilt app. No admin bootstrap was used.

## Verification

Client/server builds, focused suites, desktop/mobile fixtures, and a real isolated Electron local API/Mongo restart passed. Actual installed consent/model discovery/restart passed as above; completed live inference remains pending. The isolated bundled Mongo 8.0.34 storage integration also passed with OS-enforced loopback-only networking, encrypted move/reopen and stale-writer fencing. Coverage includes protocol/session/transfer ownership, Mongo authority fencing, API negotiation, streaming tool loops, desktop managed Mongo lifecycle and endpoint isolation. Client/server builds, changed-file lint and TypeScript baseline comparison apply. Built Nitro/Vite network isolation checks block direct-IP and redirected egress before synthetic testing.

The final documentation semantic-index refresh returned incomplete output and was rejected by Graphify’s integrity guard. A structural refresh retains the last complete semantic graph; the latest documentation edits are not claimed as semantically indexed.

## Public contracts

`api.capabilities` 1.2.0; `api.ai-chatgpt-plan` 1.1.1; `api.ai-models` 1.8.0; `api.lopu-chats` 1.7.0; `api.lopu-chats-update` 1.6.0; `api.lopu-chats-reply` 1.21.0. Setup and key ownership are documented in README and acceptance cases in TESTING.

## References

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions


## 2026-10-18 bundled database and session continuity

macOS packaging now includes checksum-pinned MongoDB Community 8.0.34, upstream source, SSPL license and notices. Fresh profiles select the included server; existing database executable choices and data stay intact. It remains an opt-in loopback child process, not a system daemon, and requires macOS14 for this bundled version. New builds require and execute-check it after signature verification; old-release recovery and macOS13 updates validate present signed resources without executing the optional database or enforcing the new pin.

Explicit legacy session recovery binds the verified original API and exact historical loopback content origin, reopens the whole defaultSession in place, and preserves the newer partition independently. One shared transition guard prevents backend/configuration changes racing recovery. A bounded window visibility fallback handles renderer failure/slow first paint. Responsive recovery controls passed 1280/375 viewport checks with full scrolling, cancellation, errors, recovery/switch-back and disabled states. Real Electron storage continuity in a nested network sandbox was blocked by Chromium sandbox initialization, so this is not claimed as installed user-session acceptance.

The combined integration build at `366e958da` passed the canonical installer and installed deep/strict signature verification at `~/Applications/Thingtime.app`. Its first launch started the local API and authenticated MongoDB and rendered the actual settings. Disabling local mode through those controls and restarting produced a ready production proxy and a connected cloud paired node. The macOS window was visible after relaunch; a computer-use window-resolution failure is recorded separately from application behavior. At that historical checkpoint, original-workspace recovery and real ChatGPT consent/model discovery/inference were unverified; the later consent/model/restart evidence is recorded above. PR #1034 is not merged. Integration PR #1035 also includes the scoped Linux native runtime repair from `268858367` (separate browser PR #1033), preserving the final combined installation.

The CodeQL connection-string hash finding was confirmed: public federation identifiers could support guesses of weak externally supplied database passwords. Public identities now use a domain-separated HMAC keyed by the existing private profile vault key. A one-time encrypted alias preserves the original renderer partition for the exact pre-upgrade database, including switch-away/return; no new URI receives an unkeyed identity. Existing storage is reused rather than copied.

Bundled MongoDB real-runtime smoke passed in an OS network sandbox: fresh bundled selection, authenticated loopback replica set, normal API registration, authenticated read after API/database restart, anonymous database access rejected, outbound/direct-IP/other-loopback/redirect escape denied. This is independent of installed UI and real ChatGPT consent acceptance.

## 2026-10-18 browser-manager main integration

Merged main at `323d7651651c5c501acd819ae39821ab75031182` (PR #1033). Packaging enforces both bundled MongoDB and agent-browser resources, and the parallel launcher retains bounded child-process shutdown/restart while accepting the new staged-build and UI-inspection flags. Isolated test backends refuse fallback before any origin lookup; normal selected ChatGPT runtime requests retain endpoint pinning, actor checks, streaming and cancellation.

Merged validation: Electron 163/163, selected API proxy 19/19, capability contracts 99/99. The durable bundled-local-runtime smoke script is included and passed in this feature checkout using its existing staged Nitro build: fresh bundled selection, normal account registration, authenticated session across restart, anonymous Mongo reads denied, and direct-IP/redirect/other-loopback escapes denied by the OS sandbox. This verifies the merged local-runtime helper against the staged backend; it does not claim a fresh merged web build, installed-session recovery, or live ChatGPT acceptance.

The current GitGuardian check remains red. Its detailed finding identifies existing incident `38239271`, commit `04deb95c85991f78513c28ebf7459c9aa39bcb83`, `remix/scripts/verify-password-manager.mjs:17`, matching the synthetic fixture already present on main. No credential value is reproduced here. The check has not been dismissed or marked successful.

Independent merge review found and resolved two integration regressions: all asynchronous desktop services now share one quit barrier, and desktop account information uses the running local API or pinned remote authority instead of pending saved settings. These implementations match the already verified integration build; regression tests cover shutdown ordering/failure and pending endpoint changes.


## 2026-10-18 Characters and CPU telemetry integration

Merged main `31b51e153` (Characters PR #1039 and CPU telemetry PR #1040), retaining the ChatGPT route, runtime, streaming proxy, session partitions, HMAC identity and bundled database work. Source conflicts were limited to the auth feature map, release notes and `test:unit`; both Character and ChatGPT suites remain included. Generated graph conflicts use one consistent prior snapshot followed by the canonical incremental refresh.

Independent auth review identified a request-override edge: a captured `X-Thingtime-Character` could pin credential management after the session selected another identity. The plan-management route now refuses that override before identity resolution or storage. Ordinary current-session authentication remains the authority for pending-operation revalidation. This compatible correction is published as `api.ai-chatgpt-plan` 1.1.1 with a regression covering begin, move, import and status requests.

Focused validation: Electron 163/163; capability contracts 101/101; ChatGPT plan 40 passed with one opt-in Mongo integration test skipped (no test Mongo binary/port supplied); Characters 13/13; auth introspection 10/10; streaming proxy 19/19; native MenuBarTelemetry 4/4. The first parallel Electron run hit `kill EPERM` in its unchanged process-group cleanup fixture; no fixture processes remained, its isolated retry passed, and the full retry passed. No Electron source changed in this merge. These checks do not substitute for the ongoing real ChatGPT consent/inference acceptance or a final installed rebuild.


## 2026-10-19 owned-plan admission and editable settings integration

Merged main `d12428728` and integrated the shared bound-block primitives, transient adapters and private settings documents. An unverified full-session user may use a connected plan they own for text chat; runtime resolution issues an opaque owner/provider-bound proof for admission and chat persistence. Forged request fields, revoked leases, Character overrides and stale account/catalog state fail closed. Ordinary API-key, catalog and voice policies are unchanged. Failed model/provider saves restore the last confirmed selection. Durable continuations keep their existing revocation-aware, owner-pinned session authority.

ChatGPT and desktop controls are individually editable blocks. Nested Builder selection reaches label and dialog children, control labels remain accessible without authored DOM IDs, and controlled checkboxes retain React restoration while dispatching exactly one private adapter operation. Full isolated renderer fixtures passed at 1280/375 pixels, including full scroll, model rollback, modal target/escape, account-change cancellation and nested label/dialog edit-save-reload. These fixtures are distinct from installed-app acceptance.

Combined validation: webpages 161 passed with four existing skips; settings 55 passed; Actions/composition 156 passed with one existing skip; capability contracts 102 passed. Admission/protocol tests passed 42 plus six real route/persistence-boundary tests; the optional storage test is separately validated with bundled Mongo under an OS network boundary. Lopu UI 238 and model/access 15 passed. TypeScript retains the same 91-error repository baseline with no additional diagnostic messages after fixing the merged stored-composition scope regression. Installed inference, new picker states and installed Builder persistence remain pending the combined rebuild; no admin grant has been used to bypass that acceptance.

The first combined CI run found two obsolete Lopu test fixtures allocating from `MAX_BLOCKS` after the shared Builder contract removed its product count cap. The fixtures now use finite 121-block pages and verify preservation through server patch operations and the client bridge. No runtime behavior changed. Full Lopu suites pass 189 + 169 tests, and Lopu UI passes 238; independent malformed-operation, operation-count, nesting and persistence guards remain covered.
