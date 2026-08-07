# PR #171 — /admin dashboard: subscription tiers, quotas, app suspension & ownership links

- **PR**: https://github.com/lopugit/thingtime/pull/171
- **Branch**: `claude/admin-ui-user-app-management-5571a3`
- **Base**: `claude/thingtime-app-integration-63ddad` (PR #158, itself stacked on #156) — merge order: #156 → #158 → #171.
- **Note**: the request referenced "Stack #165"; #165 does not exist on GitHub (numbers jump 164→166), so the open #156→#158 stack was used as the base.

## Shape of the change

| Layer | What |
| --- | --- |
| `api/utils/subscriptions/tierCatalog.ts` | Pure tier catalog (free/plus/pro/payg) + `QuotaOverrides` clamp + `resolveTierQuotas` merge. `null` anywhere = unlimited. Client-importable (patScopes pattern). Unit-tested (`test:subscriptions`, 9 tests, `node --test` via relative `.ts` import). |
| `api/utils/subscriptions/subscriptions.ts` | PROTECTED `subscription` things per subject (`user`\|`app`), deterministic shareId, 15s cache, batch reads, `resolveAppStorageBudget` (app assignment → end-user tier → free). |
| `api/utils/accounts/accountLinks.ts` | PROTECTED `account-link` things: `linkKind 'account'` (owned accounts, assumable) / `'app'` (co-managers). Many-to-many both directions. `userCanManageApp` powers apps update/delete. |
| Enforcement | `namespace.ts appStorageBudgetBytes` now async + tier-aware (null = metered unguarded `$inc`); `apps.ts createApp` maxApps; `patTokens.ts` mint cap; `appTokens.ts resolveAppToken` + `apps/public` + `oauth/authorize` refuse `crystal.revokedAt`; `setAppRevoked` sweeps live app sessions. |
| `api/utils/admin/adminDirectory.ts` | Users/apps overview rollups — one search + $in aggregates per page, never per-row collection queries. |
| Routes ×7 | `admin/users/overview`, `admin/apps`, `admin/apps/revoke`, `admin/subscriptions` (GET catalog+subject / POST assign+clear), `admin/links` (GET/POST), `auth/accounts/owned`, `auth/accounts/assume` — all three-place registered + docs entries (= Nitro routes + 14 auto docs smoke tests) + 7 guard tests. |
| UI | `components/Admin/AdminDashboard.tsx` (Users/Apps/System tabs, 🔐 gate card, nav-clearance padding), `SubscriptionEditorModal` (tier + per-field override: Tier default/Custom/Unlimited, MB inputs for byte fields), `LinkManagerModal` (user lens + app lens, debounced pickers), switcher "Owned accounts" section (localCache `tt-owned-accounts`, assume → roster), drawer `adminOnly` flag + 🛠️ Admin item, `/admin` route + title. |
| Indexes/registry | things `(crystal.targetId, crystal.linkKind)` partial; `PROTECTED_THINGTIME` += both kinds; registry schema entries; sessions `purpose` doc-drift fix. |

## Key decisions

- **Free tier mirrors the legacy caps exactly** so unassigned subjects behave identically to before the tier system existed.
- **payg = metered, no hard caps** (all quotas `null`); usage still flows through the byte ledgers so it can be billed. No payment integration (none exists in the repo).
- **Custom overrides are orthogonal to tiers** (per-field partial, `null` = unlimited) rather than a fifth tier — the admin UI badges any subject with overrides as `custom`.
- **Assume never widens the roster's anti-fixation gate**: authorization is the server-side link; each browser gets its own session; `mergeAccountSession`'s revocation is roster-scoped so co-owners in other browsers survive (verified in accounts.ts:288 before building).
- **Suspension beats deletion**: `revokedAt` is checked at the token choke point so even un-swept tokens die instantly; restore requires re-authorization by design.
- **App storage budget resolution order** app-subscription → end-user tier → default lets both dimensions be upgraded independently (a pro user gets bigger namespaces everywhere; a partner app can be granted more per user).

## Verification log (2026-08-02)

- `corepack pnpm --dir remix run test:subscriptions` → 9/9.
- ESLint clean on all ~34 changed files (branch predates `lint:files`; used `pnpm exec eslint` directly).
- Live suite `scripts/verify-admin-subscriptions.mjs http://127.0.0.1:14342` → **32/32** (admin bootstrap: register throwaway user, restart PM2 dev with `ADMIN_USERNAMES=<user>`; authorize grants must include the required `profile` scope floor).
- Browser (in-app pane on the PM2 worktree stack, desktop + 375px): all tabs, both modals, suspend/restore + toast, switcher owned-accounts assume/switch-back, drawer item, mobile table-scroll containment (page body never scrolls horizontally), zero console errors. One visual bug found+fixed during the pass: the page heading rendered under the fixed nav — added the SettingsPage-style `--tt-nav-clearance` padding.

## Dev runbook additions

- TESTING.md → "Admin dashboard, subscription tiers & ownership links" checklist.
- README → `/admin` + verify-suite env placeholders under "Admin access".
- Local worktree stack for this branch: web http://127.0.0.1:14340, nitro http://127.0.0.1:14342 (PM2 `tt-wt-inspiring-mcnulty-348eb8-14340`).
