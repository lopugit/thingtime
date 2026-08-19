# PR #308 — NSFW/TOS media moderation pipeline

- **PR**: https://github.com/lopugit/thingtime/pull/308

- **Branch**: `claude/nsfw-tos-media-moderation-58c301` (stacked on `claude/media-upload-permission-gate`, PR #302)
- **Base**: `claude/media-upload-permission-gate`
- **Why**: media attachments are public content; beyond the PR #302 admin-grant gate, every uploaded image is analyzed for NSFW and TOS/illegal content, tagged with protected system attributes, blurred or quarantined accordingly, and surfaced to admins for review.

## Shape of the change

| Layer | What |
|---|---|
| Moderation utils (`api/utils/moderation/`) | `moderationCore.ts` (verdict → protected stamp mapping, bounded categories/reason, status guards), `providers.ts` (registry: `claude` \| `test` \| `off` via `THINGTIME_MODERATION_PROVIDER`; claude auto-selected when `ANTHROPIC_API_KEY` set), `claudeProvider.ts` (@anthropic-ai/sdk vision call, strict-JSON prompt, refusal → quarantine-for-review), `analyzeAttachment.ts` (orchestrator: load doc → gate on mediaKind/type/size → presigned-GET bytes → provider → stamp + flag; DI for tests; pending-only overwrites so verdicts never regress), `moderationAdmin.ts` (review queue, verdict overrides, bounded sweep). |
| Protected attributes | `moderation` is a ROOT field on attachment things (`{ status: pending\|skipped\|clear\|nsfw\|blocked, categories, provider, model, analyzedAt, reason }`) — generic Thing input has no path to root fields, so only `api/utils/moderation/` and admin review write it. `moderationFlag` things (`modflag-<attachmentId>`, system-owned, `storageClass: control`, empty acl) are the admin review/audit records. |
| Wiring (`attachments.ts`) | `completeAttachmentUpload` fire-and-forgets `queueModeration(shareId)` after markReady (optional DI dep, no-op in unit tests). `download` 404s blocked attachments for everyone except admins (viewer now carries `isAdmin`). |
| Projections | `toAttachmentPublicMetadata(id, crystal, moderation?)`: blocked → `null` (vanishes from feed/messenger payloads), nsfw → `nsfw: true`; both aggregation sites (`things.ts` post/comment resolver, `messenger.ts`) project + pass `moderation`. Client `PublicAttachment.nsfw`, normalize keeps only explicit server `true`, snapshot compares it. |
| UI (`PostAttachments.tsx`) | `NsfwShield`: blur(64px) + opacity 0.92 + scale(1.15) crop, 2px red border, rgba(229,72,77,.22) wash, centered mono NSFW badge, pill "Show Anyway" button; per-attachment per-render reveal state; wraps images and videos in feed, permalinks, and messenger. |
| Admin (`/admin` → Moderation) | `ModerationTab.tsx`: queue table (unreviewed first), status badges, View (admins can open blocked evidence), Clear/NSFW/Block overrides with Lopu toasts, "Run analysis sweep" + backlog counts. Route `GET/POST /api/v1/admin/moderation` (requireAdmin + withAdminPrivateResponse), registered in import map + apiDocs (auto docs smoke tests). |

## Key decisions

- **Post-hoc analysis, fail-safe stamps**: analysis never blocks or slows the upload response; failures leave `pending` (never a fabricated `clear`), and the admin sweep drains pending/unstamped docs after outages.
- **Claude refusal = signal**: if Claude's safety classifiers refuse to process an image, the attachment is quarantined (`blocked`, category `analysis-refused`) for human review rather than failing open.
- **`off` fails open by design** for dev environments without a key — the PR #302 admin-grant gate is the hard spam control; set the provider in prod (documented in README).
- **Blocked = vanish + 404**: no public placeholder, no oracle; admins keep evidence access through the same content route.
- Model default `claude-opus-5`, env-overridable via `TT_MODERATION_MODEL`.

## Verification log (2026-08-18)

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
