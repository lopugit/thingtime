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
