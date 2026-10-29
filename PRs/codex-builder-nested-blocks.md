# Nested Builder insertion and block structure

## Result

Populated parents retain an explicit child insertion control, and the active
block retains its seamless sibling insertion control. A single ancestor
breadcrumb replaces overlapping title chips for nested zero-padding blocks.
The context menu offers insert above/below/beside left/beside right and structure
views for the page, the parent subtree, or the selected block subtree.

Directional insertion uses an existing compatible layout axis. Otherwise it
wraps only the selected block and its new neighbor, preserving unrelated
siblings. Original block IDs and content remain intact. Eligible HTML elements
without a `children` array accept their first child; void elements and specialized
value/option controls reject ordinary children.

The structure dialog uses ordinary editable blocks through
`SettingsDocumentHost`, `TransientBlockHost`, and `WebpageBlocksRenderer`.
Its repeated row labels, selection indicators and details are independently
editable. A private personal layout Thing stores presentation changes; a live
projection supplies the page tree and bounded selection/scope adapters. Selecting
a node targets the original page block and reopens the inspector, including when
the same block was already selected. Parent scope means the immediate parent's
subtree; a root-level block falls back to the page.

## Verification

- `pnpm --dir remix run test:webpages`: 194 passed, four existing opt-in skips.
- Raw `pnpm --dir remix run typecheck`: passed; changed-file lint passed.
- Real API/browser acceptance exercises an isolated replica set, synthetic
  identity, task-owned browser and private webpage. It checks repeated nested
  insertion, all four directions, three structure scopes, exact-ID readback,
  reload, editable layout persistence and responsive bounds. The complete run
  passed at 1440, 390 and 320 pixels and in a responsive iframe. It verifies
  13 inserted blocks, all three structure scopes, individually edited row
  fields saved to a private layout Thing, same-node inspector reopening,
  viewport/footer bounds and View/Edit transitions. All owned processes and
  listeners were cleaned up. Local evidence is in
  `/tmp/thingtime-builder-nesting-final-evidence/`.
- Electron tests: 339 passed before integrating the latest upstream helper
  changes. Isolated bundled Electron acceptance passed ancestry, structure
  selection, directional insertion, real API save/readback and reload.
  Evidence is in `/tmp/thingtime-builder-native-evidence/`; the dev app,
  profile and bundles were removed. Final signed installation and read-only
  installed smoke are tracked in the PR delivery report, separately from this
  isolated mutable-fixture acceptance.
- Graphify uses a structural refresh. The installed semantic incremental path
  would reprocess 642 previously unindexed documents; it has no safe scoped
  option that preserves the existing corpus. These changed Markdown documents
  are therefore recorded in the manifest but are not semantically indexed.

## Task state

- Task: `01a186b9-4d6e-7942-870a-7aeae690bab1`.
- Branch: `codex/builder-nested-blocks`.
- Worktree: `builder-nested-blocks/thingtime`.
- Fresh starting base: `origin/main` at
  `51e12a37fb70d55a5c49430f885ce9e5112b28d2`.
- Integrated upstream `main` at `6f6944ffb12b18d8bd8399ae3cc909726dd2af8d`
  before final source delivery, preserving the upstream password-provider work.
- User explicitly authorized merging this completed change into
  `lopugit/thingtime` main.
- Private overview task: `cf904d89-394b-44e1-8130-e5a19f6ea341`;
  renderer child: `56f1a744-7e32-47bb-a0ad-77b244d1a33e`.
  Further reporting was interrupted by unavailable Chrome extension control;
  a structure-child submission has an uncertain outcome and must be read back
  before any retry. No Character or private-subspace post was claimed.
