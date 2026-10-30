# PR #170 — real app-data quotas + app-owner storage manager

- **PR**: https://github.com/lopugit/thingtime/pull/170
- **Branch**: `codex/app-data-quota-allowances`
- **Stacked on**: PR #171, `claude/admin-ui-user-app-management-5571a3`
- **Merge order**: the earlier Thingtime app-integration stack → #171 → #170.

## Outcome

All customer data now uses one canonical logical-byte measurement, with
transactionally maintained ledgers for each quota scope. The admin app manager
has an owner-facing counterpart at `/apps/manage`:

| Control       | Source of truth                                                                                                                                                       | Default / tiers                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Whole account | One deterministic protected user `subscription` Thing: exact tier snapshot/override plus the authoritative account usage ledger                                       | The assigned immutable tier revision's `userStorageBytes`; explicit admin override; null/unlimited when metered |
| Whole app     | The app Thing: stable tier id + exact immutable tier revision/snapshot, optional admin override, aggregate allowance, and aggregate used bytes in one atomic document | Any live catalog revision; bootstrapped Free 5 GiB, Plus 25 GiB, Pro 100 GiB, PAYG null/unlimited but metered   |
| One app user  | One deterministic protected `app-storage` Thing for `(app, user)`: used bytes + optional manager override                                                             | App default 50 MiB; custom finite sub-tier; always clamped to the whole-app ceiling                             |

The registering owner and administrator-linked co-managers can switch the app
tier, edit the inherited user cap, and assign/reset one or many user overrides.
Administrator-custom app plans remain administrator-controlled and lock owner
tier switching. The generic `/apps/update` route still ignores all quota fields.

## Versioned tier catalog and admin editor

- `/admin` adds a Tiers workspace grouped into Live, Draft / not live, and
  Archived revisions. Admins can add tiers, clone the next draft version, edit
  draft content, and publish/archive with confirmation; history is never
  deleted.
- Each protected `subscription-tier` Thing carries a stable tier id plus an
  immutable version id/number, lifecycle timestamps, name, tagline, optional
  banner, currency, daily/weekly/monthly/yearly minor-unit prices, six frozen
  annualized computed-or-custom savings, Editor.js inclusions, and quota
  defaults.
- The public `GET /api/v1/tiers` exposes live cards only. Admin catalog history
  and mutations live at `GET|POST /api/v1/admin/tiers`; both are documented and
  registered in Nitro's explicit route map.
- User and app assignments pin the exact revision plus the tier name, metering
  flag, and quota snapshot. Publishing a replacement archives the former live
  revision without silently moving existing customers; archived-current cards
  remain visible but cannot be newly selected.
- Built-in v1 tiers are seeded through the protected service. Legacy implicit
  users and versionless app/subscription records resolve to the original v1
  snapshot, while new registrations record their initial exact revision on the
  user Thing before relational assignment repair.
- Publishing uses a settings-backed lease and recoverable intent journal rather
  than Mongo transactions, preserving availability and revision uniqueness on
  the documented standalone local Mongo configuration.

## Admin all-field querying

- Users, Apps, Tiers, rate-limit rules, and current administrators now share a
  typed free-text/filter/sort surface. Explicit safe field registries cover
  nested and list values without exposing arbitrary Mongo paths.
- Created-day ranges, tier ids/names/immutable versions, lifecycle/status,
  booleans, prices, computed/custom discounts, Editor.js inclusion text,
  quotas, byte usage, and rollup counts are directly queryable. Multiple
  conditions combine with AND and every sort has a stable row-id tiebreaker.
- User and app APIs accept `limit=1..200` plus opaque keyset cursors and return
  `nextCursor` (`totalCapped` remains a compatibility alias). The UI drains all
  pages into a deduplicated snapshot before applying computed/nested filters,
  so records beyond row 200 remain queryable. User hydration is batch-based
  across the Things and legacy stores, with Things-era migration twins winning.
  Responses remain admin-gated and private/no-store.
- Query state survives tab switches and refresh-after-mutation. Filtering a
  rate-limit row only hides it; its unsaved edited value remains in the source
  configuration. The separate Promote a user lookup is unchanged.

## Atomic quota model

- The exact billable size is the UTF-8 byte length of
  `JSON.stringify({ crystal, extended, tags })` after normalization. That
  logical customer-content measure is shared by every writer and excludes
  unstable physical BSON, compression, index, replication, and platform
  envelope overhead.
- Every supported first-party and registered-app content writer changes its
  document and the protected account ledger in one Mongo transaction. App
  writes also change the whole-app and app-user ledgers by that same delta;
  the overlapping scope counters enforce sub-limits and do not double-count
  the account total.
- Updates charge only the serialized-size delta. Deletes and first-party owner
  edits refund/charge the applicable ledgers. Same-key compare-and-swap races
  reconcile to the winning persisted size.
- A used counter is readable/enforceable only when its complete protected
  envelope and source stamps validate. Growth fails closed while a ledger is
  `initializing`, `needs-reconcile`, or malformed; deletes stay available and
  fence uncertain scopes for exact reconciliation instead of estimating.
- A plan cannot be set below current aggregate usage. A default or individual
  user cap cannot be set above the current aggregate, and default updates
  re-check that relationship inside the atomic write. Runtime admission still
  clamps historical overrides after a later plan downgrade.
- Legacy apps stay write-fenced until `backfill-app-storage-allowances`
  reconciles per-user ledgers and enables the aggregate marker last. Original
  `data` counters are adopted into the protected `app-storage` kind.
- A partial `(quotaKind, appId, updatedAt, ownerId)` index supports app-manager
  and admin app-user rollups without scanning ordinary app data.

## Unified projections and migration

- The protected user subscription ledger is the sole account-usage display
  and enforcement source. Root-loader, settings, admin, owned-account, and
  service-account projections consume its canonical nested `storage` object.
  The old flat user fields survive only as aliases derived from that object;
  they are never read as independent totals.
- Storage UI distinguishes `ready`, `reconciling`, and `unavailable`, includes
  exact integer byte counts alongside friendly units, and never turns unknown
  usage into `0`.
- The global idempotent migration obtains a durable lease, fences account/app/
  app-user ledgers, converges all source-changing prerequisites, stamps every
  billable source with compare-and-swap writes, exact-sums each scope, and only
  then publishes `ready`. Old usage values are deliberately ignored because
  they were never maintained; a valid explicit legacy allowance is preserved
  as a real subscription override before the old fields are removed.
- Protected exact envelopes prevent generic Things or forged lookalikes from
  becoming a ledger. Registered apps cannot mutate split ledgers through the
  old non-transactional quota helper, and deleting an app control record keeps
  historical namespace data/counters available for owner repair.

## Operational boundaries

- High-cardinality app reconciliation currently repairs all app users in one
  transaction. It is exact and fail-closed, but exceptionally large apps may
  need a future batched/fenced background reconciler to stay inside Mongo
  transaction pressure limits.
- Admin account totals and app-data subtotals come from separate concurrent
  reads, so a busy account may momentarily show adjacent committed snapshots.
  This is display-only; admission and mutation remain atomic.
- Full-source legacy compare-and-swap is safe for normal bounded Things. A
  malformed historical row close to Mongo's BSON command ceiling needs manual
  cleanup before migration.
- A timeout during the whole-corpus migration leaves ledgers fenced, never
  partially trusted. Operators rerun the idempotent maintenance migration to
  completion before storage growth is admitted again.

## Owner/co-manager surface

- `GET /api/v1/apps/storage?clientId=…` returns aggregate plan/usage, the tier
  catalog, inherited user cap, and the 200 most recent app users.
- `POST /api/v1/apps/storage` supports `set-tier`,
  `set-default-user-cap`, and `set-user-cap` (one or up to 200 selected users;
  `allowanceBytes: null` restores inheritance).
- `/apps/manage` is responsive and optimistic for non-sensitive app summaries;
  it supports app switching, plan cards, default MiB control, roster search,
  select-all, individual/bulk apply, and bulk reset.
- Username disclosure follows live consent: a row gets `@username` only while
  an unrevoked, unexpired grant covers `profile.username`. The browser cache
  never persists app-user IDs/usernames, and a failed manager re-authorization
  clears the cached view.

## Stack integration

PR #171's user subscription Things remain the source for user-wide storage,
app-registration, and PAT quotas. App subjects now store their storage plan on
the app Thing itself, replacing #171's earlier app→end-user storage fallback.
The admin subscription modal consequently exposes whole-app storage only for
app subjects, while user subjects retain user storage/max-app/max-PAT controls.
The existing `account-link` authorization is reused for co-management.

## Billing boundary

This stack does not add a payment processor or checkout flow (PR #171 also
has no payment integration). Owner plan changes therefore update and enforce
the selected storage entitlement immediately; connecting paid tiers to a
billing provider and webhook reconciliation remains a separate integration.

## Verification

- ✅ 100/100 current focused assertions pass: 41 exact-byte/storage-identity/
  migration/app-lifecycle/UI-projection regressions plus the 6 ACL, 6 app
  storage, 11 service-quota, 12 tier-catalog, and 24 schema suites. A separate
  adversarial review found no remaining P0/P1 correctness or security issue.
- ✅ Full `npm run build` passes: client, server, Nitro/Vercel packaging, Vite
  shell, filesystem route, SPA fallback, and `/authorize` frame-deny output.
- ✅ Fresh signed-in desktop (1440px) and mobile (390px) browser QA covers
  Users/Apps/Tiers query controls, horizontally reachable tables, canonical
  unavailable/reconciling storage states, exact allowance-byte tooltips, all
  six computed/custom pricing comparisons, the full tier editor and sticky
  actions, Settings account storage, and `/apps/manage`. Top-to-bottom and
  modal scrolling have no page-level horizontal overflow or browser errors;
  only the repository's pre-existing `HydrateFallback` warning remains.
- ✅ 40/40 focused catalog, schema, and app-storage tests: 12 subscription
  catalog tests, 22 schema-projection tests, and 6 atomic app-storage tests.
- ✅ Both live verification scripts pass Node syntax checks and now derive
  catalog tiers dynamically, pin exact `tierVersionId` values, and avoid
  leaving tier lifecycle mutations behind. Their authenticated live suites
  were not rerun for this tier-editor extension.
- ✅ Production build and Vercel-output verification, including the Vite shell,
  filesystem route, SPA fallback, and `/authorize` frame-deny checks.
- ✅ 24/24 focused admin-query tests cover typed/nested filters, numeric lists,
  local calendar dates, deterministic sorting, private response headers,
  globally newest cross-store paging, exact-id de-duplication, cursor validation
  and tie boundaries, Thing `shareId` cursor identity, malformed-response and
  cancellation handling, and complete multi-page client loading with
  duplicate/repeated-cursor protection.
- ✅ Signed-in desktop and 375px browser traversal of every admin query surface:
  Users, Apps, Tiers, rate-limit rules, and administrator roster. Free text,
  enum/boolean filters, state retention across tabs, empty states, complete
  128-user/15-app snapshots, dynamic panels, and top-to-bottom layout all pass
  without horizontal overflow or app-origin errors.
- ✅ Desktop and 375px browser traversal of `/admin` Tiers: all lifecycle
  sections, add/edit modal, all six computed-or-custom savings, Editor.js
  inclusions, archive confirmation, full-page and full-modal scrolling, and
  responsive tier cards. QA remained read-only; the draft and archive actions
  were cancelled. No horizontal overflow or app-origin browser errors; the
  floating mobile control now clears the sticky save action by 21px.
- ⚠️ The checkout has no `lint:files` package script; direct targeted ESLint is
  additionally blocked by the installed dependency export mismatch described
  in the repository runbook. The full-project typecheck still has broad
  pre-existing failures, while the changed tier backend files pass the focused
  TypeScript check.
- ↩️ Earlier verification for the underlying app-quota stack remains recorded
  as 30/30 live public-API app-storage checks and 38/38 live admin/co-manager
  checks; those suites were not rerun for this extension.
- ✅ Desktop and 375px browser traversal of `/apps/manage`, including Plus
  selection, a 64 MiB default cap, 80 MiB individual override, 96 MiB
  three-user bulk override, filtered reset, opened bulk controls, internal
  table scrolling, and full top-to-bottom page scroll. No horizontal page
  overflow or browser errors; the existing `HydrateFallback` warning remains.
