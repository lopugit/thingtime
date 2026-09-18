# PR 852 — Post media galleries and collected secret posts

## Behavior

Posts accept more than 25 uploaded/linked attachments, including edits. Comments,
messages, file-size validation and account storage quotas keep their existing
boundaries. Retry all targets only recoverable failed items and reuses the same
upload identity and existing completion/resume paths; queue concurrency stays 3.

Images and videos share attachment order, gallery layouts and lightbox navigation.
The default natural-height layout now uses row order at mobile breakpoints; CSS
columns and dense grid packing could visually move later media ahead of earlier
items. Videos use an inline popup player, with the same Thingtime `/media/:id`
link and copy control as images. Explicit secret keys follow shared media links.

Profiles use the feed's direct-user/group audience query and the existing exact
ACL/moderation/subspace/token gates. Link-only posts remain unlisted until a
successful secret-link visit. A protected `post-discovery` child records the
collector and current secret-key digest. Profiles batch-revalidate discoveries;
post and media reads independently recheck them. Rotation, removing hidden access,
moderation and deletion revoke access. Scoped tokens and custom data planes do not
acquire discovery grants.

Anonymous browsers keep a random 256-bit proof in localStorage and a secure,
host-only SameSite cookie. The server records its one-way anonymous ID and the
private IP observed at discovery. IP addresses alone are not access credentials.
Records are separate Things linked by targetId, are excluded from generic reads,
exports and writes, and cascade when the post is deleted. Successful visits are
rate-limited before any discovery write. Repeated visits do not grow history.

## Validation — 2026-09-18

- Production build and `verify:vercel-output` passed.
- Attachments: 219 suite tests plus the added home-media discovery regression.
- Things: 255 suite tests plus the added browser-storage regression.
- Capabilities: 67; schemas: 196; storage: 17; feed: 54 passed.
- Discovery tests cover valid/wrong keys, identity separation, key rotation,
  retired ACLs, deletion, token fences, private projections, and cookie isolation.
- Focused ESLint passed. Full TypeScript reports 116 pre-existing diagnostics;
  changed code has no new diagnostic (the registry's older errors remain).
- Chrome at desktop and 390px: ordered mixed media, popup/native inline playback,
  next/previous, copied Thingtime URL, and scrolling to the page footer. Synthetic
  production-composer test: 30 files, three errors retried once, concurrency <= 3.
- The browser upload fixture uses synthetic transport and creates no real posts
  or S3 objects. Physical iOS and authenticated production-post acceptance are not
  claimed by these checks.
- API versions: `api.things` 1.19.0, `api.things-user` 1.6.0,
  `api.attachment-content` 1.8.0; canonical registry and client requirements updated.
- Graphify refreshed through the local proxy with portable snapshot/manifest
  validation; generated snapshots are replaced as atomic artifacts after merges.

Local stack: http://localhost:18420 (HMR 18421, Nitro 18422), PM2
`tt-wt-thingtime-media-gallery-profile-18420-0840pm`, zero restarts and autorestart
false. Tailscale/Funnel cannot be verified: the installed launcher points to the
missing `/Applications/Tailscale.app/Contents/MacOS/tailscale` executable.
