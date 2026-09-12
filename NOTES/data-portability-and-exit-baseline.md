# Data portability and graceful-exit baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-01 21:06 AEST, Australia/Melbourne

**Plan:** [Data portability and graceful-exit roadmap](../PLAN/data-portability-and-exit-roadmap.md)

**Execution epic:** [TODO 23 — Data portability and graceful exit](../TODO/claude-todo/23-data-portability-and-exit.md)

## Why this matters

Thingtime's landing experience makes a strong, useful promise: data is open,
accessible, exportable, and not held hostage. That promise can be a durable
reason to trust and adopt the product, but only if a person can prove it without
admin access, custom scripts, or faith in a marketing sentence.

This note separates what the current repository proves from the account-wide
portability, recovery, and closure contract that remains to be designed. It
does not claim the current APIs are unsafe or unusable; several are strong
building blocks. It does claim that the end-to-end promise is not yet
demonstrated by one documented user journey.

## Evidence ledger

| Claim | Current evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Thingtime promises users that their data is always exportable and that there is no lock-in. | [`Landing.tsx`](../remix/app/components/Landing/Landing.tsx) says “Open data — yours to export, always” and repeats the promise in the FAQ. | High for repository copy, not production behavior. Recheck the deployed landing page and route before treating the promise as live. |
| A signed-in user can enumerate ordinary owned Things through a real API. | `GET /api/v1/things` is registered in [`apiDocs.ts`](../remix/app/docs/apiDocs.ts) and implemented by [`_things.tsx`](../remix/app/routes/api/v1/things/_things.tsx). [`listThings`](../remix/app/api/utils/things/things.ts) returns chronological pages with `nextCursor`. | High for the current branch. Recheck the docs registry, route map, projection, cursor, and live capability manifest before implementation. |
| That listing is not an account-wide export. | `listThings` caps pages at 50 and intentionally excludes protected account/control kinds and Messenger kinds. It returns API projections, not a versioned archive with completeness counts, hashes, attachment bytes, or a restore proof. | High for the current branch. This is a scope statement, not a claim that pagination is defective. |
| User-owned app namespace data has a useful inventory-and-delete pattern. | `GET /api/v1/apps/data-summary` inventories namespaces from stored Things, including disconnected/deleted apps. `POST /api/v1/apps/data/delete-all` removes one selected namespace. Both are documented in [`apiDocs.ts`](../remix/app/docs/apiDocs.ts). | High for repository behavior. Verify current auth, quotas, and live tests before reusing the pattern. |
| Uploaded attachment bytes are private and individually downloadable after authorization. | `GET /api/v1/attachments/content?id=...&download=1` authorizes the exact attachment and redirects to a short-lived object URL. Attachment deletion removes the exact S3 version before refunding storage. | High for the documented contract. It does not prove an account archive includes every attachment. |
| A custom MongoDB endpoint is a data-plane choice, not whole-account migration. | [`FUNDAMENTALS.md`](../FUNDAMENTALS.md) keeps identity, auth, protected kinds, saved endpoint credentials, and other control-plane state on the home deployment while ordinary data-plane collections can follow the active endpoint. | High for the architectural contract. Do not describe endpoint switching as backup, export, or account closure. |
| The registered API does not currently expose a dedicated account-wide export or account-deletion route. | A focused 2026-09-01 review of the API docs registry and Nitro route import map found the profile GET/POST route, Thing CRUD, attachment content/delete, app-data summary/delete-all, and custom-endpoint routes, but no account export/archive or account closure/delete endpoint. | High for this snapshot; absence can change. Re-run the route/docs/manifest inventory immediately before scoping implementation. |
| The current profile route updates public profile fields but does not close an account. | [`users/profile/_profile.tsx`](../remix/app/routes/api/v1/users/profile/_profile.tsx) supports public profile reads and authenticated profile updates. The generic Things endpoint refuses protected user Things. | High for the current branch. Recheck auth/user utilities and any newer route before relying on this gap. |
| The public backlog currently has no open issue specifically naming export, backup, restore, portability, or account deletion. | A live GitHub issue-title query returned no matching open issue on 2026-09-01. | Medium and time-sensitive. Refresh GitHub before creating an implementation issue or assigning ownership. |

## The product gap

There is no single current journey where a normal account owner can:

1. see every location and category of data Thingtime controls for them;
2. request one versioned, resumable export;
3. verify locally that the export is complete and untampered;
4. restore or import it into an empty compatible environment through the real
   API;
5. delete selected scopes or close the home account with an exact preview;
6. receive a non-sensitive receipt describing what completed, what could not
   be deleted, and what remains outside Thingtime's control.

The strongest version of “no lock-in” is not merely downloadable JSON. It is a
repeatable **exit drill**: export, verify, restore somewhere clean, compare the
result, and only then make deletion available.

## Candidate portability inventory

This is a classification draft for owner, privacy, and security review. It is
not an approved archive schema.

| Class | Candidate treatment | Important boundary |
| --- | --- | --- |
| User-authored Things, folders, posts, comments, reactions, shares, schemas, components, actions, and app data | Include portable payloads, stable ids, relationships, timestamps, ACL meaning, schema versions, and ownership/provenance needed for a safe import. | Do not copy another person's private content merely because it was visible in a feed, chat, or inherited projection. |
| Uploaded attachments | Include original bytes, display metadata, purpose/target relation, size, media type, and a cryptographic digest. | Never include S3 keys, VersionIds, upload ids, or presigned URLs. Linked external media may be represented as a link plus metadata, with an explicit “bytes not included” result. |
| Profile and non-secret preferences | Include user-authored profile fields and portable settings with a versioned schema. | Separate device-local caches and transient layout state from durable account data. Never let import overwrite security-critical defaults silently. |
| App grants, blocks, circles, invites, moderation state, and messages | Inventory each category and decide inclusion field by field with the owner/privacy team. | Relationship exports can expose other people. Chat and moderation context need policy, legal, consent, and abuse review rather than an automatic full copy. |
| Sessions, password hashes, passkeys, JWTs, PATs, OAuth tokens, OTP/reset material, secrets, and private keys | Exclude. Export a safe inventory such as counts, names, created dates, and revocation state only where useful. | An archive must never become an account-takeover kit. Imported data never confers authentication, admin, app, moderation, or action authority. |
| Saved custom MongoDB endpoints | Export a redacted inventory and setup guidance, not credential-bearing URLs. | Endpoint URLs may contain credentials and remain home-pinned private state. The user must re-enter secrets deliberately. |
| Analytics, logs, support records, email delivery state, and backups | Declare whether each category exists, who controls it, retention, deletion semantics, and whether it is included or separately requested. | “Account deleted” must not silently mean “primary Thing rows deleted while identifiable satellites remain forever.” |

## Archive contract questions

A useful first proposal should answer these before choosing storage or job
infrastructure:

- Is the archive a directory/ZIP containing `manifest.json`, versioned NDJSON
  records, and attachment files, or another open format with equivalent
  streaming and verification properties?
- Which semantic capability id and version identifies the export/import
  contract? A Git SHA or route-presence probe is not compatibility evidence.
- How is a stable export cut chosen so concurrent edits neither vanish nor
  appear twice? The ordinary newest-first cursor is useful browsing behavior,
  but not by itself a completeness proof for a long-running archive.
- What per-class counts, byte totals, and SHA-256 digests let a local verifier
  detect missing, extra, changed, or truncated entries without sending archive
  contents back to Thingtime?
- How does a resumed job prove it is continuing the same cut, account, origin,
  format, and authorization after a process or network interruption?
- Which server-owned fields are translated into portable meaning, and which
  must be regenerated on import?
- How are id collisions, unavailable foreign references, unsupported schemas,
  and newer archive versions reported without guessing or silently dropping
  data?

## Graceful deletion and account closure

Deletion is not the inverse of export. It is a destructive, multi-system
workflow with different safety properties.

A closure proposal should include:

- recent step-up authentication and revocation of live sessions/tokens;
- a category-by-category preview with counts, bytes, consequences, and items
  that Thingtime cannot control;
- an optional export-first checkpoint that is easy to take but never a dark
  pattern that blocks deletion;
- accessible confirmation with a plain-language scope, not a trick phrase or
  hidden retention exception;
- idempotent, resumable work that keeps a retry anchor until attachment bytes,
  data records, ledgers, indexes, email/auth satellites, and user identity have
  reached their declared terminal state;
- explicit handling for custom MongoDB endpoints: home-account closure cannot
  pretend data on a user-controlled external server was deleted;
- a bounded, non-sensitive receipt containing job id, timestamps, category
  counts, completion state, and declared exceptions—never deleted content,
  credentials, or private identifiers;
- tested cancellation/recovery rules before the irreversible boundary and no
  false promise of recovery after permanent deletion.

## Abuse, privacy, and reliability risks

| Risk | Defensive requirement |
| --- | --- |
| A stolen session requests a complete archive. | Require recent step-up authentication, notify through an approved channel, rate-limit jobs, make download links short-lived and single-purpose, and audit access without logging content. |
| The archive leaks secrets or other people's data. | Use a deny-by-default field registry, dedicated projections per class, adversarial fixtures, and secret/foreign-owner scans before release. |
| Concurrent writes create an incomplete archive that still says “complete.” | Use a defined consistent cut or a provable multi-pass reconciliation; publish counts/digests and fail closed on drift. |
| Import turns data into authority. | Strip server-owned auth/capability/admin fields, reauthorize every relationship, and create through dedicated real APIs. |
| Deletion breaks mid-flight. | Persist bounded idempotent progress, retry safely, keep destructive ordering explicit, and report partial state honestly. |
| Export becomes a premium lock-in lever. | Keep baseline export and account closure available to every account tier; paid value may cover hosting or managed migration, not ownership of one's data. |
| Large accounts overload serverless/runtime limits. | Stream/chunk, cap per-step work, resume from durable progress, and exercise high-cardinality fixtures before launch. |

## Evidence needed before “shipped”

- The capability manifest advertises the exact export/import/closure features
  and automated compatibility tests reject missing or breaking versions.
- A fixture account containing every supported category exports through the
  same authenticated API path used in production.
- A local verifier detects a removed record, changed byte, wrong digest,
  duplicate id, truncated attachment, and unsupported archive version.
- A clean test account or deployment imports the archive idempotently and a
  semantic comparison reports the documented equivalences and exclusions.
- An account closure drill proves sessions stop, protected and ordinary data
  reach their declared terminal states, attachment objects become inaccessible,
  ledgers reconcile, and a second identical request is safe.
- Desktop and mobile browser walkthroughs cover keyboard, screen reader,
  interrupted download, retry, cancellation, expired link, and partial-failure
  states without exposing secrets in UI, URLs, logs, or downloads.
- The live landing promise, API docs, capability manifest, support material,
  and actual production behavior describe the same contract.

## Open decisions

1. What is the minimum honest v1 scope: ordinary Things plus attachments, or
   every user-facing account category?
2. Is restore/import required before the public “no lock-in” promise can be
   treated as proven, or may a verified open archive be the first milestone?
3. Which relationship and message fields may leave the service without
   violating another person's privacy?
4. What recent-auth method and notification channel protect archive creation
   and account closure?
5. What retention, cancellation, and expiry windows apply to generated archive
   files and deletion receipts?
6. How should custom-endpoint data be inventoried when Thingtime cannot promise
   completeness or deletion on an external server?
7. Who owns the final semantic comparison that decides a restore drill passed?

## Refresh checklist

- Re-scan the API docs registry, Nitro route map, and live capability manifest
  for account export/import/closure features.
- Verify the deployed landing copy and user-facing settings/data surfaces.
- Recheck open issues and PRs for portability work before creating another
  implementation stream.
- Re-read attachment, storage, auth, custom-endpoint, app-data, Messenger, and
  deletion contracts after related changes land.
- Replace proposed classifications with owner-approved decisions in
  [`DECISIONS.md`](../DECISIONS.md) only when those decisions are made.
