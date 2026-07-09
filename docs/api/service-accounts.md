# Service Account Provisioning API

Allowlisted Thingtime admins can create service accounts for apps and backend
services. The route returns an expiring bearer token for API access.

## Endpoint

```http
POST /api/v1/auth/service-account
```

## Email verification

This endpoint requires an authenticated admin session or bearer token. Configure
admins with `THINGTIME_ADMIN_USER_IDS` (preferred), `THINGTIME_ADMIN_EMAILS`, or
`THINGTIME_ADMIN_USERNAMES`. The Mongo `_id` behind `THINGTIME_ADMIN_USER_IDS` is
server-assigned and non-claimable, so it is the safest anchor; email/username
allowlists are honoured only for an account that has verified its email (a
username allowlist additionally trusts whoever registers that handle first, so
reserve it for accounts known to already exist). It also requires a unique, valid
email address for the service account being created.

Thingtime sends an email-verification link when the service account is created.
The account must verify that email within seven days. The returned bearer token
is time-bounded, and while the account is unverified it is accepted only during
the seven-day grace window. After `verificationRequiredBy` or `expiresAt`,
authenticated requests for the service account are rejected.

Service tokens are time-bounded. `THINGTIME_SERVICE_TOKEN_TTL_DAYS` defaults to
30 days and is capped at 90 days.

## Request

```json
{
  "serviceName": "CodexTime",
  "username": "codextime",
  "email": "codextime-service@example.com",
  "displayName": "CodexTime",
  "meta": {
    "source": "codextime"
  }
}
```

Fields:

| Field | Required | Notes |
| --- | --- | --- |
| `serviceName` | No | Used as the display/service label. Required when `username` is omitted. |
| `username` | No | Lowercased and slugged. Required when `serviceName` is omitted. |
| `email` | Yes | Must be unique and syntactically valid. |
| `displayName` | No | Defaults to `serviceName`, then `username`. |
| `password` | No | Optional interactive password. If omitted, Thingtime generates one and does not return it. |
| `meta` | No | Extra service metadata stored on the user record. |

## Response

```json
{
  "ok": true,
  "user": {
    "id": "6688f0f00000000000000000",
    "ttid": "codextime",
    "username": "codextime",
    "email": "codextime-service@example.com",
    "displayName": "CodexTime",
    "emailVerified": false,
    "createdAt": "2026-07-04T00:00:00.000Z",
    "accountKind": "service",
    "emailVerificationRequiredBy": "2026-07-11T00:00:00.000Z",
    "storageAllowanceBytes": 5368709120,
    "storageUsedBytes": 0
  },
  "accessToken": "<jwt-with-exp-claim>",
  "tokenType": "Bearer",
  "expiresAt": "2026-08-03T00:00:00.000Z",
  "verificationRequiredBy": "2026-07-11T00:00:00.000Z",
  "storageAllowanceBytes": 5368709120
}
```

Local and Vercel preview responses may include `verificationLink` for developer
testing. Production sends the link by email only.

The access token is a normal Thingtime bearer token:

```http
Authorization: Bearer <accessToken>
```

Service tokens are expiring JWTs. Revocation still goes through Mongo:
Thingtime checks the token `jti` against the `sessions` collection on each
authenticated request. Revoke a token early by revoking or deleting its backing
session document.

## Frontend and client usage

Browser frontends can call the provisioning endpoint for account setup, but the
returned `accessToken` is powerful backend access and should not be stored in
browser local storage or exposed to users. Prefer creating the service account
from your app backend, storing the returned `accessToken` in that backend's
secret store, and having the backend call Thingtime APIs with:

```http
Authorization: Bearer <accessToken>
```

If a frontend needs to browse data through Thingtime, expose only your own app's
normal user-safe views or use future Thingtime data endpoints that enforce the
service account token server-side.

## Managing external app data (extensible datastore)

Service accounts can use Thingtime as a general-purpose datastore for another
app — schemas are optional. The pattern:

1. Create one bare data type (no fields) for your app:

   ```http
   POST /api/v1/crud/types
   Authorization: Bearer <accessToken>

   { "key": "myapp_data", "name": "MyApp data" }
   ```

2. Store any JSON structure on records under the schema-free `extended`
   property — Thingtime wraps it in platform metadata (share id, ACLs,
   versioning, soft deletes) and never validates or interprets it:

   ```http
   POST /api/v1/crud/records
   Authorization: Bearer <accessToken>

   { "typeId": "<type id>", "extended": { "any": "shape", "nested": [1, 2, { "deep": true }] } }
   ```

3. Read/list/page with `GET /api/v1/crud/records?id=...` or
   `?typeId=...&cursor=...`, update with `POST /api/v1/crud/records/update`
   (`extended` is replace-on-write; `null` clears it), delete with
   `POST /api/v1/crud/records/delete`, and share with other subjects via
   `POST /api/v1/crud/records/permissions` (`user:<id>`, `service:<id>`,
   `public`).

`extended` is capped at 512KB per document and is not searchable. When parts of
your data need validation, per-field encryption, or search, declare those parts
as schema fields on the type — schema'd `values` and free-form `extended`
compose on the same record. Full endpoint docs live at
`/api/v1/crud/records-docs` and `/api/v1/crud/types-docs`.
