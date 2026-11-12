# 21 — Composed app surface for Thing programs 📁

**Status:** 🔴 Not started · requested 2026-08-25.

## Goal

Data Things, Component Things, and Action Things together already make a
program, and each half is individually reachable: `/things` browses and edits
them, `/components` renders a component against arguments, `/actions` inspects
and runs an action. What is missing is the surface where they are one thing —
a page that renders several component things together, backed by their schemas
and data, where the buttons run the bound actions.

Give a folder of things a runtime view. Opening it renders its component things
live, in a composed layout, with `ttAction` controls firing as the viewer, so
the folder reads as a working mini-app rather than a list of parts. Every
element stays a Thing: clicking through from a rendered card reaches the thing
that produced it, and editing still happens in `/things`.

The naming constraint is non-negotiable and comes first. The `app` kind and the
root `appId` scalar are **already taken** by the third-party OAuth client
namespace, where `appId` stamps things written through an app token and scopes
every read. A first-party composed app must not claim either. Express app-ness
as a view over an existing folder, or introduce a distinct kind; do not overload
the client-identity control plane.

## Why it is scoped this way

The collision above and the reuse decisions below were verified against the
registry and the things utils while grounding this spec on 2026-08-25. They are
findings, not preferences, and they are the reason this surface introduces no
new kind and no new root field.

- **`app` and `appId` belong to the OAuth control plane.** The `app` kind is
  registered third-party client identity, `app-data` is its storage family, and
  the root `appId` scalar namespaces things written through an app token and
  conjoins into every read for them. A first-party composed app claiming either
  would collide with an unrelated notion of "app".
- **Folder-plus-view beats a new kind.** The registry refuses a `post` and
  `folder` composite on the rule that folder things stand alone and content
  goes in a folder by pointer, so an app cannot be a folder composite. Folder
  containment, the kind-registry dispatch, and the folder-scoped things read
  already exist and are tested; reuse all three rather than building a parallel
  membership or render path.
- **The untrusted allowlist already excludes `component` and `action`.** A
  shared or foreign app therefore renders no foreign component template at all
  today. That is a fail-closed default that this surface inherits, not a gap to
  patch in passing; widening it is its own review.

## Required experience

### Opening an app

- A folder containing schemas, components, actions, and data can be opened as a
  composed page instead of a file grid, and the choice is discoverable from the
  folder itself rather than hidden behind a URL.
- Component things render live from their resolved templates against their
  saved arguments, exactly as the trusted preview renders them today — never
  raw template tokens, never the JSON crystal.
- `ttAction` controls in that render fire, because this is a trusted,
  deliberately-entered surface for the viewer's own things. Confirmation
  behaviour follows the policy settled in
  `claude-todo/20-tester-runs-actions.md` rather than inventing a second one.
- Data written by a run appears in the same page without a reload, through the
  existing optimistic-paint rule: last-known state paints immediately from
  cache and reconciles when fresh data lands.
- Every rendered piece is traceable to its Thing: a card links to the component
  thing, an action control to the action's inspector and its run history, a
  rendered record to the data thing and its schema.

### Editing and composition

- `/things` stays the editor. This surface is the runtime; it must not become a
  second, divergent place to author components, schemas, or actions.
- Layout composition starts as the folder's own ordering and the components'
  existing sizing, not a new drag-and-drop canvas format. Any richer layout is
  a later, explicitly-specced addition.
- Adding a thing to the app is moving it into the folder, using the containment
  rules that already exist, so nothing about membership is a new mechanism.

## Naming and kind constraints

- The `app` kind is registered client identity for third-party integrations,
  with its own origin allowlist and byte ledger, and `app-data` belongs to the
  same family. Reusing either for a composed first-party app would collide with
  the OAuth control plane and confuse two unrelated notions of "app".
- The root `appId` scalar is the third-party storage namespace and conjoins
  into reads. A composed app must not stamp it.
- The registry refuses a `post` and `folder` composite, on the rule that folder
  things stand alone and content goes *in* a folder by pointer. A composed app
  therefore cannot be a folder-plus-something composite kind. Either the folder
  is the app and the app-ness is a route and a view preference, or a separate
  kind points at the folder.
- Prefer the folder-plus-view option for the first version. It requires no new
  kind, no new root field, no migration, and no new sharing semantics.

## Architecture and data rules

- Reuse folder containment as it stands: membership is the child's root pointer,
  never a list on the parent; the single assignment resolver stays the only
  validation chokepoint and keeps folders same-owner; ancestry checks stay
  cycle-safe and depth-capped; deleting a folder keeps re-parenting children
  rather than cascading.
- Read the app's contents through the existing folder-scoped things listing.
  No new endpoint is required to enumerate an app's parts, and adding one
  would duplicate an already-tested read path.
- Render through the kind registry rather than by hand, so a component renders
  identically here and in `/things`, and unknown or unmatched kinds cascade to
  their fallbacks instead of blanking the page.
- The untrusted flag gates three separate behaviours — a fail-closed kind
  allowlist that today excludes `component` and `action`, the click wrapper,
  and editor suppression. This surface must decide each one explicitly rather
  than passing a blanket trusted context, and must keep passing untrusted for
  anything that is not the viewer's own.
- Keep the two `data-tt-action` attributes as the only sanitiser hole. A
  composed layout adds rendering, not new attribute surface.
- Any per-app configuration that does become necessary belongs in the folder
  crystal or a dedicated kind, following the house pattern for new mechanisms,
  and never in a new root scalar unless the mechanism genuinely needs indexing.

## Safety and moderation

- Sharing an app means sharing its components and actions, and a shared
  component that binds an action is precisely the confused-deputy case
  documented in `claude-todo/20-tester-runs-actions.md`. A shared app must not
  silently run a stranger's binding as the viewer; the untrusted path and the
  confirmation policy both apply here, unchanged.
- Rendering a foreign component's template is currently prevented by the
  untrusted kind allowlist. If a shared app ever needs to render foreign
  components, that is a deliberate change to a fail-closed allowlist and needs
  its own review, not an incidental consequence of this surface.
- Actions invoked here run under the same identity, capability, budget, and
  rate-limit envelope as anywhere else. This surface adds no execution path and
  must not add one.
- `/things` grid tiles stay pointer-events-inert. A composed runtime view is
  the deliberate exception, not a reason to arm every tile everywhere.
- Ownership stays personal: folder assignment is same-owner by construction, so
  an app's membership cannot be edited by anyone but its owner.

## Done when

- A folder of schemas, components, actions, and data opens as a composed page
  that renders its component things live against their saved arguments.
- An action control inside that page runs and its result is visible in the same
  page without a reload, with the run recorded in the action's history.
- Every rendered element reaches its underlying Thing, and editing any part in
  `/things` is reflected the next time the app is opened.
- No new kind claims `app`, no write stamps `appId`, and no new endpoint
  duplicates the folder-scoped things read.
- A foreign or shared thing rendered in this surface still passes untrusted,
  and automated tests assert the kind allowlist and the click policy for the
  untrusted case.
- Automated tests cover membership listing, the composed render's kind
  dispatch, and the trusted-versus-untrusted branch; the actions and components
  live batteries stay green.
- Desktop and mobile browser checks cover opening an app, running an action
  from it, the data updating in place, navigating from a rendered element to
  its Thing, and a shared or foreign app rendering without firing anything.

## Existing anchors

- `remix/app/api/utils/things/things.ts` — folder assignment resolution,
  cycle-safe ancestry, folder-scoped listing, and the delete re-parent rule.
- `remix/app/components/Things/ThingsPage.tsx` — folder URL scoping, kind
  filters, breadcrumb ancestry, and the localCache optimistic paint to reuse.
- `remix/app/components/Kinds/kindRegistry.tsx` — the render dispatcher, the
  render context, and the fail-closed untrusted kind allowlist.
- `remix/app/components/Things/ThingsDialogs.tsx` — the existing trusted
  component render and the one surface where action controls fire today.
- `claude-todo/16-full-power-app-namespaces.md` — the third-party `app` kind
  and `appId` namespace this surface must not collide with.
