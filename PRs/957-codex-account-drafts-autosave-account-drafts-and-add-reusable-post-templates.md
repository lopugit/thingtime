# PR #957 — Autosave account drafts and add reusable post templates

https://github.com/lopugit/thingtime/pull/957

## Result

Signed-in editing in posts, rich/plain comments, Things, definitions and schema
editors now preserves private account drafts. Changes receive an immediate device
recovery copy, followed by serialized background saves. The composer has a shared
searchable draft/template picker, and the post menu can save an existing post as a
reusable template. Loading a template creates a fresh working copy; publishing or
discarding that copy leaves the template intact.

## Persistence and security

- Protected owner-only `draft` Things use existing home-collection transactions,
  quota accounting, authentication and fail-closed rate limits. Generic CRUD/feed
  access excludes them. Snapshot JSON is bounded to 512 KiB and preserves raw,
  unfinished editing values.
- Revisions and immutable write identities prevent stale overwrites. Uncertain
  writes replay exactly before later content. Transient failures retry with
  backoff; conflicts offer a fresh draft with independent media copies.
- Templates copy through the canonical media service. Working draft media becomes
  durable and remains private; posting transfers binding in the normal post
  transaction. Discarded remaining files rejoin the existing expiry/reaper path.
- Posting records its frozen submission identity before the mutation. Successful
  publication retires the working draft; tombstones reject delayed resurrection.
  Local retirement markers retry cleanup after response loss.
- Device drafts, Thing workspaces and cross-tab channels are account/origin scoped.
  The legacy device workspace is retained and copied once to the first opening
  account, without automatically uploading it on hydration.

## Validation

- 223 focused draft, autosave, Thing-provider, feed and schema projection tests pass.
- Editor suite: 98 pass, one expected browser-only skip. Capability suite: 87 pass.
- Attachment suites passed, including authorized working-draft media transfer.
- Targeted lint: zero errors. Production build and Vercel output verifier pass.
- Local API tests exercised owner/stranger/anonymous access, partial fields,
  revisions, replay, retirement and reusable templates through real Mongo
  transactions. Media checks exercised uploads, publication, independent copies
  and reuse after deleting the source post.
- Browser checks covered post reload recovery, publication, menu template saving,
  template reuse, edited-copy publication and desktop/mobile picker layout.
- Final merged-base attachment/capability/draft checks: 162 pass. Extended real
  API checks also pass for conflict-copy recovery with media. The shared Thing
  editor loads an account draft, saves fresh typing to the account API, and
  retains that value after browser reload.
- Raw TypeScript checks on both the branch and unchanged current `develop` each
  report 91 errors. Their normalized diagnostic sets are identical; this change
  adds no TypeScript errors. The tracked ratchet baseline remains unchanged.
- The PM2 daemon stopped responding to its list command, and the old local
  Nitro runner became unavailable. Final API/browser acceptance used the
  documented foreground validation stack on ports 18380/18381/18382. No global
  PM2 daemon or unrelated app was restarted.

## Setup and review

No new secrets or external services are required. Use existing authenticated
sessions, the transaction-capable home Mongo database, and the documented upload
storage/approval setup for media. See the [feature map](../docs/feature-map/account-drafts-and-templates.md),
[README](../README.md) and [manual checklist](../TESTING.md#account-drafts-and-reusable-post-templates).

This branch targets `develop`. It does not merge or deploy to production.

## Browser evidence

Desktop picker at 1265 CSS pixels, with a working draft and reusable template:

![Drafts and templates in the post composer](assets/957/drafts-desktop.png)

Narrow mobile layout (300 CSS pixels at the browser's existing zoom):

![Mobile drafts and templates](assets/957/drafts-mobile.png)
