# Resource-conscious reach baseline

Captured: **2026-09-05 AEST**

Repository snapshot: `bf7af3ba6a4009fc7cff050f1356ed37722e9ae1` after integrating
`origin/develop` at `6e18d175f1ad5baa35c5cc8033ed168e2622e0e2`

Status: evidence note, not a performance, accessibility, availability, or
environmental certification

This note asks a narrow world-domination question: can Thingtime stay useful,
truthful, and delightful when a person has an older device, an expensive or
unstable connection, a small data allowance, limited local storage, or a slow
path to the current Sydney-hosted dynamic service?

The matching [roadmap](../PLAN/resource-conscious-reach-roadmap.md) and
[implementation epic](../TODO/claude-todo/30-resource-conscious-reach.md) turn
the evidence into a proposed release contract. They do not authorize telemetry,
infrastructure purchases, media transcoding, offline mutation, or a public
environmental claim.

## Scope and evidence limits

The snapshot covers the web client, its current API and attachment delivery
paths, repository validation, and adjacent architecture notes. It is not:

- a current field-performance report;
- a lifecycle assessment of providers, hardware, networking, or user devices;
- proof that a historical optimization still meets an unstated budget;
- proof that one fast route makes a complete journey accessible;
- a claim that fewer transferred bytes always imply lower emissions; or
- permission to collect precise device, location, network, energy, or behavior
  data from people.

Every repository fact below names a refresh trigger. Provider topology, prices,
browser behavior, W3C drafts, and live performance are time-sensitive.

## Evidence ledger

| Claim                                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                   | Confidence and refresh trigger                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thingtime has already made deliberate client-delivery improvements.                                      | Merged PR [#299](https://github.com/lopugit/thingtime/pull/299) records route splitting, removal of an unused icon set, immutable hashed-asset caching, request/query reductions, and a measured historical entry-chunk reduction. Current [`routes.tsx`](../remix/app/routes.tsx) still distinguishes an eager primary path from lazy secondary routes.                                   | High for code and merge history. The byte figures are historical, not a current budget result; rebuild and measure the exact release before quoting them as current.                             |
| Immutable delivery is verified for content-hashed client assets.                                         | [`patch-vercel-output.mjs`](../remix/scripts/patch-vercel-output.mjs) stamps `/assets/**` with `public, max-age=31536000, immutable`; [`verify-vercel-output.mjs`](../remix/scripts/verify-vercel-output.mjs) verifies the static shell and routing order.                                                                                                                                 | High for the built-output contract. Re-run the production build whenever Nitro, Vite, Vercel output, or routing changes.                                                                         |
| Feed images defer network work, but the main post renderer does not establish a responsive-image budget. | [`PostCard.tsx`](../remix/app/components/Feed/PostCard.tsx) uses `loading="lazy"` for avatars, post images, galleries, and listing images. In the inspected renderer these images use source URLs directly and do not declare `srcset`; managed profile images may be accepted up to 64 MiB by [`profileMediaCore.ts`](../remix/app/components/Profile/profileMediaCore.ts).               | High for the cited paths. This does not prove every image surface lacks derivatives or that every accepted upload is transferred in full; inspect the complete media path before implementation. |
| Audio has a thoughtful opt-in offline path, not a general offline application contract.                  | [`AudioAttachmentPlayer.tsx`](../remix/app/components/Attachments/AudioAttachmentPlayer.tsx) uses `preload="metadata"` and requires an explicit “Save full file offline” action. [`audioPlaybackCache.ts`](../remix/app/components/Attachments/audioPlaybackCache.ts) scopes stored blobs by attachment and viewer and rejects partial downloads.                                          | High for hosted audio playback. It does not cover text, images, video, mutations, cache quotas, eviction UX, or a service worker.                                                                |
| Storage accounting measures exact customer bytes, but those ledgers are not environmental evidence.      | [`FUNDAMENTALS.md` §3](../FUNDAMENTALS.md) defines transactional logical-content and attachment-byte ledgers plus quotas. The measurement deliberately excludes physical database, compression, replication, indexes, networking, and provider overhead.                                                                                                                                   | High. Keep product billing, capacity planning, transfer cost, energy, and emissions as separate measures.                                                                                        |
| Large uploads are technically bounded, but a safety ceiling is not a recommended transfer size.          | [`attachments.ts`](../remix/app/api/utils/attachments/attachments.ts) supports multipart objects up to a very high hard safety ceiling, while purpose-specific limits such as 512 KiB custom emoji and 64 MiB profile media are narrower.                                                                                                                                                  | High for constants, not for observed usage. Do not present maximum accepted bytes as a resource target or typical file size.                                                                     |
| Global reach has adjacent research but no shipped multi-region claim.                                    | [`geo-distribution.md`](../docs/architecture/geo-distribution.md) is explicitly a proposal and separates static/anonymous edge delivery from dynamic authenticated requests. Its provider pricing and measurements are dated and require refresh.                                                                                                                                          | High for proposal status. Re-measure topology, latency, data residence, consistency, cost, and provider features before any regional change.                                                     |
| The repository has no named resource-budget validation command in the current Remix script registry.     | The inspected [`remix/package.json`](../remix/package.json) has build, output, type, unit, API, and many domain checks, but no script name matching performance, Lighthouse, Web Vitals, resource budget, sustainability, carbon, or network testing. A targeted source scan also found no owned `saveData`, `effectiveType`, `prefers-reduced-data`, Workbox, or service-worker contract. | Medium-high for this snapshot. A differently named or external check may exist; repeat repository and CI inspection before implementation.                                                       |
| Resource-conscious access is an ethical reach issue, not just an optimization.                           | The W3C [Ethical Web Principles](https://www.w3.org/TR/ethical-web-principles/) call for accommodating low-bandwidth networks and low-specification equipment, multi-device access, privacy, user control, and environmental sustainability.                                                                                                                                               | High as a design principle, not a Thingtime conformance claim.                                                                                                                                   |
| Current sustainability guidance can seed a checklist, but its status must remain honest.                 | The W3C [Web Sustainability Guidelines](https://www.w3.org/TR/web-sustainability-guidelines/) cover UX, development, hosting, and product strategy. At capture time the document is a Group Note Draft and explicitly not W3C-endorsed.                                                                                                                                                    | High for the cited publication status on 2026-09-05. Refresh before citing it in policy or public claims.                                                                                        |
| A carbon-intensity claim needs a defined system boundary and functional unit.                            | The Green Software Foundation [Software Carbon Intensity specification](https://sci.greensoftware.foundation/) defines a method around energy, region-specific carbon intensity, embodied emissions, and a functional unit.                                                                                                                                                                | High for the method. Thingtime has not produced an SCI result in this snapshot, and this note makes none.                                                                                        |
| User-perceived performance needs several measures, not one speed score.                                  | Google’s current [Core Web Vitals guidance](https://web.dev/articles/vitals) defines loading, interaction, and visual-stability measures and evaluates them at the 75th percentile, segmented by mobile and desktop.                                                                                                                                                                       | High for the linked guidance. Metric definitions evolve; refresh before setting thresholds, and do not let aggregate field data conceal accessibility or low-end-device failures.                |

## Important distinctions

| Concern                | Question                                                                                                               | What it does not prove                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Performance            | Does a task respond and render within an approved time budget?                                                         | Low data use, accessibility, correctness, reliability, or low emissions.                  |
| Transfer efficiency    | How many requests and bytes does a cold/warm journey require?                                                          | Device energy, provider energy, embodied impact, or affordability.                        |
| Device efficiency      | Can approved low-spec devices complete the journey without jank, heat, crashes, or storage pressure?                   | Network quality or backend efficiency.                                                    |
| Low-bandwidth reach    | Can a person understand state and finish useful work under latency, loss, disconnection, and metered-data constraints? | Full offline correctness or global service continuity.                                    |
| Offline support        | Which reads or mutations remain safe without a live origin, and how do they reconcile?                                 | Permission freshness, durable server acceptance, or backup/restore.                       |
| Capacity and cost      | What compute, storage, transfer, and support resources does a useful outcome consume?                                  | Environmental impact unless the physical inputs and boundaries are known.                 |
| Environmental evidence | What measured impact belongs to an explicit system boundary and functional unit?                                       | “Green,” “carbon neutral,” or comparative superiority without complete, current evidence. |

These concerns reinforce one another but must remain separately observable. A
tiny payload that loses work is not sustainable. A fast page that excludes an
older device is not broad reach. A carbon estimate that ignores its system
boundary is not a trustworthy product claim.

## Core-journey matrix to establish

The first baseline should exercise outcomes, not every route. Candidate
journeys are:

| Journey            | Cold evidence                                                                      | Warm/repeat evidence                                            | Constrained state                                                           |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Understand         | Open the public landing surface and identify what Thingtime does.                  | Reopen without refetching immutable assets.                     | Slow/lossy network, scripts delayed, images unavailable.                    |
| Create and return  | Create or import a small private Thing, leave, find it, and reopen it.             | Cached state paints immediately while current state reconciles. | Offline before write, disconnect during write, reconnect, stale permission. |
| Read and respond   | Open a feed/post, understand media alternatives, and make one authorized response. | Previously read content does not flash away.                    | Images/video deferred, text remains usable, high latency and packet loss.   |
| Share with consent | Open an approved public preview and understand scope before continuing.            | Repeat open reuses immutable bytes without stale permission.    | Narrow viewport, low memory, metered data, media not loaded.                |
| Play hosted audio  | Inspect metadata, start one track, optionally save/remove an offline copy.         | Saved copy remains account-scoped and understandable.           | Interrupted download, insufficient quota, account switch, revoked access.   |
| Export or recover  | Start an approved export/recovery path and understand progress and outcome.        | Resume without duplicating durable work.                        | Connection loss, backgrounding, constrained local storage.                  |

The owner should select a smaller approved subset for the first gate. This note
does not claim all candidates are currently implemented end to end.

## Strengths to compound

- Primary and secondary routes already have an intentional eager/lazy split.
- Hashed assets have an explicit immutable-cache contract.
- Feed images use native lazy loading and audio avoids eager full-file preload.
- Offline audio is user-requested, locally removable, and partitioned by viewer.
- Exact content-byte ledgers and purpose-specific limits provide deterministic
  inputs for storage and capacity decisions.
- The performance audit preserves both shipped improvements and refuted or
  unresolved findings instead of turning one optimization pass into a blanket
  “fast” claim.
- Optimistic rendering and truthful error-state rules give constrained-network
  work a suitable UX foundation.

## Gaps before resource-conscious reach is a contract

1. **No owned journey budget.** There is no approved request, transfer, main-
   thread, memory, local-storage, or task-completion envelope for a cold and
   warm core journey.
2. **No repeatable constrained matrix.** Build and API tests do not prove useful
   completion on an approved low-spec device profile across slow, lossy,
   offline, and reconnect states.
3. **Media delivery is source-led.** Lazy loading prevents some eager work, but
   there is no shared derivative, responsive-source, poster, transcript, or
   data-saver contract across image, video, and audio surfaces.
4. **Offline support is feature-local.** Audio can be explicitly saved, while
   cache ownership, quota, eviction, stale permissions, and mutation replay are
   not defined as one product contract.
5. **Billing bytes are easy to misuse.** Logical storage bytes are exact for
   quota purposes but omit transfer, compute, replication, user-device work,
   and embodied impact.
6. **No environmental evidence boundary.** Thingtime has not selected a
   functional unit, inventory boundary, data quality policy, uncertainty
   treatment, or claims review owner.
7. **No resource regression gate.** A build can remain functionally green while
   a core journey grows substantially in eager bytes, requests, CPU, memory, or
   local storage.
8. **Affordability is implicit.** Data use, required hardware, offline storage,
   and essential calm/access controls are not connected to a tier-neutral reach
   guarantee.

## Privacy and safety boundaries

Resource work must not become a device-fingerprinting or behavior-surveillance
program.

- Prefer deterministic lab fixtures, build artifacts, server aggregate totals,
  and structured opt-in sessions before field instrumentation.
- Do not collect raw IP addresses, precise location, SSID, carrier, battery
  state, device model, installed fonts, storage inventory, browsing history,
  Thing content, search text, attachment names, message text, or full URLs for
  performance analysis.
- Treat network class, memory class, and timing combinations as potentially
  identifying. If aggregate field signals are later approved, version the
  allowlist, coarsen dimensions, enforce minimum cohorts, bound retention,
  document deletion, and keep person-level dashboards unavailable.
- A data-saver preference must not reveal a person's income, disability,
  location, or plan to other users, ranking, advertisers, or public content.
- Offline private bytes remain partitioned by account, endpoint, namespace,
  and permission state. Logout, revoke, delete, or account switch must follow
  an approved purge/revalidation policy.
- Never queue a mutation whose eventual authority cannot be rechecked. “Saved
  locally” and “accepted durably by Thingtime” must be different states.

## Failure and abuse cases

| Risk                                                    | Defensive requirement                                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A budget removes meaning or access                      | Measure task completion, semantics, accessible alternatives, and error recovery beside bytes and timing.                                                        |
| Automatic media adaptation leaks private content        | Generate derivatives only inside the authorized attachment pipeline; preserve purpose binding and deletion/accounting invariants.                               |
| Offline cache survives an authority change              | Partition, revalidate, expire, and purge according to current account and content authority; test every boundary.                                               |
| “Data saver” becomes a degraded punishment tier         | Keep complete core meaning and essential actions; defer decorative or high-cost representation, not rights or safety controls.                                  |
| A global performance score hides excluded users         | Report approved device/network journeys and failure classes separately; one average cannot waive a blocker.                                                     |
| Field metrics become fingerprinting                     | Default to lab evidence; minimize and aggregate any approved signal contract with privacy review and deletion tests.                                            |
| Media or cache limits become a denial-of-service bypass | Retain size caps, concurrency bounds, quotas, timeouts, and cleanup; test interrupted and adversarial transfers.                                                |
| Environmental marketing outruns evidence                | Publish no “green,” neutral, avoided-emissions, or comparative claim without a named boundary, method, current data, uncertainty, and independent review owner. |
| Optimization changes service truth                      | Preserve idempotency, permissions, exact storage accounting, capability negotiation, and acknowledged-write semantics.                                          |

## Candidate measures, not approved targets

| Measure                    | Candidate unit                                                      | Required companion                                                                  |
| -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Useful completion          | Successful approved tasks / attempts per test profile               | Error class, accessibility completion, and durable-state verification.              |
| Cold transfer              | Compressed bytes and request count to complete one journey          | Cache state, media choices, and content fixture version.                            |
| Warm transfer              | Revalidated/transferred bytes on an exact repeat                    | Stale/deploy recovery and permission freshness.                                     |
| Interaction responsiveness | Task-level latency plus current user-centric browser metrics        | Low-end CPU profile, long-task evidence, and input correctness.                     |
| Backend work               | Queries, scanned/returned rows, compute duration, object transfer   | Cache hit state, correctness, and service objective.                                |
| Local footprint            | Cache bytes, entry count, expiry, and eviction result               | Account/endpoint partitioning and user-visible remove controls.                     |
| Cost per useful outcome    | Directly attributable serving and support cost / successful outcome | Reliability, accessibility, privacy, safety, and no surveillance subsidy.           |
| Environmental intensity    | Measured impact / explicitly approved functional unit               | System boundary, physical data sources, uncertainty, geography, and method version. |

## Open owner questions

1. Which three journeys and which device/network profiles define the first
   release gate?
2. What is the tier-neutral minimum experience: text, actions, previews,
   downloads, offline reads, and error recovery?
3. Should Thingtime expose one explicit data-saver setting, honor a browser or
   OS preference where reliable, or begin with deterministic user choice only?
4. Which media derivatives are worth storing, and how are their bytes billed,
   deleted, moderated, exported, and attributed?
5. Which offline reads are safe before any offline mutation queue is proposed?
6. What build and journey budgets block a release, and what exception process
   is narrow, expiring, and visible?
7. Which provider measurements are available without adding user tracking?
8. Is an SCI-style functional unit useful now, or should Thingtime first
   publish only resource reductions without an emissions claim?
9. Who owns budget review, privacy, accessibility, reliability, media safety,
   infrastructure cost, and any future environmental statement?

## Evidence-backed next step

Approve one decision packet with three core journeys, two constrained device/
network profiles, cold and warm resource envelopes, a tier-neutral meaning
baseline, an offline boundary, signal denylist, and claims owner. Then run the
repeatable lab baseline in the
[resource-conscious reach roadmap](../PLAN/resource-conscious-reach-roadmap.md).
Do not add field telemetry, media derivatives, or environmental marketing
before that packet is decided.
