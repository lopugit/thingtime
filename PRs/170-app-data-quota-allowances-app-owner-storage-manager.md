# PR #170 — real app-data quotas + app-owner storage manager

- **PR**: https://github.com/lopugit/thingtime/pull/170
- **Branch**: `codex/app-data-quota-allowances`
- **Stacked on**: PR #171, `claude/admin-ui-user-app-management-5571a3`
- **Merge order**: the earlier Thingtime app-integration stack → #171 → #170.

## Outcome

App-data is admitted against two measured byte ledgers, and the admin app
manager now has an owner-facing counterpart at `/apps/manage`:

| Control | Source of truth | Default / tiers |
| --- | --- | --- |
| Whole app | The app Thing: tier, optional admin override, aggregate allowance, and aggregate used bytes in one atomic document | Free 5 GiB; Plus 25 GiB; Pro 100 GiB; PAYG null/unlimited but metered |
| One app user | One deterministic protected `app-storage` Thing for `(app, user)`: used bytes + optional manager override | App default 50 MiB; custom finite sub-tier; always clamped to the whole-app ceiling |

The registering owner and administrator-linked co-managers can switch the app
tier, edit the inherited user cap, and assign/reset one or many user overrides.
Administrator-custom app plans remain administrator-controlled and lock owner
tier switching. The generic `/apps/update` route still ignores all quota fields.

## Atomic quota model

- Positive namespace writes reserve whole-app bytes first, then app-user bytes
  with guarded Mongo updates. A user refusal/error compensates the app
  reservation exactly once; an unavailable ledger fails closed.
- Updates charge only the serialized-size delta. Deletes and first-party owner
  edits refund/charge both ledgers. Same-key compare-and-swap races reconcile to
  the winning persisted size.
- A plan cannot be set below current aggregate usage. A default or individual
  user cap cannot be set above the current aggregate, and default updates
  re-check that relationship inside the atomic write. Runtime admission still
  clamps historical overrides after a later plan downgrade.
- Legacy apps stay write-fenced until `backfill-app-storage-allowances`
  reconciles per-user ledgers and enables the aggregate marker last. Original
  `data` counters are adopted into the protected `app-storage` kind.
- A partial `(quotaKind, appId, updatedAt, ownerId)` index supports app-manager
  and admin app-user rollups without scanning ordinary app data.

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

- ✅ 36/36 focused core, tier-catalog, and schema tests.
- ✅ Targeted ESLint across the quota, subscription, migration, route, docs,
  and manager UI files (only the migration file's pre-existing
  `no-loop-func` warning remains).
- ✅ 30/30 live public-API app-storage checks across owner controls and
  two-user ledger behavior.
- ✅ 38/38 live admin/co-manager checks.
- ✅ Production build and Vercel-output verification.
- ✅ Desktop and 375px browser traversal of `/apps/manage`, including Plus
  selection, a 64 MiB default cap, 80 MiB individual override, 96 MiB
  three-user bulk override, filtered reset, opened bulk controls, internal
  table scrolling, and full top-to-bottom page scroll. No horizontal page
  overflow or browser errors; the existing `HydrateFallback` warning remains.
