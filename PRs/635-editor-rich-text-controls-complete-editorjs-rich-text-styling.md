# PR #635 — Complete Editor.js rich text styling

[Pull request](https://github.com/lopugit/thingtime/pull/635) targets `develop`.
Branch: `codex/editor-rich-text-controls`.

## Behaviour

Selected text and block settings share a full colour/typography dialog. It offers
an HSL colour wheel, hue/saturation/lightness, opacity, HEX/RGB/RGBA/HSL/HSLA input,
text/highlight colours, bold/italic/underline/strikethrough/overline, curated font
families, and custom px/em/rem/pt/% sizes with steppers. The picker starts at 50%
lightness when no colour is set. Changes preview on the actual selected text/block;
Save keeps them, Cancel restores the starting content, and Reset clears styling.
Unchanged mixed formatting remains intact.

Both builder editor surfaces previously disabled Style. They now expose it, and
builder HTML conversions retain validated block styles and inline spans. Saved
rendering applies styles to table cells, warnings and captions as well as existing
paragraphs, headings, lists and quotes. Literal code blocks remain plain text;
whole-block typography still applies.

The inline toolbar follows the selection above the text, wraps to the available
width, and accounts for visual-viewport offsets. Mobile top/bottom positioning
needed an explicit bottom reset to avoid collapsing the popover to a thin strip.

Block conversions transfer validated whole-block styles by default, with per-property
carry checkboxes in Changes. The shared editor journal records typing, style previews,
block structure, checklist/table edits, conversions and reorder operations. Undo/Redo
and Cmd/Ctrl+Z / Shift+Z restore full drafts, including empty/unfinished blocks that
Editor.js omits from its submitted save. A new edit after undo retains abandoned
futures. Timeline events show parent, time and changed properties; users can restore
any point or selectively revert/reapply changed fields. Overlapping later edits
produce an explicit conflict, preserving the current document and all history.
Snapshots are isolated from tool mutations and share unchanged blocks in memory.
History is local to the mounted editing session, not persisted across reloads.
Builder inline and advanced editor owners retain their individual histories across
close/reopen. DOM `tt-editor-update` events expose the journal to integrations.

The larger style picker uses two columns on desktop, one on mobile, with a draggable
title and pointer/keyboard resize handle. Native block settings and the advanced
rich-text modal also resize. Editing controls reserve no horizontal document space:
+/dots float on the right for left/centre text and on the left for
right-aligned text. Controls use blank space beside the text or move above the
editor when adjacent lines would overlap. Builder inline padding now follows the
rendered content.

## Verification

- 79 Editor.js/kind tests and 31 builder/webpage tests pass.
- Targeted ESLint has no errors or warnings in the changed implementation.
- Vite client and single-file embed builds pass; embed stays within its budget.
- Chrome desktop and 390px mobile checks: live preview/cancel, 50% default,
  converted styles, complete-draft undo/redo and retained branches, timeline
  selective revert/reapply, resizing/moving, mirrored controls, modal save/reopen;
  plus heading/paragraph/table selection,
  toolbar positioning, scrolling to the page bottom, picker scrolling, custom
  colour and alpha, em/rem/px sizes and steppers, text decorations, whole-block
  typography, save/reopen and builder HTML round trips. A browser regression
  verifies substring boundaries and exact native undo restoration.
- The local `/builder` route reaches its sign-in screen. Tests use the real
  components with ephemeral fixture data rather than modifying account pages.
- Full TypeScript ratchet reports 109 errors against the existing 108-error
  baseline, with no diagnostics in the changed editor/builder files. The
  unrelated diagnostics include schemas, navigation, notifications and migrations.
- Physical iOS native context-menu and keyboard/panning behaviour remains a
  device acceptance check; Chromium mobile dimensions cannot prove native menus.

## Local preview and indexing

Local fixture: [Editor checks](http://localhost:14870/tests/editor-rich-text.html).
The worktree PM2 ecosystem entry has autorestart and watch disabled; the verified
stack uses web 14870, HMR 14871 and Nitro 14872. Funnel is unavailable because the
Tailscale shim references a missing app binary. No Funnel mapping was changed.

The repository Graphify wrapper completed incremental code and semantic indexing
through the local proxy (all three semantic chunks succeeded), then regenerated
cluster/report/HTML outputs. Portable snapshots and the semantic cache are current.

## Adaptive toolbar follow-up (2026-09-05)

Selection formatting gets the closest available space above selected text.
Builder labels, history and native block actions then place themselves around
that reservation and nearby content. The shared geometry respects the visual
viewport, fixed header/inspector and clipping ancestors; ResizeObserver and
scroll/viewport events keep positions current. Placement candidates are bounded
so large documents cannot create an unbounded search. Native settings panels
and nested conversion menus also clamp their dimensions and position to the
available space. Open native menus cover the history controls beneath them.
Toolbar typography stays independent of large document fonts, and the unused
50px Editor.js desktop gutter no longer forces narrow headings to wrap.

History remains visible for mounted editors while their content is on screen,
so moving through a gap outside a narrow block no longer hides the controls.
Selected frames and editor chrome stack above decorative outlines. Portal
controls bypass the builder frame's click capture: Changes can now close and
its timeline actions receive clicks.

Regression checks cover narrow centred text, large headings, right-edge text,
viewport panning/shrinking and stable placement. The browser fixture now uses
actual builder frames with ephemeral data. Desktop and 390/320px browser checks
covered selection separation, zero horizontal overflow, pointer travel to
Undo/Redo/Changes, picker scrolling and Changes close/return to editing.
After Chrome disconnected, the in-app browser completed native and nested menu
checks at desktop, 320px and 320x430px, plus container and viewport resizing.
The fixture disposes its React root during hot reload to avoid duplicate roots.
