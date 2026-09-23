# PR #896 — Editable shared app copies with live access checks

Ordinary shared pages can expose the reusable `$install` control. The platform
displays a copy disclosure before creating a private page and its referenced
Components, Actions and Data through the existing fork endpoint. Saved browser
Actions execute only after the viewer explicitly owns the copy. Connected
records retain their original permissions; copying grants no record access.

## Account and source boundaries

- Capability negotiation precedes copying. The expected-actor header pins the
  write to the account that opened the dialog, including cross-tab changes.
- Page/account changes abort pending transport and suppress stale navigation.
- Permission statuses survive the browser Action transport. Source refreshes
  clear rendered and cached results on 401/403/404 or account change, while
  temporary network/server failures preserve the last known result.
- The saved navigation includes a refresh button. Labels, placement and Action
  binding remain editable in its Component Thing.

## Validation on 2026-09-23

- 59 focused unit tests pass; changed-file lint passes. Typecheck ratchet: 89
  existing baseline errors, no increase.
- Full build and Vercel-output verification passed before the final fetch
  binding and mobile width fixes; final-head CI covers those corrections.
- An isolated loopback API fixture created a separate Employee account,
  copied all 50 Things privately, refused foreign browser execution and
  revalidated data access after member revocation. Original page access,
  copying, reads and writes were denied. The synthetic member was restored.
- Chrome desktop and 375px: dialog cancellation, real copy and navigation to
  the owned page, full-page scrolling, and refresh after revocation removed
  prior records and edit links. Restoring membership restored the view.
- Browser acceptance caught and fixed an unbound native fetch invocation and
  mobile dialog overflow before publication. The live page now shows an
  actionable copy state instead of the internal shared-browser refusal.
- Gitleaks scanned the source commit with no findings. Generated graph
  artifacts are binary-attributed and are not equivalent to a full text scan.
- Graphify structural and semantic refresh completed; portable HTML exists.

Local QA: http://localhost:17120/p/qa-editable-builder-page. The configured
Tailscale executable is absent on this host, so no Funnel URL was verified.
All account/content mutations in this validation used the isolated local QA
database. No production Things have been migrated.

## Remaining conversion work

Dependent reference controls, richer collections/planner interactions, generic
setup and the actual HQ migration remain separate work. Preserve the existing
page identity, gear register, record identities and access rules throughout.
