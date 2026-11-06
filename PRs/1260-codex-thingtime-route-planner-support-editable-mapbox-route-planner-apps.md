# PR 1260 — Editable Mapbox route planner framework

Saved apps need an interactive map, access to the viewer's own Mapbox Vault
entry, and paginated reads of their schema and parent relationships. The route
planner itself is authored as private saved Things. No account-specific page,
credential, contact, route or provider result is installed by this PR.

## Framework contract

- `api.maps` 1.0.0 provides address suggestions, explicitly selected Permanent
  Geocoding, public browser configuration and live route optimization.
  Provider requests stay on fixed Mapbox HTTPS endpoints. Requests require a
  full account and an owned Vault entry; secret tokens never become browser
  configuration. Responses are private/no-store and errors are redacted.
- `tt-mapbox` is a configurable viewport. Data changes update overlays on the
  same SDK instance. Account changes and unmount clear its map and token.
- `api.things` 1.44.0 filters exact saved schema and parent IDs before cursor
  pagination, preserving the existing owner, namespace and per-Thing ACL fences.
- Saved Webpage writers accept the existing guarded form, selector, change,
  style and map primitives as editable element boundaries. `api.things-update`
  1.14.0 and the Builder's requirement map negotiate this additive contract.
  Component expansion preserves source scopes, repeated templates and JSON-only
  Timeline events so nested controls can be selected, saved and reloaded.
- Page conditions receive the selected runtime query. Component dependency
  discovery traverses authored containers and inactive branches, preserving
  authorization and captured-version behavior.

Mapbox Optimization v1 has a provider limit of 2–12 stops. The app does not
silently split routes or claim a global optimum. Standard Mapbox Navigation
results are transient; user-authored favourites, groups and stop lists remain
durable. Permanent Geocoding has its own account entitlement and billing terms.

## Evidence and remaining acceptance

Focused provider/map/filter/capability tests, TypeScript, production/Vercel
output build and isolated built HTTP smoke have passed. The smoke uses a
disposable account and replica set, and tests map access refusal, exact-origin
discovery, parent/schema intersections, pagination and account isolation.

Disposable rendered acceptance exposed query-condition, nested dependency,
form and Builder-editability defects. Regression fixes passed 121 focused tests
and TypeScript. The prior saved-app revision passed eight real browser/API
interactions, twelve desktop/mobile views and expansion of nine Component
instances into 381 saved editable blocks. Final authored disclosure-layout
acceptance is tracked separately. Provider fixtures and an inert test Vault
reference do not establish live Mapbox access or Permanent Geocoding entitlement.

Actual deployed map rendering, address selection, optimization, saved data
reload, and nested Builder editing remain required acceptance checks. The
integration runbook and permanent manual checklist are in
[maps.md](../docs/maps.md) and [TESTING.md](../TESTING.md).
