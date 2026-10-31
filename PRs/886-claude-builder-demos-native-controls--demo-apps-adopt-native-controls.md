# PR #886 — Demo apps adopt native dialogs, countdown and local controls

- PR: https://github.com/lopugit/thingtime/pull/886
- Branch: `claude/builder-demos-native-controls` → `develop` (from `main`
  263cc7fad, the merge of #885 = #864's promotion)
- Date: 2026-09-22; author: Claude (AI). Follow-up to
  `PRs/864-claude-thingtime-builder-demos-2e2672--creative-demo-app-suites.md`
  on the owner's request to "update with any new features added by recent PRs".

## What changed since #864 landed

PR #870 (functional demo controls) added three native controls the apps now
use, and an inline **result panel** the runtime renders under a component
after any control run (hidden when the result carries `silent: true`).

| Feature | Where the demos use it |
| --- | --- |
| `tt-dialog` (native `<dialog>`, trigger button from `name`, children keep action delegation) | Clear all done (Done & Dusted), Start over (Thingmon keeper), Un-claim (Snapquest challenge), Compost (Pixel Garden) — via `kit.confirmButton` |
| `tt-countdown` (`value` seconds; Start / Pause / Reset) | Done & Dusted focus-timer card |
| `$ui` local controls (`op: set/toggle/increment/cycle/reset/copy/search`, bounded scalar state per component instance, keys read back like args) | focus length buttons (`set` seconds), Thingmon dex "Hide unseen" (`toggle`) |
| inline result panel | `explore` returns scalars (the encounter record rendered as a JSON blob), deletes return no `id` (a dead "Open saved Thing" link), the finder is `silent` |

Not adopted, deliberately: the integration library (#869/#875) runs remote
operations client-side in opaque frames and never feeds action results back,
so it cannot drive server-side game rules (e.g. real weather for the garden);
`tt-service-workspace` (#871) is a franchise-operations block.

## Verification (2026-09-22, worktree stack on main + this branch, private replica set)

- `test:schemas` gate (every part of every suite in both materialisations) ✓;
  suite files typecheck; changed-file ESLint clean.
- `node scripts/verify-demo-apps.mjs http://127.0.0.1:17002` with
  `TT_VERIFY_ADMIN_USER/PASS`: 138 passed, 0 failed (`explore` assertion
  updated to the scalar result).
- Browser (in-app pane, signed-in throwaway, after re-install): Thingmon
  explore on the new runtime showed the encounter JSON under the zone picker
  before the hygiene change; dex "Hide unseen" toggle, keeper Start-over
  dialog and the todo focus timer checked after.

## Gotcha

The local `$ui` state's identity includes the component's args and render,
so it survives source refetches but resets when a block's args change — fine
for toggles and pickers, not for anything that must outlive an edit.
