# PR #69 — Unified: /search platform + profile composer & advanced filters

Branch: `claude/unified-search-profile-feed-fe779a` → `main`
Supersedes #63 + #67. This note tracks the larger additions that ride on the
unified branch; `remix/CHANGELOG.md` stays the concise grouped summary.

## 2026-07-15 — Native Thingtime rendering for feed things (ThingView)

Feed/profile `thingtime` posts previously flattened their thing into static
key/value rows, and Editor.js (`rich-text`) values displayed as raw block
JSON in feed rows and /search chips.

- New `remix/app/components/Thingtime/ThingView.tsx`: posts that are
  Thingtime things mount the NATIVE `Thingtime` component — right-click
  context menu, collapse/expand, and view ⇄ edit toggling all work in the
  feed. Defaults to view mode.
- Sandboxed store: `ThingView` provides a component-local stand-in for
  `ThingtimeProvider` (same `ThingtimeContext` surface), so edit-mode
  exploration of other people's things never writes into the viewer's
  localforage-persisted tree and never collides with the composer's
  `tmp.<session>` draft branch. Edits evaporate on unmount/refetch.
- Renderer priority: a `render:` prop naming a kind renderer outranks the
  thing's explicit `kind`, which outranks structural matching
  (`resolveKindRenderer` in `kindRegistry.tsx`). When a renderer resolves,
  the rendered form shows by default with a small corner 🌀 icon switching
  to the Thingtime view (✨ switches back).
- Rich text renders visually by default: post-level `rich-text` things go
  through the registered kind renderer; nested Editor.js values inside a
  tree render through Thingtime's native `RichTextBlocks` path; /search
  crystal chips and result titles show plain-text previews of Editor.js
  docs instead of raw JSON (`richTextPreview` in `SearchPage.tsx`).
- Security: `Thingtime` gained an `untrusted` prop (threaded through child
  mounts). ThingView sets it, disabling the chakra render path — which
  spreads `thing.props` verbatim into Chakra components — for other users'
  data. MagicInput already HTML-escapes; RichTextBlocks already sanitises.

Verified live (worktree stack, desktop 900px + mobile 375px): feed, profile,
/search; right-click menu, edit-mode steppers/switch/block editor, sandbox
persistence across re-renders, corner-icon flips both ways. TESTING.md
checklists run: "Feed thing rendering", "Thing context menu" (menu open/
anchor behaviour in feed cards).

### 2026-07-15 — Hardening pass (recursive review follow-up)

The first cut exposed the kind-renderer path to untrusted cross-user feed
content for the first time. A multi-angle review surfaced several real issues,
all fixed and re-verified live:

- **Untrusted XSS / layout-hijack.** Kind renderers put URLs verbatim into
  `href`/`src`/`backgroundImage`, and `chakra`/`element` render arbitrary
  layout. Now: `resolveKindRender` (registry) resolves render:→kind→match and
  returns the first candidate that ADAPTS; ThingView only auto-renders kinds
  on an explicit `UNTRUSTED_SAFE_KINDS` allowlist (the 13 vetted media/content
  kinds), everything else (incl. chakra/element) falls back to the sanitising
  native tree. `safeUrl`/`safeCssUrl` (safeUrl.ts) scheme-guard every href/src
  sink in kindRenderersMedia + kindPrimitives, so `javascript:`/`data:` URLs
  can't reach a link or media element. Verified via DOM: no
  `a[href^="javascript:"]`, no fixed high-z overlay from post content.
- **Undo corrupting the real tree.** Editing a feed thing and pressing
  Cmd/Ctrl+Z would hit the root provider's global undo listener and mutate the
  viewer's persisted tree. ThingView now contains the keydown (stopPropagation,
  no preventDefault) so native field undo works and the real tree is untouched.
  Verified: an in-tree Cmd+Z does not reach `window`; an out-of-tree one does.
- **Sandbox integrity.** Shares the app's real event bus (so the single-open
  context-menu protocol coordinates across cards); a dirty-guard stops feed
  refetches from clobbering in-progress edits; `window.meta.things` writes are
  disabled for untrusted trees; each ThingView uses a unique store key; the
  `Everything` context value is memoized; `cloneTree` dropped its shared-ref
  shallow fallback.
- **Bounds.** A large thing (≥150 nodes) mounts collapsed and scrolls within a
  maxHeight box, restoring the DoS/wall-of-text protection the old ThingBlock
  provided.
- **Reuse / regressions.** `blocksToText` moved into the light `editorJsValue`
  module (re-exported from LongTextEditor) and SearchPage now reuses it — one
  canonical serializer; returns null on empty so non-Editor.js `{blocks:[]}`
  data isn't mislabeled "rich text"; numeric search titles no longer vanish.
  Per-node `console.log`s in Thingtime gated behind `TT_DEBUG` (they mount at
  feed scale now).

### 2026-07-15 — Review rounds 2 & 3 (recursive)

- **safeCssUrl made genuinely breakout-proof** (node-verified against a CSS
  rule-injection payload): strips C0 control chars + DEL + U+2028/U+2029 + quotes
  /backslash/angle brackets and encodes parens, but preserves spaces (legal in a
  quoted url string — stripping them corrupted real image URLs).
- **Audio/Book/Movie placeholder fallbacks** gated on the sanitized value (a
  rejected `data:`/unsafe URL now shows the emoji placeholder, not a blank box).
- **Completed the URL-sink sweep**: the core `kindRenderers.tsx` renderers
  (Video `src`/`poster`/`href`/poster-bg, Listing image, Profile banner) were
  still interpolating untrusted values raw into unquoted `url()`/attributes;
  now all route through `safeUrl`/`safeCssUrl`. Avatar-based sinks were already
  safe via the hardened `Avatar` primitive; `tel:`/`mailto:`/fixed-host map
  links are scheme-locked; RichTextBlocks image/embed keep their regex guards.
- A final independent whole-codebase completeness sweep + correctness review
  returned zero findings — every untrusted→URL/markup sink is guarded,
  scheme-locked, or regex-checked.
