import { createHash } from 'node:crypto';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { createThing } from '../things/things';
import { lockFolderDestination, MAX_FOLDER_DEPTH } from '../things/folderPlacement';
import { readTimelineEntries } from '../timeline/repository';
import { StorageMutationError } from '../storage/storageCore';
import { isFolderThing, folderThingMatch } from '../../../schemas/folderThing';
import { parseCloudFolderCreate, type CloudFolder, type CloudFolderCreate } from '../../../fileSync/cloudFolder';
import { MAX_SYNC_SCAN_ENTRIES, syncPathKey } from '../../../fileSync/reconcile';
import { cloudFolderMetadata } from './folderMetadata';

const failure = (status: number, error: string) => ({ ok: false as const, status, error });
const fail = (status: number, message: string): never => {
	throw new StorageMutationError(status, 'storage_conflict', message);
};
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const eventId = (owner: string, id: string, operationId: string) =>
	'folder-create-' +
	createHash('sha256')
		.update(JSON.stringify([owner, id, operationId]))
		.digest('hex');
const standalone = (doc: any, owner: string) =>
	doc?.ownerId === owner &&
	isFolderThing(doc) &&
	!doc.thingtime.includes('file') &&
	doc.targetId == null &&
	doc.appId == null &&
	doc.sandbox == null &&
	doc.sandboxSpace == null &&
	doc.crystal?.trashed !== true;

/** Compose ordinary folder creation with a deterministic canonical Timeline
 * capture. No parallel folder store, upload path or history collection. */
export function createCloudFolderService(
	overrides: Partial<{
		collection: () => Promise<any>;
		transaction: (work: (session: any) => Promise<any>) => Promise<any>;
		customPlane: () => boolean;
		create: typeof createThing;
		entries: typeof readTimelineEntries;
		lock: typeof lockFolderDestination;
		now: () => Date;
	}> = {}
) {
	const deps = {
		collection: getHomeThingsCollection,
		transaction: withHomeMongoTransaction,
		customPlane: isCustomMongoEndpointActive,
		create: createThing,
		entries: readTimelineEntries,
		lock: lockFolderDestination,
		now: () => new Date(),
		...overrides
	};
	const authorized = async (things: any, owner: string, id: string, session?: any) => {
		let next: string | null = id,
			first: any = null,
			privateAudience = false;
		const seen = new Set<string>();
		while (next) {
			if (!identity(next) || next.startsWith('timeline-') || seen.has(next) || seen.size >= MAX_FOLDER_DEPTH)
				fail(409, 'Folder ancestry is invalid.');
			seen.add(next);
			const doc = await things.findOne({ shareId: next }, { ...(session ? { session } : {}), maxTimeMS: 5000 });
			if (!standalone(doc, owner)) fail(404, 'Folder not found');
			if (!first) first = doc;
			if (!privateAudience) {
				if (!Array.isArray(doc.acl) || doc.acl.length !== 1 || !['tt:user', 'tt:inherit'].includes(doc.acl[0]))
					fail(409, 'Choose a private cloud folder.');
				privateAudience = doc.acl[0] === 'tt:user';
			}
			next = doc.folderId ?? null;
		}
		if (!privateAudience) fail(409, 'Choose a private cloud folder.');
		return first;
	};
	const receipt = async (things: any, owner: string, id: string, operationId: string, session?: any) => {
		const eid = eventId(owner, id, operationId),
			entry = (await deps.entries(things, owner, [eid], session))[0];
		if (!entry) return null;
		const e = entry.event,
			value = e.after?.value as any;
		if (
			e.id !== eid ||
			e.ownerId !== owner ||
			e.actorId !== owner ||
			e.thingId !== id ||
			e.operationId !== operationId ||
			e.source !== 'api' ||
			e.mode !== 'revision' ||
			e.branchId !== 'main' ||
			e.operation !== 'create' ||
			e.before !== null ||
			e.after?.adapter !== 'thing-content' ||
			e.after.version !== 1 ||
			value?.thingtime?.length !== 1 ||
			value.thingtime[0] !== 'folder' ||
			value.acl?.length !== 1 ||
			value.acl[0] !== 'tt:user' ||
			value.targetId != null
		)
			fail(409, 'Folder operation receipt is invalid.');
		return cloudFolderMetadata({ shareId: id, crystal: value.crystal, folderId: value.folderId, updatedAt: e.occurredAt, timelineHeadId: eid });
	};
	const errorResult = (error: unknown) =>
		error instanceof StorageMutationError ? failure(error.status, error.message) : failure(503, 'Folder storage is temporarily unavailable.');
	return {
		async read(owner: string, id: unknown, operationId?: unknown) {
			if (deps.customPlane()) return failure(409, 'Files require home storage.');
			if (!owner || !identity(id) || (operationId !== undefined && !identity(operationId))) return failure(400, 'Invalid folder identity.');
			try {
				const things = await deps.collection();
				const doc = await things.findOne({ shareId: id });
				if (doc && !standalone(doc, owner)) fail(404, 'Folder not found');
				if (operationId !== undefined) return { ok: true as const, receipt: await receipt(things, owner, id, operationId as string) };
				if (!doc) return failure(404, 'Folder not found');
				return { ok: true as const, folder: cloudFolderMetadata(await authorized(things, owner, id)) };
			} catch (error) {
				return errorResult(error);
			}
		},
		async create(owner: string, value: unknown) {
			if (deps.customPlane()) return failure(409, 'Files require home storage.');
			if (!owner) return failure(401, 'Unauthorized');
			let input: CloudFolderCreate;
			try {
				input = parseCloudFolderCreate(value);
			} catch {
				return failure(400, 'Invalid folder creation.');
			}
			const eid = eventId(owner, input.id, input.operationId),
				now = deps.now();
			const replay = (folder: CloudFolder) => {
				if (folder.id !== input.id || folder.folderId !== input.folderId || folder.name !== input.name)
					fail(409, 'Folder operation was reused with different input.');
				return { ok: true as const, folder, replayed: true };
			};
			try {
				const things = await deps.collection();
				let effects: (() => Promise<void>)[] = [];
				const result = await deps.transaction(async (session) => {
					effects = [];
					const existing = await things.findOne({ shareId: input.id }, { session });
					if (existing && !standalone(existing, owner)) fail(404, 'Folder not found');
					const prior = await receipt(things, owner, input.id, input.operationId, session);
					if (prior) return replay(prior);
					if (existing) fail(409, 'Folder identity already exists.');
					await authorized(things, owner, input.folderId, session);
					await deps.lock(things, owner, input.folderId, session, input.id);
					// All ordinary creates and folder moves fence this same parent. A
					// concurrent sibling create retries and sees the occupied name.
					const cursor = things
						.find(
							{ ownerId: owner, folderId: input.folderId, $or: [...folderThingMatch().$or, { thingtime: 'file', 'crystal.trashed': { $ne: true } }] },
							{ session, projection: { _id: 0, 'crystal.name': 1 }, maxTimeMS: 5000 }
						)
						.limit(MAX_SYNC_SCAN_ENTRIES + 1);
					let count = 0;
					try {
						for await (const sibling of cursor) {
							if (++count > MAX_SYNC_SCAN_ENTRIES) fail(413, 'Folder exceeds the sync scan bound.');
							if (typeof sibling.crystal?.name !== 'string' || syncPathKey(sibling.crystal.name) === syncPathKey(input.name))
								fail(409, 'A cloud path already exists; reconcile before creating this folder.');
						}
					} finally {
						await cursor.close();
					}
					const created = await deps.create(
						owner,
						{ shareId: input.id, thingtime: ['folder'], crystal: { name: input.name }, folderId: input.folderId, acl: ['tt:user'], createdAt: now },
						{ id: owner },
						null,
						{
							timelineCapture: { id: eid, operationId: input.operationId, actorId: owner, source: 'api', now, label: 'Created sync folder' },
							transaction: { session, afterCommit: (effect) => effects.push(effect) }
						}
					);
					if (created.ok === false) return fail(created.status, created.error);
					if (created.doc.crystal?.name !== input.name) fail(400, 'Folder name must be preserved exactly.');
					return { ok: true as const, folder: cloudFolderMetadata(created.doc), replayed: false };
				});
				for (const effect of effects) await effect();
				return result;
			} catch (error) {
				return errorResult(error);
			}
		}
	};
}
export const cloudFolders = createCloudFolderService();
