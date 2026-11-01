# Brand logo SEO — Organization JSON-LD, crawlable logo `<img>`, robots.txt, sitemap

Branch: `claude/thingtime-brand-logo-f1d19d` → `main` (owner-authorized merge).
Author: Claude (AI), 2026-09-19.

## Why

Googling "thingtime logo" showed Dashery merch photos and unrelated "thing"
logos. Google could not see the brand mark anywhere on thingtime.com:

- The `/branding` hero previews were `data:image/svg+xml` URIs built in the
  browser (never indexed), and the landing `<Logo>` was a grid of `<div>`s.
- Structured data emitted only `WebSite` + `WebPage`; there was no
  `Organization.logo`, which is the field Google uses for brand logos.
- `/robots.txt` and `/sitemap.xml` both returned the SPA shell as HTML, so
  the committed PNG/SVG logo files under `/branding/generated/` were orphans.

## What changed

**Structured data** — `remix/app/api/utils/meta/brandIdentity.ts` (new) holds
the public brand identity: square 1024px tree icon as `Organization.logo`,
wordmark as `Organization.image`, `sameAs` (Instagram, Dashery, merch).
`socialMeta.ts` appends the Organization node as `@graph[2]` on every shell and
links `WebSite.publisher` to it. Fork-safe: constants in code, no env/vault.

**Crawlable images** — `BrandAssetSection.tsx` renders the hero `<img>` from
the committed 1024px PNG (SVG fallback, client SVG only for custom matrices)
with descriptive `alt` per variant (`routes/branding/_index.tsx`). `Logo.tsx`
draws a real `<img>` of the matching generated PNG directly underneath the
voxel grid (same bounds, `pointer-events: none`) whenever the stock
matrix/theme has a committed file; custom matrices render voxels only. The
unused Monaco import was dropped from `Logo.tsx`.

**Indexable path list** — `meta/indexablePaths.ts` (new) is the single source
for the shell's `robots` meta and the sitemap's static section. `/privacy` and
`/terms` (the public legal pages) were added to the indexable set.

**robots.txt + sitemap** — `seo/sitemapCore.ts` (pure: XML rendering, index,
static section with image-sitemap entries, query parsing, robots text with an
explicit `Allow: /` stanza per well-known AI crawler) and `seo/sitemap.ts`
(Mongo-backed `SitemapDataSource`, response builders). Sections:

| URL | Content |
| --- | --- |
| `/sitemap.xml` | `<sitemapindex>` of every section file below |
| `?section=static` | indexable static pages + logo/press-kit images on `/` and `/branding` |
| `?section=posts&page=N` | public posts, newest first, 500/page, ≤100 pages |
| `?section=pages&page=N` | public published `/p/<id>` pages (route twins excluded) |
| `?section=profiles` | profiles of authors with public posts (≤5000) |

UGC runs as the anonymous viewer through the RSS pipeline (public superset
match → exact `canViewInherited`), emitting only permalink + timestamp.
Responses: `application/xml`, `public, max-age=300, s-maxage=3600,
stale-while-revalidate=86400`, nosniff; 400/404 as text; HEAD + 405 handled.

**Routes** — Nitro `routes` in `nitro.config.ts`: `/robots.txt`,
`/sitemap.xml` → `server/handlers/{robots,sitemap}.ts`; their `-docs` twins →
the API catch-all. `GET /api/v1/sitemap` (`routes/api/v1/sitemap/_sitemap.tsx`)
is the programmatic twin, registered in the import map + `apiDocs.ts`
(`sitemap`, `seo-robots`, `seo-sitemap`, all `1.0.0`).
`thingtimeCapabilities.ts` now lists root `-docs` twins from
`ROOT_DOCS_TWIN_IDS`. Vercel: `patch-vercel-output.mjs` adds
`^/(?:robots\.txt|sitemap\.xml)(?:-docs)?$ → /__server` before the filesystem
handler and outside the no-store social route; `verify-vercel-output.mjs`
asserts it.

**Offline generator** — `remix/scripts/generate-sitemap.mjs`
(`npm run sitemap:generate`): writes `robots.txt`, `sitemap-static.xml` and an
index into `remix/sitemap-out/` (gitignored) with no network; `--fetch`
mirrors every UGC section from `<origin>/api/v1/sitemap`. Imports the pure
core straight into node, which is why `sitemapCore.ts` uses explicit `.ts`
import extensions.

## Validation

- `test:seo` (12 new tests: static/indexable agreement, image entries, XML
  escaping and control-char stripping, index bounds, query parsing, robots
  content, response headers/HEAD/405/400/404, fake data source paging).
- `test:social-previews` (41), `test:api-capabilities` (69, includes route-map
  coverage + new manifest twins), `test:vercel-config`, `test:branding`.
- `lint:files` clean on all changed files; typecheck ratchet — see PR.
- `node scripts/generate-sitemap.mjs --origin https://thingtime.com` produced
  21 image entries across `/` and `/branding`.
- Local dev (Nitro on the worktree API port): curl checks of `/robots.txt`,
  `/sitemap.xml`, sections, `-docs` twins, JSON-LD; browser check of
  `/branding` and `/` `<img>` elements — recorded in the PR conversation.
- Production verification after merge: `robots.txt` text/plain, `sitemap.xml`
  XML with image entries, Organization JSON-LD on `/`; Search Console
  submission is a manual owner step.

## Follow-ups (not in this PR)

- Image entries for public post attachments (needs the attachment content
  URL contract + moderation state per image).
- `/media/<id>` and `/thing/<id>` sections.
- Search Console: submit `https://thingtime.com/sitemap.xml` once and request
  indexing of `/branding`; image results typically refresh over weeks.
