# 12 — Everything is a thing: collapse the satellite collections

Owner request (2026-07-12): users, feedAlgorithms, themes, waitlist, and
thingTypes all become docs in the `things` collection, each with its kind in
the `thingtime` schema-id array and a kind schema in the registry. Loop runs
until implementation AND recursive review rounds are done.

## Model

Every migrated doc becomes a standard thing:
`{ shareId, schemaVersion, thingtime: ['<kind>'], crystal: {public payload},
ownerId, acl, tags, createdAt, updatedAt }` plus two NEW root mechanisms:

- **`uniqueKeys: string[]`** — generalized uniqueness. Multikey unique sparse
  index; each element unique across the collection. Public keys are plain
  (`username:<u>`); PII keys are hashed (`email:<sha256(email)>`) so the
  wildcard text index never learns an address and uniqueness still holds.
- **`secure: {...}`** — root field (NOT crystal) for secrets, omitted from
  every projection, unreachable by the search field grammar (root whitelist),
  and its sensitive strings stored as **BinData buffers** so the `$**` text
  index (strings only) cannot tokenize them: passwordHash, email.

### Kinds

| kind | crystal (public) | secure | acl | uniqueKeys | shareId |
| ---- | ---------------- | ------ | --- | ---------- | ------- |
| `user` | username, displayName, bio, avatarUrl, bannerUrl, ttid | email (BinData), passwordHash (BinData), emailVerified, accountKind, emailVerificationRequiredBy, storage*, meta | `['tt:all']` (public profile) | `username:<u>`, `email:<hash>` | migrated = legacy `users._id` hex (preserves ownerId id-space everywhere); new = uuid |
| `feed-algorithm` | name, emoji, weights, eventCount, lastTrainedAt, parentId | — | `['tt:user']` | — | preserved |
| `theme` | name, theme tokens | — | visibility public → `['tt:all']`, private → `['tt:user']` | — | preserved (shared links keep working) |
| `waitlist` | — | email (BinData) | `['tt:user']` + ownerId `'system'` (visible to no one) | `email:<hash>` (scoped `waitlist-email:<hash>`) | uuid |
| `schema` (thingTypes) | already exists from PR #63 — builtin registry schemas get seeded as system-owned schema things; registry stays the validation source of truth | — | `['tt:all']` | `schema:<id>` | `schema-<id>` |

### Safety rails

- **Protected kinds**: `user`, `waitlist` (and future system kinds) cannot be
  created/updated/deleted through the generic `/api/v1/things` CRUD — only
  their dedicated utils (register, profile update, waitlist join) may write
  them (internal option flag). Otherwise DELETE ?id=<yourUserId> would delete
  an account, and POST could mint fake users.
- **Search/text-index leakage**: secure.* strings are BinData (invisible to
  `$**` text index); email uniqueness via hash; searchThings' root-field
  whitelist can't address `secure` or `uniqueKeys`; toPublicThings projects
  crystal only. Verify with live searches for a known email/hash.
- **Sessions and rosters stay collections** (not requested; TTL + revocation
  semantics), and keep working because user id strings are preserved.

### Dual-era + migration (house pattern, per things v1→v2)

- Writes go to `things` immediately; reads try things first, fall back to the
  legacy collection; admin migrations (`/api/v1/admin/migrations`) convert
  each collection idempotently (upsert by shareId/uniqueKeys), with census +
  dryRun in the panel. One migration per collection: `users-to-things`,
  `themes-to-things`, `feed-algorithms-to-things`, `waitlist-to-things`.
- FUNDAMENTALS §3 table, apiDocs, CHANGELOG, PRs/ note updated with the new
  reality; seeding still through the real API.

## Map findings that constrain the design (full digest: see PR note / tool-results/b9lnk4rci.txt in session scratch)

- `sessions.userId` and roster entries store `String(users._id)` — preserving
  the id string as the migrated user thing's shareId keeps sessions, rosters,
  ownerId joins, and active-theme/algorithm pointers working untouched.
- `admin.ts` (isAdminDoc/isEnvAdmin) reads RAW doc fields (`doc.username`,
  `doc.meta.admin`) and is deliberately import-free — the users util must hand
  it a legacy-shaped view (or it gains a shape adapter) during dual-era.
- `getCurrentUser` is the hot path (every request + SSR): jti → session →
  findUserById → toPublicUser, plus the service-account verification gate
  (accountKind service + unverified past emailVerificationRequiredBy → null).
- `meta.recentReactions` uses $pull+$push($each/$position/$slice 500) — array
  ops must keep working against the things-backed doc (root `secure.meta`).
- `registerUser.ts createUserAccount` is the single insertion chokepoint (also
  service accounts + seeding) — one place to switch writes to things.
- feedAlgorithms: every access is {shareId, ownerId}-scoped findOne;
  getOwnedAlgorithmWeights is hot (every ranked feed load) — must stay one
  indexed read ({thingtime,ownerId,...} index + shareId unique cover it).
- Legacy unique indexes (users username/email, feedAlgorithms/themes shareId,
  waitlist email) are replaced by things.uniqueKeys multikey unique sparse.

## Status

- [x] Touchpoint map workflow complete (6 domains)
- [x] Design finalized against the map
- [ ] Core mechanisms: kind schemas, PROTECTED kinds, uniqueKeys index,
      secure field + guards in things.ts (IN PROGRESS)
- [ ] users-as-things (auth web, dual-era)
- [ ] feedAlgorithms/themes/waitlist as things
- [ ] thingTypes/schema seeding
- [ ] migrations + verify + stacked PR + recursive reviews
