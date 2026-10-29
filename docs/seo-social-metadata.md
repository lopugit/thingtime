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


## Invitation cards — 2026-10-29

`/invite` now selects an invitation card rather than the homepage wordmark:
“You’re invited to Thingtime”, a short invitation description, and the shared
1200×630 card renderer with envelope artwork. The client document title uses
“Thingtime - Invitation”. The image URL fingerprints the invitation copy and optional revision so
future card edits can refresh image caches.

The preview is deliberately shared across invitations. Tokens remain in the
fragment and are never sent to the crawler endpoint or image URL. The resolver
never reads, validates, redeems or consumes an invite, and does not publish its
recipient, inviter, email, display name, username, gifts or validity. Valid,
expired, missing and malformed payloads therefore get the same invitation
card; the interactive acceptance page determines availability. Canonical and
Open Graph URLs remain `/invite`, query strings stay excluded, HTML remains
private/no-store, and invitation pages remain `noindex, follow`. The generic
card has no account-dependent data, so its PNG uses the existing public cache
policy safely. Previously sent WhatsApp cards can remain cached; verify fresh
raw HTML and PNG responses as well as a newly composed message after deployment.

## Shared metadata API and exact branding — 2026-10-29

`GET /api/v1/social-previews?path=/post/<id>` exposes the same anonymous resolver
used by the page HTML and `/social-card`. Negotiate `api.social-previews` 1.1.0
before using it. The response contains title, description, canonical URL, Open
Graph type and an image descriptor (URL, dimensions, MIME type and alt text).
It accepts a local path or a URL on the serving origin; query strings and
fragments are discarded. It never scrapes an arbitrary external website,
uses a caller's signed-in access or accepts a caller-selected database.

Posts, comments, profiles, media, Things and anonymously readable published
Builder pages use canonical public projections. The same resolved preview feeds
HTML tags, JSON metadata and the branded image. Private, missing, unavailable
and unknown targets retain safe generic metadata.

### Application routes are discovered automatically

`scripts/generate-route-previews.mjs` parses the actual `createBrowserRouter`
tree in `app/routes.tsx` with TypeScript's AST. It follows eager route imports,
lazy module imports, nested/index routes, aliases and optional route parameters
without importing or executing application pages. Vite regenerates the portable
`app/utils/automaticRoutePreviews.generated.json` during builds and when route
or route-module files change; Nitro also regenerates before its build. Add the
ordinary application route once: no manually maintained backend page-metadata
registry or extra per-page API registration is required.

`app/utils/automaticRoutePreview.ts` provides a title, description, eyebrow and
branded card automatically from the matched route's trusted literal pattern.
Dynamic parameter values, query strings and fragments never become that copy.
The homepage keeps its canonical brand asset; matched application routes get
named generated cards. Wildcard/unknown paths keep the generic site fallback.
These defaults do not grant access, assert public content or change indexing.
`app/utils/pageTitle.ts` uses the same discovered document-title defaults.

A page may optionally export a literal `socialPreview` object from its route
module. Supported overrides are `title`, `description`, `eyebrow`, `badges`,
`variant`, `revision` and `pageTitle` (a document-title label separate from the
social headline). Existing invitation/feed copy uses this optional mechanism.
No export is needed for automatic defaults. Only literal display fields are
read: functions, getters, spreads, interpolated runtime values, arbitrary image
URLs and access/indexing declarations are not evaluated or accepted. The
extractor does not scrape arbitrary JSX text, authenticated screens or an
unpublished marketing catalog. It does not launch a browser or execute client
JavaScript, loaders or account-creation flows to discover metadata.

### Saved pages infer their public presentation

New saved pages at `/p/:id` and `/t/:id` need no metadata code or registration.
`meta/publicWebpageContent.ts` reads only the result of `resolveWebpage` for the
anonymous viewer. It derives a headline from supported visible headings,
a description from supported prose and images from literal managed-attachment
references, including authorized Component presentation with known saved/default
primitive arguments. Existing saved `name` and `description` fields are optional
overrides and take precedence over inferred copy. The default `Untitled page`
placeholder is not an override. Clearing an override restores inference; no new metadata Thing/schema is required.

This is a bounded projection of stored public presentation, not execution of
the page. It omits hidden/unknown conditional content, unresolved bindings,
runtime sources, Actions, viewer/query/state data, private references and
arbitrary remote images. It does not infer private system `siteRoute` block
layouts or use their stored definitions as anonymous presentation. If supported
public content cannot be inferred, a safe generic page preview remains. Managed
images still pass fresh anonymous attachment authorization and exact-version
checks before pixels are embedded. Page/Component copy changes contribute to
the content revision; the independent renderer revision refreshes brand assets.

API capability manifests remain mandatory. Automatic page discovery removes
per-page metadata registration, not endpoint registration or version negotiation.
The shared metadata behavior is `api.social-previews` 1.1.0 and the generated
card behavior is `api.social-card` 1.3.0.

The card image is a real 1200×630 PNG containing the public photos. The old
loader discarded original attachments over 2 MiB, which turned ordinary phone
photos into placeholder tiles. The replacement requests canonical bounded
thumbnails, normalizes them to a renderer-supported PNG and rechecks anonymous
access and the stored version before embedding. Source/decode limits remain
resource safeguards in the existing thumbnail service, not upload limits.
Denied, changed, malformed or unavailable attachments use safe fallback art.

The shared card renderer takes its wordmark and icon from the same voxel
matrices and exporter as `/branding`, and its colours from the canonical theme
tokens. Its bundled Space Grotesk, Hanken Grotesk and JetBrains Mono faces match
the brand font families without relying on server-installed fonts. Dynamic
image URLs include an independent renderer revision as well as their content
revision, so a branding fix can change the image URL for existing posts.
The current card contract is `api.social-card` 1.3.0.

See [PR 1287 delivery evidence](../PRs/1287-invite-previews-profile-choice-shared-branded-social-previews.md)
for the source revision, checks and deployment limitations. A gateway preview
must negotiate the new metadata/card capabilities with its selected backend;
successful HTML alone does not establish that the PNG endpoint is ready.
