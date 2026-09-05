# Thingtime marketing suite

The `/marketing` routes are a generated marketing site: feature landing
pages, how-to guides, animated cursor walkthroughs, comparisons, audience
pages, use cases, concept explainers, starter templates, style editions,
FAQ pages and getting-started checklists, plus a social-media image suite
with downloadable PNG/SVG posts. Everything is derived from one catalog so
the counts, links and copy can never drift.

## Where things live

| Path | What |
| --- | --- |
| `remix/app/marketing/types.ts` | Shared types (Feature, Persona, Competitor, UseCase, Trend, SocialFormat, Walkthrough, SectionBlock, MarketingPage…). |
| `remix/app/marketing/lookup.ts` | `byKey()` — the one way the suite builds a key → entry map. Null-prototype, so `MAP[key]` guards never resolve inherited names like `constructor` or `__proto__`. |
| `remix/app/marketing/features.ts` | The feature inventory (one entry per real product surface: route, tagline, highlights, audiences, mock screen, competitors it answers). |
| `remix/app/marketing/personas.ts` | Audiences with pains, gains and lead features. |
| `remix/app/marketing/competitors.ts` | Comparison subjects with fair differences, strengths and a side-by-side table. |
| `remix/app/marketing/useCases.ts` | Concrete things people keep (steps, sample tree, features, audiences). |
| `remix/app/marketing/concepts.ts` | Glossary concepts and starter templates. |
| `remix/app/marketing/trends.ts` | The twelve visual trend styles and the ten social image formats. |
| `remix/app/marketing/copy.ts` | Deterministic copy generators (hooks per platform, headlines, FAQs, captions, hashtags), seeded by slug. |
| `remix/app/marketing/walkthroughs.ts` | `SCREEN_TARGETS` (the `data-wt` targets each mock screen exposes) and the cursor scripts per feature and use case. |
| `remix/app/marketing/social.ts` | Pure SVG builders for every feature × trend × format social image, captions and filenames. |
| `remix/app/marketing/catalog.ts` | Page enumeration (`PAGES`), per-page builders (`buildPage`), validation (`validateCatalog`) and search. |
| `remix/app/marketing/publishingCore.ts` / `publishing.ts` | Publishing: the publication key grammar, wire shape and pure change application (catalog-free core), plus catalog validation, visibility resolution, summaries and bulk helpers. |
| `remix/app/marketing/pageGroups.ts` | `groupLabel()` / `groupPages()` — how a category index buckets pages by their best reference. Keys are namespaced (`persona:developers`, `family:developer`) because display labels collide across namespaces. |
| `remix/app/components/Marketing/` | React: `MarketingShell` (chrome + SEO + admin bar), `Sections` (block renderers + section frames), `MockScreens`, `WalkthroughPlayer`, `SocialImage`, `marketingTheme` (trend → `--mk-*` CSS variables), `MarketingPublishing` (admin bar, 🌐/🔒 chips, section frames), `MarketingGate` (the visitor's not-published card + cold start), `marketingPublicationsStore` / `useMarketingPublications` (shared publish state + visibility). |
| `remix/app/routes/marketing/` | Routes: hub (`_index`), `social-media`, category index (`category`, also `/marketing/search`), splat page resolver (`page`). |

## URL shapes

- `/marketing` — hub with counts, category cards, showcase walkthrough and quick paths.
- `/marketing/<category>` — index for `landing`, `guides`, `walkthroughs`, `compare`, `for`, `use-cases`, `concepts`, `templates`, `styles`, `faq`, `checklists`; `/marketing/search?q=…` searches everything.
- `/marketing/<slug>` — one generated page. Slugs are two or three kebab segments starting with their category, for example `landing/feed`, `guides/passkeys`, `walkthroughs/feature-messages`, `compare/thingtime-vs-notion`, `compare/notion-alternative`, `compare/feed-vs-twitter`, `for/developers`, `for/developers/open-api`, `use-cases/recipe-book`, `use-cases/recipe-book/vs-notion`, `concepts/thing`, `templates/car`, `styles/y2k-chrome/polls`, `faq/themes`, `checklists/creators-getting-started`.
- `/marketing/social-media?feature=<key>&trend=<key|all>&format=<key|all>` — the menu-navigable image suite.

## Publishing — the admin gate

Everything under `/marketing` is **admin-only until an admin publishes it**, one
piece at a time. A visitor who opens an unpublished surface gets a quiet
"Not published yet" card (with `robots: noindex` and a way back); admins see
the whole suite with the publishing controls in place. The model lives in
`remix/app/marketing/publishingCore.ts` (catalog-free key grammar and wire
shape — safe for the drawer's eager bundle) and `publishing.ts` (catalog
validation, visibility, summaries, bulk helpers).

| Key | Surface | Accepted state |
| --- | --- | --- |
| `hub` | `/marketing` (also gates `/marketing/search`) | `published` |
| `category:<key>` | `/marketing/<key>` — one category index | `published` |
| `page:<slug>` | one generated page | `published` |
| `section:<slug>#<type>[/<n>]` | one section inside a page (`/2`, `/3`… when a block type repeats) | `hidden` — sections show with their page unless hidden |
| `social` | `/marketing/social-media` — the resources suite | `published` |
| `social:<feature>` | one feature's image set inside the suite | `published` |

Rules:

- **Nothing cascades.** Publishing a category index does not publish its
  pages, and publishing the hub does not publish categories: each index simply
  lists whatever is published beneath it. Bulk switches ("Publish all 87
  pages") are conveniences that write one change per key.
- **Sections are exclusions.** A published page shows every section until an
  admin hides one; hidden sections stay visible to admins, dimmed and dashed,
  so they can be restored.
- **Links follow visibility.** Sub-nav chips, footer links, hero/CTA
  secondary buttons, `links` blocks, related cards, "other looks" chips, hub
  chips, crumbs and drawer entries only point at surfaces the viewer can open,
  and the counts the chrome quotes are the viewer's counts.
- **Fail closed.** Unknown publication state (no cache, no fetch yet) renders
  an empty surface for visitors, never the content; a Mongo outage serves the
  last-known-good state or nothing.

Where it lives:

- **State**: one `settings` singleton, `key: 'marketing-publications'`, with
  `items: [{ key, state, at, by }]` (`remix/app/api/utils/marketing/`). Rows
  whose key the catalog no longer generates drop out on read, so removing a
  page needs no migration.
- **API**: `GET /api/v1/marketing/publications` (anonymous read; admin sessions
  also get the per-key `audit`) and `GET|POST /api/v1/admin/marketing/publications`
  (`{ changes: [{ key, state }] }`, up to 2,000 per call, every key validated
  against the catalog, one atomic write). Both are documented in
  `remix/app/docs/apiDocs.ts` and published through `/api/v1/capabilities`.
- **Client**: `components/Marketing/marketingPublicationsStore.tsx` — one shared
  fetch per page load, a `tt-marketing-publications` localStorage seed for the
  first paint, optimistic admin writes reconciled against the server's full
  response — and `useMarketingVisibility()` for the resolver every surface
  renders through.
- **Controls**: the admin bar under the sub-nav on every marketing page
  (state pill, Publish/Unpublish this surface, "Publish all N" over its
  children, 👁️ View as visitor, Manage all →); 🌐/🔒 chips on hub category
  cards, index page cards and social menu rows; a hide/show frame around each
  page section; and the `/admin/marketing` panel for whole-suite sweeps
  (stats, per-category page lists with filters, image sets, hidden sections,
  publish/unpublish everything behind a confirmation).
- **Drawer**: the Marketing section and its children carry `publication` keys
  and stay out of a visitor's drawer until at least one child is published.

The feature's one admin setting is **View as visitor** (per browser,
`tt-marketing-preview-as-visitor`): it renders the exact visitor experience
for an admin without signing out.

## Adding content

- **A feature**: add an entry to `features.ts` (pick an existing `screen`, keep three highlights, factual description). That alone adds a landing page, a guide, a FAQ page, a walkthrough, one persona page per audience, ten × twelve social images, and comparison pages for every competitor named in `answers`. Give it a bespoke cursor script in `walkthroughs.ts` if the generic screen tour does not fit.
- **A competitor**: add to `competitors.ts` with at least five table rows; keep every claim fair and general.
- **A trend style**: add to `trends.ts`; `social.ts` renders any new style through the default composition, and `marketingTheme.ts` maps it to CSS variables automatically. Add a bespoke layout in `buildSocialSvg` only when the look needs one (listicle, before/after, meme caption and bento do).
- **A mock-screen target**: add it to `SCREEN_TARGETS` and render it with `data-wt` in `MockScreens.tsx`; the tests fail until both sides agree.

## Guarantees the tests enforce

`npm --prefix remix run test:marketing` runs the catalog and component tests:

- 1000+ pages and 1000+ social assets, unique slugs, every slug starts with its category, titles ≤ 90 chars, descriptions 50–200 chars, no placeholder text, every related link and in-page link resolves, every page builds with a hero first and a CTA last, builds are deterministic, sibling pages do not share one headline shape.
- Every walkthrough uses only targets its mock screen exposes; every mock screen renders every target exactly once.
- Every trend × format renders valid SVG at the exact platform size with no `NaN`, no unescaped ampersands and no scripts.
- Copy generators fill every placeholder and stay deterministic per seed.
- Every `*_BY_KEY` / `PAGE_BY_SLUG` map is null-prototype, so a URL segment or query value naming an `Object.prototype` member (`constructor`, `toString`, `__proto__`…) resolves to nothing and hits the normal not-found path instead of a half-built page.
- Every publishable surface has a catalog-validated key, section ids are unique per page, keys naming nothing (including `constructor`-style names) are rejected, sections only accept `hidden` and everything else only `published`, visitors never resolve an unpublished surface while admins resolve everything unless previewing, and the store's projection drops stale keys and fails closed on read outages (`publishing.test.ts`, `api/utils/marketing/marketingPublications.test.ts`).
- Category and search indexes group pages under unique keys, and grouping keeps every page exactly once in first-seen order. `/marketing/search` mixes namespaces, and one name ("Developers") is both a persona and a feature family — so the section key is the namespaced group key, never the visible label.

## Manual checks

See the "Marketing suite" checklist in `TESTING.md`.
