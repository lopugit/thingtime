// Post-upload moderation orchestrator. Runs asynchronously after an
// attachment reaches `ready` (fire-and-forget from completeAttachmentUpload;
// the admin sweep re-runs anything still pending/unstamped). Loads the doc,
// picks the provider, fetches the bytes through a short-lived presigned GET,
// stamps the verdict on the PROTECTED `moderation` root field, and logs a
// `moderationFlag` thing for admin review when the verdict is nsfw/blocked.
//
// Failure posture: an analysis error leaves the doc pending (or unstamped) —
// never a fabricated 'clear'. Blocked docs stop being served the moment the
// stamp lands (content route + public projections both check it).
import { getHomeThingsCollection } from '../mongodb/collections';
import { attachmentContentDisposition } from '../attachments/attachmentPresentation';
import { getPrivateS3, type AttachmentS3 } from '../attachments/privateS3';
import {
	moderationFromVerdict,
	type AttachmentModeration,
	type ModerationStatus
} from './moderationCore';
import { resolveConfiguredModerationProvider, type ModerationProviderChoice } from './providers';

// Claude vision's accepted raster set; avif stays unanalyzed (skipped).
export const ANALYZABLE_IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
// Bound what we pull into memory and ship to a provider.
export const MAX_MODERATION_IMAGE_BYTES = 10 * 1024 * 1024;

export const MODERATION_FLAG_THINGTIME = 'moderationFlag' as const;
export const moderationFlagShareId = (attachmentShareId: string) => `modflag-${attachmentShareId}`;

export type AnalyzeAttachmentDependencies = {
	getThings: typeof getHomeThingsCollection;
	getS3: () => AttachmentS3;
	resolveProvider: () => Promise<ModerationProviderChoice>;
	fetchBytes: (url: string) => Promise<Uint8Array>;
	now: () => Date;
};

const defaultFetchBytes = async (url: string): Promise<Uint8Array> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`moderation: object fetch failed (${response.status})`);
	return new Uint8Array(await response.arrayBuffer());
};

const defaultDependencies = (): AnalyzeAttachmentDependencies => ({
	getThings: getHomeThingsCollection,
	getS3: getPrivateS3,
	resolveProvider: () => resolveConfiguredModerationProvider(),
	fetchBytes: defaultFetchBytes,
	now: () => new Date()
});

export type AnalyzeAttachmentResult =
	| { ok: true; status: ModerationStatus }
	| { ok: false; error: string; retryable: boolean };

// Stamp the moderation root field. Guarded on the current status so a racing
// sweep + fire-and-forget pair can't clobber a landed verdict with an older
// one: verdicts only ever replace 'pending'/absent stamps.
const stampModeration = async (
	things: Awaited<ReturnType<typeof getHomeThingsCollection>>,
	shareId: string,
	moderation: AttachmentModeration,
	options: { allowOverwriteOf: Array<ModerationStatus | null> ; now: Date }
): Promise<boolean> => {
	const statusClauses: any[] = [];
	if (options.allowOverwriteOf.includes(null)) statusClauses.push({ moderation: { $exists: false } });
	const overwritable = options.allowOverwriteOf.filter((status): status is ModerationStatus => status !== null);
	if (overwritable.length) statusClauses.push({ 'moderation.status': { $in: overwritable } });
	const res = await things.updateOne(
		{ thingtime: 'attachment', shareId, $or: statusClauses } as any,
		{ $set: { moderation, updatedAt: options.now } }
	);
	return res.modifiedCount > 0;
};

// Idempotent admin-review flag: deterministic shareId per attachment, so
// re-analysis upserts rather than duplicating. Control-plane doc (system
// owner, empty acl) — visible only to admin surfaces that query the kind
// directly, never through ordinary ACL reads.
const upsertModerationFlag = async (
	things: Awaited<ReturnType<typeof getHomeThingsCollection>>,
	doc: any,
	moderation: AttachmentModeration,
	now: Date
) => {
	const shareId = moderationFlagShareId(String(doc.shareId));
	await things.updateOne(
		{ shareId, thingtime: MODERATION_FLAG_THINGTIME } as any,
		{
			$set: {
				targetId: String(doc.shareId),
				crystal: {
					status: moderation.status,
					categories: moderation.categories ?? [],
					reason: moderation.reason ?? null,
					provider: moderation.provider ?? null,
					model: moderation.model ?? null,
					attachmentOwnerId: String(doc.ownerId || ''),
					attachmentName: String(doc.crystal?.name || ''),
					attachmentPurpose: typeof doc.attachmentPurpose === 'string' ? doc.attachmentPurpose : null,
					reviewedBy: null,
					reviewedAt: null
				},
				updatedAt: now
			},
			$setOnInsert: {
				shareId,
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

export const createAnalyzeReadyAttachment =
	(overrides: Partial<AnalyzeAttachmentDependencies> = {}) =>
	async (shareId: string): Promise<AnalyzeAttachmentResult> => {
		const deps = { ...defaultDependencies(), ...overrides };
		const now = deps.now();
		const things = await deps.getThings();
		const doc = (await things.findOne({ thingtime: 'attachment', shareId } as any)) as any;
		if (!doc) return { ok: false, error: 'Attachment not found', retryable: false };
		if (doc.attachmentState !== 'ready') return { ok: false, error: 'Attachment is not ready', retryable: false };
		const currentStatus = doc.moderation?.status;
		if (currentStatus && currentStatus !== 'pending') {
			// A verdict can land while its deterministic admin flag collides or the
			// flag write is interrupted. Keep the verdict quarantined and let every
			// sweep retry only that control-plane write, without re-running the model.
			if (doc.moderation?.flagPending && (currentStatus === 'nsfw' || currentStatus === 'blocked')) {
				try {
					await upsertModerationFlag(things, doc, doc.moderation, deps.now());
					await things.updateOne(
						{ thingtime: 'attachment', shareId, 'moderation.status': currentStatus, 'moderation.flagPending': true } as any,
						{ $unset: { 'moderation.flagPending': '' } }
					);
					return { ok: true, status: currentStatus };
				} catch (error) {
					console.error(`[moderation] flag retry failed for attachment ${shareId}:`, (error as Error)?.message || error);
					return { ok: false, error: 'Moderation flag write failed', retryable: true };
				}
			}
			// already analyzed (or deliberately skipped) — idempotent no-op
			return { ok: true, status: currentStatus };
		}

		// Linked attachments carry no stored bytes — there is no object for the
		// analyzer to fetch. They are stamped 'skipped' at mint; this guard keeps
		// a mint whose stamp was lost from wedging the sweep on a missing object.
		if (doc.attachmentLinked === true) {
			await stampModeration(
				things,
				shareId,
				{ status: 'skipped', categories: ['external-url'], provider: 'linked', analyzedAt: now },
				{ allowOverwriteOf: [null, 'pending'], now }
			);
			return { ok: true, status: 'skipped' };
		}

		const choice = await deps.resolveProvider();
		if (choice.kind === 'off') {
			await stampModeration(things, shareId, { status: 'skipped', provider: 'off', analyzedAt: now }, { allowOverwriteOf: [null, 'pending'], now });
			return { ok: true, status: 'skipped' };
		}

		const contentType = String(doc.crystal?.contentType || '');
		const size = Number(doc.crystal?.size || 0);
		if (doc.crystal?.mediaKind !== 'image' || !ANALYZABLE_IMAGE_CONTENT_TYPES.has(contentType)) {
			await stampModeration(
				things,
				shareId,
				{ status: 'skipped', categories: ['not-analyzable'], provider: choice.provider.name, analyzedAt: now },
				{ allowOverwriteOf: [null, 'pending'], now }
			);
			return { ok: true, status: 'skipped' };
		}
		if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MODERATION_IMAGE_BYTES) {
			await stampModeration(
				things,
				shareId,
				{ status: 'skipped', categories: ['too-large'], provider: choice.provider.name, analyzedAt: now },
				{ allowOverwriteOf: [null, 'pending'], now }
			);
			return { ok: true, status: 'skipped' };
		}

		// Mark in-flight so the sweep can distinguish "never analyzed" from
		// "currently analyzing" (both retryable — pending stamps are overwritable).
		await stampModeration(things, shareId, { status: 'pending', provider: choice.provider.name }, { allowOverwriteOf: [null, 'pending'], now });

		try {
			const signed = await deps.getS3().signDownload({
				objectKey: String(doc.objectKey),
				versionId: String(doc.objectVersionId || ''),
				contentDisposition: attachmentContentDisposition(String(doc.crystal?.name || 'attachment'), false),
				contentType
			});
			const bytes = await deps.fetchBytes(signed.url);
			const verdict = await choice.provider.analyzeImage({ bytes, contentType, filename: String(doc.crystal?.name || '') });
			const verdictStamp = moderationFromVerdict(verdict, { provider: choice.provider.name, model: choice.provider.model, now: deps.now() });
			const needsFlag = verdictStamp.status === 'nsfw' || verdictStamp.status === 'blocked';
			const moderation = needsFlag ? { ...verdictStamp, flagPending: true } : verdictStamp;
			const stamped = await stampModeration(things, shareId, moderation, { allowOverwriteOf: [null, 'pending'], now: deps.now() });
			// The flag doc follows the stamp's optimistic-concurrency guard: when
			// this verdict lost the race (an admin review already landed), do not
			// reset the flag's reviewedBy/reviewedAt with a stale re-analysis.
			if (stamped && needsFlag) {
				await upsertModerationFlag(things, doc, moderation, deps.now());
				await things.updateOne(
					{ thingtime: 'attachment', shareId, 'moderation.status': moderation.status, 'moderation.flagPending': true } as any,
					{ $unset: { 'moderation.flagPending': '' } }
				);
			}
			return { ok: true, status: moderation.status };
		} catch (error) {
			// Leave the pending stamp for the sweep to retry; never fail open.
			console.error(`[moderation] analysis failed for attachment ${shareId}:`, (error as Error)?.message || error);
			return { ok: false, error: 'Moderation analysis failed', retryable: true };
		}
	};

export const analyzeReadyAttachment = createAnalyzeReadyAttachment();

// Fire-and-forget hook for the upload-complete path: analysis must never
// fail or slow the upload response.
export const queueAttachmentModeration = (shareId: string): void => {
	void analyzeReadyAttachment(shareId).catch(() => {});
};
