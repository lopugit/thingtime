# PR #853 — Builder uploads, form saves, SDK docs and scoped lookups

- PR: https://github.com/lopugit/thingtime/pull/853
- Branch: `codex/builder-sdk-uploads-forms`; base: `develop`.
- Date: 2026-09-18; author: Codex (AI).

## Behavior

Embedded component blocks used a separate renderer that omitted the native upload
provider. They now use `LiveTemplate`, matching dedicated component pages while
preserving the existing ownership, shared-read and editor-mode boundaries.
Component source bindings are inherited unless a block supplies an override.

Named form controls preserve explicit empty text, leading zeroes and false
checkboxes; disabled/password/raw-file fields are excluded. Native constraints
run before submission, pending uploads block saving, and one component cannot
start duplicate concurrent runs. Late completions and retries are fenced against
account changes and unmounts. Successful saves refresh source-bound data without
resetting mounted input drafts. Server input validation distinguishes an explicit
empty optional text value from omission/defaults.

Upload controls initialize from existing `value` and `attachmentId` props, retry
commits with the same identity, and clear the form without deleting saved files or
leaving a stale upload blocker. URLs do not grant access to private files.

`/docs/builder` has six searchable sections: getting started, forms, Data Things,
uploads, lookups and troubleshooting. `/builder/docs` redirects there, Builder
links to it, and Lopu's authoring prompt consumes the same reference/examples.

`lookup` is a registered-provider action operation. The initial adapter is Google
Maps geocoding: an action must declare its provider, be owned by the invoker and
reference a literal id in that user's Vault. Authored URLs, headers, redirect
following and raw secret access are unavailable. Requests are limited by the run
deadline and eight-second cap; queries cap at 500 characters, response reads at
128 KiB, and public projections at five results. Shared runs refuse lookup. Run
history and source caches omit provider results. There is no automatic retry or
per-keystroke request. Docs link to Google's attribution and storage rules.

Capabilities: `api.actions-run` 1.5.0, `api.things` 1.19.0 (route contract 1.18.0),
`api.things-update` 1.4.0. Clients negotiate before new dependent behavior.

## Evidence

- Actions: 104 passing tests; capabilities: 67; schemas: 195; components: 38;
  webpages: 101 passing, two existing environment-gated skips.
- `verify-actions.mjs`: 99/99 against an isolated local MongoDB replica set,
  including create/update/readback, explicit empty text, defaults, unchanged
  unrelated fields, owner-private data, missing Vault credentials and foreign
  lookup refusal. An initial simultaneous build interrupted three reads; the
  sequential rerun passed all checks.
- Browser regression `/scripts/builder-sdk-regression.html`: production page
  renderer and uploader with synthetic transport. Desktop and 390px pass embedded
  upload activation, source inheritance, initial files, required validation,
  upload blocking, failed commit/stable retry, both file values, duplicate click
  suppression, empty text, refresh, clearing and draft retention.
- Browser docs checks: overview, all six section routes, alias redirect, search,
  navigation menu and footer at 1440px/390px. No page-width overflow. Action
  creation/inspector and missing-key error checked in an isolated QA account;
  lookup disclosures wrap instead of truncating on mobile.
- Chrome was interrupted by another extension popup; browser QA completed in the
  supported in-app browser. No personal account state or production data used.
- Production build and Vercel output verifier pass. The compiled Vercel handler
  returns the origin-scoped manifest and all three updated feature versions.
- Focused ESLint has no errors. Full TypeScript reports 116 errors both on the
  base commit and this branch; normalized diagnostics match with no additions.
- Graphify semantic extraction and structural refresh completed, including
  portable graph/report/HTML and matching manifest coverage for all added files.

## Integration limits and local review

Google-positive responses and storage transport were synthetic. A real Google key
with Geocoding API/billing and configured object storage are still needed for
live provider/storage acceptance. No claim of production deployment or a live
paid Google request is made. Existing private-file access rules remain in effect.

The PM2 worktree app uses web 14870 / HMR 14871 / API 14872; isolated MongoDB uses
27753. Both processes have autorestart disabled and stable restart counters.
Local docs: http://localhost:14870/docs/builder. Tailscale/Funnel is unavailable:
the installed CLI shim points to a missing Tailscale application binary. This PR
is the review delivery; preview/check status is reported from GitHub/Vercel.

## Main delivery (2026-09-18)

The user authorized merging this Builder work into `main`. The main delivery
branch `codex/builder-sdk-main` applies only the two Builder commits to current
`main`, excluding unrelated develop changes. Capability conflicts preserve the
newer attachment/fork contracts already on main and add the Builder versions.
The lookup authoring paragraph is attached to the Things endpoint documentation.

Main-based validation passed: 111 action tests (one environment skip), 67
capability tests, 195 schema tests, 101 webpage tests (two environment skips),
99 live API checks, production build and built-handler manifest smoke. Chrome
desktop and 390px fixtures pass. The mobile source-refresh assertion now waits
for an observed fetch after the save, bounded to five seconds, instead of assuming
React finishes the asynchronous refresh within a fixed 600ms delay.

Main advanced to the media release while opening PR #855. Its changes are
preserved; Builder lookup authoring now requires `api.things` 1.20.0 (route
contract 1.19.0), distinguishing it from media release 1.19.0.
