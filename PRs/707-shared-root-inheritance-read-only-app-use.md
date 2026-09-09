# PR #707 — Shared root inheritance and read-only app use

PR: https://github.com/lopugit/thingtime/pull/707
Branch: `codex/shared-root-inheritance`

## Intended behavior

Anyone with the link can view and use the shared app without editing its
original. Signed-in visitors can create an independent private copy in Builder.
The stored composition author's namespace resolves included components and
actions; a visitor's similarly named private component must not replace them.

Root audience authorization is checked again on every shared action and copy.
Same-author contained dependencies inherit that read audience only inside this
context. Foreign dependencies retain their own ACLs. Neither author nor visitor
account privileges are borrowed to run the app. Mutating saved data is refused;
computed results and local interaction state remain usable. Shared editors may
not add references to unrelated private author dependencies they cannot read.

## Evidence, 2026-09-09

- Local real-API regression covers keyed anonymous reads, wrong/revoked keys,
  custom groups and membership removal, foreign dependency exclusion, child
  actions, explicit private data reads, mutation refusal, editor-injection
  refusal, and independent private copies.
- Isolated Chrome at 1440px and 390px: Draw updates the app, original Edit is
  absent, signed-out Copy opens sign-in, and authenticated Copy opens the new
  page in Builder. Top/bottom scrolling and button bounds checked; mobile
  clipping repaired.
- Action tests: 69 passed. Webpage tests: 68 passed and opt-in fixture skipped.
  API capability tests: 22 passed; manifest assertions: 5 passed. Changed-file
  ESLint and whitespace checks passed.
- Whole-project TypeScript still reports pre-existing unrelated errors. No new
  errors were reported in the implementation files.
- Safari on preview commit `722c5f4bdbbc55d1ee348a652b83c689ed552525`,
  logged out: the actual Tarot page renders its complete card and Draw control.
  Clicking Draw changed Temperance to Judgement. Copy to my Builder is present
  and original Edit is absent. The original develop URL still uses old code.

## Remaining verification

The latest merged-head and develop/main rollout verification,
broader general-Thing/media inheritance and copy coverage, and the final
security/completeness audit remain. Dynamic dependency identifiers are not
treated as grants. Shared saved-data mutation workflows require an independent
copy. This note records an implementation milestone, not completion of the
entire sharing goal.
