import { hasRelationalAclEntries, rootAcl } from '../things/relationalAcl';
import { createHash } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { insertAccountedThing, updateAccountedThing, deleteAccountedThings } from '../storage/accountedThings';
import { StorageMutationError } from '../storage/storageCore';
import { readCloudInventoryRoot } from './inventory';
import { validSyncPath } from '~/fileSync/reconcile';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { nativePhotoAssetKey } from '~/fileSync/nativeInventory';

/** Source observations describe discovery, never a verified backup. The two
 * protected kinds use ordinary quota-accounted Things and existing owner /
 * parent indexes. No payload bytes or credential is stored here. */
export class SourceIndexDiscarded extends StorageMutationError {
	constructor() {
		super(409, 'storage_conflict', 'Source index was discarded by its owner');
	}
}
export const SOURCE_INDEX_KIND = 'sync-source-index';
export const SOURCE_OBSERVATION_KIND = 'sync-source-observation';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const date = (v: unknown) => v === null || (typeof v === 'string' && new Date(v).toISOString() === v);
const conflict = (message: string): never => {
	throw new StorageMutationError(409, 'storage_conflict', message);
};
export type SourceIndexEntry = {
	path: string;
	name: string;
	resourceVersion: string;
	sourceVersion: string | null;
	assetKey: string;
	resourceIndex: number;
	capturedAt: string | null;
	modifiedAt: string | null;
	assetKind: 'photo' | 'video' | null;
	originalCount: number;
	availability: 'pending' | 'unavailable' | 'legacy-unverified';
	reason: 'cloud-download' | 'photo-read' | null;
};
export type SourceIndexPage = {
	epoch: string;
	passId: string;
	sequence: number;
	requestId: string;
	entries: SourceIndexEntry[];
	progress: { inspectedAssets: number; totalAssets: number; indexedResources: number; complete: boolean };
};
export function parseSourceIndexPage(raw: Record<string, unknown>): SourceIndexPage | null {
	try {
		const { epoch, passId, sequence, requestId, entries, progress } = raw;
		if (
			Object.keys(raw).some((k) => !['action', 'runId', 'epoch', 'passId', 'sequence', 'requestId', 'entries', 'progress'].includes(k)) ||
			!token(epoch) ||
			!token(passId) ||
			!token(requestId) ||
			!integer(sequence) ||
			sequence < 1 ||
			!Array.isArray(entries) ||
			entries.length > 32 ||
			new Set(entries.map((e) => e?.path)).size !== entries.length
		)
			return null;
		const p = progress as SourceIndexPage['progress'];
		if (
			!p ||
			Object.keys(p).some((k) => !['inspectedAssets', 'totalAssets', 'indexedResources', 'complete'].includes(k)) ||
			!integer(p.inspectedAssets) ||
			!integer(p.totalAssets) ||
			p.inspectedAssets > p.totalAssets ||
			!integer(p.indexedResources) ||
			typeof p.complete !== 'boolean' ||
			(p.complete && p.inspectedAssets !== p.totalAssets)
		)
			return null;
		for (const e of entries) {
			if (
				!e ||
				Object.keys(e).some(
					(k) =>
						![
							'path',
							'name',
							'resourceVersion',
							'sourceVersion',
							'assetKey',
							'resourceIndex',
							'capturedAt',
							'modifiedAt',
							'assetKind',
							'originalCount',
							'availability',
							'reason'
						].includes(k)
				) ||
				!validSyncPath(e.path) ||
				typeof e.name !== 'string' ||
				e.path.length > 512 ||
				e.path.includes('/') ||
				e.path.includes('\\') ||
				!/^[a-f0-9]{64}$/.test(e.assetKey) ||
				nativePhotoAssetKey(e.path) !== e.assetKey ||
				!token(e.resourceVersion) ||
				(e.sourceVersion !== null && !token(e.sourceVersion)) ||
				!integer(e.resourceIndex) ||
				!e.path.startsWith(e.assetKey + '-' + e.resourceIndex + '-') ||
				!integer(e.originalCount) ||
				e.originalCount < 1 ||
				!date(e.capturedAt) ||
				!date(e.modifiedAt) ||
				![null, 'photo', 'video'].includes(e.assetKind) ||
				!['pending', 'unavailable', 'legacy-unverified'].includes(e.availability) ||
				(e.availability !== 'unavailable'
					? e.reason !== null || (e.availability === 'legacy-unverified' && e.sourceVersion !== null)
					: !['cloud-download', 'photo-read'].includes(e.reason))
			)
				return null;
		}
		return { epoch, passId, sequence, requestId, entries, progress: p } as SourceIndexPage;
	} catch {
		return null;
	}
}
export type SourceIndexScope = {
	origin: string;
	ownerId: string;
	configurationId: string;
	configurationRevision: string;
	deviceId: string;
	localRootId: string;
	grantRevision: string;
	folderId: string;
};
export const sourceIndexId = (scope: SourceIndexScope, epoch: string) => 'sync-source-index-' + hash([scope, epoch]);
const owned = (doc: any, scope: SourceIndexScope, kind: string) =>
	doc &&
	doc.ownerId === scope.ownerId &&
	doc.thingtime?.length === 1 &&
	doc.thingtime[0] === kind &&
	doc.appId == null &&
	doc.sandbox == null &&
	doc.sandboxSpace == null &&
	!hasRelationalAclEntries(doc) && Array.isArray(doc.acl) && rootAcl(doc).length === 1 &&
	rootAcl(doc)[0] === 'tt:user';
export async function writeSourceIndex(things: any, session: any, scope: SourceIndexScope, page: SourceIndexPage) {
	const id = sourceIndexId(scope, page.epoch),
		fingerprint = hash(page),
		options = { session, accountedPlane: 'home' as const };
	const prior = await things.findOne({ shareId: id }, { session });
	if (prior && (!owned(prior, scope, SOURCE_INDEX_KIND) || hash(prior.crystal.scope) !== hash(scope))) conflict('Source index identity changed');
	const cursor = prior?.crystal;
	if (cursor?.discarded) throw new SourceIndexDiscarded();
	if (cursor?.sequence === page.sequence && cursor.requestId === page.requestId && cursor.fingerprint === fingerprint)
		return { indexId: id, sequence: page.sequence, requestId: page.requestId, replayed: true };
	if (page.sequence !== (cursor?.sequence ?? 0) + 1) conflict('Source index sequence changed; retain the original outbox page');
	let discoveredResources = cursor?.passId === page.passId ? cursor.discoveredResources : 0;
	let unavailableResources = cursor?.passId === page.passId ? cursor.unavailableResources : 0;
	let legacyUnverifiedResources = cursor?.passId === page.passId ? cursor.legacyUnverifiedResources ?? 0 : 0;
	const now = new Date();
	for (const entry of page.entries) {
		const shareId = 'sync-source-observation-' + hash([id, entry.path]);
		const before = await things.findOne({ shareId }, { session });
		if (before && (!owned(before, scope, SOURCE_OBSERVATION_KIND) || before.parentId !== id)) conflict('Source observation identity changed');
		if (before?.crystal.passId !== page.passId) discoveredResources++;
		if (before?.crystal.passId === page.passId && before.crystal.availability === 'unavailable') unavailableResources--;
		if (entry.availability === 'unavailable') unavailableResources++;
		if (before?.crystal.passId === page.passId && before.crystal.availability === 'legacy-unverified') legacyUnverifiedResources--;
		if (entry.availability === 'legacy-unverified') legacyUnverifiedResources++;
		const crystal = {
			...entry,
			passId: page.passId,
			sequence: page.sequence,
			firstSequence: before?.crystal.passId === page.passId ? before.crystal.firstSequence : page.sequence
		};
		if (before) await updateAccountedThing(things, { _id: before._id }, { $set: { crystal, updatedAt: now } }, options);
		else
			await insertAccountedThing(
				things,
				{
					shareId,
					ownerId: scope.ownerId,
					thingtime: [SOURCE_OBSERVATION_KIND],
					schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
					acl: ['tt:user'],
					parentId: id,
					targetId: id,
					folderId: id,
					crystal,
					createdAt: now,
					updatedAt: now
				},
				options
			);
	}
	const samePass = cursor?.passId === page.passId;
	if (samePass && cursor.progress.totalAssets !== page.progress.totalAssets) conflict('Source index pass changed its library total');
	const progress = samePass
		? {
				inspectedAssets: Math.max(cursor.progress.inspectedAssets, page.progress.inspectedAssets),
				totalAssets: page.progress.totalAssets,
				indexedResources: Math.max(cursor.progress.indexedResources, page.progress.indexedResources),
				complete: cursor.progress.complete || page.progress.complete
		  }
		: page.progress;
	// Exhaustion is only a source claim and only seals counts after every
	// discovered resource is durably represented. It never proves publication.
	const complete = progress.complete && discoveredResources === progress.indexedResources;
	const crystal = {
		scope,
		epoch: page.epoch,
		passId: page.passId,
		sequence: page.sequence,
		requestId: page.requestId,
		fingerprint,
		discoveredResources,
		unavailableResources,
		legacyUnverifiedResources,
		progress: { ...progress, complete }
	};
	if (prior) await updateAccountedThing(things, { _id: prior._id }, { $set: { crystal, updatedAt: now } }, options);
	else
		await insertAccountedThing(
			things,
			{
				shareId: id,
				ownerId: scope.ownerId,
				thingtime: [SOURCE_INDEX_KIND],
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				acl: ['tt:user'],
				parentId: scope.configurationId,
				targetId: scope.configurationId,
				folderId: scope.configurationId,
				crystal,
				createdAt: now,
				updatedAt: now
			},
			options
		);
	return { indexId: id, sequence: page.sequence, requestId: page.requestId, replayed: false };
}
export async function readSourceIndex(things: any, session: any, scope: SourceIndexScope, epoch: unknown, after: unknown) {
	if (!token(epoch) || (after !== undefined && (typeof after !== 'string' || after.length > 1024)))
		throw new StorageMutationError(400, 'storage_conflict', 'Invalid source index cursor');
	const id = sourceIndexId(scope, epoch),
		header = await things.findOne({ shareId: id }, { session });
	if (!owned(header, scope, SOURCE_INDEX_KIND)) throw new StorageMutationError(404, 'storage_conflict', 'Source index not found');
	if (header.crystal.discarded)
		return { indexId: id, epoch, discarded: true, entries: [], after: null, scanComplete: false, remainingUndiscoveredResources: null };
	let cursorDate: Date | undefined,
		cursorId: string | undefined,
		observedThroughSequence = header.crystal.sequence;
	if (after) {
		try {
			const cursor = JSON.parse(Buffer.from(after as string, 'base64url').toString('utf8'));
			if (
				cursor.indexId !== id ||
				!integer(cursor.sequence) ||
				cursor.sequence > header.crystal.sequence ||
				cursor.passId !== header.crystal.passId ||
				!token(cursor.id) ||
				!date(cursor.createdAt) ||
				cursor.createdAt === null
			)
				conflict('Source index changed; restart its page cursor');
			cursorDate = new Date(cursor.createdAt);
			cursorId = cursor.id;
			observedThroughSequence = cursor.sequence;
		} catch {
			conflict('Source index cursor is unavailable; restart its page cursor');
		}
	}
	const rows = await things
		.find(
			{
				ownerId: scope.ownerId,
				parentId: id,
				thingtime: SOURCE_OBSERVATION_KIND,
				folderId: id,
				'crystal.passId': header.crystal.passId,
				'crystal.firstSequence': { $lte: observedThroughSequence },
				...(after ? { $or: [{ createdAt: { $lt: cursorDate } }, { createdAt: cursorDate, shareId: { $gt: cursorId } }] } : {})
			},
			{ session, maxTimeMS: 5000 }
		)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(33)
		.toArray();
	if (rows.some((row: any) => !owned(row, scope, SOURCE_OBSERVATION_KIND))) conflict('Source index audience changed');
	const selected = rows.slice(0, 32);
	let privateRoot = false;
	try {
		await readCloudInventoryRoot(things, session, scope.ownerId, scope.folderId, () => 5000);
		privateRoot = true;
	} catch (error) {
		if (!(error instanceof StorageMutationError) || ![404, 409].includes(error.status)) throw error;
	}
	const files = await things
		.find(
			{
				ownerId: scope.ownerId,
				folderId: scope.folderId,
				thingtime: 'file',
				'crystal.name': { $in: selected.map((row: any) => row.crystal.path) },
				'crystal.trashed': false
			},
			{ session, maxTimeMS: 5000 }
		)
		.limit(33)
		.toArray();
	const attachments = await things
		.find(
			{ ownerId: scope.ownerId, thingtime: 'attachment', shareId: { $in: files.map((file: any) => file.crystal.content.attachmentId) } },
			{ session, maxTimeMS: 5000 }
		)
		.limit(33)
		.toArray();
	const publication = (row: any) => {
		if (!privateRoot) return null;
		const candidates = files.filter((f: any) => f.crystal.name === row.crystal.path);
		if (candidates.length !== 1) return null;
		const file = candidates[0],
			attachment = attachments.find((a: any) => a.shareId === file.crystal.content.attachmentId);
		const provenance = attachment?.attachmentFileSyncOrigin,
			grant = attachment?.fileSyncSourceGrant;
		return !hasRelationalAclEntries(file) && Array.isArray(file.acl) && rootAcl(file).length === 1 &&
			rootAcl(file)[0] === 'tt:user' &&
			attachment?.attachmentState === 'ready' &&
			attachment.targetId === file.shareId &&
			attachment.objectKey &&
			attachment.objectVersionId &&
			attachmentContentVersion(attachment.shareId, attachment.objectKey, attachment.objectVersionId) === file.crystal.content.version &&
			provenance?.deviceId === scope.deviceId &&
			provenance.localRootId === scope.configurationId &&
			provenance.cloudRootId === scope.folderId &&
			provenance.folderId === scope.folderId &&
			provenance.path === row.crystal.path &&
			provenance.fileId === file.shareId &&
			grant?.localRootId === scope.localRootId &&
			grant.grantRevision === scope.grantRevision &&
			typeof row.crystal.sourceVersion === 'string' &&
			grant.sourceVersion === row.crystal.sourceVersion
			? { fileId: file.shareId, revision: file.timelineHeadId, attachmentId: attachment.shareId, sourceVersion: grant.sourceVersion }
			: null;
	};
	return {
		indexId: id,
		epoch,
		passId: header.crystal.passId,
		sequence: header.crystal.sequence,
		consistency: 'current-with-discovery-watermark',
		observedThroughSequence,
		discoveredResources: header.crystal.discoveredResources,
		unavailableResources: header.crystal.unavailableResources,
		legacyUnverifiedResources: header.crystal.legacyUnverifiedResources ?? 0,
		scanComplete: header.crystal.progress.complete,
		remainingUndiscoveredResources: header.crystal.progress.complete ? 0 : null,
		scan: header.crystal.progress,
		entries: selected.map((row: any) => ({ id: row.shareId, ...row.crystal, publication: publication(row) })),
		after:
			rows.length > 32
				? Buffer.from(
						JSON.stringify({
							indexId: id,
							sequence: observedThroughSequence,
							passId: header.crystal.passId,
							id: selected.at(-1).shareId,
							createdAt: selected.at(-1).createdAt.toISOString()
						})
				  ).toString('base64url')
				: null
	};
}

/** Owner reads do not depend on an active upload permit. Paused or expired
 * runs retain their source metadata and explicit incomplete scan state. */
export async function listSourceIndexes(things: any, session: any, ownerId: string, origin: string, raw: Record<string, unknown>) {
	if (
		Object.keys(raw).some((k) => !['action', 'configurationId', 'after'].includes(k)) ||
		!token(raw.configurationId) ||
		(raw.after !== undefined && (typeof raw.after !== 'string' || raw.after.length > 1024))
	)
		throw new StorageMutationError(400, 'storage_conflict', 'Choose a configuration and valid index cursor');
	let after: { id: string; createdAt: string } | null = null;
	if (raw.after) {
		try {
			after = JSON.parse(Buffer.from(raw.after as string, 'base64url').toString('utf8'));
			if (!after || !token(after.id) || !date(after.createdAt) || after.createdAt === null) throw Error();
		} catch {
			throw new StorageMutationError(400, 'storage_conflict', 'Invalid index cursor');
		}
	}
	const rows = await things
		.find(
			{
				ownerId,
				folderId: raw.configurationId,
				thingtime: SOURCE_INDEX_KIND,
				'crystal.scope.origin': origin,
				...(after
					? { $or: [{ createdAt: { $lt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), shareId: { $gt: after.id } }] }
					: {})
			},
			{ session, maxTimeMS: 5000 }
		)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(33)
		.toArray();
	if (rows.some((row: any) => !owned(row, row.crystal.scope, SOURCE_INDEX_KIND))) conflict('Source index audience changed');
	const selected = rows.slice(0, 32);
	return {
		indexes: selected.map((row: any) => ({
			indexId: row.shareId,
			epoch: row.crystal.epoch,
			passId: row.crystal.passId,
			sequence: row.crystal.sequence,
			discoveredResources: row.crystal.discoveredResources,
			discarded: row.crystal.discarded === true,
			createdAt: row.createdAt.toISOString()
		})),
		after:
			rows.length > 32
				? Buffer.from(JSON.stringify({ id: selected.at(-1).shareId, createdAt: selected.at(-1).createdAt.toISOString() })).toString('base64url')
				: null
	};
}

export async function ownerSourceIndex(things: any, session: any, ownerId: string, origin: string, raw: Record<string, unknown>) {
	if (
		Object.keys(raw).some((k) => !['action', 'indexId', 'configurationId', 'after'].includes(k)) ||
		(raw.indexId !== undefined && !token(raw.indexId)) ||
		(raw.configurationId !== undefined && !token(raw.configurationId)) ||
		(!raw.indexId && !raw.configurationId)
	)
		throw new StorageMutationError(400, 'storage_conflict', 'Choose a saved source index');
	const header = await things.findOne(
		{ ownerId, thingtime: SOURCE_INDEX_KIND, ...(raw.indexId ? { shareId: raw.indexId } : { folderId: raw.configurationId }) },
		{ session, sort: { createdAt: -1 }, maxTimeMS: 5000 }
	);
	const scope = header?.crystal.scope as SourceIndexScope;
	if (!scope || scope.ownerId !== ownerId || scope.origin !== origin || !owned(header, scope, SOURCE_INDEX_KIND))
		throw new StorageMutationError(404, 'storage_conflict', 'Source index not found');
	if (raw.action === 'discard-source-index') {
		// An owner tombstone fences delayed run writes before removing bounded
		// child pages. Retrying cleanup never permits the old epoch to revive.
		if (!header.crystal.discarded)
			await updateAccountedThing(
				things,
				{ _id: header._id },
				{ $set: { 'crystal.discarded': true, updatedAt: new Date() } },
				{ session, accountedPlane: 'home' }
			);
		const children = await things.find({ ownerId, parentId: header.shareId, thingtime: SOURCE_OBSERVATION_KIND }, { session }).limit(32).toArray();
		if (children.length)
			await deleteAccountedThings(things, { ownerId, _id: { $in: children.map((x: any) => x._id) } }, { session, accountedPlane: 'home' });
		// Retain the small billed tombstone as the explicit immutable refusal,
		// readable/discardable by its owner even after configuration deletion.
		return { indexId: header.shareId, discarded: true, hasMore: children.length === 32 };
	}
	return readSourceIndex(things, session, scope, header.crystal.epoch, raw.after);
}
