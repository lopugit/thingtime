# Social previews and structured-data foundation

## Investigation — 2026-09-17

The supplied examples showed three outcomes: the intended white Thingtime
wordmark, a Messenger link with no image, and an older pink app icon in Messages.
Anonymous production requests with `facebookexternalhit/1.1` now return the
white 1200×630 PNG for `/` and `/invite`; the PNG returns HTTP 200, `image/png`,
and 5,923 bytes. The old pink icon is not in those current tags. Existing
platform/page caches can outlive a deployment; this inspection does not prove
what Meta or Apple cached when the screenshots were taken.

Remaining reproducible gaps were generic raw HTML titles on route-specific
pages, relative image URLs in the static fallback shell, missing image alt
metadata, no canonical link, and no Schema.org JSON-LD. This change fixes those
at the existing Nitro shell boundary, without requiring crawlers to execute JS.
The branded image URL includes a revision; update it when the asset changes.
Existing public post, poll, gallery, comment/reply, profile, media, Thing and
published-page card rendering stays in the shared anonymous preview resolver.

## Implemented contract

- One per-request title, description, canonical and Open Graph URL. Query
  strings and fragments (including invite tokens) are excluded from metadata.
- Absolute PNG URLs, width/height, Open Graph/Twitter alt text and large cards.
  `og:image:secure_url` is emitted only for an HTTPS image.
- JSON-LD `WebSite` plus `WebPage`, `CollectionPage` or a resolved `ProfilePage`.
  Public data additionally describes a `Person`, `SocialMediaPosting`, `Comment`
  or conservative `CreativeWork`. No fabricated rating, offer, date or count.
- The same anonymous projection supplies the card and structured data. Raw
  `crystal` values, arbitrary user schema markup and authenticated content never
  get serialized. JSON-LD escapes script terminators as well as HTML-sensitive
  characters; CSP is not weakened to run inline JavaScript.
- Private/account/search/unknown screens and unavailable content use `noindex,
  follow` with generic page data. `/things` gets collection metadata, never a
  user's private collection items. Public discovery pages and successfully
  resolved public content may be indexed. `noindex` is not access control.
- Nitro HTML is private/no-store even outside Vercel. The direct static
  `/index.html` emergency shell has absolute production fallback tags and a
  homepage canonical; runtime per-route JSON-LD belongs to the Nitro handler.

## Verification and cache diagnosis

Run `npm --prefix remix run test:social-previews`, changed-file lint, the build,
and `verify:vercel-output`. Run `node remix/scripts/smoke-social-previews.mjs https://your-preview.example`
for the full read-only crawler matrix (optional path arguments select specific
permalinks). Nitro dev serves `/` as a static file; Vercel explicitly routes it
to the metadata handler, so verify the deployed homepage too. Inspect raw GET responses with a browser user agent,
`facebookexternalhit/1.1` and an Applebot user agent, then GET the exact decoded
`og:image` URL without cookies. Require PNG bytes and 1200×630 dimensions, not
just a successful HEAD. Compare title/description/canonical/JSON-LD for `/`,
`/invite`, `/feed`, `/things`, a public permalink and a missing/private target.
A fragment is never sent in an HTTP request: all `/invite#…` links share the
same anonymous preview; invitation payloads must remain private.

For Meta, inspect the public page using the [Sharing Debugger](https://developers.facebook.com/tools/debug/)
and request a fresh scrape when its cached timestamp predates deployment.
For Messages, check a newly composed link after deployment. A previously sent
message is not a fresh crawler check. Neither protocol markup nor a deploy can
guarantee that third-party caches or message bubbles update immediately.

## Broader work remains

This is a metadata foundation, **not completion of SEO or Google rich-result
eligibility**. Track the remaining route inventory, crawlable content rendering,
client navigation synchronization, public `/things` discovery, structured UGC
coverage, sitemaps, robots policy and search-console acceptance in
[the SEO TODO](../TODO/claude-todo/seo-schema-rich-results.md).

Forks should replace the static shell's `https://thingtime.com` emergency
fallback with their public origin. Normal Nitro metadata uses the request
origin. No new secret, provider account or environment variable is needed.

Local validation for this worktree uses Vite `http://localhost:19390` and Nitro
`http://localhost:19392`. The existing worktree port module owns this mapping.
Tailscale/Funnel was unavailable: the installed CLI wrapper points to a missing
`/Applications/Tailscale.app` executable. No unrelated Funnel route was changed;
use the deployed PR preview for public crawler acceptance.

## Standards

- [Open Graph protocol](https://ogp.me/): core properties, image dimensions,
  MIME type, secure URL, alt text and first-tag precedence.
- [Apple: rich previews for Messages](https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages/).
- [Google: structured data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
  and [quality guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
  Valid markup does not guarantee a rich result; it must reflect accessible,
  visible content and satisfy the requirements of a supported feature.
