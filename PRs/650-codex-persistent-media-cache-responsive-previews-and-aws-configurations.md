# PR #650 — Persistent media, responsive images and AWS restore configurations

## Behavior and boundaries

Protected images/files can reuse downloaded binary bytes across navigation.
Each worker read obtains a fresh authorization receipt; opaque keys include
viewer, object version, representation and disposition. Revocation, deletion,
moderation and offline failures cannot unlock cached bytes. Conditional HTTP
responses authorize before 304. Signed URLs are never persisted.

IndexedDB falls back to Cache Storage then memory, with 128 MiB/256-entry bounds
per backend, seven-day expiry and 16 MiB per file. Storage timeouts preserve
normal loading. Large and partial downloads retain native streaming. Public
assets require readable cache-permitting responses; private/no-store/Vary/opaque
third-party responses are excluded. Service workers do not capture HTML or
general API responses. Browser quota eviction remains possible.

Post galleries, image lightboxes and attachment details use an actual 64px
preview plus 320/640/1280/1920 responsive WebP candidates. An intersection
observer defers offscreen images. Unsupported/animated/oversized originals
fallback without resize loops. Transforms bound input bytes/pixels/concurrency
and reuse a bounded process cache. A per-mount URL marker avoids decoded-image
cache skipping the authorization step; the binary storage key stays stable.

The existing attachment-content operation declares contract and feature 1.1.0.
Clients negotiate the selected origin before using variants/receipts. No S3
public access, GET CORS, CloudFront distribution or Lambda deployment is needed.
S3 Cache-Control is applied by the upload/signed-download code; existing objects
benefit from the response override after this branch is deployed.

## Recoverable service settings

`configurations/AWS/S3` captures separate private develop/production policies,
CORS, versioning, ownership, encryption and lifecycle rules. Production enables
EventBridge and applies retention bucket-wide; development scopes it to objects/.
`configurations/AWS/SES` captures verified Sydney domain settings and both
configuration sets, with separate environment templates. Unknowns (IAM, DNS,
account-level inheritance and IP-pool allocation) are labelled. No credentials,
customer records or live AWS mutations are included.

## Validation — 2026-09-05

- Production build, embed budget and Vercel output checks passed.
- 148 attachment tests, 6 worker/storage tests and 8 capability tests passed.
- Targeted ESLint passed. Full TypeScript reports 109 pre-existing errors;
  none remain in the new media code. No baseline was changed.
- Chrome real-component fixture: revisit kept byte downloads at 2 while access
  checks increased; revoked access resulted in naturalWidth=0. Clearing and
  disabling emptied IndexedDB; disabling previews loaded the 1200px original.
- Desktop and 390px mobile fixture top/bottom, lazy media, settings and lightbox
  inspected. Real app Settings renders the section with no horizontal overflow.
- The live local app reports an existing storage migration requirement. An
  authenticated real-S3 upload/download smoke is not claimed. AWS console reads
  verified configurations; CLI credentials are invalid, independently of Chrome.
- Local app http://localhost:13540/settings; fixture
  http://localhost:13543/tests/media-cache.html. PM2 entries have autorestart
  disabled; app restart counter stayed at zero. Tailscale wrapper points to a
  missing app executable, so no Funnel URL is verified.

## Release

[PR #650](https://github.com/lopugit/thingtime/pull/650) targets develop.
Expected preview: https://pr-650.previews.dev.thingtime.com (verify current
controller receipt and exact commit before treating this as a deployed result).
Production is unchanged until the reviewed branch is promoted.
