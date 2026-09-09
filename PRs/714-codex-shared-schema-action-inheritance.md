# PR #714 — Shared Data template controls

## Contract

Link readers may render and use an app without changing its original saved
content. Stored same-author dependencies inherit the freshly authorized root
audience. Foreign dependencies keep their own access checks. Copying creates
private content identities owned by the copier.

This follows #707 (develop) and #712 (main). It does not complete the broader
sharing goal by itself.

## Changes

- Include schema-template action controls in dependency discovery and rewrite
  those controls to copied action identities.
- Activate Data detail templates through the existing live renderer. Ordinary
  owner execution requires both owned data and a freshly verified owned schema;
  a foreign schema cannot borrow the viewer's account authority.
- Resolve a shared search's schema through that action's authorized stored
  reference, whether the reference is an ID or a name. Keep the search's existing
  anonymous/public/system data boundary: including a schema is not permission
  to enumerate either account's private inventory.
- Publish action capability/contract 1.2.1 and require it before shared controls
  execute. Copy and contextual Things/media corrections remain versioned in the
  API registry.

## Evidence (2026-09-09)

- A real API regression failed before the search correction with `Schema ...
  was not found`, then passed after resolving the stored schema edge.
- Final expanded API plus Chrome fixture passed in 131.8 seconds at 1440px and
  390px: schema ID/name searches, anonymous controls, wrong keys, group
  revocation, private dependency injection refusal, independent schema/action
  copies, owner execution, and foreign-schema authority refusal.
- Action suite: 71 passed. Capability suite: 26 passed. Earlier unchanged
  webpage suite: 73 passed, one optional fixture skipped. Changed-file lint and
  live manifest checks passed; both manifests advertise actions-run 1.2.1.
- Repeat browser runs intermittently timed out waiting for a Data or signed-in
  copy control. The successful instrumented run does not establish the cause of
  those timeouts. The fixture now captures bounded, query-redacted network and
  page-error diagnostics, screenshots, and visible text at those failures.
- Full-project TypeScript previously reported 108 baseline errors, none in the
  related implementation. Exact-head CI and deployment must be checked again
  for each subsequent push; earlier green commits are not a receipt for new code.
- Fixtures use disposable synthetic accounts through the local API, never
  direct MongoDB writes. Local health still reports storage migration required;
  no migration was run. Media bytes in browser fixtures are stubs, not S3 proof.

## Develop delivery and focused main promotion (2026-09-09)

- PR #714 merged into develop as
  `411c23ce94a88ec478fea1c674aa9e09537f6275`. Source head
  `80be6d22f369bc91c3ef767b36ccfecc7508fa87` passed Web build, typecheck
  ratchet, unit and API suites plus both CodeQL language scans.
- GitHub deployment `6348337271` succeeded. The
  [exact-head preview](https://pr-714.previews.dev.thingtime.com) rendered the
  complete Tarot app in logged-out Safari, with a matching commit footer,
  Copy to my Builder, no edit control, and Draw changing Strength to Temperance.
  A temporary blank screen preceded rendering on the first navigation; this is
  not proof that initial-load latency is fixed.
- Main promotion cherry-picks only the sharing implementation commits onto
  main. Unrelated develop Commander changes and graph retention cleanup are not
  part of this promotion. Its own head still requires CI and deployment proof.
- The focused main-tree API plus Chrome fixture passed in 192.9 seconds at
  desktop and mobile widths, including signed-in copying and foreign-schema
  authority refusal. The fixture retains the same failure diagnostics as the
  validated develop source. This does not exercise real S3 object copying.

## Remaining broader-goal work

- Copied protected uploads still need an independent, authorized media-copy
  lifecycle through the attachment service, including quota, moderation,
  exact-object-version checks, binding and rollback. Never carry the original
  page bearer key into a copied crystal as a workaround.
- Audit media rendered through CSS, rich/raw HTML, and component arguments
  against both authorization discovery and client key transport. Current
  composition discovery covers literal src/poster/href render props and native
  media/text blocks; this is not proof for every stored rendering surface.
- Complete the multi-page/general-content and bounded dependency-resolution
  audit. Shared saved-data mutations remain refused; no per-visitor persistence
  model is claimed.
- Verify the final follow-up on develop and promote its focused changes to main.
  Production deployment of #712 was verified at
  b94896f31ac1a40f87e9fa253eff2633c9f38e4a, but the user's development share was
  unavailable on the production origin. Its logged-out Safari behavior was
  verified on the original dev origin, not asserted for production.
