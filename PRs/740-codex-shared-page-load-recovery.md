# PR 740 — shared-page load recovery and viewer isolation

Branch: `codex/shared-page-load-recovery` → `develop`

## Behavior

- Temporary resolver failures show a retry action instead of a missing page.
- Same-viewer refresh failures keep the last loaded content visible.
- Viewer, target and hidden-key changes discard the previous draft before
  rendering children; stale resolver, component and save results are fenced.
- Real permission denial or missing content clears the previous page.
- Optional site decoration keeps its existing nullable resolver interface.
- Link readers can still run the composition, but cannot edit its source.

## Validation and reconciliation

- Focused webpage suite: 90 passed, two opt-in browser fixtures skipped.
- Both opt-in Chrome fixtures passed separately: hook transitions and a built
  client against the real local API, including a first-resolve 503 followed by
  recovery at desktop and 390px widths. Only fixture data is created/cleaned.
- On head `0ba574eff1ba9e4aecc0598fa879108dbbc4b392`, Web CI and both CodeQL
  analyses passed; CodeQL reported zero results and no open PR alerts.
- That head's anonymous preview rendered the complete Tarot composition,
  accepted Draw, and offered Copy to my Builder without an edit-original UI.
- Develop advanced through PR 741 while PR metadata still named its earlier
  base. Standard merge attempts refused the conflict without modifying the
  target branch. Reconciliation preserves the incoming route/composer fixes;
  only changelog text required manual resolution. Fresh-head CI and preview
  verification are required after this reconciliation.
- Graphify is an approximate navigation map: native generic-import node IDs
  collide across files. Source tests, not graph completeness, establish behavior.

## Remaining broader sharing work

This PR does not claim the complete sharing goal: saved-argument-derived action
references still need composition discovery, editor authorization and fork
rewriting; independent protected-upload fork copies remain separate work.
Never-settling requests do not yet have a resolver timeout. The original
historical blank browser session's exact cause has not been proven.

## Focused main promotion

`codex/promote-shared-page-recovery-main` starts at production commit
`f87ab3f1c36b686224093ceef22db84ad8f2b5ba` and carries only the five recovery
source/test files from PR 740 plus these regression notes and refreshed graph.
It does not import develop's unrelated conversation/composer changes. The five
source/test files are byte-identical to PR 740's reconciled head.
