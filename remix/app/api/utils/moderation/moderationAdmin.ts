// Admin moderation surfaces: flag review list, verdict overrides, and the
// retry sweep. All reads/writes go through the home things collection —
// moderation is control-plane identity data and never follows a data-plane
// endpoint override.
import { getHomeThingsCollection } from '../mongodb/collections';
import { createAnalyzeReadyAttachment, moderationFlagShareId, MODERATION_FLAG_THINGTIME } from './analyzeAttachment';
import { sanitizeModerationCategories, type ModerationStatus } from './moderationCore';

export type ModerationFlagRow = {
	id: string;
	attachmentId: string;
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
	};
};

const MAX_FLAG_ROWS = 200;

const toFlagRow = (doc: any): ModerationFlagRow => ({
	id: String(doc.shareId),
	attachmentId: String(doc.targetId || ''),
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
	const [flagDocs, flagCount, unanalyzedReady] = await Promise.all([
		things
			.find({ thingtime: MODERATION_FLAG_THINGTIME } as any)
			.sort({ 'crystal.reviewedAt': 1, createdAt: -1 })
			.limit(MAX_FLAG_ROWS)
			.toArray(),
		things.countDocuments({ thingtime: MODERATION_FLAG_THINGTIME } as any),
		things.countDocuments({
			thingtime: 'attachment',
			attachmentState: 'ready',
			$or: [{ moderation: { $exists: false } }, { 'moderation.status': 'pending' }]
		} as any)
	]);
	return {
		flags: (flagDocs as any[]).map(toFlagRow),
		counts: { flags: flagCount, unanalyzedReady }
	};
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

export type ModerationSweepResult = {
	scanned: number;
	analyzed: number;
	flagged: number;
	skipped: number;
	failed: number;
};

const SWEEP_BATCH = 10;

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
			$or: [{ moderation: { $exists: false } }, { 'moderation.status': 'pending' }]
		} as any)
		.project({ shareId: 1 })
		.sort({ createdAt: 1 })
		.limit(SWEEP_BATCH)
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
