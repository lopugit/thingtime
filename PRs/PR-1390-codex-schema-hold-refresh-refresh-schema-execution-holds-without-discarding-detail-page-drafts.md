# PR 1390 — Refresh Schema holds without discarding detail-page drafts

Date: 6 November 2026. Managed worktree: `schema-hold-refresh/thingtime`.
Branch: `codex/schema-hold-refresh`, from freshly fetched
`da3f3384d3446fd37f151b0f34761f8fb96c3cfa`. Verified runtime commit:
`b558e93d0339fd431ddbf80e60a8a446f32e19c4`.

## Trigger and correction

A readable Data Thing on `/thing/:id` could retain its referenced Schema's
restoring hold after completion. The page refreshed the Data but did not read
the unchanged Schema ID again. A full real-backend route check reproduced this
on the installed-74 frontend before the fix.

Schema reads now carry an exact origin/viewer/data-plane/Thing/Schema/link/root
identity scope and a separate refresh generation. Refresh invalidates execution
synchronously, starts a fresh read, aborts older requests and ignores stale
success/error. Same-scope transient failure may preserve the readable template
and draft, while unverified execution remains blocked. Access/not-found refusal
clears it; unscoped list-cache templates are not authority for this route.

Quiet execution gating blocks actions, native callbacks, links and submission
without a restoration label or ordinary-input remount/blur. The page runtime's
identity stays stable during verification. Actual restoring ancestry remains
monotonic and continues disabling fields. Capability discovery uses canonical
typed network/deadline/HTTP failures, including an interrupted body, separately
from JSON/compatibility/origin validation. No HTTP endpoint or manifest feature
contract changes.

## Verification and provenance

- Real full-route proof: `/tmp/schema-hold-refresh-real-route/results.json`.
  A private copied compiled middleware API from verified installed
  `74f47e996a7f702839be8617c73c7978201889ef` and the freshly built fixed client
  use a new replica and synthetic accounts. The server API was unchanged by
  pacing or this client fix. Results measure the four runtime file hashes,
  frontend index and compiled API entry hashes, and refuse source changes
  during the run. No API response mocks or direct Mongo content access.
- Actual Rename save causes Schema revalidation/release. The separately tested
  Timeline-applied event is emitted by `TimelineVersionActions.tsx`. Completion
  itself has no automatic server-driven product refresh workflow in this phase.
- Cold held Component, independently held nested Component and Schema, held URL
  source, server 409 before completion and browser/server 200 after completion;
  consent, current action readback and cached reload pass.
- Real connection interruption preserves draft DOM/value/focus inertly; delayed
  stale error is ignored. Revoking a foreign Schema's actual ACL clears its
  private template while the outer Data stays readable, and a delayed old
  authorized 200 cannot restore it.
- Actual 390px fullpage top/bottom, normal action menu and Rename dialog bounds
  pass, plus desktop. Screenshots include `mobile-rename-dialog.png`,
  `mobile-schema-released-{top,bottom}.png` and `revoked-schema-cleared.png` in
  the result directory. All opened real-route pages have zero uncaught errors.
  The local fixture returns 404 for an absent Vercel analytics platform script
  rather than serving SPA HTML as JavaScript; no analytics delivery is claimed.
- Expanded existing boundary browser proof passes desktop/mobile with zero
  page errors: `/tmp/schema-hold-refresh-component-browser/results.json`.
  This separate fixture uses synthetic API/session/runtime adapters and proves
  actual hold inheritance plus quiet draft/focus, captured native callback,
  link/Enter, form submit and action fencing.
- 152 capability tests pass; raw TypeScript and targeted lint have zero errors;
  canonical Remix build/output verification and compiled manifest smoke pass.
  Command logs are `/tmp/schema-hold-refresh-*.log`. Independent bounded
  read-only review found no remaining actionable issue; it did not run tests.

Graphify's scoped note/map semantic attempt was refused as incomplete/shrinking;
no partial result was activated. A bounded note-only semantic recovery follows,
with structural source coverage retained. The changed feature maps and giant
TESTING/changelog are not claimed as freshly semantically indexed. Their prior
usable graph remains, and the previously failed 77-slice large-document path is
not repeated. The PR records observed refresh/check/preview/merge outcomes.

Native release is coordinated separately after merge, combining this fix with
pacing. These results do not claim signed installed acceptance, production
rollout, automatic restore UX or whole-account restoration. Whole-account
readiness remains false.
