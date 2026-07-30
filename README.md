# 🌈 Welcome 👋 to Thingtime 🦄 🧠

https://thingtime.com

Thingtime is a powerful platform for storing and sharing information of all kinds. Whether you want to keep track of your personal notes, collaborate on a project with your team, or build a new app that relies on rich data, Thingtime has you covered.

With Thingtime, you can create and share any abstract data structure you want, or store any practical piece of information and share it for people and machines to use equally. Thingtime is not only a platform, but also an ecosystem that empowers developers and users alike to build, share, and utilize all kinds of data and knowledge.

At Thingtime, we believe that data and knowledge should be open, accessible, and empowering. We are building Thingtime to make this vision a reality. Join us and start exploring the limitless possibilities of data!

## Embed Thingtime on any website

Thingtime now builds as a single minified browser file with shared state,
Shadow DOM mounts, an injected popup, and a first-party secure editor/save
window:

```html
<div data-thingtime-mount></div>
<script src="https://thingtime.com/embed/thingtime.min.js"></script>
```

See [the Thingtime Embed SDK guide](docs/THINGTIME_EMBED.md) for declarative and
JavaScript APIs, public persistence, conflict handling, security boundaries,
local development, and build verification.

## AI agent instructions

Repository-wide AI guidance lives in the single canonical `AI_ALL.md`.
`AGENTS.md` and `CLAUDE.md` are relative symlinks to that file so Codex,
Claude, and other compatible tools read the same instructions. Update
`AI_ALL.md` only; keep both symlinks intact.

# 💹 Donate on Indiegogo to save humanity 🩷

### You can get Merch 🌈 + other benefits 🦄💯

https://www.indiegogo.com/projects/thingtime-a-gui-for-the-internet/coming_soon

## Or Donate on GoFundMe 💖

https://www.gofundme.com/f/thingtime

### Force Push ? 👉👈

# Setup for Forks

Thingtime can run with mostly public configuration, but a few integrations need
private environment variables in local development or on Vercel.

## Nitro + React Router app

The web app lives in `remix/` for historical path compatibility, but it now
runs as a React Router non-framework Vite client with Nitro API/server routes.
Vite serves the browser app on port `9999` and proxies `/api` to the Nitro dev
server on port `10000` when local backend env is configured. If the local
MongoDB/auth env is absent, the dev proxy sends `/api` requests to
`https://thingtime.com` instead so a fresh clone can still log in, create
service-account tokens, and use the production-backed API without copying any
private `.env` files.

Local development URLs on Lopu's Mac:

- Local: `http://localhost:9999`
- Tailnet/Funnel: `https://lopus-macbook-pro-2.tail9606f9.ts.net:9999`

The Tailnet/Funnel mapping for Thingtime should proxy
`lopus-macbook-pro-2.tail9606f9.ts.net:9999` to `127.0.0.1:9999`. Vite's
`server.allowedHosts` includes `lopus-macbook-pro-2.tail9606f9.ts.net` so this
host does not trip Vite's blocked-host protection.

Install and run from the app directory:

```sh
cd remix
corepack pnpm install
corepack pnpm run dev
```

For a fresh clone or linked worktree, the equivalent repository-root bootstrap
is:

```sh
npm run worktree-setup
```

The Remix `dev`, `build`, and lint entry points run the same dependency check
automatically. It validates every direct dependency link and uses pnpm's shared
store to repair missing or stale links, so `node_modules` never needs to be
copied from another checkout.

From the repository root, `npm run web-pms` starts or restarts the PM2-managed
dev app `tt-nitro-react-router-9999`. The older `npm run remix-pms` command is
kept as a compatibility alias.

Local branch metadata is managed automatically by `remix/scripts/pre-dev.sh`.
That script writes the untracked, generated `remix/.env.auto`; do not edit that
generated block by hand. On Vercel no file is involved: the branch comes from
the `VERCEL_GIT_COMMIT_REF` system env var at build and runtime.
The local dev launcher loads `remix/.env`, `remix/.env.local`, and
`remix/.env.auto` before spawning Nitro and Vite, so ignored private values like
MongoDB credentials are available to local API status checks without committing
secrets. These files are optional for normal app usage; set them only when you
want to override the default production-backed API fallback or run the backend
self-sufficiently against your own services.

Build and verify the Vercel output with:

```sh
cd remix
corepack pnpm run build
```

The build runs `vite build`, copies the Vite shell into Nitro's server assets,
builds Nitro with `NITRO_PRESET=vercel`, and checks that
`.vercel/output/static/index.html` contains the React shell before trusting the
deployment artifact.

## Electron desktop app

The desktop shell lives in `electron/` and packages the same `remix/` web app
with Electron. It builds the Vite client and Nitro server with
`NITRO_PRESET=node_server`, stages the output in `electron/dist/web`, then
launches the bundled Nitro server on `127.0.0.1` inside the Electron app.

Build the unpacked desktop app from the repository root with:

```sh
pnpm --dir electron install
npm run build-electron
```

For local desktop smoke testing:

```sh
pnpm --dir electron dev
```

The local Electron shell reads `remix/.env`, `remix/.env.local`, and
`remix/.env.auto` before starting Nitro. Keep real MongoDB, auth, Vercel, and AI
tokens in ignored env files or the launch environment only; commit placeholder
examples in docs, not secrets.

## API self-documentation

Every registered Thingtime API endpoint exposes a JSON documentation endpoint
by appending `-docs` to the API path. The docs endpoint accepts both GET and
POST so sandboxed tools can discover the contract without caring which method
the real endpoint uses:

```sh
curl http://localhost:9999/api/v1/auth/service-account-docs
curl -X POST http://localhost:9999/api/v1/auth/service-account-docs -d '{}'
```

Each response includes the original endpoint, accepted methods, auth notes,
step-by-step usage, payload and response examples, and generated curl, wget,
Node.js, Python, and Ruby snippets. The browser reference lives at
`/docs/api`, and the docs smoke tests live in the `/tests` page under the
`Docs` group.

## Extensible data — `extended` + schema-less crystals

Schemas are optional scaffolding, not a cage. Two open surfaces on every thing:

- **`extended`** — every `things` doc carries a schema-free `extended`
  property that accepts **any JSON structure** (512KB/doc cap). Thingtime wraps
  it in the platform envelope (share ids, `tt:` ACLs, timestamps) but never
  validates, structure-indexes, or interprets it. Replace-on-write semantics:
  send `extended` to swap the whole value, `null` to clear it, omit it to leave
  it untouched (deep-merging arbitrary JSON is ambiguous, so we never do).
  It is not structured-searchable — `/search` field conditions can't target it
  — though its string content is indexed by the collection's wildcard text
  index like any field (so keep secrets out of it). One reserved key:
  `tt:textLanguage` (the text index's language override).
- **Schema-less crystals** — `thingtime` is optional on create: a bare
  `POST /api/v1/things { crystal: { any: 'shape' } }` defaults to
  `thingtime: ["data"]`, the bounded free-form crystal, so external apps can
  store structured data without declaring a schema first — and it stays
  searchable by real datatypes on `/search`.

Together they make Thingtime an open datastore: schema'd crystals get
validation and typed search, `extended` carries whatever else your app needs
on the same document. Docs: `/docs/api` → things.

## MongoDB

MongoDB powers the app status checks and database-backed API routes. Local
development does not require MongoDB env by default: when
`MONGODB_CONNECTION_STRING` is missing, Vite and Nitro forward same-origin API
requests to `https://thingtime.com` with the same method, path, query, headers,
cookies, and payload. Upstream auth cookies are rewritten for local HTTP so
zero-env localhost login can persist through the proxy.

Set these variables only when you want this checkout or deployment to serve API
requests from its own MongoDB instead of falling back to Thingtime production:

```sh
MONGODB_CONNECTION_STRING="mongodb+srv://<user>:<db_password>@<cluster>/<database>?retryWrites=true&w=majority"
MONGO_PASS="<password>"
```

`MONGO_PASS` is only required when `MONGODB_CONNECTION_STRING` contains the
literal `<db_password>` placeholder. The app substitutes `MONGO_PASS` into that
placeholder using URL encoding so special characters in the password are safe.

For a local MongoDB instance you can instead use a complete URI with no password
placeholder:

```sh
MONGODB_CONNECTION_STRING="mongodb://localhost:27017/thingtime"
```

## Admin access

Schema-version migrations (`/api/v1/admin/migrations*`), the migrations panel on
`/schemas`, the admin panel, and raw database diagnostics are admin-gated. A
user is an admin when their user doc has `meta.admin: true` (promote/demote via
the admin panel or `POST /api/v1/admin/set-admin`) or their username is in the
bootstrap env allowlist:

```sh
ADMIN_USERNAMES="your-username,another-admin"
```

Env-allowlisted usernames are a permanent override (they can't be demoted from
the UI, so there's always a way back in) and are reserved at registration so
nobody can squat an admin username before you register it.

## Auth and Lopu AI

JWT-backed browser sessions prefer ES256 asymmetric signing so other platforms
can verify Thingtime-issued user tokens without knowing the private signing key.
Configured asymmetric deployments publish the verification key at:

```sh
/api/v1/auth/jwks
```

Use a P-256 private key in PKCS#8 PEM format and a public key in SPKI PEM
format. The env vars accept either full PEM text with escaped `\n` newlines or
base64-encoded PEM, which is easier to paste into Vercel:

```sh
JWT_PRIVATE_KEY="<base64-pkcs8-private-pem>"
JWT_PUBLIC_KEY="<base64-spki-public-pem>"
JWT_KEY_ID="thingtime-es256-1"
JWT_ISSUER="https://thingtime.com"
```

Generate a fresh key pair with:

```sh
node <<'NODE'
const { generateKeyPairSync } = require('node:crypto');

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const encode = (key) => Buffer.from(key).toString('base64');

console.log('JWT_PRIVATE_KEY=' + encode(privateKey.export({ type: 'pkcs8', format: 'pem' })));
console.log('JWT_PUBLIC_KEY=' + encode(publicKey.export({ type: 'spki', format: 'pem' })));
console.log('JWT_KEY_ID=thingtime-es256-1');
console.log('JWT_ISSUER=https://thingtime.com');
NODE
```

The app also exposes a local helper UI at `/crypto`, backed by
`/api/v1/crypto`, for generating ES256 pairs, switching key encodings, checking
private/public key matches, verifying JWTs, and verifying signed messages
before pasting env vars into Vercel.

`JWT_PUBLIC_KEY` is recommended for clarity, but the server can derive it from
`JWT_PRIVATE_KEY` if only the private key is configured. Keep `JWT_SECRET`
temporarily as a legacy HS256 verifier while older browser cookies expire:

```sh
JWT_SECRET="<legacy-long-random-secret>"
```

If neither asymmetric key material nor `JWT_SECRET` is set, preview and
production auth fail closed. Local development can still run without keys using
an insecure dev-only fallback.

The JWKS endpoint supports offline signature, issuer, and expiry verification.
It does not tell external platforms whether the backing Mongo session has been
revoked; add a server-side introspection endpoint before relying on live
revocation checks outside Thingtime.

### Password reset + email 2FA

`POST /api/v1/auth/password-reset` ({ email }) always answers `{ ok: true }` so
account existence can't be probed; when the email matches an account it sends a
single-use one-hour reset link to `/reset-password?token=…`. The confirm step
(`POST /api/v1/auth/password-reset/confirm`) burns the token atomically, sets
the new bcrypt hash, and revokes every live session. Requests are rate-limited
per IP (`auth.passwordReset`). Local dev + Vercel previews surface `resetLink`
in the JSON, mirroring the register route's dev verification link.

Email 2FA is opt-in per account (`GET/POST /api/v1/auth/two-factor`, requires a
verified email — toggle lives in Settings → Security). With it on,
`POST /api/v1/login` stops minting sessions from a password alone: it returns
`{ requiresOtp: true, challenge, expiresAt }` and emails a 6-digit code (only a
sha256 hash is stored, 10-minute TTL, atomically attempt-capped at 5); a second
`POST /api/v1/login { challenge, code }` completes login with a constant-time
comparison. Login attempts are rate-limited per IP (`auth.login`).

### Email delivery (owned email layer)

All outbound email flows through `remix/app/api/utils/email/` — every send
writes an outbox row to `email_messages` first, checks the suppression /
unsubscribe lists, then delivers via AWS SES (or logs to the console in dev).
Auth wrappers in `api/utils/auth/email.ts` (`sendVerificationEmail`,
`sendPasswordResetEmail`, `sendEmailOtp`, `sendNewsletterEmail`) carry dotted
`templateKey`s (`auth.verify_email`, `auth.password_reset`, `auth.email_otp`,
`newsletter.generic`) and purpose metadata.

```sh
THINGTIME_EMAIL_PROVIDER="ses"          # 'console' (default) or 'ses'
AWS_SES_REGION="us-east-1"              # or AWS_REGION
AWS_SES_ACCESS_KEY_ID="<key id>"        # or AWS_ACCESS_KEY_ID
AWS_SES_SECRET_ACCESS_KEY="<secret>"    # or AWS_SECRET_ACCESS_KEY
THINGTIME_EMAIL_TRANSACTIONAL_FROM="Thingtime <no-reply@thingtime.com>"
THINGTIME_EMAIL_NEWSLETTER_FROM="Thingtime Updates <updates@thingtime.com>"
THINGTIME_EMAIL_REPLY_TO="support@thingtime.com"
AWS_SES_CONFIGURATION_SET=""            # or THINGTIME_EMAIL_CONFIGURATION_SET
THINGTIME_EMAIL_FAIL_CLOSED="false"     # fail-open unless "true"
SES_SANDBOX="1"                         # test throttle (1 msg/sec) for /tests
THINGTIME_EMAIL_TEST_RECIPIENT="support@thingtime.com"
```

Use the SES **API** with an IAM key scoped to `ses:SendEmail` — do not create
SES SMTP credentials for the app path. `GET /api/v1/email/config` returns the
sanitized resolved config (never credentials); `POST /api/v1/email/test-otp` is
a dev/preview-only helper for the `/tests` page restricted to the configured
test recipient (or a plus alias of it).

### Service account provisioning

Apps and backend services can create service-owned Thingtime accounts through:

```sh
POST /api/v1/auth/service-account
```

The endpoint is self-service: it does not require a server provisioning secret,
but it does require a unique, valid email address. The account must verify that
email within seven days. Until verification, the bearer token works only during
that grace window; after the deadline, authenticated requests for the service
account are rejected until the email is verified.

```sh
curl -X POST "https://thingtime.com/api/v1/auth/service-account" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceName": "CodexTime",
    "username": "codextime",
    "email": "codextime-service@example.com",
    "displayName": "CodexTime"
  }'
```

The response includes an `accessToken` that the service can use as a normal
Thingtime bearer token:

```sh
Authorization: Bearer <accessToken>
```

Service account tokens are intentionally non-expiring JWTs with revocable Mongo
session records. The session `expiresAt` value is `null`, the JWT has no `exp`
claim, and the account starts with a `storageAllowanceBytes` value of
`5368709120` (5 GiB). The email-verification deadline is returned as
`verificationRequiredBy`. Revoke the token by revoking or deleting its backing
session document.

See `docs/api/service-accounts.md` for the complete request and response shape.

Lopu musings can optionally use Claude and/or OpenAI. Without these keys, the
endpoint serves the built-in fallback library.

```sh
ANTHROPIC_API_KEY="<anthropic-api-key>"
OPENAI_API_KEY="<openai-api-key>"
LOPU_PROVIDER="claude"
```

When an AI key is configured, the musing endpoint uses MongoDB to allow 10
AI-backed musings per detected IP address per rolling hour. Requests over the
limit, or requests made while the rate-limit collection is unavailable, stream
the preset fallback responses instead of calling an AI provider.

## Vercel deployment status

The footer can show live Vercel deployment/build status. It works in a limited
tokenless mode on Vercel, but full status, dashboard links, build state, last
ready time, and active polling need a Vercel REST API token.

Local development, preview deployments, and production deployments expose
`/vercel`, backed by `/api/v1/vercel/deployments`, to scan recent Vercel pages
for the latest deployment per unique branch with timestamps, preview links,
deployment-detail links, current Vercel states, total branches counted, and an
optional display cap using the same server-only token configuration.

Add this as a sensitive Vercel project environment variable:

```sh
VERCEL_API_TOKEN="<vercel-rest-api-token>"
```

Create this token from Vercel account/team token settings, not from the OAuth
App / "Sign in with Vercel" setup page. The token needs access to the Vercel
team and project that own the deployment. A persistent `403` from
`/api/v1/vercel/status` or `/api/v1/vercel/deployments` usually means the token
was created for the wrong account/team, has expired, or lacks project access.

These Vercel variables are optional because the hosted Vercel runtime normally
provides enough deployment metadata automatically, and token-backed deployment
pages read the project name/slug from the Vercel API:

```sh
VERCEL_PROJECT_ID="<project-id>"
VERCEL_TEAM_ID="<team-id>"
VERCEL_DASHBOARD_TEAM_SLUG="<team-or-scope-slug>"
```

Use `VERCEL_DASHBOARD_TEAM_SLUG` when tokenless dashboard links need to point to
a Vercel team slug that differs from the GitHub repository owner.

Vercel automatically provides variables such as `VERCEL`, `VERCEL_ENV`,
`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_GIT_COMMIT_REF`, and
`VERCEL_GIT_COMMIT_SHA` during deployments.

The footer environment selector can compare public origins for this tab, local,
development, staging, and production. These values are browser-visible
`THINGTIME_` values, so use public origins only and never include tokens,
passwords, or other secrets:

```sh
THINGTIME_PRODUCTION_STATUS_ORIGIN="https://thingtime.com"
THINGTIME_DEV_STATUS_ORIGIN="https://dev.thingtime.com"
THINGTIME_STAGING_STATUS_ORIGIN="https://staging.thingtime.com"
THINGTIME_LOCAL_STATUS_ORIGIN="http://localhost:9999"
```

Unset values fall back to `https://thingtime.com`, `https://dev.thingtime.com`,
`https://staging.thingtime.com`, and `http://localhost:9999`.

## Public env exposure rule

Only variables with the `THINGTIME_` prefix are intentionally copied into the
browser-visible loader data, and variables containing `PRIVATE` are excluded.
Keep secrets such as MongoDB passwords and Vercel API tokens unprefixed and
server-only.

## Native iOS TestFlight web URL

The native iOS app lives in `iOS/` and defaults its embedded `WKWebView` to
`https://thingtime.com`. TestFlight builds can target a Vercel branch or preview
deployment by setting a non-secret build-time URL:

```sh
export THINGTIME_WEB_URL="https://<vercel-branch-preview-host>"
```

For repeatable local uploads, copy `iOS/.env.example` to `iOS/.env`, fill in the
TestFlight values, and run:

```sh
iOS/scripts/testflight-beta.sh
```

`iOS/.env` is ignored by git. The value is baked into that uploaded app build;
future web changes on the same Vercel branch URL do not require a new iOS
binary.
