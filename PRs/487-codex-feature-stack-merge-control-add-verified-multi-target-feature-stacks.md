# PR #487 — Add verified multi-target Feature Stacks

Branch: `codex/feature-stack-merge-control`

## Scope

- Admin → CI Control can assemble an ordered Feature Stack of 2–20 live pull requests and select one or two live target branches.
- The server converts the selection into a canonical immutable PR/head/SHA plan and dispatches it once to the protected `github-actions` controller.
- The UI persists the stack name, order, and targets for editing, but never persists the destructive merge confirmation.
- The origin-scoped capability manifest advances `api.admin-ci-dispatch` to `1.1.0`, covers the active runtime route map, and gates Feature Stack dispatch in the browser.

## Safety and regression focus

- Reject moved, closed, draft, cross-repository, duplicate, paused, or AI-excluded sources before dispatch.
- Require 2–20 unique sources and 1–2 distinct live targets; preserve the user-selected merge order exactly.
- Keep all target publication in the protected controller so branch protection and required checks remain the final merge gate.
- Preserve compact mobile labels, detail-drawer usability, full-page scrolling, and zero horizontal overflow.

## Validation log

- 2026-08-30: 23 focused capability-manifest and CI Control tests pass.
- 2026-08-30: workflow caller contract and focused ESLint pass.
- 2026-08-30: the production build and Vercel-output verification pass.
- 2026-08-30: live browser QA passes at desktop and 375px mobile widths for ordered selection, removal, target replacement, confirmation, detail drawer, top-to-bottom scroll, and overflow.
- 2026-08-30: the local capability response reports the exact browser origin, `api.admin-ci-dispatch` 1.1.0, and the generated operation inventory.
