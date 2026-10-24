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
| `remix/app/components/Marketing/` | React: `MarketingShell` (chrome + SEO), `Sections` (block renderers), `MockScreens`, `WalkthroughPlayer`, `SocialImage`, `marketingTheme` (trend → `--mk-*` CSS variables). |
| `remix/app/routes/marketing/` | Routes: hub (`_index`), `social-media`, category index (`category`, also `/marketing/search`), splat page resolver (`page`). |

## URL shapes

- `/marketing` — hub with counts, category cards, showcase walkthrough and quick paths.
- `/marketing/<category>` — index for `landing`, `guides`, `walkthroughs`, `compare`, `for`, `use-cases`, `concepts`, `templates`, `styles`, `faq`, `checklists`; `/marketing/search?q=…` searches everything.
- `/marketing/<slug>` — one generated page. Slugs are two or three kebab segments starting with their category, for example `landing/feed`, `guides/passkeys`, `walkthroughs/feature-messages`, `compare/thingtime-vs-notion`, `compare/notion-alternative`, `compare/feed-vs-twitter`, `for/developers`, `for/developers/open-api`, `use-cases/recipe-book`, `use-cases/recipe-book/vs-notion`, `concepts/thing`, `templates/car`, `styles/y2k-chrome/polls`, `faq/themes`, `checklists/creators-getting-started`.
- `/marketing/social-media?feature=<key>&trend=<key|all>&format=<key|all>` — the menu-navigable image suite.

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

## Manual checks

See the "Marketing suite" checklist in `TESTING.md`.
