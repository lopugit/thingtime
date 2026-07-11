# 13 — Admin role + admin-configurable rate limits 🟢

**Status:** Built, live-tested locally (env-admin + promote/demote, config
GET/POST, real throttling → 429, admin-only guards, admin UI panel).

## Goal
Rate-limit abuse-prone endpoints (reactions, comments) and let admins tune those
limits globally from an admin UI — plus establish an admin role, since Thingtime
had none.

## ✅ Decisions (locked)
- **Admin = `meta.admin` flag OR the `ADMIN_USERNAMES` env allowlist.** The env
  allowlist bootstraps the first admin and is a PERMANENT override (an env-listed
  user can't be demoted / locked out), so there's always a way back in. Admins
  promote/demote others in the UI (`meta.admin`). Owner's call over an env-only
  scheme (2026-07-11) — wanted in-UI admin management.
- **`isAdmin` rides the PublicUser projection** (`toPublicUser`), so the client
  reveals the admin panel, but every admin route re-checks server-side
  (`requireAdmin`) — the client flag is never trusted.
- **Global rate-limit config is a `settings` singleton doc**, admin-editable,
  merged over code defaults + clamped, cached ~15s. Endpoints + defaults:
  `things.react` 60/min, `things.comment` 20/min.
- **General sliding-window limiter** (`rateLimit/enforce.ts`) generalises the
  Lopu-musing limiter over a shared `rateLimits` collection (TTL-reaped), keyed
  by `user:<id>` (else hashed IP). **Fails OPEN** for user actions — a limiter DB
  hiccup never blocks reacting/commenting (unlike the musing limiter, which fails
  closed to protect provider quota).

## Built this round
- `auth/admin.ts` (isEnvAdmin/isAdminDoc), `isAdmin` on PublicUser + CurrentUser,
  `auth/requireAdmin.ts`, `users.ts` (setUserAdmin/searchUsersForAdmin/listAdmins).
- `rateLimit/config.ts` (defaults + get/set + cache), `rateLimit/enforce.ts`
  (limiter + 429 helper). `settings` + `rateLimits` collections + indexes.
- Routes: `GET/POST /api/v1/admin/rate-limits`, `GET /api/v1/admin/users`,
  `POST /api/v1/admin/set-admin` (all admin-guarded); react + comment routes now
  call `enforceRateLimit`. Registered + documented; safe apiTests for the guards.
- UI: `components/Admin/AdminPanel.tsx` (rate-limit editor + admin manager),
  rendered in `SettingsPage` only when `user.isAdmin`.

## Still TODO
- Consider rate-limiting auth endpoints too (login/register/resend) via the same
  general limiter — see 09-security-hardening.md.
