# PR #308 — NSFW/TOS media moderation pipeline

- **PR**: https://github.com/lopugit/thingtime/pull/308

- **Branch**: `claude/nsfw-tos-media-moderation-58c301`
- **Base**: `develop`, after the canonical public/private/all upload-scope reconciliation in #330 (the production twin is #310)
- **Why**: the scoped upload gate answers whether an account may upload a class of content; this pipeline separately analyzes uploaded/public content for NSFW and TOS/illegal material, tags it with protected system attributes, blurs or quarantines it, and surfaces it to admins for review. The obsolete one-boolean #302 architecture is not retained.

## Shape of the change

| Layer | What |
|---|---|
| Moderation utils (`api/utils/moderation/`) | `moderationCore.ts` (verdict → protected stamp mapping, bounded categories/reason, status guards), `providers.ts` (registry: `claude` \| `test` \| `off` via `THINGTIME_MODERATION_PROVIDER`; claude auto-selected when `ANTHROPIC_API_KEY` set), `claudeProvider.ts` (@anthropic-ai/sdk vision call, strict-JSON prompt, refusal → quarantine-for-review), `analyzeAttachment.ts` (orchestrator: load doc → gate on mediaKind/type/size → presigned-GET bytes → provider → stamp + flag; DI for tests; pending-only overwrites so verdicts never regress), `moderationAdmin.ts` (review queue, verdict overrides, bounded sweep). |
| Protected attributes | `moderation` is an explicitly protected ROOT system field on attachment things (`{ status: pending\|skipped\|clear\|nsfw\|blocked, categories, provider, model, analyzedAt, reason }`). `moderationFlag` is also a protected Thing kind; generic Things APIs cannot create either state. Flag upserts require both the deterministic id and protected kind, so a colliding ordinary Thing is never repurposed as a control record. |
| Wiring (`attachments.ts`) | `completeAttachmentUpload` atomically marks the attachment `pending` before returning ready, then fire-and-forgets `queueModeration(shareId)`. Public callers receive 404 while pending or blocked; owner/admin evidence access remains available. The bounded sweep retries both lost analysis and lost flag writes. |
| Projections | `toAttachmentPublicMetadata(id, crystal, moderation?)`: pending/blocked → `null` (vanishes from feed/messenger payloads), nsfw → `nsfw: true`; both aggregation sites (`things.ts` post/comment resolver, `messenger.ts`) project + pass `moderation`. Client `PublicAttachment.nsfw`, normalize keeps only explicit server `true`, snapshot compares it. |
| UI (`PostAttachments.tsx`) | `NsfwShield`: blur(64px) + opacity 0.92 + scale(1.15) crop, 2px red border, rgba(229,72,77,.22) wash, centered mono NSFW badge, pill "Show Anyway" button; per-attachment per-render reveal state; wraps images and videos in feed, permalinks, and messenger. |
| Admin (`/admin` → Moderation) | `ModerationTab.tsx`: queue table (unreviewed first), status badges, View (admins can open blocked evidence), Clear/NSFW/Block overrides with Lopu toasts, "Run analysis sweep" + backlog counts. Route `GET/POST /api/v1/admin/moderation` (requireAdmin + withAdminPrivateResponse), registered in import map + apiDocs (auto docs smoke tests). |

## Key decisions

- **Post-hoc analysis, fail-closed pending**: analysis never blocks or slows the upload response, but completion stamps `pending` before the attachment can be projected or served publicly. Failures leave it quarantined (never a fabricated `clear`), and the admin/cron sweep drains pending docs after outages.
- **Claude refusal = signal**: if Claude's safety classifiers refuse to process an image, the attachment is quarantined (`blocked`, category `analysis-refused`) for human review rather than failing open.
- **`off` is explicit**: disabled environments stamp `skipped`; configured provider failure leaves the media durably `pending` and quarantined. Upload permission scopes remain an independent authorization boundary and are never duplicated inside moderation.
- **Blocked = vanish + 404**: no public placeholder, no oracle; admins keep evidence access through the same content route.
- Model default `claude-opus-5`, env-overridable via `TT_MODERATION_MODEL`.

## Integration reconciliation (2026-08-21)

- Replayed the moderation commits onto the canonical #309/#310/#330 public/private/all permission model without any #302 field, API, migration, or UI dependency.
- Protected both the root `moderation` field and `moderationFlag` kind at the generic Things boundary.
- Made attachment readiness and the initial `pending` moderation stamp atomic; pending and blocked media now disappear from public projections and return not found from content routes, while owner/admin evidence access remains usable.
- Made deterministic moderation-flag upserts collision-safe and sweep-recoverable through `flagPending`; an ordinary Thing squatting a flag id remains untouched and cannot be converted into a system control record.
- Reconciled validation: `test:moderation` 52/52, `test:attachments` 115/115, the complete current `test:unit` chain, and the canonical Vercel/Nitro build all pass. The only stale gate was the cron contract test, now scoped to require the moderation sweep alongside cleanup and weekly notifications.

## Verification log (original 2026-08-18 branch record)

- `corepack pnpm --dir remix run test:moderation` — 10/10 (verdict mapping, category bounding, provider resolution incl. claude branch, orchestrator: nsfw/blocked stamps + flag upserts, skip paths, provider-failure leaves pending, landed-verdict no-op).
- `corepack pnpm --dir remix run test:attachments` — 104/104 with the new wiring.
- Full `test:unit` + targeted lint — see PR description.
- API suite gains `admin-moderation-guarded` + `admin-moderation-review-guarded`; the `admin-moderation` docs entry auto-adds two docs smoke tests.
- Live upload→analysis E2E requires S3 + provider env not present in this local checkout — covered by DI unit tests; the sweep + `THINGTIME_MODERATION_PROVIDER=test` recipe in TESTING.md is the staging checklist.

## Dev runbook additions

- Env: `THINGTIME_MODERATION_PROVIDER` (`claude`/`test`/`off`), `ANTHROPIC_API_KEY`, `TT_MODERATION_MODEL` (README §Private S3 media).
- TESTING.md: moderation lines under attachments + admin sections.
- FUNDAMENTALS §3: `moderationFlag` kind + protected `moderation` stamp documented.

## Cost analysis (2026-08-19)

- [`docs/ai-api-cost-analysis.md`](../docs/ai-api-cost-analysis.md) — verified market research on AI API pricing for this pipeline: per-image cost on the `claude-opus-5` default (~$0.011/image), model-tier alternatives, dedicated moderation APIs, self-hosted options, volume projections, and the ranked cost levers (free first-pass gate, `TT_MODERATION_MODEL` downgrade, Batch API, pre-send downscaling, pending-retry bound).

## Free omni-moderation first-pass gate (2026-08-19)

Implements cost lever 1 from [`docs/ai-api-cost-analysis.md`](../docs/ai-api-cost-analysis.md): OpenAI's free `omni-moderation-latest` endpoint now screens every image before any paid Claude call.

- New `remix/app/api/utils/moderation/openaiProvider.ts`: `createOmniScreen` (POST /v1/moderations, data-URL image, ≤10 MiB — under OpenAI's 20 MB cap), `mapOmniVerdict`, `shouldEscalateOmniResult`, standalone `openai` provider, and the tiered `openai+claude` provider.
- **Tiered flow**: clean screen → `clear` stamped with provider `openai` at $0; flagged OR any image-applicable category score ≥ `TT_MODERATION_ESCALATION_SCORE` (default 0.2) → Claude makes the final policy-nuanced verdict (provider `claude` + resolved model on the stamp). Fail-safes: omni outage → straight to Claude; Claude outage on a **flagged** image → omni's `nsfw` verdict lands (blur + moderationFlag beats rendering it) while borderline/no-signal rethrows so the doc stays `pending` for the sweep.
- **Why omni never decides alone**: its `sexual/minors` category is text-only (cannot see CSAM in images) and its fixed taxonomy can't apply our "artistic/medical nudity still blurs" rule — so omni never stamps `blocked`, and anything it isn't confidently clean about goes to Claude.
- Provider resolution: `THINGTIME_MODERATION_PROVIDER` gains `openai+claude` (alias `tiered`) and `openai`; unset default is now key-driven (both → tiered, ANTHROPIC only → claude, OPENAI only → openai, neither → off). Explicit values are never rerouted.
- Verification: `test:moderation` 20/20 (10 new: verdict mapping incl. text-only score exclusion, escalation threshold clamping, screen request/auth/data-URL shape + error paths, all four tiered branches, resolution matrix), `test:attachments` 111/111, full nitro build green.

## Admin AI-moderation settings + free omni text moderation (2026-08-19)

- **Settings**: `Thingtime.ModerationSettings` singleton (settings collection, waterfall-store pattern: forgiving reads/strict writes/last-known-good) with per-surface provider choices; `/admin` → Moderation gains the "AI moderation settings" card (media: default/tiered/openai-free/claude/off; text: default/openai-free/off) showing what each surface effectively runs. Admin choice overrides env via `resolveConfiguredModerationProvider`; the media pipeline consumes it through the orchestrator's default resolver.
- **Text pipeline** (`analyzeText.ts` + `textModeration.ts`): post/comment/share `crystal.text` screened by free omni on create (`createThing` tail) and on text-changing edits (`updateThing` tail). Severity split: TEXT_BLOCK_CATEGORIES (sexual/minors, harassment/threatening, hate/threatening, illicit/violent, self-harm/instructions) → `blocked` (hidden from ALL reads via the `canView` gate + `moderation.status: {$ne:'blocked'}` on thread/reaction loading); other flags → advisory `nsfw` stamp + flag, content stays visible. Flags carry `targetKind: 'text'` + a 500-char excerpt (admin evidence without resurrecting content); posts stamp on the DATA-plane things collection, flags stay on HOME. Analyzer never overwrites `provider: 'admin'` stamps.
- **Review**: `reviewTextModeration` (route `action: 'review'` + `targetKind: 'text'`); ModerationTab renders text rows with excerpt (no View button) and passes targetKind through.
- Verification: `test:moderation` 31/31 (settings normalize/validate/store, admin-override resolution, text severity mapping incl. every block category, analyzer stamp/flag/off/empty/admin-guard/failure paths), `test:attachments` 113/113, full nitro build + Vercel output check green.

### Adversarial review hardening (same day)

A 19-agent review pass (5 lenses + per-finding verification) confirmed 13 issues, all fixed before push:

- **CRITICAL — depth≥2 leak**: blocked replies still shipped full text through resolveRelated's per-level thread loop; the `'moderation.status': {$ne:'blocked'}` guard now covers the level loop (docs + counts), level reactions, share counts, and resolveThreadCounts' $graphLookup, so blocked docs vanish from every thread payload AND every count.
- **CRITICAL — inherit/app-lens bypass**: `canViewInherited` now gates the doc itself (not just its inherit terminal), and `appNamespaceVerdict` gains the same gate (the app-lens path never reaches canView).
- **MAJOR — cross-plane injection**: `queueTextModeration` refuses custom data-plane overrides (mirrors `emitCreationNotifications`) — an untrusted bring-your-own-DB plane can no longer inject or clobber HOME moderation flags, or bait an admin block against a colliding home shareId.
- **MAJOR — post-review laundering**: a flagged verdict now upserts the flag even when an admin stamp kept the pipeline off the doc, resetting reviewed markers so post-review edits resurface in the queue; the thing's admin stamp itself stays final.
- Flag lifecycle: clear re-analysis resolves unreviewed flags (reviewed ones stay as audit log); emptied text clears stale non-admin stamps + resolves flags; admin nsfw/block reviews always land a full auditable flag row; reviews of deleted targets resolve the orphaned flag instead of 404-pinning the queue.
- Test fidelity: the fake collection now genuinely evaluates the `$or`/`$exists`/`$ne` filters (a broken admin guard fails the suite); new lifecycle tests cover every path above (test:moderation 35/35).
- ~~Known limitation: text moderation has no retry sweep~~ **Superseded (same day)**: `GET /api/v1/moderation/sweep` (hourly Vercel Cron at :29, CRON_SECRET bearer, mirrors the attachments-cleanup contract) sweeps a bounded oldest-first batch of post-family things with real text and no moderation stamp — recovering mid-flight deaths/provider outages AND draining off-era backlog for free — plus the standard attachment sweep. It no-ops while the text surface is off (absence of a stamp is deliberate there); whitespace-only docs are excluded by the `\S` filter so nothing can wedge the batch. The admin sweep action now runs both batches and the Moderation tab shows the unmoderated-text backlog count. Registered in all three places (route + import map + apiDocs `moderation-sweep`).

## Historical hybrid create-time text gate (2026-08-19; superseded by the fail-closed pending flow below)

- `screenTextForCreate` (analyzeText.ts): the free omni screen races a bounded budget (`TT_TEXT_SCREEN_BUDGET_MS`, default 600ms, clamp ≤10s, `0` = pure async) inside `createThing` BEFORE the insert. Verdict in time → the doc is **born stamped**: blocked posts never render anywhere (no insert→async-verdict visibility window); clear posts skip the async call entirely (zero duplicate spend). Timeout, provider error, off surface, empty text, or a custom data plane all resolve `null` — the post publishes instantly and the async queue + hourly sweep own it (fail-open: moderation can never break or visibly slow posting; the helper never throws and clears its race timer).
- Tail logic: sync-flagged docs still fire the async analyzer once (free re-screen) so the admin moderationFlag lands with full queue semantics (reviewed-marker resets etc.); sync-cleared docs make zero extra calls; no-verdict docs queue exactly as before.
- Product choice: block-worthy posts are quarantined + flagged (stored as evidence, hidden everywhere via the canView gates), NOT rejected with an error — same posture as media, and shadow-blocking avoids tipping off abusers. Edits remain async (edit-laundering already resurfaces via flags).
- Tests: budget env parsing (default/override/disable/clamp), fast-verdict gating (blocked + clear), timeout fail-open bounded in time, provider-error fail-open, off/empty/zero-budget short-circuits (settings not even resolved at budget 0). test:moderation 39/39.

### Hybrid-gate adversarial review hardening (same day)

An 11-agent review pass confirmed 8 findings on the hybrid gate, all fixed pre-push:

- **MAJOR — flag durability**: a born-flagged doc's admin flag rode on a lossy fire-and-forget second call, and the sweep couldn't see born-stamped docs. Now: the flag is written **inline in the same request** as the born stamp (`upsertTextModerationFlag`, extracted single writer); every born-flagged stamp carries `moderation.flagPending: true`, cleared only when a flag actually lands (inline or analyzer); `UNMODERATED_TEXT_FILTER` gained `$or: [no stamp, flagPending]` so the hourly sweep deterministically retries any lost flag write. No stranded-blocked-content path remains.
- **Sticky blocks + text fence**: pipeline stamps carry `moderation.textHash`; a non-admin block on IDENTICAL text can never be relaxed by a provider flip-flop (only admin review, or a real edit — hash change — can), and every verdict stamp is fenced on `crystal.text` so a slow verdict for old text can't overwrite a fresher run after an edit.
- **Write-path**: the settings read now races inside the budget too (a hung Mongo read can't hold a post), and a screen rejection landing after the timeout can't surface as an unhandled rejection.
- **Counts**: `countCommentsOf` excludes blocked comments for all client-facing counts (matches the read paths) while the comment CAP still counts everything (it doubles as the physical per-post doc bound, so blocked spam can't mint quota).
- **Tests**: pure `postInsertModerationPlan` helper extracted (notify/inlineFlag/queueAsync branching unit-tested); new tests for hung-settings-read, late-rejection, clamp boundary, advisory sync verdicts, sticky-block vs edit-re-verdict, stamp fencing, flagPending lifecycle, sweep filter shape. test:moderation 45/45.
- Accepted + documented: an admin clearing a born-blocked doc does not retro-send its creation notifications (deliberate — days-late notifications are worse; with sticky blocks, pipeline downgrades only follow real edits, and edits never notified anyway).

## Full-content screening + sync-gate circuit breaker (2026-08-19)

- **Coverage**: `moderatedContentOf` extracts every omni-judgeable public surface of a post-family doc — prose, listing title/location/category/condition, tags, and the legacy external image URLs (`crystal.images`, http(s)-only, cap 8 × 2048 chars) — screened in ONE combined free omni request (mixed text + image_url input). The unmoderated URL-photos gap is closed; URL images flag/advisory (image-blind sexual/minors, same as omni-only media). Edit re-screens key off a `moderatedContentFingerprint` (any of prose/listing/tags/URLs changing re-screens; the stamp's textHash + sticky-block + fence semantics all use the fingerprint; the verdict fence adds `crystal.images` when present). Sweep filter + queue conditions cover image-URL-only posts.
- **Breaker**: per-instance sync-gate circuit breaker — 3 consecutive sync-screen failures (timeouts count, 'off' doesn't) open it for 60s, during which posts skip the sync toll entirely (settings not even resolved: zero added latency in a confirmed outage), then the next post probes. Budget answer for the record: the race measures server→OpenAI only; client latency cannot circumvent the gate.
- Remaining coverage gaps (deliberate): video/file CONTENTS (frame-extraction/AV infra — future), profile bio/display-name (different write path — follow-up candidate).
- Tests: content extraction (listing/tags/URL filtering + caps), image-URL-only screening + URL excerpts, breaker open/skip/re-probe lifecycle, updated fingerprint-based sticky/fence assertions, sweep filter shape. test:moderation 48/48.

## Fail-closed pending flow (2026-08-19, owner decision)

Replaces the fail-open posture: while text moderation is ON, no post-family content ever goes public unscreened.

- `screenTextForCreate` now returns a tri-state: **verdict** (born stamped), **unavailable** (omni outage / breaker open / budget-0 async-release mode → born `pending`), **skip** (surface off / custom plane / no content → publish normally unstamped).
- **Born-pending = owner-private**: `canView`/`canViewInherited`/`appNamespaceVerdict` show pending post-family docs only to their owner (kind-scoped so in-flight attachment analysis keeps today's visibility); thread/reaction/count batch queries use `$nin: ['blocked','pending']`.
- **Release**: the async queue (fires at create) or the hourly cron overwrites the pending stamp with the real verdict; a clear/nsfw release triggers `notifyModerationRelease` → things.ts's registered notifier emits the deferred creation notifications at the moment the post becomes visible (release-time notifications — the earlier blocked-release caveat no longer applies to the pending flow). Blocked releases stay silent and hidden.
- **No stranding**: the sweep filter drains `moderation.status: 'pending'`; when the surface is OFF the sweep instead RELEASES stranded pending docs (bounded batches, deferred notifications fire) so a settings flip can't orphan content; admin pending stamps are never touched.
- The breaker keeps posting fast during outages — posts simply arrive born-pending instead of paying the budget toll.
- Tests: tri-state outcomes (incl. budget-0 semantics, breaker-open settings-still-resolve/no-omni-call), pending plan branching, release notification on clear vs silent on blocked, off-sweep release lifecycle, sweep filter shape. test:moderation 50/50.
