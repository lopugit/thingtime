# PR #635 — Complete Editor.js rich text styling

[Pull request](https://github.com/lopugit/thingtime/pull/635) targets `develop`.
Branch: `codex/editor-rich-text-controls`.

## Behaviour

Selected text and block settings share a full colour/typography dialog. It offers
an HSL colour wheel, hue/saturation/lightness, opacity, HEX/RGB/RGBA/HSL/HSLA input,
text/highlight colours, bold/italic/underline/strikethrough/overline, curated font
families, and custom px/em/rem/pt/% sizes with steppers. Apply commits a draft;
Cancel preserves the document; Reset removes selected formatting. Native browser
undo restores selected-text changes, including changes inside an already styled
substring. Unchanged mixed formatting remains intact.

Both builder editor surfaces previously disabled Style. They now expose it, and
builder HTML conversions retain validated block styles and inline spans. Saved
rendering applies styles to table cells, warnings and captions as well as existing
paragraphs, headings, lists and quotes. Literal code blocks remain plain text;
whole-block typography still applies.

The inline toolbar follows the selection above the text, wraps to the available
width, and accounts for visual-viewport offsets. Mobile top/bottom positioning
needed an explicit bottom reset to avoid collapsing the popover to a thin strip.

## Verification

- 67 Editor.js/kind tests and 31 builder/webpage tests pass.
- Targeted ESLint has no errors or warnings in the changed implementation.
- Vite client and single-file embed builds pass; embed stays within its budget.
- Chrome desktop and 390px mobile checks: heading/paragraph/table selection,
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

The repository Graphify wrapper refreshed code and attempted semantic indexing
through the local proxy. One of three semantic chunks exceeded the proxy's 1.2 MB
request limit; documentation/media indexing is partial. Graphify also reported a
semantic node-id collision between the fixture HTML and TSX. Structural code data
and portable graph outputs remain usable; neither limitation affects app builds.
