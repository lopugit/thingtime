# PR #890: Editable Builder definitions and browser Actions

PR: https://github.com/lopugit/thingtime/pull/890
Branch: `codex/editable-service-components`

## Behavior

This framework foundation adds owner-only browser Action programs with generic
same-origin API requests and saved definition editing for Components, Actions
and pages. It does not convert the legacy workspace yet. The subsequent app
conversion must preserve all page blocks, record identities and access rules.
No separate service-app category is introduced.

See [the authoring contract](../docs/builder-browser-actions.md) for examples,
execution boundaries and limits. Saved definitions contain no credentials or
arbitrary JavaScript. The server validates/prepares browser programs without
creating run records; actual browser execution yields session traces. API
requests carry the initiating account fence and negotiate semantic capabilities.
Nested timeouts, recursion/operation limits, bounded response streams, and errors
stop the program without automatic mutation retries. Existing server programs
keep their existing behavior.

The shared Fields/Source editor validates canonical Thing schemas and uses
`replaceCrystal` plus `expectedUpdatedAt`; edits never replace the Thing identity
or ACL. GUI fields preserve explicit types and permit nested insertion, removal
and reordering. Saves reject a changed account or stale revision.

## Acceptance, 2026-09-23

- Action unit suite: 127 pass, 1 pre-existing optional integration skip.
- Capability suite: 82 pass; both manifests publish actions-run 1.7.0,
  things 1.28.0 and things-update 1.5.0.
- Existing real-HTTP Action verification: 99/99 pass.
- New opt-in HTTP integration passed on a disposable loopback replica: stored
  definition, old-client refusal, owner-only preparation, no forged history,
  real browser transport, private saved record, unchanged leading-zero text,
  account fence before writes, and stale definition refusal. A repeat run was
  stopped by the local sign-up rate limit; no production accounts were used.
- Chrome desktop and 375px mobile: created and ran a browser Action; edited its
  name in Fields; edited a Component template/default in Source and rendered it;
  changed/reordered page blocks in Fields and reloaded with both blocks intact.
  Nested controls, top/bottom scrolling, modal bounds and horizontal overflow
  were checked. Mobile modal footer stays clear of floating controls.
- Full Vercel build and output verifier pass. Built Nitro handler returns the
  expected capability manifest as JSON, with the selected origin.
- Changed-source lint: zero errors, one pre-existing registry no-script-url
  warning. Typecheck ratchet: 89 existing errors, at the checked-in baseline.
- The broad Components smoke suite cannot complete on this disposable database:
  seeded multi-design families are absent and fixture registration hit the
  local rate limit. Its new editor path was instead exercised live in Chrome.

Local UI: http://localhost:17120/actions (Vite 17120, HMR 17121, Nitro 17122).
Dedicated fixture Mongo replica: loopback 17123. The local Tailscale wrapper
points to an absent application executable, so no Funnel URL was available or
changed. Preview/deployment and merge status must be checked live from the PR.
