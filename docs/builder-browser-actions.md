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
