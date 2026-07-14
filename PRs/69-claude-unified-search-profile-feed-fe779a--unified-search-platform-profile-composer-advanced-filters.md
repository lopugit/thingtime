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
