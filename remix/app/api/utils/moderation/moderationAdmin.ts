// Admin moderation surfaces: flag review list, verdict overrides, and the
// retry sweep. All reads/writes go through the home things collection —
// moderation is control-plane identity data and never follows a data-plane
// endpoint override.
import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { createAnalyzeReadyAttachment, moderationFlagShareId, MODERATION_FLAG_THINGTIME } from './analyzeAttachment';
import {
	analyzeTextThing,
	notifyModerationRelease,
	resolveConfiguredTextModeration,
	TEXT_FLAG_EXCERPT_CHARS,
	TEXT_MODERATED_THINGTIMES
} from './analyzeText';
import { sanitizeModerationCategories, type ModerationStatus } from './moderationCore';
import { getModerationSettings, setModerationSettings } from './moderationSettings';
import type { ModerationSettings } from './moderationSettingsCore';
import { resolveModerationProvider } from './providers';
import { resolveTextModeration } from './textModeration';

export type ModerationFlagRow = {
	id: string;
	attachmentId: string;
	// 'attachment' rows point at an upload; 'text' rows point at a post/comment
	// thing whose crystal.text was flagged (excerpt carries the evidence)
	targetKind: 'attachment' | 'text';
	excerpt: string | null;
	status: string;
	categories: string[];
	reason: string | null;
	provider: string | null;
	model: string | null;
	attachmentOwnerId: string;
	attachmentName: string;
	attachmentPurpose: string | null;
	reviewedBy: string | null;
	reviewedAt: string | null;
	createdAt: string | null;
	updatedAt: string | null;
};

export type ModerationOverview = {
	flags: ModerationFlagRow[];
	counts: {
		flags: number;
		unanalyzedReady: number;
		// post-family things with real text and no moderation stamp — the text
		// sweep's backlog (mid-flight deaths + anything posted while text
		// moderation was off)
		unmoderatedText: number;
	};
};

// Matches exactly what the text sweep drains: post-family docs whose
// crystal.text has any non-whitespace character and that either carry no
// moderation stamp at all OR carry a born-flagged stamp whose admin flag
// write was lost (flagPending). Whitespace-only text is excluded so zombie
// docs can never wedge the oldest-first batch.
export const UNMODERATED_TEXT_FILTER = {
	thingtime: { $in: [...TEXT_MODERATED_THINGTIMES] },
	$and: [
		// real prose OR at least one external image URL — whitespace-only,
		// contentless docs are excluded so zombies can't wedge the batch
		{ $or: [{ 'crystal.text': { $regex: /\S/ } }, { 'crystal.images.0': { $exists: true } }] },
		{ $or: [{ moderation: { $exists: false } }, { 'moderation.flagPending': true }, { 'moderation.status': 'pending' }] }
	]
} as const;

const MAX_FLAG_ROWS = 200;

const toFlagRow = (doc: any): ModerationFlagRow => ({
	id: String(doc.shareId),
	attachmentId: String(doc.targetId || ''),
	targetKind: doc.crystal?.targetKind === 'text' ? 'text' : 'attachment',
	excerpt: typeof doc.crystal?.excerpt === 'string' ? doc.crystal.excerpt : null,
	status: typeof doc.crystal?.status === 'string' ? doc.crystal.status : 'unknown',
	categories: sanitizeModerationCategories(doc.crystal?.categories),
	reason: typeof doc.crystal?.reason === 'string' ? doc.crystal.reason : null,
	provider: typeof doc.crystal?.provider === 'string' ? doc.crystal.provider : null,
	model: typeof doc.crystal?.model === 'string' ? doc.crystal.model : null,
	attachmentOwnerId: String(doc.crystal?.attachmentOwnerId || ''),
	attachmentName: String(doc.crystal?.attachmentName || ''),
	attachmentPurpose: typeof doc.crystal?.attachmentPurpose === 'string' ? doc.crystal.attachmentPurpose : null,
	reviewedBy: typeof doc.crystal?.reviewedBy === 'string' ? doc.crystal.reviewedBy : null,
	reviewedAt: doc.crystal?.reviewedAt ? new Date(doc.crystal.reviewedAt).toISOString() : null,
	createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
	updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null
});

// Unreviewed first (newest within each group) so the queue surfaces work.
export const listModerationOverview = async (): Promise<ModerationOverview> => {
	const things = await getHomeThingsCollection();
	const dataThings = await getThingsCollection();
	const [flagDocs, flagCount, unanalyzedReady, unmoderatedText] = await Promise.all([
		things
			.find({ thingtime: MODERATION_FLAG_THINGTIME } as any)
			.sort({ 'crystal.reviewedAt': 1, createdAt: -1 })
			.limit(MAX_FLAG_ROWS)
			.toArray(),
		things.countDocuments({ thingtime: MODERATION_FLAG_THINGTIME } as any),
		things.countDocuments({
			thingtime: 'attachment',
			attachmentState: 'ready',
			$or: [{ moderation: { $exists: false } }, { 'moderation.status': 'pending' }, { 'moderation.flagPending': true }]
		} as any),
		dataThings.countDocuments(UNMODERATED_TEXT_FILTER as any)
	]);
	return {
		flags: (flagDocs as any[]).map(toFlagRow),
		counts: { flags: flagCount, unanalyzedReady, unmoderatedText }
	};
};

// The Admin AI-moderation settings plus what each surface EFFECTIVELY runs
// after env/key fallback — so the picker never leaves an admin guessing what
// 'default' currently means in this environment.
export type ModerationSettingsView = {
	settings: ModerationSettings;
	effective: { media: string; text: string };
};

export const getModerationSettingsView = async (env: NodeJS.ProcessEnv = process.env): Promise<ModerationSettingsView> => {
	const settings = await getModerationSettings();
	const mediaChoice = await resolveModerationProvider(env, settings.mediaProvider);
	const textChoice = resolveTextModeration(env, settings.textProvider);
	return {
		settings,
		effective: {
			media: mediaChoice.kind === 'off' ? 'off' : mediaChoice.provider.name,
			text: textChoice.kind === 'off' ? 'off' : `${textChoice.provider} (${textChoice.model})`
		}
	};
};

export const updateModerationSettings = async (value: unknown, updatedBy: string): Promise<ModerationSettingsView> => {
	await setModerationSettings(value, updatedBy);
	return getModerationSettingsView();
};

export type ModerationReviewAction = 'clear' | 'nsfw' | 'block';

const REVIEW_STATUS: Record<ModerationReviewAction, ModerationStatus> = {
	clear: 'clear',
	nsfw: 'nsfw',
	block: 'blocked'
};

export type ModerationReviewResult =
	| { ok: false; status: number; error: string }
	| { ok: true; attachmentId: string; moderationStatus: ModerationStatus };

// Admin override: replaces whatever the pipeline stamped (including a landed
// verdict — that is the point of review) and records who decided what on the
// flag thing, which doubles as the audit log.
export const reviewAttachmentModeration = async (
	attachmentId: string,
	action: ModerationReviewAction,
	reviewerId: string
): Promise<ModerationReviewResult> => {
	const status = REVIEW_STATUS[action];
	if (!status) return { ok: false, status: 400, error: 'action must be clear, nsfw, or block' };
	const things = await getHomeThingsCollection();
	const doc = (await things.findOne({ thingtime: 'attachment', shareId: attachmentId } as any)) as any;
	if (!doc) return { ok: false, status: 404, error: 'Attachment not found' };
	const now = new Date();
	const moderation = {
		status,
		categories: sanitizeModerationCategories(doc.moderation?.categories),
		provider: 'admin',
		analyzedAt: now,
		reason: `admin review by ${reviewerId}`
	};
	await things.updateOne({ thingtime: 'attachment', shareId: attachmentId } as any, { $set: { moderation, updatedAt: now } });

	const flagShareId = moderationFlagShareId(attachmentId);
	if (status === 'clear') {
		// resolve any existing flag; nothing to review when the verdict is clear
		await things.updateOne(
			{ shareId: flagShareId, thingtime: MODERATION_FLAG_THINGTIME } as any,
			{ $set: { 'crystal.status': 'clear', 'crystal.reviewedBy': reviewerId, 'crystal.reviewedAt': now.toISOString(), updatedAt: now } }
		);
	} else {
		await things.updateOne(
			{ shareId: flagShareId } as any,
			{
				$set: {
					thingtime: [MODERATION_FLAG_THINGTIME],
					targetId: attachmentId,
					'crystal.status': status,
					'crystal.categories': moderation.categories,
					'crystal.reason': moderation.reason,
					'crystal.provider': 'admin',
					'crystal.model': null,
					'crystal.attachmentOwnerId': String(doc.ownerId || ''),
					'crystal.attachmentName': String(doc.crystal?.name || ''),
					'crystal.attachmentPurpose': typeof doc.attachmentPurpose === 'string' ? doc.attachmentPurpose : null,
					'crystal.reviewedBy': reviewerId,
					'crystal.reviewedAt': now.toISOString(),
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
	}
	return { ok: true, attachmentId, moderationStatus: status };
};

// Admin override for a TEXT flag: stamps the post/comment thing on the
// DATA-plane things collection (where posts live) and records the decision on
// the home flag doc. 'blocked' hides the doc from every read via canView;
// 'clear'/'nsfw' restore or advisory-mark it. Admin stamps are final for the
// pipeline (the analyzer never overwrites provider 'admin').
export const reviewTextModeration = async (
	thingId: string,
	action: ModerationReviewAction,
	reviewerId: string
): Promise<ModerationReviewResult> => {
	const status = REVIEW_STATUS[action];
	if (!status) return { ok: false, status: 400, error: 'action must be clear, nsfw, or block' };
	const things = await getThingsCollection();
	const home = await getHomeThingsCollection();
	const now = new Date();
	const flagShareId = moderationFlagShareId(thingId);
	const doc = (await things.findOne({ shareId: thingId } as any)) as any;
	if (!doc) {
		// The target was deleted (or reaped) after flagging: resolve the orphaned
		// flag instead of 404-pinning the queue forever.
		await home.updateOne(
			{ shareId: flagShareId, thingtime: MODERATION_FLAG_THINGTIME } as any,
			{ $set: { 'crystal.status': 'clear', 'crystal.reason': 'target no longer exists', 'crystal.reviewedBy': reviewerId, 'crystal.reviewedAt': now.toISOString(), updatedAt: now } }
		);
		return { ok: true, attachmentId: thingId, moderationStatus: 'clear' };
	}
	const moderation = {
		status,
		categories: sanitizeModerationCategories(doc.moderation?.categories),
		provider: 'admin',
		analyzedAt: now,
		reason: `admin review by ${reviewerId}`
	};
	await things.updateOne({ shareId: thingId } as any, { $set: { moderation, updatedAt: now } });
	if (status === 'clear') {
		// resolving an existing flag is enough; no new audit row for a clear
		await home.updateOne(
			{ shareId: flagShareId, thingtime: MODERATION_FLAG_THINGTIME } as any,
			{ $set: { 'crystal.status': status, 'crystal.reviewedBy': reviewerId, 'crystal.reviewedAt': now.toISOString(), updatedAt: now } }
		);
	} else {
		// nsfw/block always lands a full auditable queue row, even when the
		// pipeline never flagged the thing (admin-initiated takedown)
		const kinds: string[] = Array.isArray(doc.thingtime) ? doc.thingtime : [doc.thingtime].filter(Boolean);
		await home.updateOne(
			{ shareId: flagShareId } as any,
			{
				$set: {
					thingtime: [MODERATION_FLAG_THINGTIME],
					targetId: thingId,
					'crystal.targetKind': 'text',
					'crystal.status': status,
					'crystal.categories': moderation.categories,
					'crystal.reason': moderation.reason,
					'crystal.provider': 'admin',
					'crystal.model': null,
					'crystal.attachmentOwnerId': String(doc.ownerId || ''),
					'crystal.attachmentName': '',
					'crystal.attachmentPurpose': kinds.includes('comment') ? 'comment' : kinds.includes('share') ? 'share' : 'post',
					'crystal.excerpt': String(doc.crystal?.text || '').slice(0, TEXT_FLAG_EXCERPT_CHARS),
					'crystal.reviewedBy': reviewerId,
					'crystal.reviewedAt': now.toISOString(),
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
	}
	return { ok: true, attachmentId: thingId, moderationStatus: status };
};

export type ModerationSweepResult = {
	scanned: number;
	analyzed: number;
	flagged: number;
	skipped: number;
	failed: number;
};

// One pass remains deliberately small so a single cron request stays bounded.
// The durable workflow uses these exact limits to decide whether this pass
// exhausted a surface and should immediately continue with a fresh run.
export const ATTACHMENT_SWEEP_BATCH = 10;
export const TEXT_SWEEP_BATCH = 25;

export type TextSweepResult = {
	scanned: number;
	analyzed: number;
	flagged: number;
	failed: number;
	// true when the text surface resolved to 'off' — absence of a stamp is
	// ambiguous by design in off mode, so the sweep refuses to churn (but it
	// still RELEASES born-pending docs so an off flip can't strand them)
	skippedOff: boolean;
	// born-pending docs released because the surface is off
	released?: number;
};

export type TextSweepDependencies = {
	getThings: typeof getThingsCollection;
	resolveText: typeof resolveConfiguredTextModeration;
	analyze: typeof analyzeTextThing;
};

// Retry/backfill path for post/comment text the fire-and-forget kickoff lost
// (process death between the post write and the verdict stamp, provider
// outages) — and, because omni is free, the drain path for anything posted
// while text moderation was off. Bounded oldest-first batch per call; failures
// stay unstamped and are retried on the next run.
export const sweepUnmoderatedTextThings = async (
	overrides: Partial<TextSweepDependencies> = {}
): Promise<TextSweepResult> => {
	const deps: TextSweepDependencies = {
		getThings: getThingsCollection,
		resolveText: resolveConfiguredTextModeration,
		analyze: analyzeTextThing,
		...overrides
	};
	if ((await deps.resolveText()).kind === 'off') {
		// Off must never strand born-private docs: release a bounded batch of
		// non-admin pending stamps (they become ordinary unstamped public posts)
		// and emit their deferred creation notifications.
		const things = await deps.getThings();
		const stranded = (await things
			.find({ thingtime: { $in: [...TEXT_MODERATED_THINGTIMES] }, 'moderation.status': 'pending', 'moderation.provider': { $ne: 'admin' } } as any)
			.project({ shareId: 1 })
			.sort({ createdAt: 1 })
			.limit(TEXT_SWEEP_BATCH)
			.toArray()) as any[];
		for (const doc of stranded) {
			await things.updateOne(
				{ shareId: doc.shareId, 'moderation.status': 'pending', 'moderation.provider': { $ne: 'admin' } } as any,
				{ $unset: { moderation: '' }, $set: { updatedAt: new Date() } }
			);
			notifyModerationRelease(String(doc.shareId));
		}
		return { scanned: stranded.length, analyzed: 0, flagged: 0, failed: 0, skippedOff: true, released: stranded.length };
	}
	const things = await deps.getThings();
	const candidates = (await things
		.find(UNMODERATED_TEXT_FILTER as any)
		.project({ shareId: 1 })
		.sort({ createdAt: 1 })
		.limit(TEXT_SWEEP_BATCH)
		.toArray()) as any[];
	const result: TextSweepResult = { scanned: candidates.length, analyzed: 0, flagged: 0, failed: 0, skippedOff: false };
	for (const candidate of candidates) {
		const outcome = await deps.analyze(String(candidate.shareId));
		if (outcome.ok === false) {
			result.failed += 1;
			continue;
		}
		// 'unmoderated' = the doc changed under us (text emptied, provider
		// flipped off mid-run) — it simply drops out of the next run's filter
		if (outcome.status === 'unmoderated') continue;
		result.analyzed += 1;
		if (outcome.status === 'nsfw' || outcome.status === 'blocked') result.flagged += 1;
	}
	return result;
};

// Retry path for attachments the fire-and-forget kickoff missed (deploy
// restarts, provider outages). Bounded per call; run repeatedly to drain.
export const sweepUnanalyzedAttachments = async (
	analyze = createAnalyzeReadyAttachment()
): Promise<ModerationSweepResult> => {
	const things = await getHomeThingsCollection();
	const candidates = (await things
		.find({
			thingtime: 'attachment',
			attachmentState: 'ready',
			$or: [{ moderation: { $exists: false } }, { 'moderation.status': 'pending' }, { 'moderation.flagPending': true }]
		} as any)
		.project({ shareId: 1 })
		.sort({ createdAt: 1 })
		.limit(ATTACHMENT_SWEEP_BATCH)
		.toArray()) as any[];

	const result: ModerationSweepResult = { scanned: candidates.length, analyzed: 0, flagged: 0, skipped: 0, failed: 0 };
	for (const candidate of candidates) {
		const outcome = await analyze(String(candidate.shareId));
		if (outcome.ok === false) {
			result.failed += 1;
			continue;
		}
		if (outcome.status === 'skipped') result.skipped += 1;
		else result.analyzed += 1;
		if (outcome.status === 'nsfw' || outcome.status === 'blocked') result.flagged += 1;
	}
	return result;
};

export type ModerationSweepBatchResult = {
	text: TextSweepResult;
	attachments: ModerationSweepResult;
	// Each full, failure-free surface is safe to continue immediately. A
	// provider failure deliberately breaks that surface's chain: its candidate
	// remains unstamped/pending and the hourly cron is the conservative retry.
	hasMore: boolean;
};

export const shouldContinueModerationSweep = (text: TextSweepResult, attachments: ModerationSweepResult): boolean =>
	(text.scanned === TEXT_SWEEP_BATCH && text.failed === 0) ||
	(attachments.scanned === ATTACHMENT_SWEEP_BATCH && attachments.failed === 0);

export const runModerationSweepBatch = async (): Promise<ModerationSweepBatchResult> => {
	const [text, attachments] = await Promise.all([sweepUnmoderatedTextThings(), sweepUnanalyzedAttachments()]);
	return { text, attachments, hasMore: shouldContinueModerationSweep(text, attachments) };
};
