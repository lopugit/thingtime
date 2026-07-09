# Service Account Provisioning API

Allowlisted Thingtime admins can create service accounts for apps and backend
services. The route returns an expiring bearer token for API access.

## Endpoint

```http
POST /api/v1/auth/service-account
```

## Email verification

This endpoint requires an authenticated admin session or bearer token. Configure
admins with `THINGTIME_ADMIN_USER_IDS`, `THINGTIME_ADMIN_USERNAMES`, or
`THINGTIME_ADMIN_EMAILS`. It also requires a unique, valid email address for the
service account being created.

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
