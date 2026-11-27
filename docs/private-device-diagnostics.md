# Private device diagnostics

Every full owner has a lazily provisioned private **Debug** default folder.
`auth/me` attempts the backfill in the selected home plane; storage/quota failure
never fails authentication. The diagnostics endpoint exposes its own availability.
Protected root uniqueness, canonical accounting and shared indexes serialize
provisioning; there is no new collection, index or unbounded parent event array.
The root `libraryHidden` marker omits it from normal root/sidebar lists. Its ACL
is `["tt:user"]`, not unlisted `hidden` visibility or a hidden-link grant.

The managed folder cannot be shared, moved, edited or deleted through generic
CRUD; clear its contents instead. Atomic `device-diagnostic` children allow
ordinary owner Things/MCP reads, export and individual canonical deletion. A
parent ACL change never grants access to a diagnostic child. Administrator-only
error logs remain separate.

Negotiate `api.devices-diagnostics` and `api.devices-node-diagnostics` 1.0.0 on
the selected origin. Like device observations/transfer admissions, these routes
explicitly require home. A custom context gets 409 `DATA_PLANE_CHANGED`; there
is no silent rerouting. Ordinary Things/MCP reads independently select home.

Paired POST `/api/v1/devices/node/diagnostics` accepts `{action:"status"}` and
returns `{ok,enabled,folderId}`, without reading history. `{action:"append",events}`
returns `{ok,enabled,folderId,acknowledgedEventIds}`. The transaction serializes
live credential/pairing, opt-out, exact quota and append. Optional configuration
IDs must belong to that owner/device. One immutable UUID/payload yields one
event/charge; conflicting reuse 409. The 32-event/64 KiB request bounds are processing
and transport chunks, never history ceilings. No generic native write grant exists.

The shared wire contract is `remix/app/devices/deviceDiagnostics.ts`: closed
codes/categories/levels, native phases/reasons/failure operations/retry sources,
background outcomes/end causes, nonnegative counters, numeric runtime versions,
and allowlisted NSError domain/code. `runKey` is a 64-character hexadecimal non-authorizing hash.
Dates are canonical UTC ISO with milliseconds; UUIDs are lowercase. Raw text,
stacks, URLs, filenames, credentials, photo contents, userInfo/descriptions and
unexpected fields are rejected rather than heuristically scrubbed and retained.

Capture defaults enabled. Confirmed `enabled:false` stops native collection and
clears its opted-out spool, preserving sync/uploads/history. Re-enable is checked
at ordinary foreground entry. Offline events stay immutable on disk until exact
ID acknowledgement; clients honor 429 Retry-After and 5xx backoff. Missing
capabilities remain unavailable, never a generic-write fallback.

The iOS coordinator keeps a protected, backup-excluded outbox for each exact
owner, origin and paired device. A captured recorder retains that binding and
generation; stale callbacks cannot attach an old run to a replacement pairing.
Only closed event values reach the wire. Phase changes and errors are immediate;
repeated progress snapshots are sampled every ten seconds. A rejected immutable
event is isolated locally so it cannot prevent later events from being delivered.

Delivery uses the existing paired-device bearer transport. It never borrows a
WebView cookie, creates another background task, or throws into the sync worker.
Foreground and network recovery retry transient outages; a server Retry-After
deadline survives both and app relaunch. Capture can be disabled independently
of file sync from the editable `/things/debug` page. Saved events remain private
ordinary Things that authorized owner/MCP reads can inspect after a phone test.

Owner GET `/api/v1/devices/diagnostics` is read-only and returns
`{ok,folder,settings,events,nextCursor,throughSequence}`. `deviceId`, `level`, and
`category` filters precede pagination; limit 1–100 is a page size. Cursors bind
owner/origin/filter/date/ID and the initial sequence watermark, so concurrent
appends cannot repeatedly invalidate traversal. Unknown measurements stay absent.

Owner POST requires a full owner, same-origin and exact
`X-Thingtime-Expected-Actor`. Operations: `ensure`, `settings` with boolean
`enabled`, and `clear` with **both** immutable `requestId` UUID and server-read
`throughSequence`. Capture that pair at confirmation; retain it across chunks
and uncertain replies. Each clear deletes at most 100 eligible rows and returns
the same pair plus `deleted,hasMore`. Repeat unchanged while `hasMore`. Later
arrivals survive; late retries still have their original cutoff after any later
clear. No mutable last-operation identity or unbounded operation map is needed.

Verification: safe contract/privacy, builtin projection, owner-library and both
API manifest suites; `scripts/test-device-diagnostics.mts` exercises the built
API with a protected account handle from a new canonical disposable replica
fixture. Product state is seeded only through APIs. Installed native collection
and connected-production MCP acceptance remain separate layers.
