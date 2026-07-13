# TESTING.md — per-area manual test checklists

Run the checklist for every area a PR touches, in a live browser against the
local dev stack (`npm run web-pms`, worktree stacks get their own port trio —
see `AGENTS.md`). Each list is the distilled regression history of that area:
every line exists because it broke once. Add a line whenever a new bug class
is fixed, and cite the checklist you ran in the PR description.

## Composer — Thingtime tab (`remix/app/components/Feed/PostComposer.tsx`)

- [ ] Open the feed composer → Thingtime tab: the editor shows exactly ONE
      root property, `New Thing`, with no default children (no `name`).
- [ ] The draft path is session-scoped (`tmp.<sessionId>.New Thing`): add a
      field, reload the page, reopen the tab → the draft is EMPTY again and
      the store's `tmp` branch holds only the new session.
- [ ] Post button stays disabled until the thing has real content (empty
      strings don't count; numbers/booleans/nulls do).
- [ ] Photos toggle ON requires ≥1 valid image URL before Post enables;
      Marketplace toggle ON requires valid listing fields. Toggling either
      off re-enables Post on thing content alone.
- [ ] Posting a thing + photo + listing renders the card as thing → photo
      grid → listing, with the first photo appearing exactly once.
- [ ] Change type on the `New Thing` root (context menu → change type):
      string shows a text editor that accepts input; boolean shows a boolean
      editor; the seed effect must NOT clobber the converted value back to {}.
- [ ] The in-post editor height-drags via the bottom handle (mouse and touch)
      with no upper limit, and never below the small floor.

## Editor windows & layer system (`remix/app/components/Thingtime/EditorSplit.tsx`)

- [ ] Every toolbar control on a FLOATING frame (splits, edit toggle, reader/
      code toggle, pop-out, dock-in, ▲▼ layer arrows, …) fires its action on
      click — none of them start a frame drag. Dragging empty toolbar space
      still moves the frame.
- [ ] The composer's pop-out button duplicates the window into a native
      floating frame (traffic lights + toolbar); the in-post editor stays and
      both live-sync through the store.
- [ ] New frames layer ABOVE the drawer; hovering the drawer brings it to
      front, mouse-leave hands it back.
- [ ] ▼ on the top below-drawer frame / ▲ on the bottom above-drawer frame
      crosses the drawer WITHOUT changing relative window order; ⇧-click is
      bring-to-front / send-to-back.
- [ ] Close or dock a below-drawer frame: the frames stacked above it must
      STAY above the drawer (layer divider accounting).
- [ ] Open a dropdown (feed Filters, Algorithm menu) and a drawer modal with
      a frame floating: menus (10220) and modals (10240/10250) render ABOVE
      the frame; the chrome z ladder is documented in
      `remix/app/components/Nav/Drawer/useDrawer.tsx`.
- [ ] Dragging a window from one editor instance over ANOTHER instance's
      window must not dock (and must never lose the window) — drop targets
      are instance-scoped.
- [ ] `/editor` still opens with its two-window default and the drawer's
      Editor section still lists/saves/restores layouts (embedded composer
      editors must never appear there).

## Multi-editor focus (`remix/app/components/Editor/LongTextEditor.tsx`)

- [ ] With the popout open (same path in two editors), click into an
      editor.js field, type, wait ~1s (autosave echo remounts the OTHER
      instance), keep typing WITHOUT re-clicking: the caret must stay exactly
      where it was — no jump to block start, no focus loss. Test typing in
      the popout and in the in-post editor.
- [ ] Single-editor echo: typing continuously through several autosaves in
      one editor never remounts or resets it (signature echo acknowledgment).

## Thing context menu (`remix/app/components/Thingtime/ContextMenu/`)

- [ ] Open the hover (popover) menu from a row inside a SMALL editor box: the
      menu must overflow the box freely (portal) and stay anchored to its
      trigger through page scroll, window resize, and layout shifts (e.g.
      height-dragging the composer editor while open).
- [ ] The menu renders above floating frames and drawer modals (z 10260).
- [ ] Drag-move and corner-resize the menu; near the right viewport edge it
      clamps inside the viewport without jitter.
- [ ] The design-system anatomy stories (/docs/design-system →
      thing-context-menu) still lay out statically inside their canvases
      (`inline` mode).

## Data crystals & nesting depth (`remix/app/schemas/registry.ts`)

- [ ] Post a thingtime post whose thing contains an Editor.js document (or
      any structure) nested well past 6 levels: it must save (depth rail is
      64, a stack-safety bound only, with node/array caps as the real
      guards).
- [ ] Oversized payloads still fail loudly: >10000 nodes, >1000 array items,
      or a key with `$`/dots must 400 with a precise message, never silently
      drop data.
- [ ] `["post","data"]` combinations still 400 (data crystals stand alone);
      a thingtime post's free-form payload lives ONLY under `crystal.thing`.

## Feed & profile advanced filters (`remix/app/components/Feed/AdvancedFilters.tsx`)

- [ ] Filters ▸ Advanced opens the panel between the controls row and the
      composer; applying keeps the last-known posts rendered while loading
      (no skeleton flash); a FAILED search clears to the honest empty state.
- [ ] A sort-only search (e.g. oldest, nothing else) applies; relevance with
      no text does NOT activate advanced mode.
- [ ] Shortcuts round-trip: tags, by-user (unknown user = empty result, not
      an error), min reactions/comments (bounded-window mode), text length.
- [ ] Profile panels are locked to the profile's user (no By-user field) and
      the header post count stays the profile total, not the filtered count.
