# 🧠 Thingtime × Claude — Feature To-Do

This folder is our shared roadmap. Each file is one feature: what it's for, what
already exists in the code, what's missing/broken, the plan, and how we'll know
it's done.

Keep these updated as we build — they double as living docs and as context for
future Claude sessions (use alongside `graphify-out/` for codebase orientation).

## Status board

| # | Feature | Status | File |
| - | ------- | ------ | ---- |
| 01 | MongoDB connection status (footer + `/mongodb-status`) | ✅ Done | [01-mongodb-connection-status.md](./01-mongodb-connection-status.md) |
| 02 | DB populate / seeding (now seeds via register API) | 🟢 Built, needs live test | [02-db-populate-seeding.md](./02-db-populate-seeding.md) |
| 03 | Auth — register/login/logout/me + sessions + JWT + email verification | 🟢 Built, needs live test | [03-auth-login-register.md](./03-auth-login-register.md) |
| 04 | Authed DB read + query | 🔴 Not started | [04-authed-db-read-query.md](./04-authed-db-read-query.md) |
| 05 | Authed DB write (create/update/delete) | 🔴 Not started | [05-authed-db-write.md](./05-authed-db-write.md) |
| 07 | Cross-tab sync for persisted thingtime state | 🔴 Not started | [07-cross-tab-thingtime-sync.md](./07-cross-tab-thingtime-sync.md) |
| 08 | Drawer nav & editor UX follow-ups (draggable groups, brand link, `/branding` + SVG→PNG, API tests, hover key-path context) | 🔴 Not started | [08-drawer-nav-editor-polish.md](./08-drawer-nav-editor-polish.md) |
| 09 | Security hardening (unauth admin/data endpoints, auth rate limiting, persisted-state `eval`/CSP, Date.parse corruption) | 🟡 Final §§C–D reconciliation in PR #99; §§A–B closed | [09-security-hardening.md](./09-security-hardening.md) |
| 10 | Delight & growth ideas (sharing loops, theme gallery, algorithm-growth design, Commander/DevKit power-ups, easter eggs) | 🌱 Idea bank · some eggs shipped | [10-delight-and-growth-ideas.md](./10-delight-and-growth-ideas.md) |
| 11 | Account switcher — multi-account sign-in (`tt_accounts` roster, switch/remove, add + register-new inline) | 🟢 Built, live-tested locally | [11-account-switcher.md](./11-account-switcher.md) |
| 12 | Multi-emoji reactions + custom emoji picker + optimistic UI (native keyboard, typed multi-emoji tokens, paginated recents, no loading flashes) | 🟢 Built, live-tested locally | [12-reactions-and-optimistic-ui.md](./12-reactions-and-optimistic-ui.md) |
| 13 | Admin role + admin-configurable rate limits (env-allowlist + `meta.admin`, promote/demote UI, global rate-limit config, react/comment throttling) | 🟢 Built, live-tested locally | [13-admin-and-rate-limits.md](./13-admin-and-rate-limits.md) |
| 14 | Editor.js block drag/drop reordering (desktop pointer, mobile long-press, keyboard alternative, autosave/undo-safe) | 🔴 Not started | [14-editorjs-block-drag-drop.md](./14-editorjs-block-drag-drop.md) |
| 17 | Circles become real 💞 (friends/family membership + real acl resolution) | 🟡 Friends circle shipped (real friend graph); family circle still owner-only | [17-circles.md](./17-circles.md) |
| 18 | Unique account invite links with optional username/profile prefill | 🔴 Not started | [18-account-invite-links.md](./18-account-invite-links.md) |
| 19 | Group chats with per-participant anonymity, including the creator | 🔴 Not started | [19-anonymous-group-chats.md](./19-anonymous-group-chats.md) |
| 20 | Versioned experience history — revisit any app/search/feed state | 🔴 P1 fundamental · not started | [20-versioned-experience-history.md](./20-versioned-experience-history.md) |
| 20 | Run actions from the component tester (confirm gate, inert browse grid) | 🔴 Not started · owner-approved | [20-tester-runs-actions.md](./20-tester-runs-actions.md) |
| 21 | Composed app surface — a folder of Things rendered as a working mini-app | 🔴 Not started | [21-app-composition-surface.md](./21-app-composition-surface.md) |
| 21 | Index budget — reconcile the `things` indexes under MongoDB's 64-per-collection cap (48 in use, ~5 legacy-era slots reclaimable once the v1 read path retires, budget guard) | 🔴 Not started · no rush, headroom exists | [21-index-budget-consolidation.md](./21-index-budget-consolidation.md) |
| 22 | Trustworthy adoption loop — define first value, useful return, consentful sharing, privacy-safe learning, and aligned sustainability gates | 🟣 Proposed · owner decision needed | [22-trustworthy-adoption-loop.md](./22-trustworthy-adoption-loop.md) |
| 23 | Data portability and graceful exit — inventory, verified export, safe restore, selective deletion, and account closure | 🟣 Proposed · owner decision needed | [23-data-portability-and-exit.md](./23-data-portability-and-exit.md) |

## Conventions (see `FUNDAMENTALS.md`)

- **All DB access goes through the Thingtime API** + the API utils layer. UI /
  scripts / tests never touch Mongo directly.
- **Seed and test via the real API** (e.g. seed users through
  `POST /api/v1/auth/register`), never direct DB writes — one creation path for
  seeded data and real signups.
- **One Mongo connection source:** `mongodb/config.ts` `getMongoUri()`
  (`MONGODB_CONNECTION_STRING` + `MONGO_PASS`, no fallbacks). ✅ unified by Codex.

## ✅ Decisions (locked)

- **One `thingtime` db** with collections `users`, `sessions`, `things`
  (replaces the old `auth.users` vs `thingtime.things` split).
- **Auth:** signed **httpOnly cookie carrying a JWT** (`sub`/`jti`/`exp`) + a
  Mongo `sessions` doc for revocation; `Authorization: Bearer <jwt>` supported
  for API clients. Same JWT, Mongo is source of truth for revocation.
- **Seeding** creates users by calling the real register endpoint, so the seed
  schema == the live signup schema (no drift).
