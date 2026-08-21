// Post/comment text moderation orchestrator. Runs asynchronously after
// createThing/updateThing land a post-family doc with text (fire-and-forget —
// analysis never blocks or slows the write). Screens crystal.text with the
// free omni endpoint (textModeration.ts), stamps the PROTECTED `moderation`
// root field on the thing, and logs a moderationFlag for admin review when
// flagged. Verdicts:
//   blocked → the doc vanishes from every public read (canView + thread
//             loading both exclude it); the flag carries a bounded excerpt so
//             admins can review without resurrecting the content.
//   nsfw    → advisory: content stays visible, flag queues admin review
//             (text has no blur treatment).
// Posts live on the DATA-plane things collection; moderationFlag things are
// admin control-plane docs and stay on HOME, like attachment flags.
//
// Failure posture: an analysis error leaves the doc unstamped — never a
// fabricated 'clear'. Edits re-analyze and may overwrite any non-admin stamp
// (the text changed, so the old verdict is stale); admin review stamps are
// never overwritten by the pipeline.
import { createHash } from 'node:crypto';

import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { MODERATION_FLAG_THINGTIME, moderationFlagShareId } from './analyzeAttachment';
import { moderationFromVerdict, type AttachmentModeration, type ModerationStatus } from './moderationCore';
import { getModerationSettings } from './moderationSettings';
import { DEFAULT_MODERATION_SETTINGS } from './moderationSettingsCore';
import {
	hasModeratedContent,
	mapOmniTextVerdict,
	moderatedContentOf,
	resolveTextModeration,
	type ModeratedContent,
	type TextModerationChoice
} from './textModeration';

export const TEXT_FLAG_EXCERPT_CHARS = 500;

// Fingerprint of the exact (trimmed) text a verdict describes. Fences stale
// stamps out of racing pipeline runs and distinguishes "provider flip-flop on
// identical text" (block stays sticky) from "the author actually edited"
// (fresh verdict allowed).
export const moderationTextHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

// Fingerprint of EVERYTHING a combined screen judges (prose + listing text +
// tags + external image URLs) — the unit of "did the moderated content
// actually change" for edit re-screens and sticky blocks.
export const moderatedContentFingerprint = (content: ModeratedContent): string =>
	moderationTextHash(`${content.text}\u0000${content.imageUrls.join('\u0000')}`);

// Post-family kinds whose crystal.text is user-authored prose worth screening.
export const TEXT_MODERATED_THINGTIMES = new Set(['post', 'comment', 'share']);

export type AnalyzeTextDependencies = {
	getThings: typeof getThingsCollection;
	getHomeThings: typeof getHomeThingsCollection;
	resolveText: () => Promise<TextModerationChoice>;
	now: () => Date;
};

// Admin-settings-aware text resolution — the sweep pre-checks this so an
// 'off' surface never churns through the unstamped corpus doing nothing.
export const resolveConfiguredTextModeration = async (): Promise<TextModerationChoice> => {
	let adminProvider = DEFAULT_MODERATION_SETTINGS.textProvider;
	try {
		adminProvider = (await getModerationSettings()).textProvider;
	} catch (error) {
		console.warn('[moderation] settings read failed; using env default text provider:', (error as Error)?.message || error);
	}
	return resolveTextModeration(process.env, adminProvider);
};

const defaultDependencies = (): AnalyzeTextDependencies => ({
	getThings: getThingsCollection,
	getHomeThings: getHomeThingsCollection,
	resolveText: resolveConfiguredTextModeration,
	now: () => new Date()
});

export type AnalyzeTextResult = { ok: true; status: ModerationStatus | 'unmoderated' } | { ok: false; error: string; retryable: boolean };

// Fail-closed posture (owner decision 2026-08-19): while text moderation is
// ON, no post-family content ever goes public unscreened. The sync screen
// gates creation; when a verdict can't be obtained (omni outage, breaker
// open, sync gate disabled) the doc is BORN PENDING — visible only to its
// owner — and the async queue + hourly cron screen and RELEASE it (creation
// notifications fire at release, when followers can actually see it).
// 'skip' (surface off / custom plane / no content) publishes normally.
export type SyncScreenOutcome = { kind: 'verdict'; stamp: AttachmentModeration } | { kind: 'unavailable' } | { kind: 'skip' };

// The born-private marker. provider 'openai' + status 'pending' → the
// analyzer's non-admin guard overwrites it with the real verdict on release.
export const pendingModerationStamp = (content: ModeratedContent): AttachmentModeration => ({
	status: 'pending',
	provider: 'openai',
	model: 'omni-moderation-latest',
	textHash: moderatedContentFingerprint(content)
});

// things.ts registers the actual notifier (it owns emitCreationNotifications);
// moderation modules only signal "this doc just became publicly visible".
let moderationReleaseNotifier: ((shareId: string) => void) | null = null;
export const setModerationReleaseNotifier = (notifier: (shareId: string) => void): void => {
	moderationReleaseNotifier = notifier;
};
export const notifyModerationRelease = (shareId: string): void => {
	moderationReleaseNotifier?.(shareId);
};

// Per-instance circuit breaker for the sync gate: after a few consecutive
// sync-screen failures the breaker OPENS and posts skip the budget toll
// entirely (zero added latency during a confirmed omni outage), then a
// cool-down expiry lets the next post probe again. Warm serverless instances
// learn within a few posts; a cold instance pays at most one probe.
export type SyncScreenBreaker = { failures: number; openUntil: number };
export const SYNC_SCREEN_BREAKER_THRESHOLD = 3;
export const SYNC_SCREEN_BREAKER_COOLDOWN_MS = 60_000;
const defaultSyncScreenBreaker: SyncScreenBreaker = { failures: 0, openUntil: 0 };

// ---- Hybrid create-time screen ---------------------------------------------
// createThing gives the free omni screen a bounded time budget BEFORE the
// insert: when the verdict lands in time the doc is born stamped — blocked
// content never renders anywhere, not even briefly. When omni is slow or down
// the race resolves unavailable, the post proceeds instantly but is born
// owner-private with a pending stamp; the async queue + hourly sweep release it
// only after a verdict (moderation never breaks or visibly slows posting).

export const DEFAULT_TEXT_SCREEN_BUDGET_MS = 600;

// TT_TEXT_SCREEN_BUDGET_MS overrides; '0' disables the sync gate entirely
// (pure async pipeline). Clamped to <= 10s so a typo can never wedge posting.
export const resolveTextScreenBudgetMs = (env: NodeJS.ProcessEnv = process.env): number => {
	const raw = env.TT_TEXT_SCREEN_BUDGET_MS?.trim();
	if (!raw) return DEFAULT_TEXT_SCREEN_BUDGET_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : DEFAULT_TEXT_SCREEN_BUDGET_MS;
};

export type ScreenTextDependencies = {
	resolveText: () => Promise<TextModerationChoice>;
	budgetMs: number;
	now: () => Date;
	breaker: SyncScreenBreaker;
	nowMs: () => number;
};

// Never throws and never exceeds its budget by design — every failure mode
// (custom plane, off, empty text, timeout, provider error) returns null and
// the caller falls back to the async pipeline.
export const screenTextForCreate = async (
	content: ModeratedContent,
	overrides: Partial<ScreenTextDependencies> = {}
): Promise<SyncScreenOutcome> => {
	const breaker = overrides.breaker ?? defaultSyncScreenBreaker;
	const nowMs = overrides.nowMs ?? Date.now;
	const recordFailure = () => {
		breaker.failures += 1;
		if (breaker.failures >= SYNC_SCREEN_BREAKER_THRESHOLD) {
			breaker.openUntil = nowMs() + SYNC_SCREEN_BREAKER_COOLDOWN_MS;
			breaker.failures = 0;
			console.warn('[moderation] sync screen breaker OPEN — posts are born pending until', new Date(breaker.openUntil).toISOString());
		}
	};
	try {
		if (isCustomMongoEndpointActive()) return { kind: 'skip' };
		if (!hasModeratedContent(content)) return { kind: 'skip' };
		const budgetMs = overrides.budgetMs ?? resolveTextScreenBudgetMs();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), Math.max(budgetMs, 1));
			(timer as { unref?: () => void }).unref?.();
		});
		// Breaker open (confirmed outage) or budget 0 (async-release mode):
		// never call omni, but STILL resolve the surface so 'off' publishes
		// normally while an active surface fails closed to born-pending.
		if (nowMs() < breaker.openUntil || budgetMs <= 0) {
			const choiceAttempt = (overrides.resolveText ?? resolveConfiguredTextModeration)();
			choiceAttempt.catch(() => {});
			const choice = await Promise.race([choiceAttempt, timeout]).finally(() => clearTimeout(timer));
			return choice && choice.kind === 'off' ? { kind: 'skip' } : { kind: 'unavailable' };
		}
		// EVERYTHING variable-latency — the settings read AND the omni call —
		// races the budget, so no degraded dependency can hold a post hostage.
		const attempt = (async () => {
			const choice = await (overrides.resolveText ?? resolveConfiguredTextModeration)();
			if (choice.kind === 'off') return 'off' as const;
			return { choice, verdict: mapOmniTextVerdict(await choice.screen(content)) };
		})();
		// a rejection landing AFTER the timeout already won the race must never
		// surface as an unhandled rejection
		attempt.catch(() => {});
		const screened = await Promise.race([attempt, timeout]).finally(() => clearTimeout(timer));
		if (screened === 'off') return { kind: 'skip' };
		if (!screened) {
			// distinguish "surface off" (neutral skip) from a real timeout
			// (failure → born pending): the attempt may have resolved just after
			const settled = await Promise.race([attempt.then((value) => value, () => 'rejected' as const), Promise.resolve('pending' as const)]);
			if (settled === 'off') return { kind: 'skip' };
			if (settled === 'pending' || settled === 'rejected') recordFailure();
			return { kind: 'unavailable' };
		}
		breaker.failures = 0;
		const stamp = moderationFromVerdict(screened.verdict, {
			provider: screened.choice.provider,
			model: screened.choice.model,
			now: (overrides.now ?? (() => new Date()))()
		});
		stamp.textHash = moderatedContentFingerprint(content);
		// the admin flag hasn't been written yet — createThing writes it inline
		// right after the insert, and the hourly sweep drains any doc where that
		// write was lost (the marker is cleared once a flag lands)
		if (stamp.status === 'nsfw' || stamp.status === 'blocked') stamp.flagPending = true;
		return { kind: 'verdict', stamp };
	} catch (error) {
		recordFailure();
		console.warn('[moderation] sync text screen failed; the doc is born pending:', (error as Error)?.message || error);
		return { kind: 'unavailable' };
	}
};

export const createAnalyzeTextThing =
	(overrides: Partial<AnalyzeTextDependencies> = {}) =>
	async (shareId: string): Promise<AnalyzeTextResult> => {
		const deps = { ...defaultDependencies(), ...overrides };
		const choice = await deps.resolveText();
		// off = leave the doc entirely unstamped: unlike attachments there is no
		// sweep draining text backlogs, and stamping every post would be pure
		// write churn.
		if (choice.kind === 'off') return { ok: true, status: 'unmoderated' };

		const things = await deps.getThings();
		const doc = (await things.findOne({ shareId } as any)) as any;
		if (!doc) return { ok: false, error: 'Thing not found', retryable: false };
		const kinds: string[] = Array.isArray(doc.thingtime) ? doc.thingtime : [doc.thingtime].filter(Boolean);
		if (!kinds.some((kind) => TEXT_MODERATED_THINGTIMES.has(kind))) {
			return { ok: false, error: 'Not a text-moderated thing', retryable: false };
		}
		const content = moderatedContentOf(doc);
		const text = content.text.trim();
		if (!hasModeratedContent(content)) {
			// Emptied text: the old verdict describes prose that no longer exists.
			// Clear a stale pipeline stamp (admin stamps stay final) and resolve
			// any unreviewed flag; write nothing when there was never a stamp.
			if (doc.moderation) {
				const now = deps.now();
				const cleared = await things.updateOne(
					{ shareId, moderation: { $exists: true }, 'moderation.provider': { $ne: 'admin' } } as any,
					{ $unset: { moderation: '' }, $set: { updatedAt: now } }
				);
				if (cleared.modifiedCount > 0) {
					const home = await deps.getHomeThings();
					await home.updateOne(
						{ shareId: moderationFlagShareId(String(doc.shareId)), thingtime: MODERATION_FLAG_THINGTIME, 'crystal.reviewedBy': null } as any,
						{ $set: { 'crystal.status': 'clear', 'crystal.excerpt': '', 'crystal.reason': 'text removed by edit', updatedAt: now } }
					);
				}
			}
			return { ok: true, status: 'unmoderated' };
		}

		try {
			const rawText = doc.crystal?.text;
			const rawImages = doc.crystal?.images;
			const verdict = mapOmniTextVerdict(await choice.screen(content));
			const now = deps.now();
			let moderation = moderationFromVerdict(verdict, { provider: choice.provider, model: choice.model, now });
			const textHash = moderatedContentFingerprint(content);
			const prior = doc.moderation as AttachmentModeration | undefined;
			if (prior?.status === 'blocked' && prior.provider !== 'admin' && prior.textHash === textHash && moderation.status !== 'blocked') {
				// Provider flip-flop on IDENTICAL text never relaxes a block — only
				// admin review, or an actual edit (which changes the hash), can.
				moderation = {
					...moderation,
					status: 'blocked',
					reason: `${moderation.reason ? `${moderation.reason} ` : ''}(block retained: identical text was previously blocked)`.slice(0, 500)
				};
			}
			moderation = {
				...moderation,
				textHash,
				...((moderation.status === 'nsfw' || moderation.status === 'blocked') ? { flagPending: true } : {})
			};
			// Guarded stamp: the pipeline may lay a first verdict or replace its own
			// stale one, but an admin review stamp is final until an admin changes
			// it, and the crystal.text fence keeps a slow verdict for OLD text from
			// stamping over an edit that a fresher run already re-screened.
			const stamped = await things.updateOne(
				{
					shareId,
					'crystal.text': rawText,
					...(Array.isArray(rawImages) ? { 'crystal.images': rawImages } : {}),
					$or: [{ moderation: { $exists: false } }, { 'moderation.provider': { $ne: 'admin' } }]
				} as any,
				{ $set: { moderation, updatedAt: now } }
			);
			// A born-pending doc that just became publicly visible emits its
			// creation notifications NOW — followers hear about it when they can
			// actually see it (blocked releases stay silent and hidden).
			if (stamped.modifiedCount > 0 && prior?.status === 'pending' && (moderation.status === 'clear' || moderation.status === 'nsfw')) {
				notifyModerationRelease(String(doc.shareId));
			}
			const home = await deps.getHomeThings();
			const flagShareId = moderationFlagShareId(String(doc.shareId));
			if (moderation.status === 'nsfw' || moderation.status === 'blocked') {
				// Flag EVERY flagged verdict — even when an admin stamp kept the
				// pipeline from touching the doc: an edit AFTER an admin 'clear' must
				// resurface in the queue (resetting the reviewed markers), or a user
				// could launder content by editing violations in post-review.
				await upsertTextModerationFlag(home, doc, moderation, text || `[image urls] ${content.imageUrls.slice(0, 3).join(' ')}`, now);
				// the flag landed: clear any flagPending marker a born-flagged sync
				// stamp left behind (admin stamps never carry it)
				await things.updateOne(
					{ shareId, 'moderation.flagPending': true, 'moderation.provider': { $ne: 'admin' } } as any,
					{ $unset: { 'moderation.flagPending': '' } }
				);
			} else if (stamped.modifiedCount > 0) {
				// Re-analysis cleared edited text: resolve any UNREVIEWED flag so the
				// queue doesn't keep showing evidence that no longer exists. Reviewed
				// flags stay as the audit log (mirrors the attachment clear branch).
				await home.updateOne(
					{ shareId: flagShareId, thingtime: MODERATION_FLAG_THINGTIME, 'crystal.reviewedBy': null } as any,
					{
						$set: {
							'crystal.status': 'clear',
							'crystal.excerpt': text.slice(0, TEXT_FLAG_EXCERPT_CHARS),
							'crystal.reason': 're-analyzed after edit: clear',
							updatedAt: now
						}
					}
				);
			}
			return { ok: true, status: moderation.status };
		} catch (error) {
			console.error(`[moderation] text analysis failed for thing ${shareId}:`, (error as Error)?.message || error);
			return { ok: false, error: 'Text moderation analysis failed', retryable: true };
		}
	};

export const analyzeTextThing = createAnalyzeTextThing();

// Fire-and-forget hook for createThing/updateThing: moderation must never
// fail or slow the write that triggered it. Custom data-plane overrides are
// refused outright (mirroring emitCreationNotifications): override-plane docs
// can deliberately collide with home shareIds, and the flag upsert writes to
// Thingtime's HOME control plane — an untrusted plane must never be able to
// inject or clobber home moderation flags (or bait an admin block against a
// home doc that shares the id).
export const queueTextModeration = (shareId: string): void => {
	if (isCustomMongoEndpointActive()) return;
	void analyzeTextThing(shareId).catch(() => {});
};

// The single writer of text moderationFlag docs (HOME plane) — used by the
// async analyzer, and inline by createThing for born-flagged docs so the
// admin queue row lands in the same request as the born stamp.
export const upsertTextModerationFlag = async (
	home: Awaited<ReturnType<typeof getHomeThingsCollection>>,
	doc: { shareId: unknown; ownerId?: unknown; thingtime?: unknown },
	moderation: AttachmentModeration,
	text: string,
	now: Date
): Promise<void> => {
	const kinds: string[] = Array.isArray(doc.thingtime) ? (doc.thingtime as string[]) : [doc.thingtime as string].filter(Boolean);
	const flagShareId = moderationFlagShareId(String(doc.shareId));
	await home.updateOne(
		{ shareId: flagShareId, thingtime: MODERATION_FLAG_THINGTIME } as any,
		{
			$set: {
				targetId: String(doc.shareId),
				crystal: {
					targetKind: 'text',
					status: moderation.status,
					categories: moderation.categories ?? [],
					reason: moderation.reason ?? null,
					provider: moderation.provider ?? null,
					model: moderation.model ?? null,
					attachmentOwnerId: String(doc.ownerId || ''),
					attachmentName: '',
					attachmentPurpose: kinds.includes('comment') ? 'comment' : kinds.includes('share') ? 'share' : 'post',
					excerpt: text.slice(0, TEXT_FLAG_EXCERPT_CHARS),
					reviewedBy: null,
					reviewedAt: null
				},
				updatedAt: now
			},
			$setOnInsert: {
				shareId: flagShareId,
				thingtime: [MODERATION_FLAG_THINGTIME],
				ownerId: 'system',
				storageClass: 'control',
				acl: [],
				tags: [],
				createdAt: now
			}
		},
		{ upsert: true }
	);
};

// Pure post-insert decision for createThing: who gets notified and which
// moderation follow-up runs. Kept Mongo-free so the branching is unit-tested.
export type PostInsertModerationPlan = { notify: boolean; inlineFlag: boolean; queueAsync: boolean };

export const postInsertModerationPlan = (doc: {
	thingtime?: unknown;
	crystal?: { text?: unknown } | null;
	tags?: unknown;
	moderation?: { status?: string } | null;
}): PostInsertModerationPlan => {
	const status = doc.moderation?.status;
	const kinds: string[] = Array.isArray(doc.thingtime) ? (doc.thingtime as string[]) : [doc.thingtime as string].filter(Boolean);
	const textKind = kinds.some((kind) => TEXT_MODERATED_THINGTIMES.has(String(kind)));
	const screenable = hasModeratedContent(moderatedContentOf(doc as any));
	return {
		// born-blocked docs are invisible everywhere; born-PENDING docs are
		// owner-private until released — either way, notify at release, not now
		notify: status !== 'blocked' && status !== 'pending',
		// born-flagged docs get their admin flag written inline, same request
		inlineFlag: textKind && (status === 'nsfw' || status === 'blocked'),
		// pending docs queue immediately (a slow-blip verdict releases them in
		// seconds); unstamped screenable docs queue the ordinary async screen
		queueAsync: textKind && (status === 'pending' || (!status && screenable))
	};
};
