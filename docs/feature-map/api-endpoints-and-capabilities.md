# API endpoints and capabilities

All data access goes through `/api/v1/...` (`FUNDAMENTALS.md` §1). Nitro
routes every documented endpoint to one catch-all handler; the docs registry is
the source of truth for the route table and both capability manifests.

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
Canonical `test:lopu` includes workflow/admission and reload/account-switch
regressions; `test:lopu-ui` covers presentation and client state.

Thing discussions, linked references and metadata rename require `api.things`
1.27.0; rich linked comments require `api.things-comment` 1.8.0. Client negotiation
must reject main's earlier 1.23.0/1.7.0 workspace-only contracts for those features.

## Verify

Timeline is registered at `/api/v1/timeline` with `api.timeline` 1.2.0. Its
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
