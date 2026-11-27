# Vercel memory and CI webhooks

Status: active (2026-11-26). Evidence: [hosting options note](../NOTES/hosting-options-2026-11-26.md).

## Why memory is the bill

- Vercel Fluid functions on Pro come in two sizes only: 2 GB / 1 vCPU (ours)
  or 4 GB / 2 vCPU ([docs](https://vercel.com/docs/functions/configuring-functions/memory)).
  `vercel.json` cannot set memory. On 26 Nov a throwaway Build Output API
  deployment with `.vc-config.json` `memory` 1024 and 512 still ran each
  function in the same ~2.2 GB instance, so smaller sizes are not available.
- Provisioned memory is billed at 2 GB for every second an instance has at
  least one request in flight, and stops when the last one finishes
  ([pricing](https://vercel.com/docs/fluid-compute/pricing)). One instance
  serves many requests at once; it is not one server per request.
- Our requests use about 300–330 MB on average. The cost comes from how long
  requests stay open, not from how much memory each one uses.
- Billing day 25 Nov (≈19:00–19:00 AEDT): 96.9 GB-hr, $1.44 of the $2.25 day.
  That is about two instances busy around the clock.

Last-hour snapshot, 26 Nov ~17:00 AEDT (`/api/[...]`): 1.8K calls, average
6 s, P95 21 s.

| Path | Calls | P75 |
|---|---|---|
| `integrations/github/webhook` | 572 | 2.12 s |
| `things` | 259 | 1.12 s |
| `auth/me` | 218 | 1.64 s |
| `actions/run` | 196 | 1.19 s |
| `chats/updates` | 126 | 7 s |
| `devices/node/state` | 109 | 2.25 s |

## Milestones

### M0 — skip CI detail before any write (this PR)

The GitHub webhook answers job, workflow-run, deployment and PR-label
deliveries with 200 `accepted:false` before touching the database, unless the
Admin → Automation switch `ci.webhookDetail` is on (off by default). PR state
changes, pushes, branch create/delete and Feature Stack runs are still
recorded. Done when Observability shows the webhook's P75 in tens of
milliseconds.

### M1 — stop the deliveries at GitHub (owner sign-in needed)

GitHub App **Thingtime CI Control** → Webhook. Untick *Workflow jobs*,
*Workflow runs*, *Deployments* and *Deployment statuses*. Keep *Pull
requests*, *Push*, *Create* and *Delete*. Untick *Active* to stop every
delivery. GitHub asks for a passkey or GitHub Mobile confirmation first. M0
makes each delivery cheap; M1 removes the requests themselves. Target: fewer
than 1,000 deliveries a day.

### M2 — pull CI state in batches instead of pushing every event

- Admin → CI Control runs Reconcile once when the dashboard opens. That is one
  batched GitHub read of branches, PRs, 100 runs and 100 deployments. Reconcile
  stays available as a button, and nothing runs on a timer.
- The PR manager changes `lopu: queued` only when the queue state actually
  changes. It toggled about 4,400 times in a day, and each change also starts
  workflow runs.
- "Lopu manages PRs after …" decides in one admission job before laying out its
  ~28 jobs. It ran 587 times a day, and about 15K of its 16K jobs were skipped.
- "Vercel prebuilt deployments" stops starting on every Web CI / CodeQL
  `requested` event (175 runs a day) and runs only for main pushes and real
  preview needs.
- Anything the product genuinely needs from CI arrives as one signed summary
  through the existing `integrations/ci/*` HMAC routes, not as raw webhooks.

### M3 — shorten time in flight

- Done 2026-11-27: the MongoDB pool's idle timeout was 60 s, and
  `attachDatabasePool` (from `@vercel/functions` 3.9.7) holds the instance open
  through `waitUntil` for idle timeout + 100 ms after every connection checkout.
  Any database call more often than once a minute therefore kept a 2 GB
  instance billed all day: 59.9 GB-hr on 26 Nov from only ~9K invocations. Now
  5 s, as Vercel's pooling guide suggests. Measured first: requests that skip the
  database (`/api/v1/teapot`) answer in 60–180 ms, and a single settings read in
  60–360 ms even after 90 s idle. The slow cases are the endpoints' own work,
  for example `health/nitro` at ~2.8 s and webhook bursts. The gateway
  self-check averages 63 ms.
- Close the stale pre-#1557 browser tab that keeps `chats/updates` open (7 s
  each).
- Replace remaining long-polls with short reads plus client-triggered refresh.
- Speed up the slow endpoints themselves: `health/nitro` storage readiness
  (~2.8 s, run by the storage monitor workflow 183 times a day), `auth/me`
  (P75 1.6 s for signed-in users) and `things` (1.1 s). Every second saved is
  2 GB-seconds.
- Target: under 30 GB-hr a day (about $0.45).

### M4 — leave per-second memory billing if M1–M3 fall short

Move the API to an always-on Sydney container, where memory is a flat price:
Fly.io `syd` 1 GB at about $8.50 a month, or DigitalOcean at $12. Keep static
files on Cloudflare and previews on Vercel. Trigger: memory still above
30 GB-hr a day after M3, or by the end of December 2026.

## Measure

Use the Vercel FOCUS billing export for the daily provisioned GB-hr and
Observability for per-path calls and P75. Production `ciControl_v1` `ci-event`
counts give deliveries by type, with about 24 h retained.
