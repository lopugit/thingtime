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
- `thingtime-landing/` — the built-out landing (nav · hero · live demo ·
  use cases · ecosystem · FAQ); links into `thingtime-app/`
- `thingtime-app/` — app mockup: the thing editor (interactive demo,
  path-bar commands); links back to `thingtime-landing/`
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
