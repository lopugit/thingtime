# Codex CRUD Implementation Plan

## Purpose

Build a first-class Thingtime CRUD API stack for user-owned typed data. The
stack must preserve the current Thingtime fundamentals:

- all data access goes through `/api/v1/...` routes and `remix/app/api/utils/...`;
- auth uses `getCurrentUser(request)` with httpOnly cookie or Bearer JWT;
- MongoDB remains the single `thingtime` database;
- public API responses are explicit projections and never leak raw Mongo ids,
  password/session data, encryption keys, or unauthorized record existence.

This plan is documentation-first. The implementation should land in focused
phases so each phase can be tested and reviewed without changing unrelated feed,
theme, algorithm, or auth behavior.

## Current Repo Anchors

Use the existing API families as the model:

- `remix/app/api/http.ts`: `json()` and `readJsonBody()` for response shape and
  real request-size caps.
- `remix/app/api/utils/auth/getCurrentUser.ts`: canonical auth resolution.
- `remix/app/api/utils/mongodb/collections.ts`: single DB connection and
  `ensureIndexes()`.
- `remix/app/api/utils/themes/themes.ts`: save/list/delete CRUD pattern, public
  projections, owner checks, `{ ok:false, status, error } | { ok:true, ... }`.
- `remix/app/api/utils/things/things.ts`: `shareId` as public id, `kind`
  discrimination inside `thingtime.things`, visibility filtering before read or
  interaction, and feed-safe projections.
- `remix/server/routes/api/[...].ts`, `remix/nitro.config.ts`, and
  `remix/app/docs/apiDocs.ts`: every new `/api/v1/...` route must be registered
  in the route import map, API docs, and Nitro route list.

## Recommended Shape

Use the existing `thingtime.things` collection for user records and add a small
schema collection for user-defined data types:

- `things` remains the canonical user-data collection. Feed posts continue as
  `kind: "post"`. Generic CRUD records are added as `kind: "record"`.
- `thingTypes` stores user-defined schemas, field policies, and type-level
  defaults.
- Optional later: `thingAuditEvents` for append-only security and mutation
  history once the core CRUD path is stable.

This keeps Thingtime's "actual data lives in things" rule intact while avoiding
a feed-specific record shape.

## Data Model

### Type Document

Collection: `thingtime.thingTypes`.

```ts
type ThingTypeDoc = {
  _id?: any;
  shareId: string;
  ownerId: string;
  key: string;
  name: string;
  description: string | null;
  visibility: "private" | "public";
  version: number;
  fields: ThingTypeField[];
  defaultAcl: ThingRecordAcl;
  createdAt: Date;
  updatedAt: Date;
};

type ThingTypeField = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "date" | "json" | "url" | "fileRef";
  required: boolean;
  encrypted: boolean;
  searchable: "none" | "exact" | "term";
  sortable: boolean;
  maxBytes?: number;
};
```

Rules:

- `shareId` is the only type id exposed to clients.
- `key` is stable for integrations and must be unique per owner.
- Field keys are lowercase slug identifiers; labels are presentation only.
- `encrypted: true` fields are stored in envelope form and never placed in
  plaintext search text.
- `searchable` for encrypted fields means server-generated blind index tokens,
  not ciphertext search.

### Record Document

Collection: `thingtime.things`.

```ts
type ThingRecordDoc = {
  _id?: any;
  shareId: string;
  kind: "record";
  typeId: string;
  ownerId: string;
  acl: ThingRecordAcl;
  values: Record<string, StoredThingValue>;
  search: {
    tokens: string[];
    publicText: string | null;
  };
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type ThingRecordAcl = {
  ownerId: string;
  readKeys: string[];
  writeKeys: string[];
  adminKeys: string[];
  searchKeys: string[];
};

type StoredThingValue =
  | { storage: "plain"; value: unknown }
  | { storage: "encrypted"; envelope: EncryptedValueEnvelope };

type EncryptedValueEnvelope = {
  alg: "AES-256-GCM";
  kid: string;
  iv: string;
  ciphertext: string;
  tag: string;
  aad: string;
};
```

Rules:

- `ownerId` is always included in `readKeys`, `writeKeys`, `adminKeys`, and
  `searchKeys`.
- Use subject keys instead of several parallel ACL arrays:
  `user:<id>`, `service:<id>`, `account-kind:service`, and `public`.
- Anonymous callers only receive the `public` subject key.
- Unauthorized direct reads return 404, matching existing private-theme and
  not-visible post behavior.
- Soft delete first (`deletedAt`), then hard-delete only if a later retention
  policy needs it.

## Permission Model

Permissions are operation-specific and fail closed:

- `read`: can fetch the record and receive allowed fields.
- `search`: can match the record in search/list endpoints. Default should equal
  `read` because search reveals existence.
- `write`: can update values but cannot grant permissions.
- `admin`: can update ACLs, type links, and delete the record.
- `owner`: implicit admin/write/read/search authority and cannot be removed from
  the ACL.

Utility layer:

- `subjectKeysForUser(user: PublicUser | null): string[]`
- `recordPermissionMatch(user, "read" | "search" | "write" | "admin")`
- `canReadRecord(record, user)` and `canWriteRecord(record, user)`
- `assertRecordAdmin(record, user)` for ACL mutations
- `sanitizeAclInput(input, ownerId)` to normalize and dedupe grants

Mongo filters should combine permission checks with the business query:

```ts
{
  kind: "record",
  deletedAt: null,
  typeId,
  "acl.searchKeys": { $in: subjectKeys },
  "search.tokens": { $all: requestedTokens }
}
```

For direct `id` reads:

```ts
{
  kind: "record",
  shareId: id,
  deletedAt: null,
  "acl.readKeys": { $in: subjectKeys }
}
```

## Encryption Model

Start with server-side envelope encryption. Do not mix this with the public
`/api/v1/crypto` diagnostic helpers.

Environment:

- `THINGTIME_DATA_MASTER_KEYS`: JSON map of key id to base64url 32-byte key.
- `THINGTIME_ACTIVE_DATA_KEY_ID`: active key id for new writes.

Fork-safe docs should show placeholder values only. Never commit real keys.

Utility module:

- `remix/app/api/utils/crud/encryption.server.ts`

Responsibilities:

- load and validate configured keys at request time;
- encrypt encrypted field values using AES-256-GCM;
- bind record/type/field metadata as AAD;
- decrypt only after the record-level permission check passes;
- support key rotation by decrypting with `kid` and re-encrypting with the
  active key on future writes.

Encrypted field search:

- Build blind index tokens with HMAC-SHA256 using a separate search key derived
  from the active master key.
- Token format: `v1:<typeId>:<fieldKey>:<mode>:<digest>`.
- `exact` search stores one token from a normalized full value.
- `term` search stores normalized word tokens for text-like fields.
- Do not support prefix/fuzzy search for encrypted fields in v1; it leaks too
  much shape. Add it later only with an explicit threat-model update.

Plain fields:

- Plain searchable fields can populate both `search.tokens` and `search.publicText`.
- `search.publicText` is never used to authorize; it is only a convenience for
  display snippets after the permission filter has already matched.

## API Family

Use explicit static route keys because Nitro's catch-all import map currently
registers known paths.

### Type CRUD

- `GET /api/v1/crud/types`
  - Lists caller-visible type definitions.
  - Auth optional; anonymous callers see public types only.
- `POST /api/v1/crud/types`
  - Creates a type or updates a caller-owned type when `id` is provided.
  - Requires session or Bearer auth.
- `POST /api/v1/crud/types/delete`
  - Deletes or archives a caller-owned type.
  - Refuse delete when records exist unless `archive: true`.

### Record CRUD

- `GET /api/v1/crud/records?id=<recordId>`
  - Reads one permitted record.
  - Auth optional; public records can be read anonymously.
- `GET /api/v1/crud/records?typeId=<typeId>&cursor=&limit=`
  - Lists permitted records for a type.
- `POST /api/v1/crud/records`
  - Creates a record for a type.
  - Requires session or Bearer auth.
- `POST /api/v1/crud/records/update`
  - Updates values on a writable record.
  - Requires write permission.
- `POST /api/v1/crud/records/delete`
  - Soft-deletes a record.
  - Requires admin or owner.
- `POST /api/v1/crud/records/permissions`
  - Updates ACL grants.
  - Requires admin or owner.

### Search

- `GET /api/v1/crud/search?q=&typeId=&fields=&cursor=&limit=`
  - Auth optional; always filters by `acl.searchKeys`.
  - Returns projected record summaries only.
- `POST /api/v1/crud/search`
  - Same operation with JSON body for complex filters.
  - Use `readJsonBody(request, 64 * 1024)`.

Search result shape:

```ts
{
  ok: true,
  records: PublicThingRecordSummary[],
  nextCursor: string | null
}
```

Do not return encrypted values from search unless they are needed for the result
summary and the caller has read permission. Search snippets for encrypted fields
should be omitted in v1.

## File Targets

Add utilities:

- `remix/app/api/utils/crud/types.ts`
- `remix/app/api/utils/crud/records.ts`
- `remix/app/api/utils/crud/permissions.ts`
- `remix/app/api/utils/crud/encryption.server.ts`
- `remix/app/api/utils/crud/search.ts`
- `remix/app/api/utils/crud/validation.ts`

Add route modules:

- `remix/app/routes/api/v1/crud/types/_types.tsx`
- `remix/app/routes/api/v1/crud/types/delete/_delete.tsx`
- `remix/app/routes/api/v1/crud/records/_records.tsx`
- `remix/app/routes/api/v1/crud/records/update/_update.tsx`
- `remix/app/routes/api/v1/crud/records/delete/_delete.tsx`
- `remix/app/routes/api/v1/crud/records/permissions/_permissions.tsx`
- `remix/app/routes/api/v1/crud/search/_search.tsx`

Update glue:

- `remix/app/api/utils/mongodb/collections.ts`
  - add `getThingTypesCollection()`;
  - add indexes in `ensureIndexes()`.
- `remix/server/routes/api/[...].ts`
  - add imports for each new static route key.
- `remix/app/docs/apiDocs.ts`
  - add docs for each endpoint so `apiV1RouteKeys` and `apiV1DocsRouteKeys`
    include them.
- `remix/nitro.config.ts`
  - no manual path update should be needed if `apiDocs.ts` is correct, but
    verify generated `apiRoutes`.
- `FUNDAMENTALS.md`
  - add `thingTypes` and optional `thingAuditEvents` to the collection table
    when implementation lands.
- `README.md`
  - document placeholder encryption env vars and local setup.

Indexes:

```ts
db.collection("thingTypes").createIndex({ shareId: 1 }, { unique: true });
db.collection("thingTypes").createIndex({ ownerId: 1, updatedAt: -1, shareId: 1 });
db.collection("thingTypes").createIndex({ visibility: 1, updatedAt: -1, shareId: 1 });

db.collection("things").createIndex({ shareId: 1 }, { unique: true, sparse: true });
db.collection("things").createIndex({ kind: 1, typeId: 1, ownerId: 1, updatedAt: -1, shareId: 1 });
db.collection("things").createIndex({ kind: 1, typeId: 1, "acl.readKeys": 1, updatedAt: -1, shareId: 1 });
db.collection("things").createIndex({ kind: 1, typeId: 1, "acl.searchKeys": 1, updatedAt: -1, shareId: 1 });
db.collection("things").createIndex({ kind: 1, typeId: 1, "search.tokens": 1, updatedAt: -1, shareId: 1 });
db.collection("things").createIndex({ kind: 1, deletedAt: 1, updatedAt: -1, shareId: 1 });
```

Avoid indexes with multiple independent array fields in the same compound index.
Keep permission subject matching in one ACL array per operation.

## Public Projections

Create explicit projection types:

- `PublicThingType`
- `PublicThingRecord`
- `PublicThingRecordSummary`
- `PublicThingPermissionGrant`

Projection rules:

- expose `id`, never `_id`;
- expose `typeId`, never raw internal ids;
- expose decrypted field values only after read permission passes;
- omit encrypted field values from summaries by default;
- never return encryption envelopes, key ids, ACL internals, session data, or
  owner email;
- return `permissions` as booleans (`canRead`, `canWrite`, `canAdmin`) rather
  than raw ACL arrays unless the caller is admin.

## Validation Rules

Type validation:

- cap type name, description, field count, field label size, and field key size;
- reject duplicate field keys;
- reject unknown field kinds and search modes;
- require encrypted fields for values that callers mark secret;
- deny changing a field from encrypted to plain when records already exist
  unless an explicit migration command is introduced.

Record validation:

- load the type first through a permitted type read;
- validate each submitted value against the field policy;
- reject unknown fields unless `allowUnknownFields` is added later;
- enforce per-field `maxBytes`;
- use `readJsonBody()` for all mutation routes;
- increment `version` on every write and optionally support optimistic
  concurrency with `expectedVersion`.

Permission validation:

- owner cannot remove own admin/read/search/write grants;
- public write/admin grants are rejected in v1;
- public read/search grants are allowed only when explicitly requested;
- service accounts can own and access records through the same user id model;
- unauthorized ids return 404, not 403, when returning 403 would reveal
  existence.

## Tests

Add focused API utility tests where possible and browser/API smoke tests where
the current API test runner is the integration surface.

Minimum coverage:

- type create/list/update/delete requires auth where expected;
- anonymous caller sees only public types and public records;
- user B cannot read, search, update, delete, or change permissions for user A
  private record;
- granted user can read/search but cannot write until write grant exists;
- encrypted field persists as envelope data, not plaintext;
- encrypted exact/term search matches only through blind index tokens;
- search never returns records outside `acl.searchKeys`;
- direct id reads return 404 for unauthorized users;
- deletion hides records from read/list/search;
- docs endpoints exist for every new CRUD route;
- Nitro route import map includes every new route.

Use the existing `remix/app/tests/api/apiTests.ts` pattern for smoke coverage
and add lower-level tests around `permissions.ts`, `encryption.server.ts`, and
`search.ts` if the repo's test runner supports direct utility tests at that
point.

## Rollout Phases

1. Foundation
   - Add types, permission helpers, schema validation, collection getters, and
     indexes.
   - Add docs-only API entries for the proposed endpoints if implementation is
     split.

2. Encryption
   - Add env-key loading, AES-GCM envelope helpers, blind-index helpers, and
     tests with fixed test keys.
   - Add README placeholder setup for local/fork-safe configuration.

3. Type CRUD
   - Implement type create/list/update/delete and API docs.
   - Verify route registration through `/api/v1/crud/types-docs`.

4. Record CRUD
   - Implement create/read/list/update/delete using type schema validation,
     encryption policies, and ACL helpers.
   - Add projections and optimistic `version` handling.

5. Permission Management
   - Implement record ACL mutation endpoint.
   - Add tests proving owner/admin boundaries and no public write/admin grants.

6. Search
   - Implement GET/POST search with permission-first Mongo filters.
   - Add exact/term search for encrypted fields via blind index tokens.
   - Keep encrypted snippets omitted in v1.

7. Product Integration
   - Wire UI only after API behavior is stable.
   - UI should consume the API exclusively and use Lopu notifications for
     user-facing errors.

8. Hardening
   - Add audit-event writes for create/update/delete/permission changes.
   - Add key rotation command/path.
   - Add admin diagnostics that report key availability without exposing key
     material.

## Acceptance Checklist

- Every new endpoint is registered in the route module map, API docs, and Nitro
  route list.
- All mutation routes use `getCurrentUser()` and `readJsonBody()` with a byte
  cap.
- All data access goes through API utilities; no UI, script, or test writes
  directly to Mongo.
- Unauthorized direct reads return 404.
- List and search queries include permission filters before returning any
  records.
- Encrypted fields are not stored as plaintext and do not appear in public
  projections unless decrypted for an authorized read.
- Search over encrypted fields uses blind indexes and documents the leakage
  tradeoff.
- README documents placeholder encryption env setup.
- `FUNDAMENTALS.md` documents new collections after implementation.
- API tests cover auth, permissions, encryption storage, search filtering, and
  docs route existence.
