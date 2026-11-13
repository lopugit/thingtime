# Parent-path pins in the Thing browser

Pins are personal placement preferences. A pin belongs to an account, API origin,
data plane and ordered parent path, not to the target Thing. The same Thing can
therefore have different pin positions in Things, Builder and another parent.
Pinning never changes the source Thing, its ownership, folder, audience or ACL.

## Location and interaction

The stable path starts with the browser page identity and continues through its
parent identifiers. Search text, kind filters, sort, grouping, grid/list/columns
layout and display preferences do not create new pin scopes. Each visible column
uses its own parent path. Stored cloud files have a distinct browser path; live
remote inode entries are ephemeral and do not pretend to be persisted Things.

The canonical Thing action catalogue defines **Pin**, **Unpin** and **Reorder
pins**. Browser adapters provide those capabilities for their current location.
Both item overflow/right-click menus and the background menu can enter reorder
mode. Drag handles support pointer and touch input; move buttons and arrow keys,
Home and End provide alternatives. **Done** leaves the mode. Ordinary content
keeps its selected sort order after pinned content. Filtering does not delete
pins, and a filtered reorder preserves the other pins.

## Storage and authorization

`thing-browser-pin` is a private protected Thing per source and scope. Its source
identity and order are scalar properties; pins do not accumulate in an array on
a parent or user. A separate `thing-browser-pin-scope` private Thing carries the
scalar revision used to serialize changes. Scope identity hashes the exact
origin, owner, data plane and ordered path. Shared root unique keys prevent
concurrent duplicates; existing target/kind/creation indexes support paging.
There is no separate database, collection or per-path MongoDB index.

The dedicated API rechecks source authorization when pins are saved and read.
Inaccessible targets are omitted without disclosing their content or why they
are unavailable. Owned device identities follow their dedicated home-plane
check. Archived dedicated content uses the same owner-only minimal browser card
as the archive list. Those pin rows may include an optional `presentation` card
with an allowlisted generic label, kind and timestamps; protected bodies and
participants never enter the pin response. Active dedicated content and another
owner's archived content remain unavailable. Generic Thing CRUD cannot create, change or reveal protected pin records.
Home-plane pin content participates in the canonical transactional storage
accounting for both the pin rows and scalar scope headers. Empty scope headers retain their revision to prevent stale requests from becoming valid again; they remain quota-accounted.

`GET /api/v1/things/pins` reads a bounded page with a revision and continuation
cursor. The page size is a processing batch, not a maximum number of pins. A
changed revision invalidates a continuation so the client can reread a coherent
list. Mutations require the last read revision; stale writes return a conflict
instead of silently replacing another session's changes. The client retains
usable cached order, applies optimistic intent and reconciles against saved
state, with inline retry on failure. Cache identity includes account, origin,
data plane and Character.

The contract is `api.things-pins` 1.0.0. First-party clients negotiate it at the
selected origin before dependent work. See the canonical API registry for exact
request and response fields, and `TESTING.md` for browser and privacy checks.

## Implementation and checks

- Shared contract: `remix/app/utils/thingBrowserPins.ts`.
- Storage service: `remix/app/api/utils/things/thingBrowserPins.ts`.
- Browser state and order: `useThingPathPins.ts`, `thingPathPins.ts` and
  `ThingPinControls.tsx` in `remix/app/components/Things/`.
- Menus: the shared `thingActions.ts` catalogue, `thingEntityMenu.ts` and
  `thingsMenuModel.ts`.
- Real API and browser acceptance: `remix/scripts/test-thing-pins-ui.mjs`, using
  disposable accounts/data and an isolated browser, never production fixtures.
