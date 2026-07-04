# Service Account Provisioning API

Apps and backend services can create Thingtime service accounts and receive a
non-expiring bearer token for API access.

## Endpoint

```http
POST /api/v1/auth/service-account
```

## Email verification

This endpoint is self-service and does not require a provisioning secret. It
does require a unique, valid email address.

Thingtime sends an email-verification link when the service account is created.
The account must verify that email within seven days. The returned bearer token
is non-expiring, but while the account is unverified it is accepted only during
the seven-day grace window. After `verificationRequiredBy`, authenticated
requests for the service account are rejected until the email is verified.

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
  "accessToken": "<jwt-without-exp-claim>",
  "tokenType": "Bearer",
  "expiresAt": null,
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

Service tokens are non-expiring JWTs. Revocation still goes through Mongo:
Thingtime checks the token `jti` against the `sessions` collection on each
authenticated request. Revoke a token by revoking or deleting its backing
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
