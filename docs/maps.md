# Editable maps and routing

`tt-mapbox` is a map viewport primitive, usable in a saved Component or an
individually editable Builder element. Headings, fields, route cards and actions
remain ordinary blocks beside it. Application pages, schemas and Actions are
private saved Things; the framework does not install a hardcoded route app.

## Provider contract

Negotiate origin-scoped `api.maps` 1.0.0 before `POST /api/v1/maps`.
Every operation uses the current full-account session and an owned `vaultId`.
Never put an API token in a saved page, Action, query string or source file.

- `browser-config`: returns only a public Mapbox `pk` token for the SDK.
  Secret `sk` tokens are refused. The map retains this only in component memory.
- `suggest`: `query`, optional `permanent` and `expectedId`. Autocomplete results
  are temporary. To save a selected geocode, send its full address with
  `permanent:true` and its exact `expectedId`; a changed match fails closed.
  Permanent Geocoding account entitlement, billing and provider conditions apply.
- `optimize`: `stops` of `{id,coordinates:[longitude,latitude]}`, `profile`
  (`driving`, `driving-traffic`, `walking`, `cycling`) and `roundtrip`.
  Mapbox Optimization v1 accepts 2–12 stops. Larger catalogues are valid, but
  this provider cannot optimize them in one request. Do not split a route and
  claim global optimization. A non-roundtrip fixes first and last stops.
  The result has `orderedStopIds`, GeoJSON `geometry`, `distanceMeters`,
  `durationSeconds` and `cachePolicy:'transient'`.

Provider destinations are fixed to Mapbox HTTPS endpoints; redirects, arbitrary
URLs and caller-supplied headers are refused. Failures never expose tokens or
upstream bodies. Responses are private/no-store. Browser programs must avoid
source-result persistence for temporary geocodes and optimization output.

## Storage and attribution

Mapbox Product Terms dated 20 October 2026, section 2.10.1, prohibit caching
Navigation API results. Standard integration therefore does not store optimized
order, geometry or estimates. Saved user-entered addresses, contacts, groups and
chosen stop order are separate user content. A route cache needs a provider
contract permitting retention; never relabel provider output as user content.

Mapbox Geocoding temporary results also cannot become saved locations. Store
only independently supplied coordinates or valid Permanent Geocoding results
under its entitlement and conditions. Google Places results displayed on a map
require Google Maps, so do not mix that provider's results into this Mapbox map.
Keep SDK attribution and navigation safety guidance visible.

Sources: [Mapbox Optimization v1](https://docs.mapbox.com/api/navigation/optimization-v1/),
[Product Terms](https://www.mapbox.com/legal/service-terms),
[Geocoding storage](https://docs.mapbox.com/help/dive-deeper/understand-temporary-vs-permanent-geocoding/),
[Google Places policy](https://developers.google.com/maps/documentation/places/web-service/policies).

## Verification

Run `pnpm --dir remix run test:maps` and `test:api-capabilities`, targeted lint,
and typecheck. For built HTTP coverage, build Nitro with `NITRO_PRESET=node-server`
and run `pnpm --dir remix run test:maps-built`. The smoke uses a disposable
replica set and synthetic account; it checks origin-scoped discovery, map
authentication, Vault failure handling, and schema/parent-filtered Thing lists.
`THINGTIME_TEST_MONGOD` selects an installed MongoDB executable. It never loads
production environment files or provider credentials.

Provider fixtures prove validation and redaction, not live token
access or Permanent Geocoding entitlement. Smoke the built manifest and map
endpoint, then verify a real account/Vault request, selection, optimization,
visible map and saved user data reload on the deployed origin. Use separate
synthetic local identities for local UI tests.
