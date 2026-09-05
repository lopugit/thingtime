# PR #638 — Marketing suite admin publish gate (`claude/marketing-pages-admin-guard-ed2cd8`)

Stacked on PR #610 (`claude/marketing-suite`). Lopu asked for the recent
marketing page / resources work to be locked behind an admin route guard so
pages, resources and sections can be published one at a time.

## What shipped

- **Model** — `remix/app/marketing/publishingCore.ts` + `publishing.ts`:
  keys `hub`, `social`, `social:<feature>`, `category:<key>`, `page:<slug>`,
  `section:<slug>#<type>[/<n>]`. Sections take only `hidden` (shown with
  their page by default); everything else only `published`; `null` clears.
  Nothing cascades — an index lists whatever is published beneath it. The
  catalog-free core exists so the drawer (eager root chunk) never imports the
  1,600-page catalog.
- **State** — one `settings` singleton (`marketing-publications`,
  `items: [{ key, state, at, by }]`) written by ONE atomic aggregation-pipeline
  update (`$filter` out touched keys + `$concatArrays` the new rows, `$literal`
  so stored strings are never read as field paths). Stale keys drop on read;
  outages serve last-known-good or nothing (fail closed).
- **API** — `GET /api/v1/marketing/publications` (anonymous, `no-store`;
  admin sessions add `audit`) and `GET|POST /api/v1/admin/marketing/publications`
  (`{ changes }`, ≤ 2,000 per call, catalog-validated, fail-closed rate
  limit). Nitro import map + `apiDocs.ts` + capabilities 1.0.0 +
  `rateLimit/config.ts` defaults (`marketing.publications`,
  `admin.marketingPublications`).
- **Client** — `marketingPublicationsStore.tsx` (module store,
  `useSyncExternalStore`, `tt-marketing-publications` first-paint seed,
  deduplicated fetch, optimistic writes reverted + refetched on failure, retry
  backoff) and `useMarketingVisibility()`; the `View as visitor` flag lives in
  `tt-marketing-preview-as-visitor`.
- **UI** — `MarketingPublishing.tsx` (admin bar, `PublishToggle` chips,
  `SectionAdminFrame`), `MarketingGate.tsx` (visitor card with `noindex`,
  cold-start surface), `MarketingShell` (bar slot, filtered sub-nav/footer,
  viewer counts), `Sections.tsx` (frames, hidden sections, filtered
  links/secondary CTAs), the four marketing routes, `drawerMenu.tsx`
  (`publication` keys + `filterDrawerTopItems`), Admin → Marketing tab
  (`MarketingPublishingTab.tsx`, `React.lazy`).

## Decisions worth remembering

- **Sections are exclusions, everything else inclusions.** Publishing a page
  and then hiding a block is the natural editing motion; making every one of
  the ~12k sections opt-in would have made "publish a page" a 9-click job.
- **Settings singleton, not `things` rows.** The publish state is
  admin-editable app configuration bounded by the catalog (1,737 keys), which
  is exactly what FUNDAMENTALS §3 reserves the `settings` collection for; a
  `things` kind would have needed a schema registry entry, ACLs and an index
  budget slot for no reader benefit.
- **Client-side gate.** The suite is static client code (the catalog ships
  in the marketing chunk regardless), so the guard protects *publication*, not
  secrecy: render-time gating with the same 🔐-card idiom as `/admin`, backed
  by server-validated state. Titles of gated pages are not leaked into the
  tab (`useMarketingSeo` receives the gated title).
- **Fail closed on unknown state.** A visitor with nothing cached renders an
  empty surface for the one round trip, and a failed fetch becomes "nothing
  published" while the store retries — never the content, never a spinner.
- **Source-only commits** — graphify snapshots left uncommitted, as #610 did,
  so GitHub can diff the PR.

## Verification (2026-09-05, worktree stack Vite 14090 / Nitro 14092)

- Unit: `test:marketing` 71/71 (7 publishing-core + 4 store tests added),
  `test:nav` 4/4 (3 drawer gating tests added), `test:api-capabilities` 8/8,
  `adminRoutesCore` + `rateLimit/config` green. `lint:files` clean on 38
  changed files; `tsc --noEmit` shows no errors in changed files (the
  pre-existing baseline stands, incl. the duplicate `headers` key in
  `apiDocs.ts`).
- API: anonymous GET = `no-store`, no `audit`; admin GET has `audit`;
  unknown key → 400 `Unknown page: nope`; wrong state → 400
  `hub only accepts state 'published' or null`; anonymous POST → 401; the
  write lands in `settings_v1` with `by` = the admin username.
- Browser (the pane was hidden, so DOM probes rather than screenshots):
  visitor gate on hub / category / page / social with `robots: noindex`,
  "Not published yet" title, "Back to Thingtime" when the hub is unpublished
  and "Back to marketing" when it is; sub-nav wordmark is a `<span>` while
  the hub is unpublished; a published page hides its hidden section, drops
  its `links` block and related/sibling cards to visible targets; the drawer
  shows no Marketing section until the hub (or a child) is published.
  Admin: bar + chips + frames everywhere; section hide/show, "Publish all 88
  pages" → 89/89 → "Unpublish all" → 0/89, chip re-publish, social image-set
  chip, preview mode (7 sections, no frames, flag survives reload),
  `/admin/marketing` publish-everything sweep (1,737 keys, one request) and
  back, per-page toggle in the expanded category list. 375px: no horizontal
  overflow on hub, index, page; admin bar wraps to 3 rows; section chips sit
  in the frame's top-right without touching the hero title.

## Gotchas

- Hidden Browser pane throttles the page's timers: JS polling loops time out
  (45s) and first renders of lazy chunks take 8–15s — use `wait` actions plus
  one-shot DOM probes.
- Bash cwd persists across tool calls; a `cd remix &&` in one call breaks
  relative paths in the next — prefix every command with the worktree root.
- Without `strictNullChecks`, `if (!x.ok) x.error` does not narrow the
  `{ ok: true } | { ok: false; error }` unions — use `x.ok === false` like the
  rest of the codebase.
