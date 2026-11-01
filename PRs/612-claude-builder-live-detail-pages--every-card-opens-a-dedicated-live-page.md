# PR #612 — Builder round 3: every card opens a dedicated live page (`claude/builder-live-detail-pages`, stacked on #578)

Rescued from the stranded Claude worktree `pokeworld-starsalign-thingtime-40cd5f`.
Round 3 of the builder demo library was authored on 2026-09-03 on top of
`c30af479d` (the "shared live-component path, confirm gate, and detail route
stubs" commit that IS on `claude/builder-demo-library`) but the pages
themselves (19 edits + 4 new files) were never committed.

The design and surface table live in
`PRs/578-builder-demo-library-app-suites-pokeworld-starsalign.md` under
"Round 3 — every card opens a dedicated live page"; this note only records
the rescue.

## What this PR carries

- The round-3 pages as authored: `/builder/demos/:slug`, `/schemas/:key`,
  live panes on `/components/:key` and `/thing/:id`, cards → links on every
  catalog surface, `demoDetail.ts`, `schemaBrowseTypes` / `componentBrowseTypes`
  helpers and their tests, the "Dedicated live pages" `TESTING.md` checklist.
- A merge of the current `claude/builder-demo-library` head (PR #578's Lopu
  review rounds); the only conflict was the PR-578 note, resolved by keeping
  both appended sections.

## Verification (2026-09-05, worktree stack on 18500)

- Unit groups `test:components` 27, `test:webpages` 56, `test:schemas` 155,
  `test:things` 27, `test:actions` 53 — all green after the merge; `lint:files`
  clean on the changed pages (pre-existing warnings only).
- Browser (DOM-probed; the pane was hidden for part of the run):
  - `/builder/demos` cards link to `/builder/demos/<slug>` (72 links);
    `/builder/demos/hero-centered-paper` renders PREVIEW + LIVE panes and the
    Demo library / Use template / Open /p/ / Open in builder actions, at
    desktop and 375px with no horizontal overflow.
  - `/schemas` cards link to `/schemas/builtin:<id>`; `/schemas/builtin:post`
    renders the 12-field tree, inline create-a-thing and "your things with
    this shape".
  - `/components/demo-accordion-panel` renders the LIVE + PREVIEW panes, args
    and docs; for the throwaway signed-in tester the live pane reports
    `inert` (see the trust-ladder note below).
- CI on the PR: CodeQL, API suite, Build + typecheck ratchet + unit tests —
  green at the time of writing.

## Merge order

Merge #578 first, then this PR (or merge this branch into
`claude/builder-demo-library` to fold round 3 into #578).

## Trust-ladder note (from the rescue's browser pass)

`componentTrustFor` (componentBrowseTypes.ts) grants `seeded` only to a
system-owned, `component-`-prefixed thing whose `demo-`/`app-` componentKey
resolves to a suite in `ALL_SUITES`. The local dev database still holds older
seeded components such as `component-demo-accordion-panel` /
`demo-hangman-panel` / `demo-tabs-panel` whose keys name suites that no longer
exist in the registry, so their live pane reads `inert` even for a signed-in
viewer. That is the ladder failing closed on stale seed data, not a regression
in this round; components of registered suites (guestbook, rsvp, poll, tasks,
…) and the viewer's own components take the `platform · live` / `yours · live`
paths.
