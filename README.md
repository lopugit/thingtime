# 🌈 Welcome 👋 to Thingtime 🦄 🧠

https://thingtime.com

Thingtime is a powerful platform for storing and sharing information of all kinds. Whether you want to keep track of your personal notes, collaborate on a project with your team, or build a new app that relies on rich data, Thingtime has you covered.

With Thingtime, you can create and share any abstract data structure you want, or store any practical piece of information and share it for people and machines to use equally. Thingtime is not only a platform, but also an ecosystem that empowers developers and users alike to build, share, and utilize all kinds of data and knowledge.

At Thingtime, we believe that data and knowledge should be open, accessible, and empowering. We are building Thingtime to make this vision a reality. Join us and start exploring the limitless possibilities of data!

## AI agent instructions

Repository-wide AI guidance lives in the single canonical `AI_ALL.md`.
`AGENTS.md` and `CLAUDE.md` are relative symlinks to that file so Codex,
Claude, and other compatible tools read the same instructions. Update
`AI_ALL.md` only; keep both symlinks intact.

## GitHub Actions control plane

Thingtime keeps executable CI/CD behavior on the long-lived, protected
`github-actions` branch. Product branches (`main`, `develop`, feature branches,
and promotion branches) retain only seven small event listeners in
`.github/workflows/`: GitHub must be able to discover a workflow file on the
ref/default branch that receives a native `push`, `pull_request_target`,
`schedule`, `repository_dispatch`, or `workflow_dispatch` event. Each listener
contains triggers, caller permissions, and typed inputs only; its sole job calls
the matching reusable workflow at
`lopugit/thingtime/.github/workflows/<name>.yml@github-actions`.

All runner selection, shell commands, third-party actions, AI/model routing,
Git operations, Graphify refreshes, and workflow scripts live only on
`github-actions`. The product branches intentionally contain no `.github/actions`
or `.github/scripts` behavior. `remix/scripts/workflow-caller-contract.mjs`
fails if executable behavior leaks back into a listener or one stops pinning the
control-plane ref.

Protect `github-actions` with a ruleset: require pull-request review for changes,
block force pushes and deletion, and restrict direct updates. A push to that
branch runs its own control-plane contract CI. Updating the implementation no
longer requires separately merging the same behavior into `develop` and `main`;
the thin listeners on both branches call the same reviewed revision immediately.

The Admin → CI Control dashboard adds the external observation/operation layer:
signed GitHub and Vercel webhooks project repositories, features/stacks,
branches, pull requests, Actions runs, deployments, previews, audited dispatches,
and append-only status history into protected Things. The GitHub App is also
used for explicit reconciliation and allowlisted workflow dispatch. Native
listeners remain the automatic trigger path, so a webhook outage cannot silently
turn off conflict resolution or CI; the dashboard makes drift and stale delivery
state visible. Administrator dispatches enter only through the reviewed
`develop` or `main` listener selected for that workflow; neither the UI nor API
can load workflow YAML from an arbitrary feature branch.

Configure the server-side integration with private environment variables only
(never `PUBLIC_*`):

```sh
THINGTIME_GITHUB_REPOSITORY="owner/repository"
THINGTIME_GITHUB_APP_ID="123456"
THINGTIME_GITHUB_APP_INSTALLATION_ID="12345678"
THINGTIME_GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
THINGTIME_GITHUB_WEBHOOK_SECRET="replace-with-a-long-random-secret"
THINGTIME_VERCEL_WEBHOOK_SECRET="secret-returned-when-the-webhook-is-created"
```

Create a repository-installed GitHub App with repository metadata read,
Actions read/write (for workflow dispatch), Contents read (branches), Pull
requests read, and Deployments read. Subscribe its webhook to `push`, branch
create/delete, pull request, workflow run, workflow job, deployment, and
deployment status events, using:

```text
https://<your-thingtime-origin>/api/v1/integrations/github/webhook
```

Create a project-scoped Vercel webhook for deployment created/ready/error/
canceled/deleted events at:

```text
https://<your-thingtime-origin>/api/v1/integrations/vercel/webhook
```

Store each secret directly in the deployment environment. The Admin API reports
only whether an integration is configured; it never returns credentials.

# 💹 Donate on Indiegogo to save humanity 🩷

### You can get Merch 🌈 + other benefits 🦄💯

https://www.indiegogo.com/projects/thingtime-a-gui-for-the-internet/coming_soon

## Or Donate on GoFundMe 💖

https://www.gofundme.com/f/thingtime

### Force Push ? 👉👈

Thingtime has two deliberately separate conflict workflows:

- **Resolve PR conflicts (AI)** merges a PR's base branch into its head branch.
- **Rebase PRs and stacks (AI)** rebases the PR head and, when the PR is part
  of a stack, continues from the stack root toward its leaves.

Both workflows cover every same-repository PR regardless of its base branch.
The merge workflow listens to pushes on `"**"` and checks open PRs both
targeting and originating from the pushed branch. A staggered twice-hourly
all-PR sweep catches conflicts whose original event was missed or ran from an
older branch without the latest workflow. Their ownership is intentionally
disjoint: standalone merge conflicts go to the merge workflow; standalone PRs
that merge cleanly but cannot rebase, plus stack members whose current history
needs a merge or rebase update, go to the rebase workflow. Adding
`no-ai-rebase` opts a merge-conflicting stack member back into the merge-based
resolver instead.

The rebase workflow covers the case GitHub reports as `mergeable: true` but
`rebaseable: false`: a plain merge needs no help, yet replaying the branch's
commits onto its base stops at a conflict. It automatically scans same-repo
PRs after branch pushes and PR `opened`/`reopened` events, with a scheduled
all-PR scan as a backstop because GitHub emits no dedicated event when its
**Rebase stack** button fails. A standalone PR is replayed onto its base; a
detected stack is rebased root-to-leaf, so each child is replayed onto the
rewritten parent rather than onto the parent's old SHA.

To run it directly, open **Actions → Rebase PRs and stacks (AI) → Run
workflow** on the default branch, enter the PR number, and leave cascading
enabled when the PR has children. Leaving the number blank scans all open
same-repository PRs. Manual dispatch is also the recovery path after reviewing
a paused run.

**Resolve PR conflicts (AI)** has the same manual convention: enter a base
branch to scan only that base, or leave it blank to scan every open eligible
PR. Broad scans are API-only detectors; they hand off one trusted
default-branch run per conflicted base, so unrelated bases do not share one AI
job. If a run fails while the same eligible snapshot is still live, it adds
`ai-merge-paused` so the scheduled sweep cannot repeatedly spend AI budget.
The hold is bound to the exact owner, refs, SHAs, and topology recorded in a
bot-only hidden marker: a changed snapshot is eligible again automatically,
while the same snapshot requires review and a named-base manual retry.

The merge workflow also snapshots the exact live head and base SHAs, repeats
its PR/ref/label/stack/protection checks immediately before publication, and
uses an exact head lease. If either branch moves while Claude is working, the
resolved merge is discarded rather than overwriting the newer work.

Detection is patient and audible: GitHub computes a PR's mergeability lazily
after its base moves and verdicts can take minutes to settle, so the merge
detector re-queries until every scanned PR has a verdict (time-budgeted via
`MERGEABLE_POLL_SECONDS`, default 500 seconds — a little over eight minutes)
instead of sampling once at push time. When it must leave a conflicted-looking PR alone — a fork PR it
cannot push to, or a verdict that never settled — it upserts one status
comment on the PR saying exactly that, so a silent PR means "nothing needed
doing", never "nobody looked". Conflicts that are handed off announce
themselves through the resolve job's "Auto-resolve running" comment.

**Rebase PRs and stacks (AI)** rewrites PR history, so its force push has
stricter boundaries:

- It operates only on branches in this repository. Fork PRs, the repository's
  default branch, and protected branches are refused.
- Claude receives only regular copies of the exact files stopped in conflict,
  inside a repo-less scratch directory. It never sees the real checkout, Git
  metadata, action implementation, or push credentials, and it has only
  read/edit/write file tools—no shell, Git, search, or network tools. Code
  loaded from the exact trusted default-branch commit
  independently validates the scratch files, conflict set, index, and completed
  rebase before any push.
- Nothing is pushed until the complete rebase succeeds. The final update uses
  an exact `--force-with-lease` against the head SHA inspected at the start, so
  a concurrent human or bot push makes the run fail instead of being erased.
- Add `no-ai-rebase` to opt a PR out of automatic rebasing. A failed automatic
  run adds `ai-rebase-paused` for that exact owner/ref/SHA/topology snapshot,
  preventing a retry loop while the failure is reviewed. A changed snapshot or
  resolver owner invalidates the hold automatically; retry the unchanged
  snapshot with a deliberate manual PR-number run.
  `ai-rebase-in-progress` is the only cross-workflow mutex. Pause labels do not
  decide ownership: a queued retry re-proves the exact refs and owner before
  clearing its specific stale pause. Publication requires pauses to be absent,
  and post-push cleanup preserves any fresh hold created for the new snapshot.
  An orphaned `ai-rebase-in-progress` lock is recovered after 90 minutes, while
  paused, active, or not-yet-computed parents—and protected or opted-out
  parents that still need a rewrite—keep stacked children from running ahead.
- A rewrite authenticated by `GITHUB_TOKEN` explicitly dispatches **Web CI**
  against the new branch SHA when the final PR diff touches `remix/` or its CI
  workflow, because token-authored pushes do not create ordinary Actions runs.

For a fork of Thingtime, enable **Settings → Actions → General → Workflow
permissions → Read and write permissions**, then add one of these repository
Actions secrets:

- `ANTHROPIC_API_KEY`, or
- `CLAUDE_CODE_OAUTH_TOKEN` (created by the Claude CLI GitHub App setup).

`CONFLICT_RESOLVER_PAT` is optional. Add it only if the resolver must rewrite a
branch whose rebase changes files under `.github/workflows/`; the token needs
repository contents access plus permission to update workflows. Keep all
tokens in Actions secrets, scope them to the fork, and never put them in an
environment file or commit. Automatic runs still skip PRs originating from
another repository; the contributor's fork must run its own trusted workflow
if it wants equivalent automation.

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

Admins get the `/admin` dashboard (also under the drawer's Account section):
Users, Apps, Tiers, CI Control, and System management. CI Control presents the
feature/branch/PR/Actions/deployment topology and signed status history, with
allowlisted reconciliation and retry controls. The Tiers tab manages protected,
versioned `subscription-tier` Things in separate Live, Draft / not live, and
Archived sections. Admins can create a tier or draft a new revision, edit its
name, tagline, banner, currency, daily/weekly/monthly/yearly prices, six
computed-or-custom percentage-saved comparisons, Editor.js inclusions, and
quota defaults, then publish or archive without deleting history. User and app
assignments pin the exact immutable revision and quota snapshot, so later tier
changes never silently rewrite an existing customer's plan. The dashboard also
supports per-field quota overrides (`null` = unlimited), platform-level app
suspension, and many-to-many ownership links (assign accounts to an owner so
one login can switch into its service accounts without credentials, and assign
apps to co-managers).

App owners and linked co-managers use `/apps/manage` to see the app's measured
aggregate usage and choose among the current live tier cards (the bootstrapped
catalog starts with Free 5 GiB, Plus 25 GiB, Pro 100 GiB, and metered PAYG).
Cards show the configured banner, renewal prices, savings, and Editor.js
inclusions; selection sends both the stable tier id and exact live revision id.
Managers can also change the inherited per-app-user cap (50 MiB by default) and
assign or reset custom caps for one or many app users. The app Thing is the
aggregate ledger; protected relational `app-storage` Things hold per-user usage
and optional sub-tiers, so neither generic app editing nor an end user can
rewrite the accounting rows.

The live verification suites need a disposable local database. The app-storage
suite is deliberately local-URL-only; the admin suite needs an env-admin's
credentials (placeholders — use your own throwaway admin):

```sh
node remix/scripts/verify-app-storage.mjs http://127.0.0.1:10000
```

```sh
TT_VERIFY_ADMIN_USER="your-admin-username" \
TT_VERIFY_ADMIN_PASS="your-admin-password" \
node remix/scripts/verify-admin-subscriptions.mjs http://127.0.0.1:10000
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

### Notification emails (SES notification stream)

Activity notifications (friend requests, new followers, comments, replies,
reactions, shares — plus an optional weekly summary digest) can also email the
recipient. They ride the same emit calls as the in-app bell, are always
fire-and-forget, only go to verified addresses, and honor the per-user channel
matrix from Settings → Notifications (`/api/v1/notifications/settings`: per
type × channel switches plus a master switch per channel; the two high-volume
post types are email-opt-in). Sends are capped per recipient per hour, and
every email footer carries a manage link plus a one-click unsubscribe link
(`GET /api/v1/notifications/email/unsubscribe?uid=…&token=…`, an HMAC token —
no session needed).

```sh
THINGTIME_EMAIL_NOTIFICATIONS_FROM="Thingtime <no-reply@thingtime.com>"
                                        # optional; falls back to the
                                        # transactional from-address
THINGTIME_EMAIL_UNSUB_SECRET=""         # optional HMAC secret for unsubscribe
                                        # links; falls back to JWT_SECRET /
                                        # JWT_PRIVATE_KEY
CRON_SECRET="<random string>"           # lets the Vercel cron trigger the
                                        # weekly digest run
APP_URL="https://your-deployment.com"   # absolute links in emails
```

The weekly digest is scheduled in `remix/vercel.json` (`crons`) against
`GET /api/v1/notifications/email/weekly-summary`; Vercel attaches
`Authorization: Bearer <CRON_SECRET>` automatically when that env var exists.
Signed-in admins can run the same endpoint manually (`?dryRun=1` or
`POST { dryRun: true }` previews without sending), and the run is idempotent —
a six-day per-recipient lookback in the `email_messages` outbox prevents
double-sends.

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

## Branch automation: develop → main promotion

`develop` is the integration branch; `main` is the release branch. Four
workflows keep them flowing without manual branch surgery, giving two
complementary ways to ship:

- **Promote features to main** (`.github/workflows/promote-features-to-main.yml`)
  scans PRs merged into `develop` and opens one promotion PR per feature
  against `main` (cherry-picked `promote/pr-<n>-<slug>` branches), so every
  change can get a second, release-focused review on its own. PRs that share a
  feature group (a `Promotion-Group: <key>` body line, a `stack:<key>`/
  `group:<key>`/`feature:<key>` label, a `feature/<key>/...` branch, or a
  `feat(<key>): ...` title) are opened as a stacked chain in merge order —
  review and merge bottom-up, deleting each branch on merge. Label a develop
  PR `no-promote` to keep it out of the train; close a promotion PR to reject
  that change for `main` permanently.
- **Promote develop to main** (`.github/workflows/promote-develop-to-main.yml`)
  keeps one standing all-or-nothing PR open (head `develop`, base `main`).
  When everything on `develop` is deemed mergeable, merge it instead of
  merging every feature individually. The two trains never fight: after an
  omnibus merge the per-feature workflow sees the content already on `main`,
  skips it, and automatically closes any open promotion PRs whose diff has
  become empty.
- **Sync main into develop** back-merges `main` after promotions land.
- The AI conflict/rebase workflows keep promotion PRs and stacks mergeable.

Fork setup: everything runs with the default `GITHUB_TOKEN`, but promotion
PRs it creates will not trigger CI, and promotion branches touching
`.github/workflows/**` cannot be pushed. Optionally add a `PROMOTION_PAT`
repository secret (fine-grained token with Contents + Pull requests +
Workflows read/write, placeholder value `github_pat_...`) to lift both limits;
`SYNC_BRANCHES_PAT` / `CONFLICT_RESOLVER_PAT` are honoured as fallbacks.

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

### Trusted `develop`-target PR deployments

A pull request's base branch does not select its Vercel environment. A feature
branch targeting `develop` is therefore still an ordinary Preview unless the
trusted controller in `.github/workflows/develop-pr-preview.yml` explicitly
deploys its exact head SHA to the `develop` Custom Environment. Thingtime now
also assigns the current `develop` runtime variables to generic Preview, so an
ordinary newly built Preview shares the development data/services even without
the controller. The controller remains responsible for the stable
`pr-<number>.previews.dev.thingtime.com` alias, identity/SHA gates, status
comment, and marker-scoped cleanup.

The workflow deliberately uses two stages. Its `pull_request_target` job has no
environment or Vercel secret, checks out no code, and emits only a bounded
`repository_dispatch` payload. The privileged dispatch job runs the controller
from `main` behind the `vercel-develop-pr-control` environment. It proves the
source workflow path/run, repository, same-repository PR, head SHA, action, and
triggering actor through GitHub's API, then re-reads the live PR. Both the PR
author and triggering actor must be explicitly allowlisted, currently hold
write/admin permission, and the non-draft PR must still target `develop`.
Neither GitHub job checks out or executes PR-head code; Vercel performs the
remote build only after those gates pass.

The workflow and its controller script must first be merged to the repository's
default `main` branch. `pull_request_target` loads trusted workflow code from
the default branch, so merely adding the files to a feature branch does not
activate the controller. Thingtime's active `main` `Basic Protection` ruleset
has no bypass: it requires a pull request, resolved review threads, strict Web
CI and CodeQL status checks, and blocks branch deletion and force-pushes. The
tracked CODEOWNERS file requests owner review, but independent CODEOWNER
approval is optional future hardening once a second trusted collaborator can
review controller changes. The controller Environment intentionally has no
required reviewer because that would pause event cleanup and every six-hour
scheduled reconciliation instead of letting them run automatically.

Thingtime's protected GitHub Environment `vercel-develop-pr-control` allows only
the `main` deployment branch. It contains the nine controller variables and a
dedicated project-scoped 90-day Vercel token. The masked unsigned S3 CORS probe
secret is also installed. The secret-free `pull_request_target` stage hands off
to a `repository_dispatch` run in the default-branch context; scheduled runs
also use the default branch, and the workflow refuses a manual dispatch from
any other ref. Forks must use values from their own Vercel project; the examples
are placeholders and must not be committed with live credentials or
identifiers:

```sh
# GitHub Environment secrets
VERCEL_DEVELOP_DEPLOY_TOKEN="<dedicated-Vercel-deployment-token>"
THINGTIME_DEVELOP_S3_CORS_PROBE_URL="https://<exact-develop-bucket>.s3.<region>.amazonaws.com/<probe-object>"

# GitHub Environment variables
VERCEL_PROJECT_ID="<Vercel-project-id>"
VERCEL_PROJECT_NAME="<Vercel-project-name>"
VERCEL_TEAM_ID="<Vercel-team-id>"
VERCEL_TEAM_SLUG="<Vercel-team-slug>"
VERCEL_GITHUB_REPO_ID="<Vercel-linked-GitHub-repository-id>"
VERCEL_CUSTOM_ENVIRONMENT_ID="<Vercel-develop-custom-environment-id>"
DEVELOP_PREVIEW_TRUSTED_ACTORS="<trusted-GitHub-login>[,<trusted-GitHub-login>]"
PREVIEW_ALIAS_SUFFIX="<preview-alias-suffix>"
STABLE_DEVELOP_DOMAIN="<stable-develop-domain>"
```

`VERCEL_CUSTOM_ENVIRONMENT_ID` must contain the exact immutable ID returned for
the `develop` Custom Environment, not the display slug `develop`. The author and
triggering actor must both appear in `DEVELOP_PREVIEW_TRUSTED_ACTORS` and
still hold current write/admin repository permission. Keep the Vercel
environment's branch matcher on the literal `develop` branch. Bind
`dev.thingtime.com` to that Git branch (`gitBranch: develop` and no
`customEnvironmentId` on the domain), not to the entire Custom Environment,
and keep the Custom Environment's own domain list empty. The controller assigns
only the verified PR wildcard alias explicitly. This leaves the stable
development hostname on the real `develop` branch while PRs receive only
`https://pr-<number>.previews.dev.thingtime.com`.

Generic Preview intentionally receives every runtime variable currently
assigned to the `develop` Custom Environment, while retaining its existing
Preview-only filesystem, CI, repository, webhook, and workflow variables. This
includes the development-only APP URL, CRON, JWT, MongoDB, and S3 settings, plus
the AI, SES/email, and Vercel API values that `develop` intentionally shares
with Production. Production MongoDB, JWT, and S3 settings remain separate and
are not assigned to Preview.

For Thingtime, set `PREVIEW_ALIAS_SUFFIX=previews.dev.thingtime.com` and
`STABLE_DEVELOP_DOMAIN=dev.thingtime.com`. Forks should replace both with
domains they control. The masked Environment secret
`THINGTIME_DEVELOP_S3_CORS_PROBE_URL` is required and must be a credential-free
HTTPS object URL on the exact develop bucket, with no query string or presigned
parameters. The controller sends only an unauthenticated CORS `OPTIONS` probe
and fail-closes alias publication if it is not accepted.

`*.previews.dev.thingtime.com` is registered, verified, and detached from
both Git branches and Custom Environments in Vercel. Its remaining Thingtime
DNS setup keeps Cloudflare authoritative for the apex. The **DNS only**
(grey-cloud) CNAME from `*.previews.dev` to `cname.vercel-dns.com` routes wildcard
traffic, while wildcard TLS issuance and renewal require two narrow NS
delegations from `_acme-challenge.previews.dev` to `ns1.vercel-dns.com` and
`ns2.vercel-dns.com`. Do not move the `thingtime.com` apex to Vercel nameservers
or delegate a broader subtree. Dedicate `_acme-challenge.previews.dev` to this
preview wildcard, because that delegation gives Vercel control of certificate
validation for the subtree and can prevent another provider from issuing there.
See Vercel's official
[wildcard-without-Vercel-nameservers guide](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers).
Forks should first add their own wildcard to Vercel and copy every CNAME or
verification record Vercel currently displays for that domain; do not copy
another project's account-specific targets.

The develop S3 bucket permits browser upload CORS from the stable development
origin, the controller-managed PR aliases, and Thingtime's generated Vercel
Preview hostnames. Downloads remain same-origin through Thingtime and the
bucket stays private:

```json
[
	{
		"AllowedHeaders": ["x-amz-checksum-sha256"],
		"AllowedMethods": ["PUT"],
		"AllowedOrigins": ["https://dev.thingtime.com", "https://*.previews.dev.thingtime.com", "https://thingtime-*-lopugits-projects.vercel.app"],
		"ExposeHeaders": [],
		"MaxAgeSeconds": 300
	}
]
```

Activation status as of 2026-08-10: the no-bypass `main` ruleset, protected
Environment, nine controller variables, dedicated 90-day Vercel token, masked
`THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret, shared develop/Preview runtime
scope, generic-Preview OIDC trust, develop bucket CORS, detached Vercel
wildcard, DNS-only wildcard CNAME, narrow ACME NS delegation, and wildcard TLS
are complete for
`*.previews.dev.thingtime.com`. Merge of this controller to `main` and the live
end-to-end checklist remain pending. The installed secrets do not make the
controller live while its workflow is absent from `main`. Do not describe a PR
alias as ready before every remaining gate passes.

CORS is not authorization. The bucket remains private, while the development
AWS role explicitly trusts both Thingtime's `environment:develop` and
`environment:preview` OIDC subjects. Every new ordinary Preview can therefore
read or mutate the same development MongoDB/S3/data plane and use the same
private integration values as `dev.thingtime.com`. Treat all branches Vercel is
allowed to build as trusted development code, use disposable data, and keep
production MongoDB/JWT/S3 credentials out of Preview.

`*.previews.thingtime.com` is reserved for a separate future production-preview
controller. Do not point the develop controller at that suffix, copy the
production S3 role into generic Preview, or let ordinary Vercel feature/fork
previews assume the production AWS role. A production-preview controller must have its
own trusted actors, protected control environment, exact production OIDC trust,
deployment cleanup, CORS probe, and bucket CORS rule before that namespace is
activated.

Every generic Preview and eligible controller deployment intentionally shares
the same development MongoDB, S3 bucket, quotas, and other runtime state as
`dev.thingtime.com`. It is a trusted integration surface, not an isolated
sandbox: use disposable test accounts/data and do not allow Vercel to build
untrusted code in this project. The controller updates one marker comment with
deploying/ready/failure state, moves
the PR alias only after the exact SHA is ready and revalidated, and deletes only
its marker-tagged superseded resources. Close/retarget/draft handling removes
the alias, inactivates the transient GitHub Deployment, and deletes its tagged
Vercel deployments. A six-hour scheduled reconciliation repeats marker-scoped
cleanup after an interrupted or missed event without touching the stable
`develop` deployment; manual dispatch safely revalidates one supplied PR.
See `VERCEL_DEPLOYMENTS.md` and the Develop-target checklist in `TESTING.md` for
the operator runbook.

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
