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
import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { MODERATION_FLAG_THINGTIME, moderationFlagShareId } from './analyzeAttachment';
import { moderationFromVerdict, type ModerationStatus } from './moderationCore';
import { getModerationSettings } from './moderationSettings';
import { DEFAULT_MODERATION_SETTINGS } from './moderationSettingsCore';
import { mapOmniTextVerdict, resolveTextModeration, type TextModerationChoice } from './textModeration';

export const TEXT_FLAG_EXCERPT_CHARS = 500;

// Post-family kinds whose crystal.text is user-authored prose worth screening.
export const TEXT_MODERATED_THINGTIMES = new Set(['post', 'comment', 'share']);

export type AnalyzeTextDependencies = {
	getThings: typeof getThingsCollection;
	getHomeThings: typeof getHomeThingsCollection;
	resolveText: () => Promise<TextModerationChoice>;
	now: () => Date;
};

const defaultResolveText = async (): Promise<TextModerationChoice> => {
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
	resolveText: defaultResolveText,
	now: () => new Date()
});

export type AnalyzeTextResult = { ok: true; status: ModerationStatus | 'unmoderated' } | { ok: false; error: string; retryable: boolean };

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
		const text = String(doc.crystal?.text || '').trim();
		if (!text) {
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
			const verdict = mapOmniTextVerdict(await choice.screen(text));
			const now = deps.now();
			const moderation = moderationFromVerdict(verdict, { provider: choice.provider, model: choice.model, now });
			// Guarded stamp: the pipeline may lay a first verdict or replace its own
			// stale one (edits change the text), but an admin review stamp is final
			// until an admin changes it.
			const stamped = await things.updateOne(
				{ shareId, $or: [{ moderation: { $exists: false } }, { 'moderation.provider': { $ne: 'admin' } }] } as any,
				{ $set: { moderation, updatedAt: now } }
			);
			const home = await deps.getHomeThings();
			const flagShareId = moderationFlagShareId(String(doc.shareId));
			if (moderation.status === 'nsfw' || moderation.status === 'blocked') {
				// Flag EVERY flagged verdict — even when an admin stamp kept the
				// pipeline from touching the doc: an edit AFTER an admin 'clear' must
				// resurface in the queue (resetting the reviewed markers), or a user
				// could launder content by editing violations in post-review.
				await home.updateOne(
					{ shareId: flagShareId } as any,
					{
						$set: {
							thingtime: [MODERATION_FLAG_THINGTIME],
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
							ownerId: 'system',
							storageClass: 'control',
							acl: [],
							tags: [],
							createdAt: now
						}
					},
					{ upsert: true }
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
