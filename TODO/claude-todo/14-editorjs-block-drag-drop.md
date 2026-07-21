# 14 — Editor.js block drag/drop reordering 🟢

**Status:** Built 2026-07-21 (phase 1). `editorJsBlockReorder.ts` (pure planning
logic, unit-tested) + `editorJsBlockDragDrop.ts` (DOM adapter) wired into
`LongTextEditor`: pointer drag from the six-dot grip with a drop indicator and
viewport autoscroll, touch long-press (short tap still opens settings, early
movement yields to native scroll), Alt+↑/↓ keyboard moves with caret-follow and
aria-live announcements, Escape/pointercancel cancellation, read-only guard.
One `blocks.move()` per completed gesture (one history event); block
ids/type/data verified preserved. Live-verified in the feed composer (desktop +
mobile viewports). Still open from the full spec: long-document autoscroll QA,
deep undo/redo + stale-save interplay QA, nested list tools.

## Goal

Let people reorder Editor.js blocks visually while preserving the exact
`{ blocks }` document, the active caret/focus, and Thingtime's immediate
history plus deferred persistence semantics.

## What already exists

- The six-dot Editor.js control opens block settings; Thingtime does not yet
  install or initialise a block drag/reorder integration.
- Editor.js exposes `blocks.move(toIndex, fromIndex?)`, so reordering can use a
  public API instead of mutating saved block JSON or private editor state.
- `LongTextEditor` already sequences asynchronous snapshots, rejects stale
  saves across remounts, reconciles parent echoes, and records each accepted
  value through Thingtime's undo/redo timeline before deferred LocalForage
  persistence.

## Done when

- Desktop pointer drag starts only from the six-dot grip. A click still opens
  block settings, dragging shows a clear drop indicator, and long documents
  autoscroll near viewport edges.
- Mobile long-press on the grip starts reordering without hijacking normal page
  scroll, text selection, or a short tap that opens block settings.
- Keyboard and screen-reader users can move the active block up/down, keep
  focus in the moved block, and receive an accessible position announcement.
  Reorder controls are absent in read-only mode.
- Reordering preserves every block's id, type, data, tunes, nesting, and inline
  markup exactly; first/last no-ops do not create history.
- One completed reorder produces one Editor.js/Thingtime history event—not one
  event per pointer move—survives view/edit toggles and reload, and undo/redo
  restores the exact prior order.
- Rapid reorders cannot be overwritten by a stale async save or parent autosave
  echo, and completing a reorder does not remount Editor.js or lose the caret.
- Escape, pointer cancellation, and an interrupted touch gesture cancel cleanly
  without changing data. Existing toolbox/settings controls and multiline tool
  inputs continue to work.
- Focused unit tests cover index changes, no-ops, cancellation, event ordering,
  and stale saves. Live desktop and mobile browser QA covers drag, long-press,
  keyboard movement, autoscroll, reload, undo/redo, overflow, and console health.

## Risks and guardrails

- Prefer Editor.js's public move API; avoid coupling to private DOM beyond the
  minimum grip/drop-target discovery needed for interaction.
- Evaluate a maintained drag/drop integration against a small Thingtime-owned
  pointer/touch adapter before adding a dependency.
- Explicitly settle one save after drop if Editor.js does not reliably emit
  `onChange` for `blocks.move()`, while keeping the existing ordered save queue.
- Account for index shifts, nested list tools, touch-scroll thresholds, editor
  teardown, and the difference between a cancelled gesture and a completed
  reorder.
