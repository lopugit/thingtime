# PR #841 — Social preview metadata and public Schema.org markup

2026-09-17 · branch `codex/social-schema-crawler-fix` · target `main`

Problem, evidence, standards and implementation:
[SEO/social metadata note](../docs/seo-social-metadata.md).
Remaining product-wide scope:
[SEO, Schema.org and rich results TODO](../TODO/claude-todo/seo-schema-rich-results.md).

The live baseline already advertised the white wordmark PNG; the screenshots'
old pink icon could not be reproduced in current crawler HTML. The delivered
fix addresses confirmed missing canonical/schema/alt tags, generic raw titles,
relative fallback image URLs and a stable branded-image cache key. Existing
sent-message caches are outside the site's control.

## Validation

- 41 social/card/metadata tests pass, including public UGC, secret stripping,
  malformed markup, script terminators, fallback noindex and image attributes.
- Changed-file ESLint, production build and Vercel output verifier pass.
- Local Nitro: nine paths across three user agents, real 1200×630 PNG reads;
  public post and generic Thing resolve to SocialMediaPosting and profile to
  ProfilePage/Person; missing routes stay generic/noindex.
- Chrome invitation and public post body/footer inspected on desktop/mobile.
  The existing authenticated local mobile navigation can be crowded by a long
  test username; this metadata change does not alter navigation layout.
- Full typecheck: 116 diagnostics in unchanged files, including existing smarts,
  component-test types and duplicate `serverAssets` in Nitro config. None in the
  changed source. No baseline increase was accepted or hidden.
- Local URLs: Vite http://localhost:19390, Nitro http://localhost:19392.
  Tailscale/Funnel unavailable: CLI wrapper targets a missing Tailscale app.
- Graphify semantic extraction ran through the local proxy; immutable snapshot
  regeneration is included. Generated snapshots are regenerated after main
  updates, never hand-merged.

Public preview and production crawler checks are required before reporting this
as deployed. Tests cannot prove a physical iMessage/Messenger bubble refreshed
or guarantee Google rich-result eligibility.
