# Hosting options and cost per call and per user

Grounded 2026-11-26. This is a read-only analysis; nothing changed in Vercel,
Atlas or production. It follows
[the Vercel cost reduction note](vercel-cost-reduction-2026-11-25.md).

Interactive version with charts and a cost calculator:
<https://claude.ai/artifact/DVkFX93yAYGMXCs1AnFUXr> (private to the owner).

## Summary

- **Stay on Vercel Pro for now.** After the November fixes and the Automation
  switches, real use is a few thousand calls a day. That fits inside Pro's $20
  usage credit. Expect about $20–45 a month once Observability Plus and Vercel
  Agent are off. Moving hosts now saves $0–25 a month.
- **Don't run production on Vercel Hobby.** The quietest stretch on record
  (30 Sep–11 Oct, about 9.6K calls a day) ran at about 8.4 CPU-hours and 1.35M
  CDN requests a month. Hobby allows 4 CPU-hours and 1M CDN requests, then pauses
  the site until the next month instead of billing extra. It is also
  non-commercial only. This supersedes the earlier goal of pointing
  thingtime.com at a Hobby account.
- **The cost driver is time that instances stay alive, not call count.**
  Long-polls and background loops kept 2 GB instances alive all day. One power
  user with background automation cost about $113 a month in compute. The same
  user acting by hand would cost about $0.90.
- **Next step at about 2M calls a month, or when live updates are needed:** one
  always-on Node server in Sydney (Fly.io `syd` or DigitalOcean App Platform),
  Cloudflare for the static site, R2 for file bytes, and Atlas Flex. This is a
  flat $25–40 a month up to about 8M calls. Open connections (SSE and
  WebSocket) cost nothing, so live updates can replace polling.

## Two months on Vercel (26 Sep–25 Nov, 61 days)

Source: `GET /v1/billing/charges` (FOCUS export), team-wide plus the
`thingtime` project. Costs are list price (`EffectiveCost`).

| Product                  | Usage           | List cost   | Share |
| ------------------------ | --------------- | ----------- | ----- |
| Fluid provisioned memory | 6,078 GB-hr     | $90.43      | 33%   |
| Pro seat                 | 2 months        | $40.00      | 15%   |
| Observability events     | 32.2M           | $38.67      | 14%   |
| Fast Origin Transfer     | 164.5 GB        | $38.21      | 14%   |
| Fluid active CPU         | 198.9 h         | $35.75      | 13%   |
| Vercel Agent             | 16.6 credits    | $16.59      | 6%    |
| Function invocations     | 13.43M          | $8.06       | 3%    |
| CDN requests and the rest| 16.1M requests  | $4.94       | 2%    |
| **Total**                |                 | **$272.65** |       |

After plan credits, $220.08 was billed. November reached $180 by the 25th.
Fast Data Transfer (190 GB) was free inside Pro. The export now includes Fluid
memory, CPU, Fast Origin Transfer and Observability, so the dashboard-only gap
described in the previous note no longer applies.

### Per call

Across all 13.43M calls, the average call used 53 ms of CPU and 1.63 GB-s of
provisioned memory (about 0.8 s of a 2 GB instance). It sent 12.2 KB out of the
function. That is $12.84 of compute per million calls, $15.71 with Observability
Plus, and $20.30 all-in.

| Period                  | Calls/day | CPU/call | Memory/call | Compute $/1M | Total $/day |
| ----------------------- | --------- | -------- | ----------- | ------------ | ----------- |
| Quiet, 30 Sep–11 Oct    | 9.6K      | 104 ms   | 0.64 GB-s   | $10.11       | $1.15       |
| Growing, 13 Oct–1 Nov   | 235K      | 50 ms    | 0.86 GB-s   | $9.11        | $3.51       |
| Always-on, 2–16 Nov     | 433K      | 52 ms    | 1.78 GB-s   | $13.56       | $8.63       |
| Steady floor, 17–23 Nov | 142K      | 57 ms    | 4.44 GB-s   | $26.51       | $5.19       |

Two things stand out. Provisioned memory jumped from about 77 to 291 GB-hr a
day on 2 Nov. And the steady-floor week cost the most per call: traffic fell by
two thirds from the peak, but long-polls still held instances open. Quiet days
show the highest CPU per call because sparse traffic means more cold starts.

### Where request time went (7 days to 25 Nov)

The shares below are calls × P75 duration from Observability, so they are
approximate.

| Endpoint                                   | Share |
| ------------------------------------------ | ----- |
| Mac folder-sync control (about every 3 s)  | 32.6% |
| Mac node command long-poll (20 s waits)    | 31.9% |
| Watch pairing poll                         | 10.0% |
| Timeline                                   | 7.7%  |
| Messenger updates                          | 4.6%  |
| Mac node state (99% errors)                | 2.6%  |
| Mac node telemetry                         | 2.2%  |
| Network probe                              | 2.2%  |
| Everything else                            | 6.3%  |

The Mac app's background loops were about 70% of the time Vercel billed for.

### Right after the fixes (6 hours to 15:10 AEDT, 26 Nov)

There were 3.3K function calls:

- 974 were GitHub CI webhooks.
- About 1,450 came from one browser tab still running a pre-fix build (721
  `chats/updates` plus page-data refreshes from `/api/root-data`).
- About 900 were real use.

Active CPU P75 was 391 ms per call, and average memory was 283 MB of the 2.05 GB
allocated. Hobby cannot use a smaller size, and Fluid's Standard size is
2 GB / 1 vCPU.

## Users and data (production, read-only aggregate counts)

- 18 distinct accounts created a browser session in the last 30 days (the same
  over 60 days, because sessions expire after 30 days), and 3 in the last 7.
  Device, app, PAT and ChatGPT MCP sessions belong to one account.
- `things_v2` holds 321K documents: 507 MB of data plus 543 MB of indexes. The
  whole database is 577 MB of data and 748 MB of indexes. 312K of the documents
  are under 61 days old. Most are device history: 113K `timeline-link`, 35K
  `timeline-event`, 24K `timeline-branch-head` and 51K `location`. The top two
  owners created 165K and 95K documents in that window. That is roughly 250 MB of
  growth a month, driven by one power user's devices.
- The production Atlas tier could not be confirmed with read-only access.
  `docs/architecture/geo-distribution.md` records M0 earlier in the year, and the
  current size suggests a paid tier.

## Per-user model

Only the automation row is measured (the owner's devices, 17–23 Nov). The other
rows are estimates. A page load makes about 15–25 API calls, and each action
makes 1–3 more.

| Profile                    | Calls/day | Calls/month | Vercel  | Workers | Fly.io  | Lambda  |
| -------------------------- | --------- | ----------- | ------- | ------- | ------- | ------- |
| Casual (web, weekly)       | 15        | 450         | $0.005  | $0.0005 | $0.001  | $0.002  |
| Light (web, daily)         | 60        | 1,800       | $0.018  | $0.002  | $0.006  | $0.008  |
| Regular (web + iPhone)     | 300       | 9,000       | $0.09   | $0.01   | $0.03   | $0.04   |
| Pro, hands-on              | 3,000     | 90,000      | $0.91   | $0.10   | $0.29   | $0.39   |
| Pro, background automation | 141,800   | 4.25M       | $112.73 | $4.68   | $13.76  | $18.58  |

These are marginal compute costs only, excluding each host's base fee. The mix
assumed is 55% casual, 30% light, 13% regular and 2% pro, which averages about
3,760 calls per user a month. The 2% of pro users make 48% of the calls.

Monthly API hosting by scale, for that mix (database excluded):

| Users   | Calls/month | Vercel Pro | Workers | Fly.io syd | DO App Platform | Lambda | Cloud Run | Atlas    |
| ------- | ----------- | ---------- | ------- | ---------- | --------------- | ------ | --------- | -------- |
| 20      | 0.08M       | $20        | $5      | $17        | $12             | $0     | $0        | Flex $8  |
| 200     | 0.75M       | $20        | $5      | $17        | $12             | $0     | $2        | Flex $8  |
| 2,000   | 7.5M        | $76        | $10     | $29        | $12             | $26    | $83       | Flex $8  |
| 20,000  | 75M         | $759       | $84     | $192       | $120            | $396   | $909      | M10 $92  |
| 100,000 | 376M        | $3,795     | $415    | $800       | $564            | $2,051 | $4,578    | M20+ ~$320 |

The model's assumptions:

- About 40 ms of CPU and 10 KB out per call on the other hosts.
- Fly.io: about 3M calls a month per shared-cpu-1x 1 GB machine at about
  $8.50 in Sydney, or 25M per dedicated machine at about $40.60.
- DigitalOcean: about 8M calls a month per $12 container.
- Vercel: $10.11 per million for hands-on traffic and $26.51 for background
  automation, measured.
- Lambda: 0.25 GB-s per call at 1 GB.
- Cloud Run: 0.3 vCPU-s per call at Sydney's Tier 2 rates.

## Host comparison

| Host                    | Base                        | Per 1M calls   | Open connections            | Catch |
| ----------------------- | --------------------------- | -------------- | --------------------------- | ----- |
| Vercel Pro (now)        | $20 (returned as credit)    | $10–27         | Billed per GB-hour, 2 GB min | Highest per call |
| Vercel Hobby            | $0                          | none sold      | Same                        | 4 CPU-h and 1M CDN requests, then pauses; non-commercial |
| Cloudflare Workers      | $5 (10M calls, 30M CPU-ms)  | ~$1.10         | Free; Durable Objects for WebSockets | Port off Node; MongoDB driver on workerd unproven; 128 MB isolates; native bcrypt |
| Fly.io `syd`            | ~$17 (two 1 GB machines)    | ~$3 at capacity| Free                        | Shared-CPU quota; Sydney ×1.27 pricing |
| DigitalOcean App Platform `syd` | $12 per 1 GB container | ~$1.50 at capacity | Free                   | Fewer controls |
| AWS Lambda `ap-southeast-2` | $0 (1M calls, 400K GB-s free) | ~$5.50   | Billed per second waiting   | $0.114/GB egress; more setup |
| Cloud Run `australia-southeast1` | $0 (2M requests free) | ~$12        | Billed while open           | Tier 2 CPU rates; cold starts |
| Railway, Render, Hetzner | $5–7                       | low            | Free                        | No Sydney region: +90 ms or more per DB round trip |

The API must stay in Sydney while Atlas is in Sydney.

## Recommendation

1. **Now:**
   - Pay the overdue Vercel invoice.
   - Turn off Observability Plus and Vercel Agent.
   - Reload or close the stale browser tab.
   - Point the GitHub CI webhooks at the CI controller runtime instead of the
     product app.
2. **At about 2M calls a month, or for live updates:**
   - Run the Nitro server with the `node-server` preset in a container on
     Fly.io `syd` or DigitalOcean App Platform.
   - Serve the website from Cloudflare.
   - Send file bytes directly to R2 with signed URLs.
   - Use SSE or WebSockets instead of polling.
   - Keep Vercel for pull request previews only.
3. **At tens of thousands of users:**
   - Move to Cloudflare Workers with Durable Objects, after a proven MongoDB
     path or a separate data layer for hot paths.
   - Move Atlas to M10 or M20 in Sydney.
4. **Database hygiene for any host:**
   - Put retention or roll-ups on device timeline and location history.
   - Trim indexes, which are larger than the data.

## Open questions

- Does provisioned memory fall to about 2 GB-hr a day after the fixes, or does
  one instance still stay alive all day (about 48 GB-hr)? The 26 Nov billing day
  answers this.
- Should the CI controller's webhooks (3.6K calls on a normal day, 44K on a busy
  one) get their own small host?
- Is a one-day Fly.io trial of the Nitro `node-server` build worth running to
  measure real Sydney latency and CPU per call?

## Sources

- Vercel billing export, 1 Sep–26 Nov 2026, and Vercel Observability →
  Functions (6 hours and 7 days).
- Production MongoDB, read-only aggregate counts on 26 Nov 2026.
- Vercel [Fluid pricing](https://vercel.com/docs/functions/usage-and-pricing),
  [Sydney rates](https://vercel.com/docs/pricing/regional-pricing/syd1),
  [Hobby limits](https://vercel.com/docs/plans/hobby) and
  [function memory](https://vercel.com/docs/functions/configuring-functions/memory).
- Cloudflare [Workers](https://developers.cloudflare.com/workers/platform/pricing/),
  [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)
  and [MongoDB on Workers](https://developers.cloudflare.com/workers/tutorials/connect-to-mongodb-atlas/).
- [Fly.io](https://docs.fly.io/about/pricing),
  [DigitalOcean App Platform](https://docs.digitalocean.com/products/app-platform/details/pricing),
  [Railway](https://docs.railway.com/reference/pricing/plans),
  [AWS Lambda](https://aws.amazon.com/lambda/pricing/),
  [Cloud Run](https://cloud.google.com/run/pricing) and
  [MongoDB Atlas](https://www.mongodb.com/pricing) pricing pages, read on
  26 Nov 2026.
