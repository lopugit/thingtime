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
| 09 | Security hardening (unauth admin/data endpoints, auth rate limiting, persisted-state `eval`/CSP, Date.parse corruption) | 🔴 Not started · ⚠️ has urgent items | [09-security-hardening.md](./09-security-hardening.md) |
| 10 | Delight & growth ideas (sharing loops, theme gallery, algorithm-growth design, Commander/DevKit power-ups, easter eggs) | 🌱 Idea bank · some eggs shipped | [10-delight-and-growth-ideas.md](./10-delight-and-growth-ideas.md) |
| 11 | Account switcher — multi-account sign-in (`tt_accounts` roster, switch/remove, add + register-new inline) | 🟢 Built, live-tested locally | [11-account-switcher.md](./11-account-switcher.md) |

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
