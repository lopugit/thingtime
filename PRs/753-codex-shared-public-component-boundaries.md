# PR #753 — Preserve public component audience boundaries

## Reproduction and contract

A private action owned by B ran anonymously through B's public component,
but returned 404 through A's hidden-key page embedding that component. The
resolver limited all inheritance to A, so the public composition stopped
working merely because another author embedded it.

Each traversal now carries a freshly authorized audience boundary. Same-author
children inherit that boundary. An independently readable foreign component,
schema or action starts its own boundary for its authored descendants. The
outer root remains mandatory; neither boundary grants execution as its owner.

Page-authored overrides crossing authors have no inherited private authority.
The component's own defaults are traversed separately. A guessed private action
or media ID supplied by the embedding page cannot borrow either author's
authority. Writers inspect even untrusted rendered media IDs without assigning
them an audience, and reject new unavailable required dependencies before saving.

The older browser expectation that a public schema could not publish its own
private authored action was updated deliberately: such a schema must behave
the same when embedded as when opened directly. Independent ACL checks on
foreign nodes, anonymous operation scope, mutation denials and injection tests
remain in place.

## Validation — 2026-09-10

- Real API and built-client Chrome 152 fixture passed at 1440px and 390px.
  It covers signed-out Draw, foreign schema controls, copy independence after
  source revocation, wrong/retired keys, group removal, absent Edit Original,
  full-page scrolling and horizontal-overflow assertions.
- A third test account proves a writer who owns neither root nor component
  can include a public composition, but cannot inject private action/media
  references through either PATCH /things or POST /things/update.
- Action suite: 76 passed. Capability/route coverage: 27 passed. Webpages:
  91 passed with two opt-in skips. Attachment suite: 161 passed.
- Full Vite client, embed, Nitro and Vercel output build passed. The built
  origin-scoped manifest verifies Things 1.9.1, things-update 1.2.6,
  actions-run 1.3.1, things-fork 1.2.1 and attachment-content 1.6.2.
- Targeted lint passed. Full typecheck retains 108 baseline errors, none in
  the changed files; it is not claimed green.
- A fixture run concurrent with a build lost its API connection. Final proof
  runs the completed build first, then the fixture. Cleanup now respects
  bounded Retry-After responses; four earlier leftover disposable records
  were identified and removed, and final cleanup passed.
- Graphify maps were refreshed with the repository CAS workflow. Graph output
  is navigation evidence, not the source of authorization decisions.

Local validation uses http://localhost:12280. Tailscale/Funnel is unavailable:
the CLI wrapper points to a missing Tailscale.app executable. Local Nitro also
reports a pre-existing storage-accounting migration requirement; no migration
was performed as part of this change.

## Delivery and remaining scope

PR #750 separately promoted the prior saved-action fix to main as
df815f7d03501aea03b601fc094c11a216289ef9; its exact production footer was verified.
This follow-up targets develop first. Check the live PR for current CI,
security analyses, deployment and merge state rather than treating this note
as a live status source.

Independent binary-upload copying and the remaining whole-goal containment
audit are not claimed complete by this change. Stored ACLs and source content
are not rewritten by contextual reads.
