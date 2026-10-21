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
	const validateReceipt = (entry: any, owner: string, id: string, operationId: string) => {
		const eid = eventId(owner, id, operationId);
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
	const receipt = async (things: any, owner: string, id: string, operationId: string, session?: any) => {
		const eid = eventId(owner, id, operationId),
			entry = (await deps.entries(things, owner, [eid], session))[0];
		if (!entry) return null;
		return validateReceipt(entry, owner, id, operationId);
	};
	const errorResult = (error: unknown) =>
		error instanceof StorageMutationError ? failure(error.status, error.message) : failure(503, 'Folder storage is temporarily unavailable.');
	return {
		async readReceipts(owner: string, inputs: { id: string; operationId: string }[], signal?: AbortSignal) {
			if (deps.customPlane()) return failure(409, 'Files require home storage.');
			if (!owner || !Array.isArray(inputs) || inputs.length > 256 || inputs.some((r) => !identity(r.id) || !identity(r.operationId)))
				return failure(400, 'Invalid folder receipt identities.');
			try {
				signal?.throwIfAborted();
				const things = await deps.collection(),
					ids = inputs.map((r) => eventId(owner, r.id, r.operationId));
				const bounded = signal
					? new Proxy(things, {
							get(target, key) {
								if (key === 'find') return (filter: any, options: any) => target.find(filter, { ...options, maxTimeMS: 5000, signal });
								const value = target[key];
								return typeof value === 'function' ? value.bind(target) : value;
							}
					  })
					: things;
				const entries: any[] = [];
				for (let offset = 0; offset < ids.length; offset += 128) {
					signal?.throwIfAborted();
					entries.push(...(await deps.entries(bounded, owner, ids.slice(offset, offset + 128))));
				}
				const byId = new Map(entries.map((row) => [row.event.id, row]));
				return {
					ok: true as const,
					receipts: inputs.map((r, i) => (byId.has(ids[i]) ? validateReceipt(byId.get(ids[i]), owner, r.id, r.operationId) : null))
				};
			} catch (error) {
				return errorResult(error);
			}
		},
		/** Shared canonical transaction, never a lock/auth bypass. Namespace
		 * cursors are shared only within this attempt. All inner createThing
		 * placement/quota/Timeline checks remain intact. */
		async createWave(
			owner: string,
			values: unknown[],
			options: {
				check?: () => void;
				row?: () => void;
				beforeWrite?: (things: any, session: any, inputs: CloudFolderCreate[]) => Promise<Map<string, { status: number; error: string }> | void>;
			} = {}
		) {
			if (deps.customPlane()) return failure(409, 'Files require home storage.');
			if (!owner || !Array.isArray(values) || values.length < 1 || values.length > 8) return failure(400, 'Invalid folder wave.');
			let inputs: CloudFolderCreate[];
			try {
				inputs = values.map(parseCloudFolderCreate);
				if (new Set(inputs.map((r) => r.id)).size !== inputs.length) throw Error();
			} catch {
				return failure(400, 'Invalid folder wave.');
			}
			try {
				const things = await deps.collection();
				let effects: (() => Promise<void>)[] = [];
				const result = await deps.transaction(async (session) => {
					effects = [];
					options.check?.();
					const entries = await deps.entries(
						things,
						owner,
						inputs.map((input) => eventId(owner, input.id, input.operationId)),
						session
					);
					const byId = new Map(entries.map((entry) => [entry.event.id, entry]));
					const results: any[] = new Array(inputs.length),
						pending: { input: CloudFolderCreate; index: number }[] = [];
					for (const [index, input] of inputs.entries()) {
						options.check?.();
						const entry = byId.get(eventId(owner, input.id, input.operationId)),
							prior = entry ? validateReceipt(entry, owner, input.id, input.operationId) : null;
						if (prior) {
							if (prior.id !== input.id || prior.folderId !== input.folderId || prior.name !== input.name)
								fail(409, 'Folder operation was reused with different input.');
							results[index] = { ok: true, folder: prior, replayed: true };
							continue;
						}
						const existing = await things.findOne({ shareId: input.id }, { session, maxTimeMS: 5000 });
						if (existing) {
							results[index] = failure(standalone(existing, owner) ? 409 : 404, 'Folder identity is unavailable.');
							continue;
						}
						pending.push({ input, index });
					}
					const names = new Map<string, Set<string>>(),
						invalidParents = new Map<string, { ok: false; status: number; error: string }>();
					for (const { input } of pending) {
						if (names.has(input.folderId) || invalidParents.has(input.folderId)) continue;
						try {
							await authorized(things, owner, input.folderId, session);
						} catch (error) {
							if (!(error instanceof StorageMutationError)) throw error;
							invalidParents.set(input.folderId, errorResult(error));
							continue;
						}
						const occupied = new Set<string>(),
							cursor = things
								.find(
									{
										ownerId: owner,
										folderId: input.folderId,
										$or: [...folderThingMatch().$or, { thingtime: 'file', 'crystal.trashed': { $ne: true } }]
									},
									{ session, projection: { _id: 0, 'crystal.name': 1 }, maxTimeMS: 5000 }
								)
								.limit(MAX_SYNC_SCAN_ENTRIES + 1);
						let count = 0;
						try {
							for await (const sibling of cursor) {
								options.check?.();
								options.row?.();
								if (++count > MAX_SYNC_SCAN_ENTRIES) fail(413, 'Folder exceeds the sync scan bound.');
								if (typeof sibling.crystal?.name !== 'string') fail(409, 'Folder namespace is invalid.');
								const key = syncPathKey(sibling.crystal.name);
								if (occupied.has(key)) fail(409, 'Folder namespace is ambiguous.');
								occupied.add(key);
							}
						} finally {
							await cursor.close();
						}
						names.set(input.folderId, occupied);
					}
					const eligible = pending.filter(({ input, index }) => {
						const denied = invalidParents.get(input.folderId);
						if (denied) {
							results[index] = denied;
							return false;
						}
						const occupied = names.get(input.folderId)!;
						const key = syncPathKey(input.name);
						if (occupied.has(key)) {
							results[index] = failure(409, 'A cloud path already exists; reconcile before creating this folder.');
							return false;
						}
						occupied.add(key);
						return true;
					});
					const denied = eligible.length
						? await options.beforeWrite?.(
								things,
								session,
								eligible.map((r) => r.input)
						  )
						: undefined;
					const writes = eligible.filter(({ input, index }) => {
						const error = denied instanceof Map ? denied.get(input.id) : undefined;
						if (error) {
							results[index] = failure(error.status, error.error);
							return false;
						}
						return true;
					});
					// A failure from here aborts the WHOLE wave. Mongo has no
					// savepoints; no partially mutated transaction is committed.
					for (const { input } of writes) {
						options.check?.();
						await deps.lock(things, owner, input.folderId, session, input.id);
					}
					for (const { input, index } of writes) {
						options.check?.();
						const now = deps.now(),
							eid = eventId(owner, input.id, input.operationId);
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
						if (created.ok === false) throw new StorageMutationError(created.status, 'storage_conflict', created.error);
						if (created.doc.crystal?.name !== input.name) fail(400, 'Folder name must be preserved exactly.');
						results[index] = { ok: true, folder: cloudFolderMetadata(created.doc), replayed: false };
					}
					return { ok: true as const, results };
				});
				for (const effect of effects) await effect();
				return result;
			} catch (error) {
				return errorResult(error);
			}
		},
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
