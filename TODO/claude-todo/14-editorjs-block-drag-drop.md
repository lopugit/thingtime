# 14 — Editor.js block drag/drop reordering 🟢

**Status:** Shipped 2026-07-21 (session 2) — `editorJsBlockReorder.ts` wired
into `LongTextEditor`: grip pointer-drag with drop indicator + edge
autoscroll, touch long-press (400 ms; early movement stays a scroll),
Alt+Shift+ArrowUp/Down keyboard moves with an aria-live position
announcement, Escape/pointercancel abort. Every completed gesture is exactly
one `editor.blocks.move()`, so it rides the existing onChange → ordered save
queue → Thingtime timeline as ONE history event; first/last no-ops never call
move. Unit tests cover the boundary/no-op/autoscroll/keybinding math.

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
