import { prepareVersionChange } from '../../../timeline/versionPlan.ts';
import { createVersionGraphTools } from '../../../timeline/versionGraph.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { createHash } from 'node:crypto';
import { TIMELINE_UNDO_LABEL, versionRequestIdentity, parseVersionRequest, type VersionRequest } from '../../../timeline/publishedVersion.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import type { ThingWriteTransaction } from '../things/things';
import { createThing, findViewableThing, updateThing } from '../things/things';
import { StorageMutationError } from '../storage/storageCore';
import { readTimelineEntries, readTimelineNodes } from './repository.ts';
import { comparePublishedComponents, liveComponentContext, planPublishedComponentCopies, recordedComponentVersions } from './publishedComponents';
import { newThingMutationCapture } from './recordMutation.ts';
import { readDeletedThingState } from './deletedThing.ts';
export { parseVersionRequest, type VersionRequest } from '../../../timeline/publishedVersion.ts';

const reject = (status: number, message: string): never => {
	throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message);
};
export const { restorableContent, loadVersionGraph, versionMergeBase, versionContentSources, createVersionContentReader } =
	createVersionGraphTools(reject);

const dependencies = {
	collection: getThingsCollection,
	find: findViewableThing,
	update: updateThing,
	create: createThing,
	transaction: withMongoTransaction,
	entries: readTimelineEntries,
	nodes: readTimelineNodes,
	snapshot: readTimelineSnapshot,
	deleted: readDeletedThingState,
	recorded: recordedComponentVersions,
	live: liveComponentContext
};
export function createVersionService(overrides: Partial<typeof dependencies> = {}) {
	const deps = { ...dependencies, ...overrides };
	return async (ownerId: string, input: VersionRequest) => {
		const request = parseVersionRequest(input);
		const things = await deps.collection();
		const read = (ids: string[], session?: any) => deps.entries(things, ownerId, ids, session);
		const signature = createHash('sha256').update(versionRequestIdentity(request)).digest('hex');
		const committedId = request.operationId ? `version-${request.operationId}` : null;
		const existing = async (session?: any) => {
			if (!committedId) return null;
			const entry = (await read([committedId], session))[0];
			if (
				entry &&
				(entry.event.operationId !== signature || entry.event.actorId !== ownerId || entry.event.source !== 'api' || entry.event.mode !== 'revision')
			)
				reject(409, 'This operation id was already used for another version request.');
			return entry ?? null;
		};
		const prior = request.command === 'apply-version' ? await existing() : null;
		if (prior) return { ok: true as const, entry: prior };
		const planState = await prepareVersionChange(ownerId, request, {
			reject,
			find: (id, owner) => deps.find(id, { id: owner }),
			entries: (owner, ids) => deps.entries(things, owner, ids),
			nodes: (owner, ids) => deps.nodes(things, owner, ids),
			snapshot: (owner, entry, side) => deps.snapshot(things, owner, entry.event.id, side, entry.event[side]),
			deleted: (owner, id) => deps.deleted(things, owner, id),
			folderExists: async (owner, id) =>
				!!(await things.findOne({ shareId: id, ownerId: owner, thingtime: 'folder' }, { projection: { shareId: 1 } })),
			recorded: (owner, sources) => deps.recorded(things, owner, sources),
			live: (doc, current, result) => deps.live(things, undefined, doc, current, result),
			compare: comparePublishedComponents,
			hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
		});
		const { preview, source, doc, recovery, headId, current, merged, refs, components } = planState;
		if (request.command === 'preview-version') return { ok: true as const, preview };
		const undo = request.mode === 'undo';
		const capture = {
			...newThingMutationCapture(ownerId, 'api'),
			id: committedId!,
			operationId: signature,
			// No new operation value: an undo commits as a restore whose label and
			// hashed mode keep it distinct from a restore of the same version.
			operation: recovery ? ('create' as const) : request.mode === 'undo' ? ('restore' as const) : request.mode,
			parentIds: [...new Set([headId, source.event.id])],
			label: recovery
				? 'Recovered deleted Thing'
				: undo
				? TIMELINE_UNDO_LABEL
				: request.mode === 'merge'
				? 'Merged branch into current version'
				: 'Restored earlier version'
		};
		const plan =
			request.componentMode === 'recorded' && refs.length
				? planPublishedComponentCopies(request.operationId!, merged.value, components!.result)
				: { copies: [], content: merged.value };
		const copies = plan.copies.map((copy) => ({
			...copy,
			capture: {
				...newThingMutationCapture(ownerId, 'api'),
				id: 'version-copy-' + copy.shareId,
				operationId: signature,
				label: 'Copied recorded component for restored page'
			}
		}));
		const beforeCommit = async (transaction: ThingWriteTransaction) => {
			if (components) {
				const live = await deps.live(things, transaction.session, doc, current, merged.value);
				if (live.fingerprint !== request.expectedComponents) reject(409, 'A component changed after the preview. Refresh and compare again.');
			}
			for (const copy of copies) {
				const created = await deps.create(
					ownerId,
					{ shareId: copy.shareId, thingtime: ['component'], crystal: copy.crystal, visibility: 'private' },
					{ id: ownerId },
					null,
					{ transaction, timelineCapture: copy.capture }
				);
				if (created.ok === false) reject(created.status, created.error);
			}
		};
		if (recovery) {
			let effects: (() => Promise<void>)[] = [];
			try {
				const entry = await deps.transaction(async (session) => {
					effects = [];
					const replay = await existing(session);
					if (replay) return replay;
					const deleted = await deps.deleted(things, ownerId, source.event.thingId, session);
					if (deleted.entry.event.id !== headId) reject(409, 'This Thing changed after the recovery preview. Refresh and compare again.');
					const transaction = {
						session,
						afterCommit: (effect: () => Promise<void>) => {
							effects.push(effect);
						}
					};
					await beforeCommit(transaction);
					const created = await deps.create(
						ownerId,
						{ ...(plan.content as any), shareId: source.event.thingId, thingtime: recovery.thingtime },
						{ id: ownerId },
						null,
						{ transaction, timelineCapture: capture }
					);
					if (created.ok === false) reject(created.status, created.error);
					const committed = await existing(session);
					if (!committed) throw new Error('Recovered content is missing its Timeline receipt.');
					return committed;
				});
				for (const effect of effects) await effect();
				return { ok: true as const, entry };
			} catch (error) {
				const completed = await existing();
				if (completed) return { ok: true as const, entry: completed };
				throw error;
			}
		}
		const result = await deps.update({ id: ownerId }, source.event.thingId, plan.content as any, {
			replaceCrystal: true,
			expectedUpdatedAt: new Date(doc!.updatedAt).toISOString(),
			timeline: {
				expectedHeadId: headId,
				capture,
				...(components ? { beforeCommit } : {})
			}
		});
		if (result.ok === false) {
			const completed = await existing();
			if (completed) return { ok: true as const, entry: completed };
			reject(result.status, result.error);
		}
		const entry = await existing();
		if (!entry) throw new Error('Version was saved but its Timeline receipt could not be read. Retry this operation.');
		return { ok: true as const, entry };
	};
}
export const handleVersionRequest = createVersionService();
