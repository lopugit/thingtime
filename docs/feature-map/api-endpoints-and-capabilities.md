# API endpoints and capabilities

`api.file-sync-transfer-admissions` 1.1.0 extends
`POST /api/v1/files/sync-transfer-admissions`. The owner can admit publication
of an exact private Photos original. Existing 1.0.0 admissions still authorize
signing and completing only the original reservation. Optional v4 Photos policy
requires `api.things` 1.53.0 and `api.things-update` 1.21.0. The import map and registry describe the route;
`test:api-capabilities` checks negotiation and `test:files:transfer-admissions`
exercises the built API. See [transfer admissions](../file-sync-transfer-admissions.md).

## Private device observations and locate actions

`deviceObservations.ts` implements owner-only location reads/settings and
device-bearer observations, with collection-generation fencing, immutable
sample IDs, observed/received timestamps and accounted retention cleanup.
The observations, observation-settings, node-observations and cleanup routes
have independently negotiated `api.devices-*` features at 1.0.0. History is
relational protected `device-observation` Things, not a growing device array.

`deviceAlerts.ts` and `deviceAlertMedia.ts` implement owner-targeted alerts,
bound APNs registrations, lease-authorized attachment versions and prepared
notification sounds. Their alerts/node-push/node-media/node-alert-sounds
features are 1.0.0; command features are 1.11.0. Devices/node-state 1.15.0
accept a closed optional model descriptor patch. Notification lists/settings
1.8.0 include device-alert history. Notifications-devices 1.3.0 removes the
old registration count limits that could discard existing device bindings.
Reuse existing ownership/session checks,
command approvals, leases, media holds and notification history. APNs provider
acceptance never asserts playback; uncertain effects retain their request ID.

Run `test:devices`, `test:api-capabilities`, the built-server manifest smoke,
and the native mobile/Node suites. `DeviceLocationWorkspace` is a scope-fenced
read/action adapter for private saved editable layouts, with canonical uploads
and a separately negotiated native location bridge. No new MCP is introduced.

## Independent backup destinations

`api.backup-destinations` 1.0.0 registers private full-account home-plane
`GET /api/v1/backups/destinations` in the docs registry and Nitro map. The shared
client negotiates its explicit requirement map before reading. Fixed-label
administrator vault registration is selected by exact deployment environment
and origin; only opaque destination IDs, labels and configured-unverified
status are projected. Primary attachment bucket reuse refuses. This is
configuration discovery only: execution remains unavailable. Run destination
unit/route tests, `test:api-capabilities` and the compiled
`scripts/smoke-built-backup-destinations.mjs --bundle <output>` proof; see
[independent destination setup](../backup-destinations.md).

## Incoming-share message compatibility

`api.chats-messages` 1.3.0 accepts large purpose-matched attachment selections
and message text without the old 25-item/4,000-character product ceilings.
`api.chats-messages-edit` 1.1.0 removes the matching edit ceiling. Both public
manifests derive these versions from `apiDocs.ts`; the Messenger client
negotiates them before mutation. No new HTTP route or permission is introduced.
Native sharing negotiates its own exact-origin `thingtimeShare` 1.x bridge.
Zero-byte social files require upload-start 1.9.0 and upload-complete 1.7.0.
Long shared Data text requires Things 1.50.0; updates, imports and the built-in
schema descriptor publish compatible contracts 1.19.0, 1.13.0 and 1.2.0.
Run `test:api-capabilities`, the attachment service tests, and the built-server
incoming-share acceptance before release.


## Connector confirmations and large mutation plans

`api.settings-connector-protections` 1.0.0 registers GET/POST
`/api/v1/settings/connector-protections`; the current owning account alone may
write its ten confirmation preferences, with `X-Thingtime-Expected-Actor` and
same-origin validation. Connected Things PATs can read their own effective
policy but cannot disable it. Missing settings default to enabled; failed
negotiation/read requires confirmation. `api.chatgpt-mcp` 2.0.0 uses compact
signed preview references, encrypted staged plans, paged review/history and
single-use application. Current account preferences are checked again at
application, including the underlying operation and workflow/undo rules.
Run `test:chatgpt`, `test:api-capabilities`, and
`test:connector-mutations:acceptance`. See the hosted connector documentation
for staged text parts and unavoidable upstream transport constraints.

`api.devices` and `api.devices-node-state` 1.14.0 add optional host resource
measurements to the existing device state mirror. `DeviceResources.swift`
samples host counters, `ThingtimeAPIClient` sends the fields only to a
compatible paired origin, and `normalizeDeviceState` validates the scalar
allowlist for writes and the owner-only read projection. Older snapshots omit
these fields. Run `test:devices`, `test:api-capabilities`, and the
`DeviceResourcesTests` Swift suite. See the [native node guide](../../macos/ThingtimeNode/README.md).

`api.devices-sync-control` 1.1.0 adds `/api/v1/devices/sync-control` for the
account browser and installed sync worker. `deviceSyncControl.ts` authenticates
the owner and current device pairing, delivers an immutable request once, and
accepts a result only from its claiming lease. Protected `device-sync-control`
Things reuse the device queue/unique-key indexes, secure BinData payloads and
shared control TTL; no new collection or index is introduced. File bytes and
native grants remain on the device. Optional owner-private `roots[].sourcePath`
location metadata survives the encrypted status result; it grants no ancestor
access and never appears in a public manifest. Run `test:devices`, `test:api-capabilities`
and `test:schemas`; see [browser device sync](../browser-device-sync.md).

`api.admin-mongodb-connections` 1.1.0 registers the private administrator
`GET /api/v1/admin/mongodb/connections` in the docs registry and Nitro map.
The shared `useApi` client negotiates it against the selected origin. Its reply
separates optional selected-server totals from paginated runtime/pool observations
and explicitly declares incomplete coverage. Optional monitoring topology models,
pool retention settings and allowlisted cumulative request-feature use explain
deployment costs without claiming measured monitoring or exclusive socket use.
Run `test:mongodb-connections`,
`test:api-capabilities` and `scripts/mongodb-connections-acceptance.mjs`; see
[connection inventory](../mongodb-connections.md).

Private task reporting publishes `api.agent-reporting` 1.0.0 on
`POST /api/v1/agents/reporting`; both manifests derive it from `apiDocs.ts` and
the Nitro route map. The ChatGPT MCP surface publishes `api.chatgpt-mcp` 1.1.0
and its separate `chatgpt.agent-reporting` 1.0.0 contract. OAuth authorization
publishes `api.chatgpt-oauth-authorize` 1.2.0 and `chatgpt.oauth` 1.11.0 for
the issuer-bound Codex CIMD and its exact ephemeral loopback callback.
The reporting tools
negotiate reporting, Characters and overview at the connected account's exact
origin, and require `agents.report` independently of `things`. Run
`test:agent-reporting`, `test:chatgpt` and `test:api-capabilities`; see
[the reporting runbook](../agent-reporting.md).

Explicit Thing presentation is shared crystal metadata: `registry.ts`
`validateThingtimeCrystal` retains `renderComponent` after each typed content
allowlist and validates embedded definitions through the canonical Component
sanitizer. `api.things` 1.42.0 and `api.things-update` 1.13.0 advertise it through
both generated manifests. The first-party create/PATCH/PUT client negotiates
1.42.0 when it sends a declaration. Omitted PATCH metadata survives content
edits; `null` remains an explicit unavailable renderer; replacement omission
removes the declaration. Malformed declarations fail validation. Saved pointers
never grant Component/dependency access. `renderComponentDeclaration.ts` shares
the declaration grammar and root-over-nested post precedence with rendering.
Run `test:schemas`, `test:feed`, `test:api-capabilities` and the isolated
`subspace-messages-acceptance.mjs` typed-post/comment persistence checks.

Environment API gateway ingress is negotiated through `api.environment-gateway`
1.1.0 and `/.well-known/thingtime-capabilities.json`. Server deployments use
the build-bundled `mongoConnectionPolicy` (`proxy` by default, `dedicated` by
opt-in) with the `THINGTIME_MONGODB_CONNECTION_MODE` runtime override. Dedicated
mode executes its own backend, advertises `gateway: null`, and refuses relay
traffic; it does not imply an isolated database. See [the gateway runbook](../environment-api-gateway.md)
for the audited environment mapping and pending activation evidence.

Mobile device descriptors use `app/devices/platform.ts` across validation,
projection, schemas and client types. `api.devices` 1.10.0 and
`api.devices-pairing-claim` 1.1.0 add iOS/Android to the existing signed pairing
protocol. Run `test:devices`, `test:schemas` and `test:api-capabilities`.
See [mobile sync acceptance](../mobile-file-sync.md) for pending native clients.

`api.devices-node-identity` 1.0.0 is a private device-token-only GET: the token
fixes both IDs and the owned device must still exist. `api.devices-disconnect`
1.0.0 is a full-user POST accepting only `deviceId`; `disconnectDevice.ts` revokes
that owner's matching device sessions in the home transaction while retaining
Things/files. Both routes use the import map and docs registry. Native
`ThingtimeAPIClient.verifyFileSyncIdentity` negotiates the optional identity
feature and selects the exact local credential. `device-identity.integration.mts`
checks real signed pairing, privacy, owner-only disconnect and no claim revival.
Character agent discovery uses `remix/scripts/character-coordination-preflight.ts`
and the shared `capabilityContract.ts` SemVer/origin contract. Run
`npm --prefix remix run characters:preflight -- --origin <selected-origin>` and
`test:characters-preflight`; see [the coordination runbook](../characters.md#agent-coordination).
This read-only client adds no route, permission or server contract. Edge refusal
must remain distinct from missing capabilities, authentication and membership.

Paired Mac inventory uses `api.devices` 1.10.0 and `api.devices-node-state`
1.11.0 (`deviceMenuBar.ts`, native `MenuBarTelemetry.swift`). Approved Bash uses
`api.devices-commands` / `api.devices-node-commands` 1.10.0 (`deviceScript.ts`,
native `DeviceScript.swift`). Both extend existing routes. Optional native
negotiation preserves compatibility with older origins; script leases require
explicit approved envelopes. Editable suites live in `appSuites/macMenuBar.ts`
and `appSuites/deviceScripts.ts`; scripts retain results only on explicit
private-Thing creation. See README and TESTING for limits and acceptance.

Timeline 1.18.0 adds named versions, undo and version export on the existing
route: the POST command `name-version` (`api/utils/timeline/versionNames.ts`,
shared `timeline/versionNames.ts`, protected kind `timeline-version-name`),
`mode: 'undo'` on preview-version/apply-version (`api/utils/timeline/versions.ts`
with injectable `entries/nodes/snapshot/deleted/recorded/live` seams,
`TIMELINE_UNDO_LABEL` in `timeline/publishedVersion.ts`), GET `export=1`
(`api/utils/timeline/exportVersion.ts`, `timeline.export` rate limit), and
page / `eventId` reads carrying `names` beside `notes`. Register changes in
`apiDocs.ts` (both capability pins), keep the kind in `schemas/registry.ts`,
and run `test:timeline`, `test:api-capabilities` and `test:timeline:versions`.

Timeline 1.17.0 adds contextual notes on the existing route: POST commands
`add-note`, `explain-change` and `remove-note` (`api/utils/timeline/notes.ts`,
shared `timeline/notes.ts`), page and `eventId` reads carry `notes`, and
`timeline.explain` rate-limits Lopu explanations (`api/utils/timeline/explain.ts`
over the Lopu platform model routing). Register changes in `apiDocs.ts`, keep the
`timeline-note` protected kind in `schemas/registry.ts`, and run
`test:timeline`, `test:api-capabilities` and `test:timeline:notes`.

Server Action admission/outcomes use `api/utils/timeline/actionOutcome.ts` and
shared `timeline/actionOutcome.ts`, called from the canonical server executor.
They retain safe effect receipts in the existing Timeline, never a new history
store or growing array. `api.actions-run` 1.37.0 and `api.timeline` 1.16.0 publish
this contract; the first-party client negotiates it. `test:timeline:action-outcomes`
checks real replica APIs, optional quota, privacy, partial failures and sealed
completion recovery. `timeline/actionRecovery.ts` validates delivery bundles;
`api/utils/timeline/actionRecovery.ts` verifies server proofs and admissions.
`localBackend.client.ts`, the existing IndexedDB store/sync and `useApi` retain
and resend the identical canonical event. `auth/jwt.ts` provides a durable
content seal using configured keys, never the development fallback. See
[the Timeline ledger](../unified-timeline.md) for incomplete-receipt boundaries.

Timeline 1.13.0 adds `related=1` with an owned webpage `thingId` to the existing
GET route. Cursor reads require `relatedRevision`; changed current-composition
membership returns `reset: true`. Shared definitions never expose another author's
private event graph. See `api/utils/timeline/relatedHistory.ts`,
`test:timeline:related` and [the Timeline contract](../unified-timeline.md).

Timeline 1.9.0 adds direct private `branchId` + `thingId` lookup on the same
route; the shared client/sync path validates identity and caches canonical
branch/head records without consuming queued pushes. See
[the Timeline contract](../unified-timeline.md).

Timeline 1.6.0 accepts explicit `storage=home` on the existing route while
`ownerId`/`dataPlane` remain authorization and identity fences. The scoped home
context applies to discovery, paging, drafts, exact versions, branches and
restoration without changing the surrounding request's database selection.

`api.mongodb-endpoint` 1.1.0 publishes root-data `dataPlane` using the same
canonical key as Timeline. `X-Thingtime-Expected-Data-Plane` is an optional
precondition on dispatched API requests: malformed keys return 400; a changed
selection returns 409 before the handler. It checks the selected source before
any explicit home/admin routing and grants no access. Ordinary source-fenced
requests preserve their header and selection through the same fallback as root
data; the upstream enforces the precondition. `app/api/utils/mongodb/dataPlane.ts` owns the identity and guard;
`app/utils/dataPlane.ts` owns the shared public validation/header/link helpers.

Saved theme history uses `api.themes` / `api.themes-delete` 1.1.0 and
`api.timeline` 1.5.0. The dedicated home writer records approved token versions
and retained deletion in its content transaction; no new endpoint or collection
is introduced. See [the Timeline contract](../unified-timeline.md).

`api.themes` 1.2.0 and `api.themes-shared` 1.1.0 add optional focus border,
two glow colours, blur and strength tokens. Theme saves negotiate 1.2.0 through
`theme/capabilities.ts`; older theme documents receive defaults without losing
other settings. `test:theme` covers normalization and the authenticated route,
while `test:api-capabilities` covers both manifests and client compatibility.

All data access goes through `/api/v1/...` (`FUNDAMENTALS.md` §1). Nitro
routes every documented endpoint to one catch-all handler; the docs registry is
the source of truth for the route table and both capability manifests.

Saved Webpage writes with editable intrinsic `tt-form`, `tt-select`, `tt-style`,
`tt-change` and `tt-mapbox` blocks require `api.things` 1.44.0 on create and
`api.things-update` 1.14.0 on update. Builder negotiates these before saving;
`api.webpages-resolve` remains the independent read contract.

Stored map source Actions are discovered through shared composition
(`api.actions-run` 1.39.0) and retargeted to their copied IDs in private copies
(`api.things-fork` 1.8.0). Map inputs and runtime row values do not grant access.

## Where the code lives

| Concern | Path |
| --- | --- |
| Catch-all handler and import map (`routeModules`) | `remix/server/routes/api/[...].ts` |
| Endpoint docs registry (`endpoint({...})` entries, `apiV1RouteKeys`, `createApiCapabilitiesManifest`) | `app/docs/apiDocs.ts` |
| Discovery manifest `/.well-known/thingtime-capabilities.json` | `app/api/utils/capabilities/thingtimeCapabilities.ts`, handler `remix/server/handlers/thingtime-capabilities.ts` |
| Legacy manifest `/api/v1/capabilities` | built in the catch-all from `createApiCapabilitiesManifest` |
| Client negotiation | `app/api/utils/capabilities/requireCapability.client.ts` (`requireThingtimeCapability(feature, minVersion)`), `capabilityContract.ts` |
| Nitro config (route table derived from docs, assets mounts) | `remix/nitro.config.ts` |
| HTTP helpers | `app/api/http.ts` (`json`, `readJsonBody`, `requireJsonContentType`, `redirect`) |
| Current user / actors | `app/api/utils/auth/getCurrentUser.ts`, `resolveThingsActor` (PATs, app tokens) |
| Rate limiting | `app/api/utils/rateLimit/config.ts` (`RATE_LIMIT_DEFAULTS`), `enforce.ts` (`enforceRateLimit(request, key, identity, { failClosed })`) |
| Route conventions example | the `themes` family and `app/routes/api/v1/attachments/content/_content.tsx` (dependency-injected loader factory for tests) |

## Adding or changing an endpoint (all steps, in order)

1. **Route file** `app/routes/api/v1/<group>/<name>/_<name>.tsx` exporting
   `loader` (GET/HEAD) and/or `action` (everything else). Return `json(...)`
   with `{ ok: true, ... } | { ok: false, error }`; use `readJsonBody` with a
   size cap for mutations; export a `create<Name>Loader(overrides)` factory so
   tests can inject dependencies.
2. **Import map** entry in `remix/server/routes/api/[...].ts`
   (`'v1/<group>/<name>': () => import(...)`). Missing this → Nitro 404.
3. **Docs entry** in `app/docs/apiDocs.ts`: `endpoint({ id, contractVersion,
   featureVersion, group, title, endpoint, summary, detail, auth, methods,
   steps, requestExamples, responseExamples })`. This registers the route in
   Nitro, creates the `-docs` twin, and publishes `api.<id>` on both manifests.
   Bump versions deliberately: PATCH for compatible corrections, MINOR for
   additive behaviour, MAJOR for removals or incompatible changes.
4. **Rate key** in `RATE_LIMIT_DEFAULTS` when the endpoint reads storage or
   mutates; call `enforceRateLimit` with `failClosed: true` for storage paths.
5. **Client**: add the call to `app/hooks/useApi.tsx` and negotiate
   `requireThingtimeCapability('api.<id>', '<minimum>')` before persisting or
   acting; keep a small requirement map per feature.
6. **Tests**: assert the feature on both manifests and the route in
   `routeModules` (`app/docs/apiCapabilities.test.ts`); route tests beside the
   route; the docs entry auto-generates two `-docs` smoke tests.
7. **Docs**: README section for any env/setup, `TESTING.md` checklist,
   `remix/CHANGELOG.md` under `[Unreleased]`, and the relevant feature map.

## Lopu continuity and native activity contracts

`api.lopu-chats-reply` 1.14.0 and `api.lopu-background-tasks` 1.3.0 describe safe
continuation metadata and local/server management. `continuationWorkflow.server.ts`,
`continuationSteps.server.ts`, `continuationFinalization.server.ts` and
`backgroundTasks.ts` retain a conversation claim until the executor saves its
last output and acknowledges completion. Uncertain work never replays. The
`api.lopu-live-activity` 1.0.0 route registers one aggregate native chat activity.
`readContext.ts` retains up to 16 private JSON-page locators in assistant message
`secure` BinData. `loadLopuHistory` returns them only after chat membership checks;
`restoreReadContext` rereads exact revisions through `get_thing` before any provider
disclosure. Reply 1.19.2 reuses the existing private background transcript for up to eight
completed tool results on an exact verified continuation (`checkpointResults.ts`
and `backgroundTasks.ts`); no Action is replayed. `aiTasks.client.test.mts` covers
terminal output polling and account/deployment boundaries. Reply 1.19.1 repairs tool-protocol stalls without replaying displayed
JSON or mutations. Canonical `test:lopu` includes workflow/admission and reload/account-switch
regressions; `test:lopu-ui` covers presentation and client state.

Thing discussions, linked references and metadata rename require `api.things`
1.27.0; rich linked comments require `api.things-comment` 1.8.0. Client negotiation
must reject main's earlier 1.23.0/1.7.0 workspace-only contracts for those features.

## Verify

Timeline is registered at `/api/v1/timeline` with `api.timeline` 1.7.0. Its
route handles private discovery, paging, immutable draft upload and explicit
version preview/apply commands, exact version reads, and named branch create/push/pull. Branch commands use an immutable operation id and per-Thing head revision; divergence refuses without changing published content. Shared formats and the client queue live in
`app/timeline`; storage, transaction integration and merge ancestry live in
`app/api/utils/timeline`. `test:timeline` and its opt-in replica-set integration
cover the contract. See [Unified Timeline](../unified-timeline.md).

Lopu reply 1.19.0 adds read-only `inspect_action` in `chatTools.ts`, reusing
`actions/execute.ts` resolution and `actions/actionInputs.ts` validation.
`test:lopu` covers confirmation ordering, revoked reads and incomplete contracts;
`test:lopu-chat-streaming` covers provider transport. `workspaceAppComposition.ts`
authors typed save inputs from the canonical service fields (`test:schemas`).

Lopu reply 1.18.0 adds bounded, lossless crystal inspection to `get_thing`.
`app/api/utils/lopu/thingInspection.ts` walks only the authorized public crystal;
JSON Pointer, revision and offset select exact pages without relaxing ACLs.
`test:lopu` covers the parser, output bounds and per-page authorization; the
provider transport regression lives in `test:lopu-chat-streaming`.

Lopu page contexts require `api.lopu-chats-reply` 1.16.0: dirty/ready flags and
omitted blocks survive transport and continuation. Missing blocks are never an
empty page; only known-clean saved pages may fetch their persisted tree.

- `npm --prefix remix run test:api-capabilities` — every `routeModules` key
  appears on the manifest, versions parse.
- Built server smoke: the discovery endpoint must return JSON with the selected
  origin, not the SPA shell (`verify:vercel-output`, preview `curl`).
- `curl <base>/api/v1/<group>/<name>-docs` returns the entry as JSON.

## MongoDB health failure shape

`app/routes/api/v1/health/mongodb/_mongodb.tsx` preserves the complete
`MongoConnectionStatus` shape when remote probes fail. `api.health-mongodb` 1.0.2
includes `custom: false` (the remote request has no viewer-selected database)
and `replicaSet: null` (unknown), alongside the existing disconnected/null
fields, timestamp and sanitized error. The status response remains HTTP 200;
it does not imply the database is connected. Remote health/status-data probes
must not forward the local session cookie. Run the adjacent `_mongodb.test.ts`
through `node --import tsx --test` from `remix/`, plus `test:api-capabilities`.

## Gotchas

- Auth modes: `none`, `optional`, `session`, `bearer`, `session-or-bearer`.
  Service accounts are not first-party attachment principals.
- `withAttachmentPrivateResponse` (or equivalent `private, no-store` headers)
  for anything touching private data.
- A duplicate object key in `nitro.config.ts` silently drops the earlier one
  (last wins); the ratchet catches it as TS1117.

## Remote filesystem commands

The existing devices command routes carry the bounded `filesystem` operation;
no arbitrary filesystem HTTP path is added. `deviceFilesystemCore.ts` validates
closed request/result shapes, `deviceCommands.ts` leases and fences reports,
and only an exact owner/device/command read returns short-lived bytes. History
and events exclude file data. Native and browser clients each negotiate a small
requirement map. `filesystemCommandRoute.test.mts` tests the real service with
a test collection; both manifest suites assert the additive contracts.
See [remote-files.md](../remote-files.md) for semantic versions and limits.

## Integration library runtime

`app/library/platformApis.ts` adds fixed read-only provider operations to
`api.library-request` 1.2.0, including Google Places POST search templates.
`app/library/request.ts` is the request builder and client requirement source;
`app/api/utils/library/request.ts` bounds and redacts upstream transport.
Browser Mapbox and Google SDKs use `app/library/sdkSandbox.ts` and the separately
restricted `/library/sdk.html` document. Browser keys never enter saved Things.
Run `npm --prefix remix run test:library`, included in `test:unit`, for catalog,
builder hierarchy, credential boundaries, and SDK recipe contract coverage.

## Browser Action programs

`api.actions-run` 1.7.0 prepares owner-only browser programs; `api.things` 1.28.0
and `api.things-update` 1.5.0 store the runtime and request grammar. The shared
HTTP catch-all checks `expectedActor.ts` before endpoint execution. Browser
transport/interpreter live in `components/Actions/browserActionHost.ts` and
`browserActionRuntime.ts`; no endpoint-specific UI behavior lives there.
See [authoring and verification](../builder-browser-actions.md).

JSON Action inputs and Web standards draft saving add `api.things` 1.33.0,
`api.things-update` 1.10.0, `api.actions-run` 1.12.0 and
`api.webpages-suites-install` 1.3.0. Both manifests and client negotiation cover
these versions. Input validation includes resolved defaults and child calls;
see the JSON input section in the browser Action contract above.


Live Web Platform form-event programs require `api.actions-run` 1.15.0. The
existing catalogue Action emits complete saved program data; `liveDOM.ts`
provides generic native method/event backing. The explicit `allowFormEvents`
context is confined by the runtime CSP and never enables form navigation. See
[Web standards runtime and tests](../web-standards-builder.md).

ECMAScript built-in receiver recipes add `api.actions-run` 1.16.0, negotiated by
the same manifests and client. Complete Component program data implements the
examples through existing language nodes; no additional runtime permissions or
new execution endpoint is required. See [coverage and native behavior](../web-standards-builder.md#ecmascript-built-in-receivers).

TypedArray, iterator and generator intrinsic recipes add `api.actions-run`
1.17.0. They extend the same catalogue with saved data programs using existing
language nodes; `javascriptIntrinsics.test.ts` checks native byte conversion,
protocol cleanup, engine differences and edited draft round trips. See
[intrinsic receiver coverage](../web-standards-builder.md#ecmascript-intrinsic-receivers).

Native constructor signature programs require `api.actions-run` 1.18.0. Both
manifests and client negotiation cover the additive catalogue contract.
`javascriptConstructors.test.ts` verifies native invocation requirements,
overloads, mutation/identity, callbacks, errors and saved edited defaults through
the existing data compiler. No new execution endpoint or permission is added.

Reusable binding and assignment patterns add `api.actions-run` 1.19.0. The
existing catalogue and Component runtime accept bounded pattern nodes in
declarations, assignments, parameters, catches and loops. Both manifests and
client negotiation advance together; no new execution endpoint or permission
is introduced. See the native-pattern section in the Web standards guide.


Web IDL option and callback programs add `api.actions-run` 1.20.0. The existing
catalogue Action emits complete dictionary/event/fetch/geometry/stream programs;
no new endpoint, runtime grant or storage shape is needed. Both manifest
assertions and client negotiation advance together. `webIdlFixtures.test.ts`
checks native semantics and edited saved data; browser checks cover geometry
and platform-specific behavior.


Native live-event bindings add `api.actions-run` 1.21.0. The existing catalogue
Action returns 107 more complete editable Component programs for HTML event
surfaces and GlobalEventHandlers attributes. Listener options, propagation and
cancellation flags, IDL replacement/return-false behavior and bounded native
receipts are saved data shared by the renderer, compiler and existing Thing
write/save/reopen flow. No endpoints or permission expansion are added.


Native media Component programs add `api.actions-run` 1.22.0. `mediaFixtures.ts`
authors 95 complete media examples; `mediaPolicy.ts`, `liveMedia.ts` and the
existing DOM binding interpreter provide the reusable property/method/event
backing. Both manifests and client negotiation advance together. No endpoint,
external media source or device grant is added. Save/reopen uses the unchanged
opaque program and private Component write boundary.

Canvas catalogue programs negotiate `api.actions-run` 1.23.0. Existing DOM worker
transport now accepts bounded surface roots and Path2D/ImageData construction;
`canvasPolicy.ts`/`canvasSupport.ts` own native receiver/resource limits and
`canvasFixtures.ts` owns editable program data. Surface access never exposes the
runtime Document or permits unrelated tree mutation. See the Web standards
Canvas checklist for native pixels/fonts, private save/reload and scope refusal.

SVG catalogue programs negotiate `api.actions-run` 1.24.0. `svgFixtures.ts`
authors 311 complete namespace-aware Component programs; `svgPolicy.ts` and
`svgSupport.ts` register bounded surface receivers and local resources. The DOM
transport adds primitive IDL constants without constructor handles. Native bbox
option probes distinguish ignored options from implemented behavior. Both
manifests and the client advance together; storage, endpoints and CSP remain
unchanged. See the SVG section of the Web standards guide and native checklist.

CSS Typed OM programs add `api.actions-run` 1.27.0 for registered native CSS
factories/parsers, constructors, arithmetic, transforms and scoped style maps.
The existing opaque receiver bridge and catalogue/save Action contracts remain
canonical. See [native CSS Typed OM programs](../web-standards-builder.md#native-css-typed-om-programs).


CSSOM programs add `api.actions-run` 1.28.0 for native declarations, bounded
stylesheet/rule receivers, scoped adopted sheets and awaited replacement.
`cssomPolicy.ts`/`cssomSupport.ts` define generic contracts; `cssomFixtures.ts`
contains reusable program data. Worker Stop/deadline handling fences late
native Promise replies. The canonical catalogue and private Component save
contracts are unchanged. See [CSSOM programs](../web-standards-builder.md#native-css-object-model-programs).

Observer programs add `api.actions-run` 1.30.0. Saved `dom-callback` expressions
carry authored functions through the existing worker transport; synchronous
`dom` batches preserve native mutation queue semantics. Observer targets,
options, receivers and callback delivery are bounded and run-owned. Completion
and Stop disconnect native observers without extending the shared deadline.
The catalogue, save Action and private Component contracts remain canonical.
See [observer programs](../web-standards-builder.md#native-observer-programs).

Range programs require `api.actions-run` 1.31.0. Forty additional saved programs
use owned live/static ranges, native boundary/mutation methods and bounded
contextual fragments through the existing DOM bridge. See
[live and static ranges](../web-standards-builder.md#native-live-and-static-ranges).

Animation programs add `api.actions-run` 1.32.0. `animationPolicy.ts` and
`animationSupport.ts` bound native objects, keyframes and options; the existing
DOM bridge transports promises and authored callbacks and cancels native
animations on completion/Stop. Both manifests and client negotiation advance
together. See [native animation programs](../web-standards-builder.md#native-web-animation-programs).

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.
ARIA object programs add `api.actions-run` 1.33.0. `ariaPolicy.ts` adds bounded
nullable Element reflection and owned relationships; the existing worker bridge
preserves native frozen-list and element identity. Catalogue inputs/projections
remain saved data. See [native ARIA programs](../web-standards-builder.md#native-aria-object-programs).


## Lopu Action access

`api.lopu-chats` 1.6.0, `api.lopu-chats-update` 1.5.0 and
`api.lopu-chats-reply` 1.15.0 carry per-chat Ask/Full mode and browser/server
Action execution. `chatTools.ts` gates every mutation and Action; the
first-party host reuses `browserActionRuntime.ts` and the canonical
`server/utils/actionDataRoutes.ts` import map, which Nitro's `routeModules`
also spreads. Register a new delegable data route in that shared map; other
routes stay in the catch-all. Both still need the API docs registry entry.
See [authorization and validation](../lopu-action-access.md).

Native traversal and editable synchronous callback objects/functions require `api.actions-run` 1.35.0. `synchronousCallback.ts` evaluates bounded data instructions; `domBridge.ts` retains native ownership, traversal and callback/error transport. Both manifests and the existing Actions client negotiate the contract. See [runtime limits and acceptance](../web-standards-builder.md#native-traversal-and-synchronous-callback-programs).

## Lopu schemas, files and prompt settings

`api.lopu-chats-reply` 1.17.0 combines all earlier page-context and Ask/Full contracts with current base/personal prompt composition, visible-schema inspection and extension, and independent private attachment saving. The new `api.settings-lopu-prompt` 1.0.0 route supports authenticated personal checklists and admin base edits with revision conflicts. `api.lopu-voice-session` 1.2.0 returns composed session instructions consumed by both web and iOS direct voice clients. Endpoint docs remain the executable registration source; tests cover both manifests and the route import map.


Named-branch comparison uses `preview-branch-merge` on that same endpoint;
`api/utils/timeline/branchMerge.ts` reads the exact fenced head and shared merge
base. `TimelineBranchMerge` reuses `TimelineVersionComparison`, persists the
canonical draft merge event, then queues ordinary `advance-branch`. No new
endpoint, storage schema or collection is introduced. Both manifests assert
1.7.0 and `useApi.v1.timeline.branchMerge` negotiates it. Run `test:timeline` and
`test:timeline:branch-merge`; see the named-branch section of Unified Timeline.


Timeline 1.8.0 adds read-only `checkout-branch` on the registered Timeline route.
The exact branch revision and head are required. A transient materialized snapshot
accompanies the unchanged canonical entry; ordinary client events and branch
commands remain the only branch-edit writes. See the Unified Timeline contract.


`api.webpages-resolve` 1.5.0 adds bounded private POST component previews on the
existing registered resolve route. `webpages/componentPreview.ts` accepts only
blocks plus exact account/source query scope, then reuses the viewer-only batch
resolver without page/root grants. Both manifests, client negotiation, unit
checks and guarded `test:timeline:visual-branch` cover it. GET is unchanged.


Timeline 1.10.0 adds `components=1` with exact `eventId`/owner/dataPlane on the
existing registered route. The private response is `{ok,eventId,entries}` using
unchanged canonical events. Maximum 120 direct component dependencies; scalar
byte metadata is checked before payload decoding, then the result is capped at
4 MiB. Unknown/duplicate selectors, foreign accounts and stale sources refuse.
`useApi.timeline.componentBindings` negotiates 1.10.0; both generated capability
manifests derive it from the canonical docs entry. No new route or index.


Timeline 1.11.0 extends `preview-branch-merge` with optional `componentChoices`.
Opt-in responses include three bounded component-link maps and canonical capture
entries; old clients refuse versions with retained dependencies. Metadata is
preflighted before up to 360 unique captures are read in batches of 128, with
aggregate 4 MiB/200,000-node response bounds. No new route, collection or schema;
both manifests and conditional client negotiation use the canonical docs entry.


## Password manager

`PasswordGenerator.tsx`, `PasswordIcon.tsx` and `PasswordPasskeySetup.tsx` compose
editable settings blocks; secret output stays in the controlled entry draft.
`passwords/generator.ts` owns WebCrypto/preset validation. `passwords/icons.ts`,
`icons.client.ts` and `api/utils/passwords/icons.ts` own descriptors, anonymous
image loading and the separately sealed list projection. `test:passwords` covers
these boundaries; `scripts/password-tools.browser.html` is an isolated synthetic
UI fixture, not native-provider acceptance.

See [password-manager.md](../password-manager.md). `api.passwords` 1.3.0 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
Native integrations live in `apple/Passwords`, `apple/PasswordProvider`,
`iOS/Thingtime/Web/PasswordBridge.swift` and `electron/lib/password-provider.cjs`.


## Incoming mail

See [incoming-mail.md](incoming-mail.md) for Email settings, IMAP/POP3, private cloud storage, the paired local connector, offline reading and proxy inbox views.

## iOS TestFlight delivery

`api.integration-ios-release` 1.0.0 registers the production-only
`POST /api/v1/integrations/ios-release` in both manifests and the Nitro import map.
The native release script negotiates the origin manifest before requesting a
single-use GitHub OIDC credential delivery or explicitly enabled create-only
migration. No origin fallback is allowed. Run `test:ios-release`, capability and
API fallback tests; see [the release runbook](../ios-automatic-testflight.md).

Password migration coverage and encrypted file lifecycle: `passwords/onePassword.ts`,
`transfer.ts`, `fileCrypto.ts`, `files.client.ts`, `backup.client.ts`, and
`api/utils/passwords/files.ts`. Every original 1PUX member is retained as an
encrypted attachment to a source archive entry; item editors preserve structured
values, source context and password history. See [the password contract](../password-manager.md).

The admin migration status/run contracts are `1.4.0` for guarded incident cleanup;
the migration UI negotiates both before use. Missing local Mongo/JWT settings
produce a no-store `503 LOCAL_API_NOT_CONFIGURED` before handler/body execution.
Public docs and capability discovery remain local and available.


`api.ai-chatgpt-plan` 1.1.0 registers GET redacted account/attempt status, local authorization availability and storage mode; same-origin POST begin/cancel/select-model/refresh-models/disconnect/prepare-import/move-account/import-account. An optional `X-Thingtime-Expected-User` header rejects stale-account UI requests. `api.ai-models` 1.7.0 lists owner-scoped plan connections; `api.lopu-chats-reply` 1.20.0 resolves those IDs strictly even when saved and uses plan Responses without API billing fallback. Explicit desktop remote selections negotiate and pin the receiving API before proxying; local mode never falls back. `api.capabilities` 1.2.0 permits custom loopback data authorities for local runtimes. Both manifests derive these versions from the canonical docs registry; tests live in `ai/chatgpt-plan`, `apiCapabilities.test.ts` and the Lopu stream suite.

General compressor storage adds `api.things` 1.41.0, `api.things-update`
1.12.0 and `api.webpages-resolve` 1.8.0 for validated intrinsic media containers
with separately editable children. `api.webpages-suites-install` 1.7.0 installs
the upgraded media-tools definitions. Both manifest generators consume the
canonical endpoint registry; media suite clients require the new minor before
installation. No image-byte HTTP endpoint is introduced.


## Mapbox provider integration

`POST /api/v1/maps` negotiates `api.maps` 1.0.0. `api/utils/maps/route.ts`
uses full-account authorization, owner-scoped Vault references and operation
rate limits; `mapbox.ts` fixes provider destinations and redacts responses.
Register `_maps.tsx` in Nitro and the canonical docs registry. Run `test:maps`
and `test:api-capabilities`; see [maps](../maps.md) for provider storage constraints.
The saved Builder `tt-mapbox` viewport loads the official `mapbox-gl` npm
distribution JavaScript and CSS staged as Vite's same-origin public assets
(`components/Builder/Maps/mapboxSdk.ts`).
The application CSP permits only the Mapbox service and events origins in
`connect-src`, with its existing `blob:` worker allowance; it does not permit a
remote Mapbox script or eval. The separate Library SDK demo keeps its own
opaque-origin policy and CDN loader.

## Storage readiness and recovery

`api.storage-accounting` 1.0.0 publishes shared deferred-accounting semantics
from the canonical shared-feature registry to both manifests.
`api.health-nitro` 1.3.0 adds honest recovering state and source-stamp checks;
`api.lopu-recordings-run` 1.6.0 adds aggregate storageRecovery outcomes on the
existing protected scheduler. Both manifests derive versions from apiDocs.ts.
The dispatcher records allowlisted storage failure codes without logging response
bodies. See [storage recovery](../storage-recovery.md) for transactional queue,
worker, controller gates and the scheduled production monitor.


Connections catalog, account/list, unlink, feed, filters and OAuth begin/callback
publish independent 2.0.0 contracts through `apiDocs.ts` and both generated
manifests. The existing `useApi` connection methods negotiate these requirements.
There is no new endpoint. Owner-private encrypted grants replace shared tokens;
OAuth app configuration is exact-origin/environment scoped. Read the auth map,
README social OAuth setup and TESTING before provider acceptance.
## Environment gateway and index readiness

The negotiated ingress contract and connection-mode policy are summarized at the
top of this map. `app/api/utils/deployment/environmentGateway.ts` owns bounded discovery,
admission and pool draining; `server/utils/environmentGateway.ts` validates
origin-preserving signed relays before the normal route authorization path.
`server/middleware/environment-gateway.ts`, the SPA fallback and capability
handler retain local discovery/static serving while routing data operations.
`mongodb/indexLifecycle.ts` and `indexMaintenance.mts` coordinate durable index
readiness without blocking read-only authentication. Existing admin migration
status/run contracts and Lopu background-task contracts carry their deliberate
compatible patch versions in both generated manifests.

Run `test:environment-gateway`, `test:collections`, `test:api-capabilities` and
the built `test:environment-gateway:acceptance` runner. See
[the gateway runbook](../environment-api-gateway.md) for server settings,
environment partitioning and outstanding live rollout acceptance.

## Public social metadata

`GET /api/v1/social-previews?path=` exposes `api.social-previews` 1.2.0.
`api.social-card` 1.4.0 and `utils/socialPreviewDesign.ts` share five template
IDs and four layout choices. Only `previewTheme`/`previewLayout` survive into
share metadata and matching canonical URLs so each chosen card stays identifiable. The anonymous JSON
projection adds resolved design and choice catalogues.
`meta/socialMetadata.ts` reuses the anonymous `resolveSocialPreview` projection
and `socialMetaFromPreview`; the route resets custom data-plane selection and
never resolves caller identity. Same-origin inputs lose query/fragment before
lookup, remote URLs are refused, and private/missing content uses generic
metadata. The JSON response is an explicit title/description/URL/type/image
allowlist. `social-previews.read` applies fail-closed anonymous rate limiting.
`meta/socialCardImages.ts` embeds canonical public attachment thumbnails in
cards, with bounded decoding and a fresh anonymous authorization/version check.
`api.social-card` 1.3.0 shares automatic route defaults from the actual browser
router (`scripts/generate-route-previews.mjs` →
`app/utils/automaticRoutePreviews.generated.json`), with optional literal
`socialPreview` exports in route modules. New app pages need no parallel backend
metadata registry. Saved `/p/:id` and `/t/:id` pages use
`meta/publicWebpageContent.ts` over the anonymous `resolveWebpage` projection:
visible supported copy/managed images are inferred; saved `name`/`description`
remain optional overrides. Runtime sources, Actions, private bindings and system
`siteRoute` layouts are never executed or inferred. Endpoint capability manifests
and semantic version negotiation still apply. See
[the automatic metadata contract](../seo-social-metadata.md).
Run `test:social-previews` and `test:api-capabilities`.

Named Connections management is opt-in at `api.connections`,
`api.connections-oauth-begin`, `api.connections-oauth-callback` and
`api.connections-unlink` 2.1. `POST /api/v1/connections/named`
(`api.connections-named` 1.0) verifies exact actor, origin, connection ID and
a fixed operation. Token envelopes never cross the response boundary.
Generic Things 1.46.3 also keeps private account and named grant metadata
behind the origin-scoped Connections API. See
`test:connections:oauth` and `test:api-capabilities`.

Connection provider artwork negotiates `api.connections-provider-icon` 1.0.0.
`GET /api/v1/connections/provider-icon?provider=<built-in-id>` serves cached
PNG bytes, 204 when unavailable, or 404 for an unknown provider. This public
asset stays on the document origin without opening a data-plane connection or
forwarding user headers to the provider. Verify both manifests and route
registration with `test:api-capabilities` and `test:connections:built`.

## Dynamic map workspaces

`api.things` 1.47.0 / `api.things-update` 1.16.0 accept editable `tt-upload` blocks.
`api.webpages-resolve` 1.9.0 identifies the updated page contract.
`PageActionSurface` and `webpageRuntime` support `$ui` query `scope: page`;
`Builder/Maps/` renders custom marker text, labels, icon lists and authorized
attachment avatars. `useWebpage` negotiates the upload save minimums.
`GET /things` numeric summaries reuse canonical ACL-checked `listThings` pages
through `api/utils/things/numericSummary.ts`, with exact schema/parent filters,
no item-count cap and no partial success. Run the summary, map overlay/data,
local UI, Webpage and capability tests plus live saved-page acceptance.


`api.things` 1.49.0 advertises exact authenticated counts (`count=true`), shared
literal archive filtering, and visible ordinal list windows (`offset`) on the
existing Things endpoint. Both manifests derive this additive contract from
`apiDocs.ts`; count and list reuse the same canonical scope and exact ACL gates.
See [Things and folders](things-and-folders.md#exact-authorized-counts-and-visible-offset-windows)
for query and response semantics, performance limits, and real replica coverage.


`api.maps` 1.1.0 adds exact-address `autocomplete:false`, allowlisted geocoding
confidence/accuracy metadata, and correlated `queries` batches on the existing
owner/Vault-scoped suggest operation. Batch inputs are validated before key
access, duplicate addresses share provider calls, processing chunks are not a
product cap, and failures never return partial results. Permanent results retain
the exact expected-selection and storage-policy contract. See [Maps](../maps.md).

`api.things` 1.49.0 also adds ordered authenticated `ids` JSON-array exact reads
on the existing GET endpoint. Missing/denied/protected positions are null;
canonical ACLs and projections are shared with single reads. This remains a
registered read-only Action request. URL/response transport limits require
chunkable clients, never truncation or a maximum dataset size.


`api.actions-run` 1.40.0 adds unary `ttExpr:["encodeURIComponent",value]`
for authored URL components. It accepts string/nullish inputs, refuses other
types and malformed UTF-16 without leaking the value, and retains the existing
expression output budget. Programs using it negotiate execution protocol 1.40;
encoding performs no HTTP operation. Both capability manifests derive this
version from the canonical registry. Run expression, browser Action protocol
and capability tests.

Large/deep editable Webpage capture is corrected by `api.things` 1.49.2,
`api.things-update` 1.18.1 and `api.timeline` 1.19.1. The shared iterative
Timeline block traversal removes the hidden 1,200-block/24-level write and
comparison limits; existing Component authorization and capture contracts remain.
Both manifests derive these PATCH versions from the canonical endpoint registry.

The bounded Mac byte transport negotiates independent native
`fileSingleUploadVersion` 1.0.0; it does not add HTTP endpoints or alter existing
API feature versions. The host/client continue to negotiate the selected origin's
attachment start/part/complete/content contracts and use those canonical routes.
The native proof includes attachment identity/version/size/fingerprint only;
publication remains the existing guarded Files contract. See the
[compound transport contract](../mobile-file-sync.md#bounded-compound-mac-upload-transport--2026-11-06).


## Shared-content request transport

Incoming sharing negotiates `api.things` 1.51.0, `api.things-update` 1.20.0,
`api.things-comment` 1.11.0, `api.chats-messages` 1.4.0,
`api.chats-messages-edit` 1.2.0, `api.attachment-uploads` 1.10.0,
`api.attachment-annotate` 1.3.0, `api.attachment-link` 1.2.0 and `api.files`
1.12.0. Both manifest generators derive these independent minors from apiDocs.
The scoped shared-content JSON reader admits authorization/rate limits before
streaming fatal UTF-8 decoding with no application body ceiling. Other control
requests retain numeric budgets. Completion accepts only uploadId and enumerates
parts server-side; presigning pages every part. See [incoming sharing](../incoming-sharing.md);
run `test:shared-content`, `test:api-capabilities` and the isolated real-API
`remix/scripts/shared-body-acceptance.mjs` harness.

The merged shared-value Action contract is `api.actions-run` 1.42.0. The
authored-controls branch independently used 1.41.0, so that origin alone must
not satisfy clients requiring complete shared Data values. Both generators
read the canonical version; shared-content Action clients require 1.42.0, while
older authored-control-only minima remain valid for their narrower contract.

`api.timeline` 1.19.2 corrects ordinary revision copy/reconstruction for valid
broad content. Existing snapshot parts handle breadth beyond inline processing
windows; no total-content node cap remains. Full-content checkout, merge,
export and restore clients require this patch. Metadata reads retain their
older minima. Run `test:timeline`; the wire/parts formats are unchanged.

## Reviewed creation projections and execution admission

Things 1.52.0 adds derived `executionHeld` and owner-only scalar
`creationProgress`. Component browse 1.1.0 and Webpage resolve 1.13.0 retain the
hold; Actions run 1.43.0 refuses held server/browser/shared/child admission.
Both manifests derive from `apiDocs.ts`; clients negotiate the small maps in
`backups/contentCreation.ts` and `utils/sharedContentCapabilities.ts`.
There is no new restore route/import-map entry. Run capability coverage plus
`backups/creationContract.test.ts`, the real ordinary-restore replica proof and
the isolated execution-hold browser check. After the canonical Remix build,
`test:content-execution:built` imports the compiled Vercel fetch handler in a
clean synthetic runtime and checks both manifests and all four docs routes.


## Client discovery failure classification

`requireCapability.client.ts` uses the canonical `ThingtimeApiError` for network,
deadline and HTTP discovery errors, including an interrupted response body.
Parsing and compatibility checks remain separate: malformed/missing/breaking or
wrong-origin manifests and 401/403/404 cannot retain protected projections.
Temporary failures may retain a same-scope readable template only while execution
remains unverified and inert. This is a client lifecycle correction, with no
endpoint/manifest feature change. Run its focused tests and the full real-route
Schema refresh/revocation fixture documented in `TESTING.md`.

### Account-file restore writer epoch corrections

`api.files` 1.12.1, `api.things-bulk` 1.7.1 and `api.things-delete` 1.1.1 fence
writes/moves/drains of held restored content through the root content epoch.
`ACCOUNT_FILE_RESTORE_REQUIREMENTS` negotiates them with existing Things,
Timeline and exact attachment content contracts. Both manifest generators derive
versions from `apiDocs.ts`. Trusted transaction composition and audit labels are
internal options, never new accepted HTTP fields; public retained-version input
and upload approval remain unchanged. Run `test:api-capabilities`, the backup
contract test, canonical build/output smoke and `test:backups:file-restore`.


Backup dispatch recovery is `/api/v1/backups/run` (`api.backup-dispatch` 1.0.0),
registered in the docs registry, Nitro import map and existing Vercel cron config.
GET uses the existing scheduler secret; POST uses full same-origin administrator
permission and no selectors/payload. `backupDispatch.server.ts` reserves opaque
attempt IDs before SDK start; `backupJobs.ts` keeps original-session and
transaction/lease fences. No browser call can supply a Workflow run ID, store
address, original session or runnable intent. Source configuration and compiled
routing are not deployed scheduler/provider evidence; see TESTING and README.

The first-party `/api/v1/backups/workspace` contract (`api.backup-workspace`
1.0.0) provides catalog, sealed snapshot pages, durable job progress and completed
review reads, plus fixed snapshot/review/restore/control commands. Its route,
Nitro map, `useApi` wrappers and explicit requirements share the DTO in
`app/backups/workspace.ts`. Saved source paths come from a bounded worker catalog
stage over retained exact-timestamp descriptors. Browser reads never obtain
provider configuration, session references, execution leases or writable intents.
See the first-party backup workspace checklist in TESTING for real HTTP/Builder
acceptance and the separate deployed scheduler/provider gates.
