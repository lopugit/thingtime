# 🏛️ Thingtime Fundamentals

Core engineering principles for this codebase. These are deliberately short and
non-negotiable — read before adding features. (Roadmap lives in `claude-todo/`.)

## 1. The API is the only gateway to data

All data access — reads, writes, seeding, tests — goes through the Thingtime API
(`remix/app/routes/api/v1/...`) and the API utils layer
(`remix/app/api/utils/...`). UI components, scripts, and tests **never** touch
MongoDB directly.

## 2. Seed and test through the real API (functionality cohesion) ⭐

**Seeding and tests create data by calling the same API the live app calls — not
by writing to Mongo directly.**

Why: a seeded user and a user who signs up on the site must be **identical** —
same validation, same password hashing, same schema, same side effects. If
seeding writes straight to the DB, the two paths drift and "works when seeded /
breaks on real signup" bugs appear.

- ✅ Seed a user → `POST /api/v1/auth/register` (the real endpoint).
- ❌ Seed a user → `collection.insertOne({...})` in a script.

This makes **test, live, and direct-API behaviour one and the same code path.**
Applies to every entity (users, things, sessions): there is one creation path,
and everything uses it.

## 3. One database: `thingtime`

Single Mongo database `thingtime` with these collections:

| Collection | Holds |
| ---------- | ----- |
| `users`    | user accounts (hashed passwords + signup metadata + profile fields: bio/avatarUrl/bannerUrl; `meta.twoFactorEmailEnabled` gates the email-2FA login flow) |
| `sessions` | server-side sessions / JWT records (for revocation) |
| `things`   | the actual Thingtime data — every thing (posts, comments, reactions, shares, data, schemas) as one root shape: `thingtime` schema ids + `crystal` payload (see `/api/v1/things` and `app/schemas/registry.ts`). Every thing also carries a schema-free `extended` property for arbitrary unvalidated JSON (≤512KB, replace-on-write, never structured-searchable) |
| `emailVerifications` | pending email-verification tokens |
| `passwordResets` | single-use password-reset tokens (1h TTL; consuming one revokes every live session) |
| `authOtps` | email-2FA login challenges (sha256 code hashes only, 10-min TTL, attempt-capped) |
| `email_messages` + `email_events`/`email_suppression_list`/`email_unsubscribes`/`email_templates`/`email_subscriptions`/`email_identities` | the owned email layer — outbox rows for every send plus deliverability satellites (see `api/utils/email/`) |
| `lopuMusingRateLimits` | rate-limit windows for Lopu musings |
| `themes`   | saved user themes (shareable by `shareId`; see `/api/v1/themes`) |
| `waitlist` | launch waitlist emails (`/api/v1/waitlist`) |
| `feedAlgorithms` | per-user doomscroll-trained feed algorithms (`/api/v1/algorithms`; active pick lives in `users.meta.activeFeedAlgorithmId`) |

(Replaces the earlier inconsistent `auth.users` vs `thingtime.things` split.)

### Appended/child data is relational — never an unbounded embedded array

Data that accumulates on a parent (post **reactions**, post **comments**, and
anything similar in future) is stored as its OWN atomic `things` doc
(`kind: 'reaction'`, `kind: 'comment'`, …) linked to the parent by `parentId`
(the parent's `shareId`) and aggregated back on read. NEVER append it as an
ever-growing array/map field on the parent doc.

Why: an embedded array/map has no natural bound — one actor can grow a single
doc toward Mongo's 16 MB cap (bricking it) and bloat every reader's
payload/DOM, and every write rewrites the whole parent. Relational children keep
the parent bounded, make each write per-item + concurrency-safe (a partial-unique
index enforces invariants like one-reaction-per-user), and give natural paging.

How (see `api/utils/things/things.ts`):
- Child docs carry `kind` + `parentId` + `ownerId` (+ payload), no `shareId`.
- Reads **batch-aggregate** children for the whole page in ONE query per kind
  (`{ kind, parentId: { $in: postIds } }`) — never N+1 — and project the same
  shape the client already consumes, so the UI is unchanged.
- Writes create/delete one child doc; per-parent/per-user caps become soft
  product limits, not structural safety rails.
- Legacy embedded data folds in on read and migrates to children on first write.
- Deleting a parent cascades: delete its children by `parentId`.

## 4. One MongoDB connection source

The connection string comes from exactly one place:
`remix/app/api/utils/mongodb/config.ts` → `getMongoUri()`, fed by
`MONGODB_CONNECTION_STRING` (+ `MONGO_PASS` for the `<db_password>` placeholder).
No alternate env vars, no fallbacks. Every helper resolves through it.

For **local dev**: set `MONGODB_CONNECTION_STRING=mongodb://localhost:27017/thingtime`
(no placeholder → `MONGO_PASS` unused).

## 5. Auth = httpOnly cookie + revocable JWT + Mongo session

One auth model used everywhere (see `claude-todo/03-auth-login-register.md`):

- On login/register: create a **session doc** in `sessions` (Mongo) → gives a
  `jti` (token id) we can revoke.
- Mint a **signed JWT** (`sub` = userId, `jti`, `exp`) via `userGenerateJWT`.
- **Browser:** store the JWT in a signed **httpOnly cookie** (the Remix
  `Session` cookie) — JS can't read it, sent automatically.
- **API clients:** send the same JWT as `Authorization: Bearer <jwt>`.
- Every authed request: verify signature + `exp`, then check the `jti` is still
  live in `sessions` (not revoked). Logout / revoke = flip the session in Mongo →
  the JWT stops working immediately, before `exp`.

So the JWT lives in the cookie for the website *and* works as a Bearer token for
API clients — and either way Mongo is the source of truth for revocation.

Multi-account: a second httpOnly cookie, **`tt_accounts`**, holds an opaque id
naming this browser's account-switcher roster — a doc in the Mongo `rosters`
collection whose entries reference sessions by id (no account limit, no raw
JWTs stored anywhere). `tt_auth` stays the single ACTIVE credential; switching
mints a fresh JWT from the chosen live session. Every roster account is
independently revocable and validated by the same session→user path as
`tt_auth`, and raw tokens never reach the client (the switcher API returns
public users only). See `claude-todo/11-account-switcher.md`.

## 6. Never leak secrets

- Strip credentials from any connection string shown to a client
  (`sanitiseMongoHost`).
- Never return password hashes, session tokens, or raw JWTs in read responses;
  project them out.

## 7. One notification: Lopu 🦄

**All user-facing notifications go through the Lopu toast component**
(`remix/app/components/Lopu/useLopu.tsx`) — never raw Chakra `useToast`, browser
`alert()`, or ad-hoc banners. This keeps one consistent voice (messages read as
coming from "Lopu", the Thingtime AI) and one visual style (the rainbow-bordered
card below the nav, with a built-in ✕ close button).

Two hooks, same look:

- `useLopu()` → one-shot toast: `lopu({ title, description?, status?, duration?, link? })`.
  `status` is `'success' | 'error' | 'info'`; default `duration` is 15s.
- `useLopuStream()` → a streaming toast that pops instantly ("Lopu is thinking…")
  and types an NDJSON response in live (used by the DevKit musing). The read-timer
  starts when the stream *finishes*.

Don't pass Chakra-native toast props (e.g. `isClosable`, `render`) to `lopu()` —
the component owns presentation. `console.error`/logging is for developers and is
not a user notification; surface anything the user should see through Lopu.
