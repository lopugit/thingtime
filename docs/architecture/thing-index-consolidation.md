# Thing index consolidation — September 2026

Status: active implementation and measurement, **not a completed migration**.
The owner explicitly authorized analysis, implementation, production/develop
migrations, and merge-commit releases into both `develop` and `main` on
2026-09-08. This change is independent of unfinished Watch PR #665.

## Baselines, not estimates

Read from the authenticated `/migrations` census on 2026-09-08:

| Origin | Things | Logical document bytes | Index bytes | Index count |
| --- | ---: | ---: | ---: | ---: |
| thingtime.com | 7,658 | 22.9 MB | 53.8 MB | 60 |
| dev.thingtime.com | 8,320 | 21.1 MB | 18.4 MB | 61 |

Both branches resolved to `e4a54884766b0e74b195e1df83198582ac0660e0` at
the initial audit. Source-plan replay at that revision yields **60 including
Mongo's `_id_`**: 11 unique, three TTL, one text; 46 of the 59 application
definitions have partial filters and three are sparse. Categories overlap.
The authenticated read-only workbench returned all 61 develop definitions
with result limit 100. The extra index is `lopu_recording_due`, used by Watch
PR #665 against the shared develop database; it must be preserved. The default
50-row workbench limit truncates this inventory, so it is not sufficient.
These numbers supersede, but do not rewrite, the historical September 2 audit.
The UI also advertises pending schema/accounting work; a schemaVersion-1
document is not by itself evidence of the legacy `kind` format.

Reproduce the **source**, not live, inventory without any database connection:

```sh
cd remix
node --import tsx scripts/audit-things-indexes.mts
```

`thingsIndexPlanEntries()` replays the executable index plan, including exact
ordered keys and options. `thingsIndexPlanNames()` now derives from it, so
the existing rebuild migration and audit cannot silently use different plans.
The conservative prefix audit finds **zero ordinary prefix redundancies**.
It excludes unique, TTL, partial, sparse, hidden, collation and text indexes;
even an ordinary prefix candidate would still require workload measurement.

## Why one Thing collection has sixty indexes

An index organizes a query's predicates and ordering, not a programming data
type. One B-tree already handles strings, numbers and dates. An index on one
numeric property does not efficiently sort another arbitrary property. Nor
does full-text indexing enforce unique usernames, preserve stable paginated
feeds, or reap expired operational records.

Mongo's compound indexes follow ordered prefixes and equality/sort/range
rules. A wildcard index can help unknown property paths but is not a universal
replacement for compound ordering, unique constraints, or TTL. Both `acl` and
`thingtime` are arrays: combining them as independent indexed arrays fails
writes. Any generic typed-property design must test multikey bounds and sort
behavior, not just successful index creation.

Primary references:
- [Compound index prefixes and ESR](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/)
- [Compound wildcard indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-wildcard/index-wildcard-compound/)
- [Wildcard limitations](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-wildcard/reference/restrictions/)

## Entire source plan: optimization decisions

The command above supplies every exact name/key/options tuple; this table
accounts for all 60 entries at the baseline, without double-counting.

| Family | Count | Existing purpose and consolidation requirement |
| --- | ---: | --- |
| Identity | 3 | `_id_`, `shareId_1`, `uniqueKeys_1`. Keep the shared protected uniqueness namespace; changing public IDs/cursors is a separate compatibility migration. |
| User directory | 2 | Username prefix discovery and partial admin roster. Exact username lookup is not the only reader; replacing it with hashed keys loses prefix search. |
| Legacy `kind` era | 7 | Five compound read indexes plus reaction/comment unique constraints. Census actual `kind` rows, migrate surviving content through canonical accounting, remove every legacy query arm first, then retire. Preserve custom-endpoint compatibility until explicitly negotiated. |
| Generic chronological/relational access | 7 | Type, type+owner, tags, ACL, source-device, folders, and target+type. Shared scope keys are candidates, but selective matching, multikey ordering, cursor ties and ACL residuals must be measured. |
| Theme gallery | 1 | Partial type+updatedAt, not createdAt. Candidate for a shared updated-order family, not a plain chronological substitute. |
| Unread notifications | 1 | Tiny partial unread set. Preserve index-only counts; replacing with full notification history reintroduces unbounded badge cost. |
| Account reconciliation | 1 | Content class+owner+version+bytes. Keep exact accounting semantics and covered sum access; index-count savings do not justify ledger scans on every admission. |
| Legacy share relation | 1 | `shareOfId_1`. Retire only after share conversion and removal of its `$or` query branch. An empty legacy partition does not prevent a planner regression. |
| Attachment lifecycle | 3 | Owner drafts, global expiry cleanup, target bindings. Global expiry MUST NOT become TTL: S3 deletion and ledger refunds precede row deletion. |
| Schema usage | 2 | Canonical schemaId and legacy schema name. Backfill names to unambiguous IDs before collapsing the fallback. |
| Full-text search | 1 | Weighted wildcard text over public searchable fields. It already shares all string properties; fuzzy matching requires a distinct capability, not duplicating this index per feature. Keep secure/Binary values unsearchable. |
| Current reaction uniqueness | 1 | Target+owner+emoji. Move to protected namespaced uniqueKeys only after all insert/update/migration paths and concurrent duplicate rejection are proved. |
| Relationship point lookups | 7 | Friend, member, DM, invite, emoji, follow, vote. Reuse protected uniqueKeys for the six actual lookup families after complete backfill; emoji has no crystal-key reader and can retire independently. |
| App identity and app-data uniqueness | 2 | Client identity and owner+app+key. Shared protected keys can enforce equality; list-by-app and upsert races still need coverage. |
| Subscription tiers | 3 | Version identity, one live revision, status/order listing. Two constraints can share namespaced keys, but live-slot publication/archival must update atomically. |
| App storage ledgers | 2 | Per-app users and per-user aggregate ledgers. Shared scopes may consolidate these without summing the entire ledger partition. |
| Legacy app sharing | 1 | crystal.appId+ACL+updatedAt. Candidate to fold into root appId after canonical namespace backfill and all readers change. |
| Ownership links | 1 | Target+linkKind reverse lookup. Candidate for shared target/scope keys; security semantics remain home-pinned. |
| Subspace feed | 1 | Selective subspace+chronological paging; cannot simply filter the whole post feed. |
| Device operations | 6 | Pending-slot uniqueness, command queue, control-event retention, live-event retention, external segments, approval list. Shared scopes/status/order are candidates; command claims, expiry and duplicate approval races need tests. |
| Operational TTL | 3 | Device, sandbox, migration diagnostic expiry. Potentially one protected root expiry field, but retention eligibility differs; never include billable attachments or custom-endpoint diagnostic data. |
| Messenger grouping | 2 | Thread replies and community channels. Good candidates for shared relational scopes if sorted explain plans remain bounded. |
| Root app namespace lists | 2 | Owner namespace and shared audience sorted by updatedAt. ACL and namespace are different security concepts and must not be conflated. |
| **Total** | **60** | No hidden assumption that all indexes are redundant or all rows enter all partial indexes. |

## Implementation sequence and acceptance gates

1. **Inventory and provably dead lookup removal.** Source recorder, conservative
   analysis, regression coverage. Stop creating `things_emoji_key_lookup` and
   retire exactly that home-owned non-unique name through the existing index
   bootstrap. Emoji reads use shareId or scope; `newThingDoc` stamps the
   protected emoji uniqueness key. Do not remove the older unique ancestor
   without verifying its replacement. Resulting source plan: **59**. This is
   a first increment, not fulfillment of the overall reduction request.
2. **Consolidate genuine relationship readers.** Convert all point and batched
   readers, including attachment authorization and AI-import membership
   upserts, not just Messenger's UI. Backfill missing individual keys even
   on rows that already have other uniqueKeys. Preserve non-target keys,
   use compare-and-swap against the source key, and fail closed on duplicate
   or malformed identities. No arbitrary winner/deletion. Indexed reads
   activate only after validation; old lookup indexes retire last.
3. **Retire real legacy query branches.** Census both environments and custom
   endpoint policy. Zero pending migration is insufficient: test actual kind,
   parentId, commentId, shareOfId and schema-name shapes. Prove every `$or`
   branch remains indexable before removing any supporting index.
4. **Share remaining unique constraints and retention.** App client/data,
   reaction, live-tier and approval slots can use namespaced protected keys.
   Test transaction/duplicate races and key removal when status changes.
   Separate TTL-eligible operational data from explicit S3/accounting cleanup.
5. **Prototype shared query scopes / typed properties.** Benchmark real API
   query shapes with skewed fixtures, selective tags, large histories,
   multiple schema IDs/ACL entries, mixed data types and descending cursor
   ties. Measure index bytes, entries per write, documents/keys examined,
   blocking sort and latency. A ten-index plan is an experiment, not a promise.
   A few physical indexes with excessive multikey fan-out can be worse than
   many small partial indexes. Do not add an unbounded property-token array.
6. **Release and verify.** Ready PR to develop, exact-head CI and preview;
   deploy code that can safely read old and new states, run idempotent
   migration through the admin API under its lease, verify counts/constraints
   and bounded queries, then promote the same changes to main and run the
   production migration. Old preview writers sharing develop's DB must be
   considered before switching layouts. Preserve unknown indexes, private
   data, ACLs and accounting. Record before/after counts for both origins.

## Relationship migration preparation

The existing `backfill-relationship-unique-keys` migration now checks individual
Binary keys rather than only documents without a `uniqueKeys` field. It adds
missing keys without replacing other keys, compares the source relationship
identity before writing, and counts actual modified rows. A finite cursor
replaces the repeated-first-page loop: more than 500 duplicate rows cannot
trap the migration. Duplicate slots remain pending with bounded, identity-free
notes; no winner is chosen and no relationship is deleted. Lease loss and
non-duplicate database errors close the cursor and stop the run.

### Shared relationship lookup cutover

The intended steady-state home plan is now **54 including `_id_`**, with ten
slots of headroom: the unused emoji lookup plus five additional indexes are
removed, without adding any new index. Friends, follows, chat/community
memberships, DMs and invitation codes share the existing protected
`uniqueKeys_1` index. Point and batched readers include attachment permission
checks and AI/device import upserts. Original kind, owner, target, state and
crystal identity guards remain: a stale key must not identify a changed DM or
grant access to the wrong membership.

This is not automatic retirement at startup. Before activation, home readers
and bootstrap keep the five legacy indexed lookups (59 planned indexes).
Custom data planes keep those lookups permanently; explicit home identity and
attachment paths remain pinned home even inside a custom-endpoint request.
The selected home plan in the source audit is the intended **post-migration**
plan, not proof of the current live index count.

Run `consolidate-relationship-lookup-indexes` through the admin migration API:

1. Deploy compatible key-stamping writers and shared-key readers on **every
   origin sharing the database**, including previews. Older readers retain
   correct results but can scan after retirement, and older bootstraps can
   recreate the redundant indexes; retire only after that rollout is resolved.
2. Dry-run and inspect the pending key repairs, readiness marker and index
   retirements. No data, settings, or indexes change during a dry run.
3. Run with `confirm: true`. The migration requires the existing admin lease,
   ensures the shared unique constraint, adds missing keys, then validates the
   entire selected family set. Duplicate/conflicting identities block
   activation without choosing winners or deleting relationships.
4. The migration writes an indexed home-settings readiness marker only after
   validation, then removes only the five exact expected non-unique partial
   definitions. Unique, TTL, sparse, hidden, collated, redefined and unknown
   indexes are preserved. A crash after activation leaves redundant indexes;
   retry completes retirement. Lease loss stops further operations.
5. Requests check one small indexed settings record, cached for 30 seconds.
   They never scan/backfill relationship data or perform index DDL. Migration
   completion invalidates the local cache; other workers converge within the
   cache window. Re-check pending work after old workers have drained.

The marker uses the existing home-only settings collection/key index; no
new physical collection or index is introduced. The explicit migration's
finite scan projects only each identity field and protected keys. Its cost
still needs production-scale workload measurement before live cutover.

Local native replica-set acceptance passed using the real API utilities and
250 unrelated data Things: **59 → 54 indexes**, each sampled friend/follow/
chat-member/community-member/chat/invite lookup returned one row with **one
key and one document examined**, without hints. Batched reads, non-member
chat exclusion, invite redemption, concurrent DM dedupe and repeated AI-import
upserts passed before/after cutover. The final dry-run reported zero pending
work. This establishes sampled query behavior, not production p95 latency or
large-history performance for the other index families.

## Still required before claiming completion

- Both full definition lists were captured through the authenticated workbench
  with its result limit raised to 100. Develop differs only by the Watch
  `lopu_recording_due` index, which must remain. Exact counts of documents with
  `{kind: {$exists: true}}` were **zero on both origins** on 2026-09-08. This
  supports investigation, not immediate removal of legacy query indexes.
  Capture workload usage and native explain plans next. Metadata redaction
  masks `uniqueKeys` and `token` directions in workbench output; do not mistake
  the redacted values for their real index specifications.
- Complete the query-family reader/writer inventory beyond the first traced
  relationship/emoji families and benchmark every replacement.
- Test MongoDB-native explain plans and concurrent constraints through the
  API utility layer, plus real API behavior (not synthetic index success alone).
- Run the production/develop migrations and verify both deployed SHAs and
  index sets. No migration or merge is claimed by this initial audit.
- Source regression tests enforce the 54-index intended home plan and the
  custom/pre-migration fallback. Native workload measurements and actual
  production/develop inventories must substantiate the cutover before release.
