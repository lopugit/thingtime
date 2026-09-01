# PR #505 — Admin CI Feature Stacks and opt-in PR previews

## Why

The original Feature Stack batch could reject the entire queue when one chosen
target did not belong to the base-branch family of any selected PR. Large stacks
also moved the page while selections were added, and operators had no focused
live run feed. Admin navigation and long configuration panels made returning to
the same CI operation slower than necessary.

Thingtime also needed a deliberate way to run a trusted PR against either the
develop or production runtime without turning every ordinary Vercel preview
into a production-data surface.

## Product behavior

- Automatic Feature Stack routing keeps every compatible source/target pair,
  marks incompatible saved targets as skipped, and rejects only a plan with no
  compatible pair at all.
- PR filters map exactly to Clean, Conflicting, Draft, Merged, Closed, and
  Unknown. The ordered stack and selectable PR table scroll independently, so
  adding or removing a row does not move the rest of the page.
- A selected running stack shows signed dispatch, workflow/job, and target-PR
  progress with a browser-local estimated finish time and five-second live
  refresh while active.
- Every Admin tab has a bookmarkable `/admin/<section>` route. CI Control's
  Lopu automation, credential waterfall, and Feature Stack cards collapse from
  their headings and remember state per administrator.
- Automation compute describes one Lopu repository manager with operation
  lanes; GitHub-only supporting build pipelines remain separate.
- A selected PR has independent Develop and Production/Main preview switches.
  Both may be enabled simultaneously and later PR-head updates rebuild every
  enabled environment.

## Preview security boundary

- The mutation endpoint requires an admin session and capability negotiation.
- Enabling re-reads the live PR through the GitHub App and accepts only an open,
  ready, same-repository head with an exact 40-character SHA.
- Develop targets only the configured Vercel Custom Environment. Production
  requires an explicit acknowledgement and targets Vercel Production values.
- Both deployment payloads set `autoAssignCustomDomains: false`; the controller
  returns only the immutable generated Vercel URL and cannot move
  `thingtime.com` or `dev.thingtime.com`.
- Credentials and provider identifiers remain server-side. Browser responses,
  stored policies, audit events, and webhook projections contain only bounded
  metadata.
- Rebuilds and cleanup use Thingtime PR/environment markers. Disabling or
  closing a PR cannot delete an ordinary stable deployment.

## Verification

- CI Control unit/component suite: 31/31.
- Admin integration/route suite: 5/5.
- Capability manifest suite: 2/2.
- Targeted ESLint: passed.
- Full Vercel production build and output verifier: passed.
- Typecheck ratchet: no errors in touched files; unrelated repository baseline
  remains non-blocking.
- Staged secret scan: passed.
- Graphify incremental refresh, hooks, and union merge driver: verified.

Signed-in desktop/mobile and production-route QA is completed against the
deployed origin after merge. No production-environment PR deployment is
triggered merely to test the switch.
