# 🌈 Welcome 👋 to Thingtime 🦄 🧠

https://thingtime.com

Thingtime is a powerful platform for storing and sharing information of all kinds. Whether you want to keep track of your personal notes, collaborate on a project with your team, or build a new app that relies on rich data, Thingtime has you covered.

With Thingtime, you can create and share any abstract data structure you want, or store any practical piece of information and share it for people and machines to use equally. Thingtime is not only a platform, but also an ecosystem that empowers developers and users alike to build, share, and utilize all kinds of data and knowledge.

At Thingtime, we believe that data and knowledge should be open, accessible, and empowering. We are building Thingtime to make this vision a reality. Join us and start exploring the limitless possibilities of data!

# 💹 Donate on Indiegogo to save humanity 🩷

### You can get Merch 🌈 + other benefits 🦄💯

https://www.indiegogo.com/projects/thingtime-a-gui-for-the-internet/coming_soon

## Or Donate on GoFundMe 💖

https://www.gofundme.com/f/thingtime

### Force Push ? 👉👈

# Setup for Forks

Thingtime can run with mostly public configuration, but a few integrations need
private environment variables in local development or on Vercel.

## Remix app

The Remix app lives in `remix/`.

Install and run from the Remix directory:

```sh
cd remix
corepack pnpm install
corepack pnpm run dev
```

Local branch metadata is managed automatically by `remix/scripts/pre-dev.sh`.
That script updates `remix/.env.auto`; do not edit that generated block by hand.

## MongoDB

MongoDB powers the app status checks and database-backed API routes.

Set these variables in `remix/.env` for local development, and in your Vercel
project environment variables for deployed previews/production:

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

## Public env exposure rule

Only variables with the `THINGTIME_` prefix are intentionally copied into the
browser-visible loader data, and variables containing `PRIVATE` are excluded.
Keep secrets such as MongoDB passwords and Vercel API tokens unprefixed and
server-only.
