# Vercel cost reduction: getting back to $0.50–$2 a day

Grounded 2026-11-25. Read-only investigation; nothing was changed in Vercel,
GitHub or production.

## Summary

The Vercel bill rose from about **$0.15–$2.30 a day in September** to **$10–15 a
day around 4–5 November**. It has since settled at about **$3–4 a day**.

The cause is not the Vercel cron jobs. There are only nine of them, each once a
day, and Vercel cron was disabled on 21 November. Scheduled jobs now run through
the hourly GitHub workflow `thingtime-scheduled-jobs.yml`.

The cost comes from **steady machine traffic from Thingtime's own devices and
open pages**. Since 12 October it has never stopped. The main sources are:

- Mac app sync and command long-polls
- device telemetry
- Watch pairing polls
- notification, chat and timeline polling
- two endpoints that fail on almost every call

Fluid compute charges memory (**Fluid Provisioned Memory**) for every hour an
instance stays alive. Continuous polling means instances never scale to zero.
That is the large blue bar on every day since 5 November.

The provisioned-memory floor must go first. After that, Vercel Agent and
Observability Plus are separate settings that can be switched off.

## Evidence

### Daily function invocations (Vercel billing API, `thingtime` project)

| Period          | Typical invocations/day                           | Dashboard cost/day |
| --------------- | ------------------------------------------------- | ------------------ |
| Quiet Sep/early Oct days (24–25 Sep, 28 Sep, 30 Sep–11 Oct) | **6K–14K** | $0.13–$0.35 |
| Busy September days (21–23 Sep, 26–27 Sep) | 250K–380K                               | about $2–3   |
| 12 Oct onward: never back to quiet | 100K–520K                                        | rising         |
| 3–5 Nov peak    | 473K, **892K**, 741K                              | $10–15         |
| 17–23 Nov       | 130K–156K (steady floor)                          | about $3–4     |

Other team projects are negligible: pokeworld and techattack together made
about 5K invocations over the whole period.

### Breakdown of the 4 November peak (dashboard tooltip, $14.28)

| Product                  | Usage       | Cost  | Implied syd1 rate |
| ------------------------ | ----------- | ----- | ----------------- |
| Fluid Provisioned Memory | 303 GB-hrs  | $4.49 | ~$0.0148/GB-hr    |
| Fast Origin Transfer     | 10 GB       | $2.69 | ~$0.27/GB         |
| Observability Events     | —           | $2.44 | Observability Plus |
| Vercel Agent             | —           | $2.17 | AI PR reviews     |
| Fluid Active CPU         | 10 hours    | $1.87 | ~$0.19/hr         |
| Function Invocations     | 892K        | $0.54 | $0.60/M           |

An instance kept alive all day costs about 48 GB-hrs, roughly **$0.71/day**,
at the 2 GB size. 303 GB-hrs is about six instances alive around the clock.
Average memory use is only **307 MB of the 2.05 GB** each instance is billed for.

### Hottest routes, last 7 days (Vercel Observability → Functions)

994K invocations; 2.6% errors. `/api/[...]` handled 680K with a P75 of
**2.96 s**. `/__server` handled 317K at 5 ms each.

| Path                                   | 7-day calls | ≈/day | P75     | Note |
| -------------------------------------- | ----------- | ----- | ------- | ---- |
| `/api/v1/devices/sync-control`         | 193K        | 27.6K | 3.17 s  | Mac folder sync control (`electron/lib/folder-sync.cjs`); about every 3 s, continuously |
| `/api/v1/timeline`                     | 85K         | 12K   | 1.69 s  | slow and frequent |
| `/api/v1/devices/node/observations`    | 72K         | 10.3K | 584 ms  | Mac Thingtime Node telemetry, about every 8 s |
| `/api/v1/notifications`                | 44K         | 6.3K  | 470 ms  | web bell (15 s) and iOS timer (30 s) |
| `/api/v1/watch/pairing`                | 42K         | 6K    | 4.46 s  | Watch pairing poll |
| `/api/v1/auth/me`                      | 41K         | 5.9K  | 606 ms  | identity re-reads |
| `/api/v1/devices/node/identity`        | 39K         | 5.6K  | 227 ms  | Mac node identity |
| `/api/v1/chats/updates`                | 34K         | 4.9K  | 2.52 s  | Messenger (4 s active, 25 s idle) |
| `/api/v1/integrations/github/webhook`  | 25K         | 3.6K  | 872 ms  | GitHub webhooks (CI control plane) |
| `/api/v1/devices/node/state`           | 24K         | 3.4K  | 2.03 s  | **99.2% errors** — broken retry loop |
| `/api/v1/devices/node/commands`        | 24K         | 3.4K  | **25 s**| long-poll (`waitMs` up to 20 s); one request is always open |
| `/api/v1/network-probe/ping`           | 18K         | 2.6K  | 2.26 s  | |
| `/api/v1/health/{nitro,frontend,vercel,mongodb}` | ~2.2K each | ~320 | up to 6 s | caller unknown; about every 4.5 min |
| `/api/v1/{peers/sync,lopu/recordings/run,backups/run}` | ~2.3K each | ~330 | ~2 s | daily jobs called about 14×/hour; `peers/sync` has **94.9% errors** |

Adding up `duration × calls` gives about **70 hours of request wall time a
day**. The `node/commands` and `sync-control` loops alone each keep one request
open all day. Any instance that is always serving a request is never reclaimed.

### Configuration observations

- `vercel.json` pins deployments to `syd1` with `fluid: true`. However, the
  project default `functionDefaultRegions` lists **five regions** (`cpt1`,
  `gru1`, `sfo1`, `fra1`, `syd1`). If the `vercel.json` pin is ever removed,
  each region would keep its own warm instances.
- The project's default function timeout is **300 s**.
- Behind Cloudflare, `thingtime.com` returns `x-vercel-cache: MISS`. The SPA
  shell goes through the `/__server` function (317K calls a week) instead of
  being served statically.
- Fast Origin Transfer peaked at 10–13 GB/day on 13–15 Nov while invocations
  were modest. That pattern fits file bytes from device sync and uploads
  passing through functions.
- The team shows **Overdue / payment failed**. The production alias
  `thingtime.com` is on this Pro team, on deployment `dpl_F8gN…` from 10 Nov.
  Newer production deployments are not aliased.

## Plan to reach $0.50–$2/day

The ordering puts the biggest saving per unit of effort first. The estimates
use the syd1 rates above.

### Tier 0 — dashboard switches (minutes, no code)

1. **Turn off Vercel Agent PR reviews** (Team → Settings → Vercel Agent). The
   repo's CI already reviews PRs. Saves an average of $0.2–0.6/day, and
   $2–2.6/day on busy PR days. It cost $19.61 over this period.
2. **Turn off Observability Plus after the fixes below are verified.** It cost
   $0.3–2.4/day plus the monthly base. Keep it until Tier 1 lands, because the
   route breakdown above depends on it.
3. **Set project function regions to `syd1` only, and lower the default
   timeout** to about 30–60 s. This is a safety net so a config regression
   cannot multiply instances, and runaway requests stay short.
4. **Check the function size.** Usage is about 300 MB against a 2 GB
   allocation. If the plan offers a smaller size, provisioned memory falls in
   proportion.

### Tier 1 — stop the always-on traffic (the main win, code)

Goal: when nobody is actively using Thingtime, production should see fewer than
about **10–20K invocations a day and no continuously open request**, as in
September.

1. **Mac Thingtime Node command long-poll** (`ThingtimeAPIClient.swift`,
   `devices/node/commands`, 20 s wait, never idle). Drop to a slow idle cadence
   (for example 2–5 minutes) and only long-poll while a command or approval is
   expected. Alternatively, use push or a non-serverless realtime channel.
   Long-polls on per-GB-hour serverless are the most expensive pattern there is.
2. **Folder-sync control loop** (`electron/lib/folder-sync.cjs` →
   `devices/sync-control`, about every 3 s, 3.2 s each). Make it event-driven.
   Run it on local file changes and when a remote change is signalled, with
   exponential idle backoff to minutes.
3. **Node observations** (about every 8 s). Batch locally and upload every
   5–15 minutes or on meaningful change: 10K/day becomes about 100–300.
4. **Fix the failing loops**: `devices/node/state` (99.2% errors) and
   `peers/sync` (94.9%). These are pure waste, and `node/state` takes 2 s per
   failure.
5. **Watch pairing** (4.5 s, 6K/day). Poll only while the pairing UI is open,
   then stop.
6. **Web polling** (notifications bell 15 s, Messenger 4 s/25 s, CI dashboard
   5 s, VercelStatus 5 s, timeline). Pause when `document.visibilityState` is
   hidden, back off when idle, and use ETag/`304` so a poll is cheap.
   Agent-owned browsers that leave Thingtime tabs open multiply this.
7. **Identity re-reads** (`auth/me` + `node/identity`, about 11.5K/day). Cache
   them, and refresh on focus, expiry or account change only.
8. **Serve the SPA shell statically** (`/__server`, about 45K/day). Route
   non-API paths to the static `index.html` after the `filesystem` handle, so
   page loads stop invoking a function.
9. **Find the ~14/hour caller** of the health and scheduled-job endpoints. The
   hourly GitHub workflow explains only about 1 an hour. Reduce it to hourly or
   less. `claimScheduledDay` already makes the extra calls no-ops, but they
   still keep instances warm.
10. **GitHub webhooks** (3.6K/day). Unsubscribe from event types the CI
    controller does not consume.

### Tier 2 — data transfer

- Send device-sync, upload and download bytes directly to object storage with
  presigned URLs, so file bytes never pass through functions. Fast Origin
  Transfer is about $0.27/GB in syd1.
- Keep `timeline` and list responses paginated and compact. Polling responses
  should return `304` when nothing has changed.

## Expected outcome

| State                                     | Est. cost/day |
| ----------------------------------------- | ------------- |
| Now (17–23 Nov)                           | ~$3–4 (spikes $10–15) |
| Tier 0 only                               | ~$2.5–3.5, with the Agent/Observability spikes removed |
| Tier 0 + Tier 1 items 1–4 (Mac loops + broken retries) | ~$1–2 |
| All tiers, quiet day                      | ~$0.3–1 (the September quiet-day level) |
| All tiers, busy development day           | ~$1–2 |

## Hobby migration dependency

Thingtime is being prepared for a Vercel Hobby account. Vercel publishes a Hobby
allowance of about **360 GB-hrs of provisioned memory a month**. At the current
floor of about 130–300 GB-hrs a day, that would run out in about two days.
Tier 1 is therefore a prerequisite for Hobby, not only a cost saving. Check the
current Hobby limits before switching.

## Method and sources

- `GET /v1/billing/charges` (FOCUS export) for the team, 2026-09-17 to
  2026-11-24. Used for the daily `thingtime` invocation, CDN request,
  Fast Data Transfer and Vercel Agent series.
  This export does not include Fluid Provisioned Memory, Active CPU, Fast
  Origin Transfer or Observability Events. Those figures come from the usage
  dashboard screenshots.
- The Vercel Observability → Functions and `/api/[...]` path views for the
  7 days to 2026-11-25.
- `GET /v9/projects/thingtime` and `/v13/deployments/*` for regions, timeout,
  crons and production alias.
- Source: `vercel.json`, `.github/workflows/thingtime-scheduled-jobs.yml`,
  `remix/app/api/utils/automation/{scheduledJobs,scheduledDispatch}.ts`,
  `remix/app/api/utils/devices/deviceCommands.ts`,
  `macos/ThingtimeNode/Sources/ThingtimeNodeCore/ThingtimeAPIClient.swift`,
  `electron/lib/folder-sync.cjs`, and the polling constants in
  `remix/app/components/**`.

## Open questions

- Which process makes the ~14/hour health and scheduled-job calls?
- Is the `sync-control` P75 of 3.2 s a deliberate wait or slow work?
- Where exactly does the 3 s folder-sync loop live? It was not pinned to a
  constant.
- Does Fluid on this plan offer a function size below 2 GB?
