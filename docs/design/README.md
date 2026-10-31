# 🎨 docs/design — Claude Design exports

Each folder is one design entry. Every entry ships a self-contained
`index.html` (open directly, works via `file://`) plus the editable
`*.dc.html` source, which needs `support.js` + `ds/` served from the same
directory. Rebuild any entry's bundle with `python3 inline-dc.py <folder>`.

## Entries

- `claude-design-mockup-v1/` — launch page prototype (interactive reader/dev
  switch, edit mode, ⌘P commander)
- `thingtime-launch-celebration/` — launch-day page, click for confetti
- `thingtime-directions/` — exploration canvas: 8 landing directions in one
  scrollable doc (anchors `#1a`–`#1h`)
- `claude-design-mockup-v2-fable/` — the built-out landing (nav · hero ·
  live demo · use cases · ecosystem · FAQ); links into `thingtime-app/`
- `thingtime-app/` — app mockup: the thing editor (interactive demo,
  path-bar commands); links back to `claude-design-mockup-v2-fable/`
- `thingtime-algorithm-growth/` — design concept: the doomscroll-trained feed
  algorithm visibly matures 🥚 → 🐣 → 🐥 → 🧠 (interactive scrubber; Prism look).
  Hand-authored self-contained `index.html` (no `.dc.html` source).
- `thingtime-theme-gallery/` — design concept: a browsable, one-click-apply
  public theme gallery; each card is a live mini preview in its own theme.
  Hand-authored self-contained `index.html` (no `.dc.html` source).
- `thingtime-history-timeline/` — design concept: the unified history browser
  and contextual History panel — Scope (Everything / This Thing / Page +
  related) × Look (List / Cards / Line / Frames), Thing cards as of each
  version, property-change chips, contextual messages (you / Lopu / apps /
  system), local-first sync pills, variations as lanes with "Review and
  combine", and History settings (interactive; Prism look). Hand-authored
  self-contained `index.html` (no `.dc.html` source).
- `thingtime-history-evolution/` — design concept: the alternative history
  browser view — one Thing laid out left to right. Cards look (default): the
  Thing's card as of each version alternating above and below a rainbow
  progress spine, edit callouts, minimap, density presets, dashed variation
  row; Line look (nodes on a line, labels alternating, day axis); Frames look
  (filmstrip); scrub, play, compare. Hand-authored self-contained `index.html` (no `.dc.html`
  source); cross-links with `thingtime-history-timeline/`.
- `thingtime-landing-1a-classic-centered/` — classic centered · waitlist-first · warm copy
- `thingtime-landing-1b-product-split/` — product split · the demo IS the hero · confident copy
- `thingtime-landing-1c-crowdfund-campaign/` — crowdfund campaign · backers-first · rallying copy
- `thingtime-landing-1d-developer-first/` — developer-first · API hero · terse copy (dark)
- `thingtime-landing-1e-typographic-story/` — typographic story · use-case led · narrative copy
- `thingtime-landing-1f-ecosystem-map/` — ecosystem map · one brain, every surface · systems copy
- `thingtime-landing-1g-magic-path-bar/` — magic path bar · novel UX hero · playful copy
- `thingtime-landing-1h-ultra-minimal-voxel/` — ultra-minimal voxel · quietest copy

The `thingtime-landing-1*` entries are split from `thingtime-directions/`
(one standalone page per direction, card width preserved as a centered
`max-width:980px`).
