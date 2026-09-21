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
1.25.0; rich linked comments require `api.things-comment` 1.8.0. Client negotiation
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
