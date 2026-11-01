# Editable maps and routing

`tt-mapbox` is a map viewport primitive, usable in a saved Component or an
individually editable Builder element. Headings, fields, route cards and actions
remain ordinary blocks beside it. Application pages, schemas and Actions are
private saved Things; the framework does not install a hardcoded route app.

The viewport can load `favouritesSource` and `routeSource` from saved read
Actions using the normal viewer/shared authorization boundary. Both use
`{action,inputs}`; inputs can reference the page query. Each Action returns
`items` and an optional `nextCursor`, accepted back as the next `cursor` input.
The map follows all pages, deduplicates stable record IDs and refuses repeated
cursors. It does not impose a catalogue-size limit. A refused page never
publishes a partial result; account, Character, origin and target changes fence
late responses. Any page marked `cache:'no-store'` makes the whole source
result nonpersistent.

Favourites may provide `{id,label,coordinates:[longitude,latitude]}` records or
saved Things with `crystal.title`, `crystal.longitude` and `crystal.latitude`.
They display as teal pins. Route sources additionally return
`points:[{id,label,coordinates}]`, displayed as coral numbered stops while
favourites remain visible. `showFavourites:false` (or query string `"false"`)
hides favourites without clearing route stops. Fitting prioritizes the selected
route; selection-only changes preserve the current camera and Mapbox instance.
`onSelectQuery` and `onRouteSelectQuery` name page-query parameters for marker
selection, preserving the other current parameters. `selectedFavouriteId` and
`selectedRoutePointId` highlight their respective pins. `focusPoint` and
optional `focusZoom` focus a chosen coordinate without rebuilding the map.

Bind a live optimization result to `transientRoute`, with `routeId` set to the
selected route ID (or use `routeSource.inputs.routeId`). Only a matching
`transientRoute.routeId` can supply its `geometry` and `orderedStopIds`; switching
routes clears the previous line and optimization order immediately. Route
selection itself shows saved stop pins without making a Navigation request.
An explicit optimization displays the real provider line. This result remains
in the page runtime, outside saved Things and persistent source caches.

`height` accepts positive pixel numbers and simple CSS lengths such as
`100%`, `80dvh` or `calc(100dvh - 64px)` for map-first layouts. The existing
container observer resizes the canvas as editable drawers and responsive panels
change its size. Mapbox attribution and controls remain visible.

Keep the persistent viewport outside source-bound subtrees: those intentionally
reset local drafts on query navigation. `PageActionSurface` supplies the live
page's `query`, `last`, `viewer` and `page` bindings to ordinary editable blocks,
so an unconditional map does not need a source wrapper. Place route-bound forms
and record panels in their own source subtrees. Inert Builder previews retain
their inherited inspection scope and do not execute the sources.

Builder's **Expand into editable blocks** converts guarded `tt-form`, `tt-select`,
`tt-style`, `tt-change`, `tt-mapbox`, `tt-collection` and repeated `ttEach` nodes
into normal nested blocks. Each form field, button and repeated-card template
child keeps its own selection identity. Expansion retains the Component's source
Action and arguments; saving these intrinsic blocks negotiates `api.things`
1.44.0 and, for updates, `api.things-update` 1.14.0.

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
