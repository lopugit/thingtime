# 20 — Run actions from the component tester ⚡

**Status:** 🔴 Not started · approved 2026-08-25 by the repo owner.

## Goal

A component's `ttAction` control must be runnable from the page where an
author is actually trying that component. Today `/components/:key` renders the
resolved template directly through the sanitising renderers, bypassing
`ComponentKindRenderer`, so the one wrapper that carries the click handler is
never mounted and a Send pill in the tester does nothing. The `/things`
PreviewModal is currently the only surface where a component's action fires.

Make the component page a firing surface: the live preview and the args tester
run the bound action as the viewer, through the ordinary bounded run endpoint,
with the tester's current argument values flowing into the action inputs.

Two constraints are non-negotiable. A run must never be a surprise: every run
started from the catalog is confirmed first, and the confirmation — never the
button label — is the source of truth about what will execute. And the browse
grid must stay inert: one shared preview component renders the feed, grid, and
columns views, so arming it arms every card of an infinite scroller at once.

## Why it is scoped this way

Both limits below were verified against the code while grounding this spec on
2026-08-25. They are findings, not preferences: do not relax either without
re-reading the cited files first.

- **One preview component serves the whole catalog.** The browse page's preview
  is a single component rendered by the feed, grid, and columns views alike, so
  attaching the click handler inside it arms every visible card of an infinite
  scroller in one edit. Nothing structural prevents that today — unlike
  `/things` tiles, the catalog previews carry no inert guard at all — which is
  why the prop-level default *is* the guard and has to be pinned by a test.
- **A component control can only run the viewer's own actions.** The delegated
  path — a `ttAction` click, as opposed to the deliberate `/actions` inspector
  Run — is owner-pinned for both reference shapes since the 2026-08-25 security
  review. Foreign markup naming a stranger's action id no longer resolves it,
  and a bare key never did. What remains is narrower but real: foreign markup
  can name one of *your own* actions with author-chosen inputs, and a bare key
  is still the case the dialog cannot resolve client-side. That residue is what
  the confirmation is for, and why its wording matters more than a lookup.

## Required experience

### On the component page

- The live preview and the args tester on `/components/:key` fire `ttAction`
  controls. Editing a tester argument changes the `data-tt-action-inputs` the
  run receives, so an author can try the same action against different values.
- Clicking a control opens a confirmation naming what will run before anything
  executes. Cancel runs nothing and leaves no run record.
- A signed-out viewer gets an informational "sign in to run actions" toast
  rather than a red error toast carrying the endpoint's 401. The catalog
  browses fine signed out and must keep doing so.
- A successful run reports duration and operations used and offers the deep
  link to the action's inspector, where the run record has just landed. A
  failed run surfaces the executor's own refusal text verbatim.
- Re-running the same action while iterating in the tester may skip repeat
  confirmations for that action for the rest of the page session. The skip is
  per action, never global, and never survives a reload.

### Everywhere else

- Browse cards in every view mode stay inert by default. Clicking a card's
  preview must continue to select or navigate and must never run anything.
- Arming a browse card is an explicit opt-in only, and only behind a signal
  that the viewer is testing that specific card, such as its argument drawer
  being open. It is not part of this change.
- The `/things` PreviewModal keeps firing exactly as it does today, and
  `/things` grid tiles stay pointer-events-inert. Feed and search renders stay
  untrusted and keep receiving no handler.

## What the confirmation must say

Every action a component control can reach is one the viewer owns, because the
delegated path is owner-pinned. The dialog's job is therefore not to warn about
whose program runs, but to make *which* of the viewer's own programs — and on
what inputs — impossible to mistake.

- A reference that resolves to one of the viewer's own action things renders
  the action's name, its numbered steps, its declared capabilities, its
  cannot-access complement, and its limits envelope, reusing the same pure
  helpers the inspector already renders from.
- A bare action key cannot be resolved client-side, because no key-to-action
  lookup endpoint exists. The dialog must state plainly that confirming runs
  the viewer's own action of that name with the inputs shown. Do not invent an
  endpoint to dress this case up; the honest wording is the safety feature.
- The resolved inputs are shown as JSON, truncated past a display cap.
- Component render templates are author-controlled markup, so a control
  labelled "Preview" or "Copy" can carry a `ttAction`. The dialog states what
  runs; the label is decoration.

## Architecture and data rules

- This is a client-only change. The run endpoint contract, its rate limit, its
  auth posture, and the executor's capability and budget enforcement are
  unchanged, and no new endpoint is added for the confirmation.
- Do not route the catalog previews through `ComponentKindRenderer`. That
  renderer's adapt step computes values as defaults merged with saved args and
  has no channel for the tester's live arguments, so routing the preview
  through it would silently break the tester it is meant to serve.
- Attach the existing click hook locally behind one shared gated wrapper so the
  surface policy lives in a single place. Whether a surface is enabled and
  whether it confirms are props, never duplicated logic at each call site.
- Extract the inputs-attribute parse out of the hook into a pure helper so the
  tolerant-parse contract is unit-testable without a DOM.
- Grid inertness is a prop-level default asserted by a test, not a
  `pointer-events` rule. A pointer-events guard on catalog previews would kill
  legitimate preview interaction.
- `data-tt-action` and `data-tt-action-inputs` remain the only `data-*`
  attributes the HTML renderer allowlists. This change adds no new attribute
  and no new sanitiser hole.
- The comment in the component kind renderer currently documents the opposite
  policy and must be rewritten to describe the surfaces as they end up.

## Safety and abuse controls

- The authority framing stays true and should be stated in the UI: a click
  grants the viewer no authority they did not already have. Actions run as the
  invoking viewer through the ordinary things utils, created things land
  owner-private with no channel for the component author to grant themselves
  visibility, search is hard-filtered to the viewer's own data things, the
  vocabulary has no delete, no network, and no secrets, recursion is refused by
  construction, and every run is clamped to the server's budget ceilings and
  the per-user run rate limit. A foreign private action stays invisible.
- What the framing does **not** prevent is why the gate exists. Foreign markup
  can still name one of the viewer's *own* actions with author-chosen inputs,
  and a bare key is exactly the case the dialog cannot resolve, so it must say
  so. Button labels can lie: the control reading "Preview" is author-controlled
  markup. A single stray click in an infinite grid is the failure mode.
- Require a signed-in viewer before offering to run, client-side, in addition
  to the endpoint's own refusal.
- Do not weaken any server-side check to make the client gate simpler.

### Ownership is already a trust boundary elsewhere — decide it here explicitly

The 2026-08-25 security review made ownership the trust boundary on the
`/things` PreviewModal: a component the viewer does not author renders normally
but inert, computed inside the modal so no call site can forget it. The catalog
is mostly seeded and other people's components, which is precisely where "try
this one" is most useful, so this surface cannot inherit that rule unexamined.

The settled policy for this spec, to be implemented as written or explicitly
overturned before work starts:

- Fire on `/components/:key` regardless of who authored the component, because
  the executor's owner-pinned delegated path already bounds a foreign
  component's reach to the viewer's own actions.
- Treat ownership as confirmation *strength*, not an on/off switch. A component
  the viewer authored may use the per-action, per-session skip; a component
  they did not author always confirms, with no skip.
- Do not weaken the PreviewModal boundary to match. That surface renders
  whatever a `?preview=<id>` deep link resolves, which is a different and
  broader exposure than a page the viewer deliberately navigated to.

## Done when

- `/components/:key` preview and args tester run a bound action, the tester's
  current arguments reach the action inputs, and the target data thing changes.
- The confirmation appears before any run, Cancel executes nothing and writes
  no run record, and confirming runs exactly once per click.
- The confirmation distinguishes a resolvable action reference from a bare
  action key and states the ownership consequence of the key case.
- Browse cards in feed, grid, and columns views run nothing when clicked, and a
  unit test pins that default so it cannot be flipped by accident.
- A component the viewer did not author always confirms and never offers the
  skip, and a test pins that ownership drives confirmation strength rather than
  silently becoming an on/off switch.
- The `/things` PreviewModal keeps refusing to fire for a component the viewer
  does not author; this change does not relax that boundary.
- A signed-out click shows the sign-in toast and issues no request that relies
  on a 401 for its user-facing message.
- Unit tests cover the extracted inputs parse against null, malformed JSON,
  arrays, scalars, and plain objects, the surface-policy helper against every
  surface and the untrusted and signed-out cases, and the confirmation copy for
  both reference shapes; `test:actions` stays green.
- The live batteries `verify-actions.mjs` and `verify-components.mjs` still
  pass unchanged, confirming no server behaviour moved.
- Desktop and mobile browser checks cover the confirm-then-run flow, Cancel,
  an edited tester argument reaching the run, the inert browse grid in all
  three view modes, the signed-out toast, and the unchanged `/things`
  PreviewModal and pointer-events-inert tiles.

## Existing anchors

- `remix/app/components/Actions/useTtActionClicks.tsx` — the click half:
  nearest-control lookup, containment guard, single-flight latch, run call,
  and result toast.
- `remix/app/components/ComponentsLibrary/ComponentDetailPage.tsx` — the live
  preview and args tester that must fire.
- `remix/app/components/ComponentsLibrary/ComponentsBrowsePage.tsx` — the one
  preview component shared by the feed, grid, and columns views that must stay
  inert.
- `remix/app/components/Kinds/kindRenderers.tsx` — the component kind renderer
  holding the only mounted click wrapper today and the comment describing the
  surface policy.
- `remix/app/api/utils/actions/execute.ts` — the two resolution modes, and the
  owner-pinned delegated path a component control runs under.
- `SECURITY-REPORTS/2026-08-25-action-thing-v1-security-review.md` — the review
  that established ownership as the trust boundary and owner-pinned delegated
  runs; read it before changing either.
- `remix/app/components/Things/ThingsDialogs.tsx` — the `/things` PreviewModal,
  the existing trusted firing surface, and the confirm-dialog pattern to copy.
