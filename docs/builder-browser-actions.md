# Editable Builder definitions and browser Actions

Components, pages and Actions remain ordinary Things. Owners can use **Edit
definition** in a Component/page menu or the Action inspector to edit every
stored definition field. Fields mode supports nested objects and arrays,
explicit scalar types, insertion, removal and reordering; Source mode edits the
same JSON. Saving validates the canonical schema and uses `expectedUpdatedAt`
with `replaceCrystal`, so removing a property persists and stale edits refuse to
overwrite a newer revision. Sharing and record identities stay unchanged.

In **Actions → New action → Edit full program**, authors can edit inputs,
steps, conditions, expressions, capabilities and limits. The guided server
builder remains available. New full-program Actions are private by default.
Request steps require the browser runtime; replace server `things.*` steps with
requests when changing runtimes. Permissions can be derived from the steps.

## Browser request program

```json
{
  "name": "Load records",
  "runtime": "browser",
  "inputs": [{"name": "query", "type": "string", "default": ""}],
  "capabilities": [{
    "capability": "http.request",
    "endpoints": ["GET /api/v1/things"]
  }],
  "steps": [{
    "op": "http.request",
    "method": "GET",
    "path": "/api/v1/things",
    "feature": "api.things",
    "minimumVersion": "1.28.0",
    "query": {"q": "$input.query", "limit": 20}
  }, {
    "op": "return",
    "value": "$step.1.things"
  }]
}
```

`http.request` supports literal same-origin `/api/v1/...` paths and GET, POST,
PUT, PATCH and DELETE. Each step declares the endpoint's semantic feature and
minimum compatible version from its API docs. Query parameters accept scalars;
JSON bodies, inputs and results use the existing Action references, `ttConcat`
and pure `ttExpr` grammar. `compute`, `when`, `fail`, `return` and explicitly
allowlisted `actions.invoke` compose browser flows. Browser child Actions must
also use the browser runtime. Server programs keep their existing vocabulary.

The browser uses its current session. Definitions cannot supply credentials,
custom headers, another origin or redirects. Every request pins the account that
started the run with `X-Thingtime-Expected-Actor`; the server refuses a changed
account before executing the endpoint. Existing endpoint authorization, quotas
and validation remain authoritative. Browser programs are owner-only: foreign
or shared composition programs cannot borrow the viewer's private authority.
A deployment forwarding to a fallback API refuses these fenced requests.

The server prepares and validates a browser program; the client executes it.
Preparation is not execution and does not create a successful server run record.
The inspector shows the actual browser trace for that session. HTTP errors,
account changes, recursion, and operation/child/depth/time/byte limits stop the
flow; it never automatically retries writes. Earlier successful steps may have
committed before a later step fails. Review state before manually rerunning a
partially completed mutation.

The protocol is `api.actions-run` **1.7.0**, `api.things` **1.28.0** and
`api.things-update` **1.5.0**. Older run clients receive a refusal for browser
programs. Ordinary server programs retain their existing execution/history.
This foundation does not itself convert existing native workspace blocks.

## Cursor pagination

A GET request can collect a cursor-backed list with editable fields:

```json
"pagination": {
  "cursorParam": "cursor",
  "cursorPath": "nextCursor",
  "itemsPath": "things",
  "itemKey": "id",
  "maxPages": 20,
  "maxItems": 5000
}
```

The response must contain the configured list and cursor; `null` ends the list.
Dot paths select nested response fields. The first response supplies metadata;
subsequent pages replace the list and cursor. An optional item key deduplicates
overlapping pages, preserving first-seen order and the latest item values.
Repeated cursors, missing fields, changed accounts and exhausted budgets fail
the Action without returning a partial list. No request is retried. Every page
spends the same operation, time and result-byte budgets as other steps.
Browser programs may explicitly raise `timeoutMs` up to 120000 and
`maxResultBytes` up to 8388608; these larger envelopes also require the 1.8
execution protocol. Defaults and server Action limits stay unchanged.

Use the composer's **Add paginated request** preset, then edit its destination,
capability and response fields. Configure page/item budgets alongside the
Action's existing limits; these budgets protect a run from a broken server loop.

Pagination requires `api.actions-run` **1.8.0**, `api.things` **1.29.0** for
creation/PATCH and `api.things-update` **1.6.0** for that update route. Clients
send `executionVersion: "1.8.0"` when preparing browser programs. The server
refuses pagination for older or incompatible execution clients before any
request can run. Programs without pagination retain their 1.7 runtime contract.

## Verification

- `npm --prefix remix run test:actions`
- `npm --prefix remix run test:api-capabilities`
- `node remix/scripts/verify-actions.mjs <disposable-local-origin>`
- `TT_BROWSER_ACTION_TEST_LOCAL=1 node --import tsx scripts/test-browser-actions-local.mts`
  from `remix/`: explicitly opt-in; checks the dedicated loopback replica,
  creates fixture accounts via HTTP, then verifies real preparation/execution,
  ACLs, account fencing and stale definition protection. Sign-up rate limits
  apply; use a fresh disposable database for independent suite runs.

The isolated `thingtime-editable-services` checkout derives Vite **17120**, HMR
**17121**, Nitro **17122**. Local UI: <http://localhost:17120/actions>.
Acceptance used a disposable replica set on loopback **17123**, configured in
ignored `remix/.env`. No production data was copied. As of 2026-09-23, Funnel
could not be checked: the local `tailscale` wrapper targets an absent
`/Applications/Tailscale.app` executable. No public mapping was changed.

## JSON inputs

Actions can declare `type: "json"` for structured programs, objects, arrays or
scalar JSON values. The guided builder parses a JSON default; the inspector
provides a JSON editor. Typed JSON form fields decode once before transport.
API callers pass the actual JSON value in `inputs`; strings such as `"null"` or
`"$input.other"` remain literal strings, including across nested Actions.
Explicit null, false, zero and empty strings survive. Omitting an input selects
its declared default or triggers the required-input refusal.

Each JSON value is limited to 64 KiB of UTF-8 JSON, 4,000 nodes and depth 64.
Only JSON data is accepted. Resolved defaults and child invocations also obey
the Action's total input byte budget. Cycles, executable objects, getters and
sparse arrays are refused. The server independently validates every input.

This addition requires `api.things` 1.33.0 for creation, `api.things-update`
1.10.0 for updates, and `api.actions-run` 1.12.0 for preparation/execution.
The browser execution grammar remains 1.11.0; JSON data adds no executable node.
The Web standards draft-saving suite uses `api.webpages-suites-install` 1.3.0.

## Run an Action when a private page opens

An owner can add an optional `activationAction` to the saved standalone
Webpage definition. It stays separate from read sources, whose normal
refresh rules still apply. For example:

```json
{
  "action": "owner-saved-action-id",
  "cadence": "day",
  "timeZone": "Australia/Melbourne",
  "dayInput": "day",
  "inputs": { "collection": "my-daily-records" },
  "queryResult": { "selectedId": "record.id" }
}
```

Use the exact owner-private saved Action ID. `cadence: "open"` runs once per opening;
`"day"` also runs when the configured civil date changes while the page is
open. Day cadence requires a valid IANA timezone. Optional `dayInput` names
a declared string input; the server supplies the stable `YYYY-MM-DD` value.
Other inputs are literal saved scalars. Write Actions may ensure a stable
Thing identity so a second opening, tab or explicit retry can reuse it.
An ensure key must be literal or the bound civil-date input. Arbitrary
writes and composed child Actions are refused.

Only the full owning account viewing its saved private standalone page can
run the binding. Builder previews, shared readers, historical branches and
held content do not start it. Page copies and portable imports leave the
activation opt-in unset. Remove the
descriptor in **Edit definition** to disable it. A saved Action can also
read an ordinary private setting and return without creating or selecting
anything. No refresh or retry bypasses the server's live page, actor,
revision and date checks.

The optional `queryResult` maps named page-local query keys to result
paths. Returned scalar values fill the mapped keys that the reader has not
selected manually or set in a deep link. A result with no mapped values
leaves selection unchanged. A page switch invalidates a late result.

Authoring requires `api.things` 1.56.0 or `api.things-update` 1.22.0.
The live viewer negotiates `api.webpages-resolve` 1.14.0 and
`api.actions-run` 1.44.0 before activation. The canonical Actions endpoint
accepts `source: "activation"`, `action`, `activationPageId`,
`activationPageRevision` and `activationOnceKey` ("open" or the civil date),
plus existing browser-execution negotiation. Do not send Action inputs in
this request; only the saved binding may supply them.

## Create or reuse an owned Data Thing

In a server Action, add a `things.ensure` step through the full program
editor. Give it a literal schema reference, a non-empty text `key`, and
creation `values`. The key can resolve from an input or expression. An
optional `folderId` assigns a newly created Thing to an owned folder.
Declare `things.read` and `things.create` for the selected schema.

The invoker, saved Action ID, key and selected data plane identify the
Thing. Concurrent runs return the same private creation. Later runs return
the readable current `{ id, crystal, schema, schemaId }` and preserve edits,
folder moves and explicit audience changes. A mismatched schema or refused
read fails the run. Deleting the Data Thing frees the key.

## Exclude a map point from viewport fitting

Map source points may set `fitBounds: false` to keep their marker and normal
selection behavior while excluding its coordinates from automatic viewport
fitting. Omit it to include a point when the map fits its points and route.
This requires `api.things` 1.56.0.

## Load an independent map points layer

A saved `tt-mapbox` can add points from a literal Action reference in
`pointsSource`. The existing static points, favourites and selected-route
layers keep their own source and refresh behavior.

```json
{
  "action": "saved-map-points-action",
  "itemsPath": "points",
  "refresh": "interval",
  "intervalMs": 30000,
  "showError": false
}
```

Optional `inputs` can bind ordinary scalars from the current map scope.
Use the same cursor fields as a collection source. `itemsPath`,
`cursorPath`, `cursorInput` and `itemKey` default to `items`,
`nextCursor`, `cursor` and `id`. The source validates and combines
all cursor pages before publishing them. A failed read removes this layer
and leaves the rest of the map usable. If an editable status block already
reports the same read, set `showError: false` to suppress the map’s
additional source warning.

Authoring uses `api.things` 1.56.0 and `api.things-update` 1.22.0.
The live map negotiates `api.webpages-resolve` 1.14.0 and
`api.actions-run` 1.44.0. Shared composition and private copies follow
the stored literal Action reference and apply their existing access rules.
