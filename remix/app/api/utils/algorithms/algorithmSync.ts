import { isDataPlane } from '../../../utils/dataPlane';
import { getHomeThingsCollection, getFeedAlgorithmsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { createAlgorithm, updateAlgorithm, deleteAlgorithm, type AlgorithmMutationBoundary } from './algorithms';
import { MAX_SAVED_ALGORITHMS } from './algorithmContent';
import { parseAlgorithmTransfer } from './algorithmTransferCore';
import { readTimelineEntries, appendTimelineEvent } from '../timeline/repository';
import { storedSnapshotVersion, storedSnapshotMatch } from '../things/storedSnapshot';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { parseAlgorithmWrite, ALGORITHM_VERSION_PREFIX, type AlgorithmWriteAcknowledgment } from './algorithmSyncContract';
import { algorithmWriteDigest, algorithmWriteEventId, createAlgorithmWriteReceipt, readAlgorithmWriteReceipt } from './algorithmSyncReceipt';
export class AlgorithmSyncError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}
class Replayed extends Error {
	constructor(readonly acknowledgment: AlgorithmWriteAcknowledgment) {
		super('Algorithm save already completed.');
	}
}
const conflict = (): never => {
	throw new AlgorithmSyncError(409, 'The account algorithm changed. Device changes have been kept.');
};
const version = (doc: any) => storedSnapshotVersion(doc, ALGORITHM_VERSION_PREFIX);
const iso = (value: unknown) => new Date(value as string).toISOString();
const project = (doc: any, legacy = false) => {
	const content = legacy ? doc : doc.crystal;
	return {
		id: doc.shareId,
		version: version(doc),
		content: parseAlgorithmTransfer({
			...(Object.prototype.hasOwnProperty.call(content, 'title') ? { title: content.title } : {}),
			name: content.name,
			emoji: content.emoji,
			weights: content.weights,
			eventCount: content.eventCount,
			lastTrainedAt: content.lastTrainedAt ? iso(content.lastTrainedAt) : null
		}),
		parentId: content.parentId ?? null,
		description: content.description ?? '',
		shared: content.shared === true,
		listed: content.listed === true,
		folderId: legacy ? null : doc.folderId ?? null,
		createdAt: iso(doc.createdAt),
		updatedAt: iso(doc.updatedAt),
		legacy
	};
};
/** A complete private home catalogue; an oversized or malformed catalogue fails
 * explicitly and must never be interpreted as deletion of retained profiles. */
export async function algorithmSyncSnapshot(ownerId: string) {
	const things = await getHomeThingsCollection(),
		legacy = await getFeedAlgorithmsCollection();
	return withHomeMongoTransaction(async (session) => {
		const current = await things
			.find({ ownerId, thingtime: 'feed-algorithm' } as any, { session })
			.limit(MAX_SAVED_ALGORITHMS + 1)
			.toArray();
		const earlier = await legacy
			.find({ ownerId }, { session })
			.limit(MAX_SAVED_ALGORITHMS + 1)
			.toArray();
		if (current.length > MAX_SAVED_ALGORITHMS || earlier.length > MAX_SAVED_ALGORITHMS)
			throw new AlgorithmSyncError(413, 'Algorithm catalogue exceeds the synchronization limit.');
		const rows = new Map<string, ReturnType<typeof project>>();
		try {
			for (const doc of earlier) rows.set(doc.shareId, project(doc, true));
			for (const doc of current) rows.set(doc.shareId, project(doc));
		} catch {
			throw new AlgorithmSyncError(409, 'A saved algorithm needs repair before its complete profile can synchronize.');
		}
		if (rows.size > MAX_SAVED_ALGORITHMS) throw new AlgorithmSyncError(413, 'Algorithm catalogue exceeds the synchronization limit.');
		const result = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
		try {
			copyBoundedJson(result, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250000 });
		} catch {
			throw new AlgorithmSyncError(413, 'Algorithm catalogue exceeds the synchronization limit.');
		}
		return result;
	});
}
/** Extend the canonical protected writer, including its quota, home routing and
 * deletion cleanup. Content and a small immutable receipt commit together. */
export async function synchronizeAlgorithmWrite(
	ownerId: string,
	selectedPlane: string,
	raw: unknown,
	admit: () => Promise<void>
): Promise<AlgorithmWriteAcknowledgment> {
	if (!isDataPlane(selectedPlane)) throw new AlgorithmSyncError(400, 'Confirm the selected database before synchronizing.');
	let command;
	try {
		command = parseAlgorithmWrite(raw);
	} catch {
		throw new AlgorithmSyncError(400, 'Invalid algorithm synchronization command.');
	}
	const things = await getHomeThingsCollection(),
		legacy = await getFeedAlgorithmsCollection();
	// Selection is reauthorized on every request; the immutable receipt belongs
	// to the home content destination and survives a legitimate selection change.
	const digest = algorithmWriteDigest(ownerId, command);
	const replay = async (session?: any) => {
		const rows = await readTimelineEntries(things, ownerId, [algorithmWriteEventId(command.writeId)], session);
		if (!rows.length) return null;
		if (rows.length !== 1) return conflict();
		try {
			return readAlgorithmWriteReceipt(rows[0].event, ownerId, command, digest);
		} catch {
			return conflict();
		}
	};
	const boundary: AlgorithmMutationBoundary = {
		createId: command.id,
		...(command.action === 'save' && command.folderId !== undefined ? { folderId: command.folderId } : {}),
		...(command.action === 'save' ? { content: command.content, ...(command.parentId === undefined ? {} : { parentId: command.parentId }) } : {}),
		beforeWrite: async (before, old, session) => {
			await admit();
			const previous = await replay(session);
			if (previous) throw new Replayed(previous);
			if (command.expectedVersion === null) {
				if (
					before ||
					old ||
					(await things.findOne({ shareId: command.id } as any, { session, projection: { _id: 1 } })) ||
					(await legacy.findOne({ shareId: command.id }, { session, projection: { _id: 1 } }))
				)
					return conflict();
				if (
					command.action === 'save' &&
					command.parentId &&
					!(await things.findOne({ shareId: command.parentId, ownerId, thingtime: 'feed-algorithm' } as any, { session, projection: { _id: 1 } }))
				)
					return conflict();
			} else {
				if (before && old) return conflict();
				const doc = before ?? old;
				if (
					!doc ||
					doc.ownerId !== ownerId ||
					doc.shareId !== command.id ||
					(before && (before.thingtime?.length !== 1 || before.thingtime[0] !== 'feed-algorithm' || before.appId)) ||
					version(doc) !== command.expectedVersion
				)
					return conflict();
				if (
					!(await (before ? things : legacy).findOne(storedSnapshotMatch(doc, ALGORITHM_VERSION_PREFIX) as any, { session, projection: { _id: 1 } }))
				)
					return conflict();
			}
		},
		afterWrite: async (after, session) => {
			const stored = after
				? await (Array.isArray(after.thingtime) ? things : legacy).findOne({ _id: after._id, shareId: command.id, ownerId } as any, { session })
				: null;
			if (after && !stored) return conflict();
			const acknowledgment: AlgorithmWriteAcknowledgment = {
				id: command.id,
				writeId: command.writeId,
				action: command.action,
				expectedVersion: command.expectedVersion,
				resultVersion: stored ? version(stored) : null
			};
			await appendTimelineEvent(things, createAlgorithmWriteReceipt(ownerId, acknowledgment, digest, new Date().toISOString()), session, {
				plane: 'home'
			});
		}
	};
	await admit();
	const previous = await replay();
	if (previous) return previous;
	try {
		const result =
			command.action === 'delete'
				? await deleteAlgorithm(ownerId, command.id, boundary)
				: command.expectedVersion === null
				? await createAlgorithm(
						ownerId,
						{ name: command.content.name, emoji: command.content.emoji, description: command.description },
						command.content,
						boundary
				  )
				: await updateAlgorithm(
						ownerId,
						{ id: command.id, name: command.content.name, emoji: command.content.emoji, description: command.description },
						boundary
				  );
		if (result.ok === false)
			throw new AlgorithmSyncError(
				result.status === 404 ? 409 : result.status,
				'The account algorithm change was refused. Device changes have been kept.'
			);
		return (await replay()) ?? conflict();
	} catch (error) {
		if (error instanceof Replayed) return error.acknowledgment;
		const receipt = await replay();
		if (receipt) return receipt;
		throw error;
	}
}
