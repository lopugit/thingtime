# PR #489 — Add verified multi-target Feature Stacks to main

Branch: `codex/feature-stack-main`

## Scope

- Promote only the Feature Stack admin UI, immutable dispatch plan, capability manifest, tests, and protected workflow listener from PR #487 to `main`.
- Keep the `main` change independent of unrelated `develop` history.
- Preserve the same preferred Thingtime Claude credential slot without removing the existing primary or fallback credentials.

## Safety and regression focus

- Require 2–20 unique, live, same-repository PR sources and one or two distinct live target branches.
- Preserve exact source order and immutable head SHAs from browser dispatch through the protected `github-actions` controller.
- Keep destructive confirmation nonpersistent and leave publication behind branch protection and required checks.
- Preserve responsive selection rows, detail-drawer usability, full-page scrolling, and zero horizontal overflow.

## Validation log

- 2026-08-30: PR #487 passed the focused capability/CI Control suite, workflow caller contract, ESLint, production build, Vercel-output verification, full CodeQL, and Vercel preview deployment before merging to `develop`.
- 2026-08-30: desktop and 375px mobile browser QA passed for ordered selection, removal, target replacement, confirmation, detail drawer, top-to-bottom scroll, and overflow.
- 2026-08-30: this narrow main promotion is regenerated against `origin/main` and must pass its own protected CI/CodeQL/Vercel gates before merge.
