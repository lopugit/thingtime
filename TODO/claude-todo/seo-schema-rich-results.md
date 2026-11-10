# SEO, Schema.org and rich results across every page and public Thing

Requested by Lopu on 2026-09-17. Priority: ongoing product-wide work.
Status: server metadata foundation implemented; broader acceptance remains open.
Evidence and current behavior: [social metadata note](../../docs/seo-social-metadata.md).

The product requirement is automatic, accurate Open Graph, social-card,
canonical and Schema.org metadata for all pages, `/things`, public Things and
UGC, with useful rich results for search engines and crawlers. It must scale
through the route/schema registries rather than depend on authors writing tags.
Private, inherited/restricted, unpublished, deleted and moderated content must
never become public through any SEO projection or discovery index.

- [x] Add matching server HTML title, canonical, Open Graph/Twitter image alt
  and safe JSON-LD at the shared Nitro shell boundary.
- [x] Reuse existing anonymous public Thing/post/profile/page/media previews;
  describe `/things` as a collection without enumerating personal data.
- [x] Add script-injection, secret-stripping, fallback/noindex and semantic
  type regression tests. Keep the branded fallback a real 1200×630 PNG.
- [ ] Inventory every route and schema kind, including subspaces, public
  collections, listings, events, audio/video, polls, nested comments, user-built
  pages and future UGC. Record public/private, canonical, robots, schema type,
  visible content and social-image coverage. Generate a missing-coverage check.
- [ ] Define public `/things` discovery and public collection permalinks without
  indexing personalized views, filters, drafts, app namespaces or private IDs.
- [ ] Add crawlable public body content/prerendering where needed; the current
  Vite shell still renders its body in JS. Ensure structured data matches what
  an anonymous visitor can actually see. Do not add SSR solely for metadata.
- [ ] Synchronize canonical/social/JSON-LD on SPA navigation and back/forward;
  scope to identity/origin, clear obsolete entities immediately and fence stale
  asynchronous reads. Keep static emergency shells/forks correctly configured.
- [ ] Map eligible schemas to Google-supported rich-result types with real
  required fields, public author identity, dates, media and breadcrumbs. Do not
  fabricate prices, ratings, availability or claim eligibility from JSON syntax.
- [ ] Add scalable canonical public sitemaps, robots.txt and deliberate preview/
  staging noindex rules. Respect pagination, aliases, duplicate URLs, query
  traps, publication/moderation changes, deletion and private-content revocation.
- [ ] Make image cache revisions follow both renderer versions and all visible
  content/dependency changes; audit CDN lifetime and purge/revocation behavior.
  Cover multiple languages and fonts, meaningful alt text and crawl budgets.
- [ ] Verify raw deployed HTML and fetched image bytes under crawler agents;
  run Schema.org Validator, Google Rich Results Test/Search Console inspection,
  Meta Sharing Debugger and fresh physical-device Messages/Messenger checks.
  Record exact deployment, scrape time, errors and eligible result types.
- [ ] Add periodic route-coverage, broken-image, canonical, schema and crawler
  regression checks. Track real indexing/rich-result outcomes, not assumed SEO
  improvements. Add capability contracts/tests for any new discovery API.

Acceptance: every supported public route/Thing has correct automatic metadata
and accessible matching content; private routes stay private; structured-data
validators pass for claimed types; search/crawler evidence is recorded. An old
message bubble or a generic WebPage schema alone does not satisfy this goal.
