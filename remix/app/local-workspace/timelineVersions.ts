import { prepareVersionChange } from '../timeline/versionPlan';
import { parseVersionRequest, versionRequestIdentity, TIMELINE_UNDO_LABEL, type VersionRequest } from '../timeline/publishedVersion';
import { createPublishedComponentTools, componentComparisonText, componentDefinitionFields } from '../timeline/publishedComponentTools';
import { componentValues, definitionSnapshot } from '../timeline/componentDefinitions';
import { componentVersion, componentVersionBindings } from '../timeline/componentMerge';
import { COMPONENT_BINDING_PREFIX, componentBindingSnapshot, webpageComponentRefs } from '../timeline/componentBindings';
import type { TimelineEntry } from '../timeline/contract';
import { isProtectedThingtime } from '../schemas/registry';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { localTimelineEntry, localTimelineHead, localRecordedComponents, LOCAL_TIMELINE_OWNER, type LocalMutationCapture } from './timeline';
import { LocalThings, type LocalThing } from './things';
import { resolveWorkspacePage } from './webpageResolution';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceTransaction } from './storage';

const owner = LOCAL_TIMELINE_OWNER;
const reject = (status: number, message: string): never => {
	throw new WorkspaceError('LOCAL_VERSION', message, status);
};
const hashText = (text: string) => transferChecksum(new TextEncoder().encode(text));
const hash = (value: unknown) => hashText(componentComparisonText(value));
const tools = createPublishedComponentTools(componentComparisonText, (message) => reject(422, message));
function liveVersion(all: LocalThing[], page: any, content: any) {
	const refs = page.thingtime.includes('webpage') ? webpageComponentRefs(content.crystal?.blocks) : [];
	if (!refs.length) return {};
	const projected = { ...page, id: page.shareId, crystal: content.crystal } as LocalThing;
	const resolved = resolveWorkspacePage([...all.filter((row) => row.id !== projected.id), projected], { kind: 'id', id: projected.id }, owner);
	const docs = new Map(resolved.components.map((doc) => [doc.id, doc]));
	const result = componentDefinitionFields(
		refs,
		Object.fromEntries(
			refs.map((ref) => {
				const doc = docs.get(resolved.refs[ref] ?? '');
				return [ref, (componentBindingSnapshot(ref, doc ? { id: doc.id, crystal: doc.crystal } : null).value as any).component];
			})
		)
	);
	try {
		definitionSnapshot(componentValues(result));
	} catch {
		reject(413, 'Current components exceed the comparison budget.');
	}
	return result;
}
const liveValues = (all: LocalThing[], page: any, current: any, result: any) => ({
	current: liveVersion(all, page, current),
	result: liveVersion(all, page, result)
});
const allThings = async (tx: WorkspaceTransaction) => (await tx.list<LocalThing>('things')).map((row) => row.value);
async function deletedState(tx: WorkspaceTransaction, id: string) {
	if (await tx.get('things', id)) reject(409, 'This Thing is already present. Refresh History before restoring it.');
	const entry = await localTimelineHead(tx, id);
	if (!entry || entry.event.operation !== 'delete' || entry.event.after !== null || !entry.event.before)
		reject(409, 'A recorded deletion is required to recover this Thing.');
	const value = entry.event.before!.value as any;
	if (
		entry.event.before!.adapter !== 'thing-content' ||
		!Array.isArray(value.thingtime) ||
		!value.thingtime.length ||
		value.thingtime.some((kind: unknown) => typeof kind !== 'string') ||
		isProtectedThingtime(value.thingtime) ||
		value.thingtime.includes('action-run')
	)
		reject(409, 'This item needs recovery through its own editor.');
	if (value.targetId !== null) reject(409, 'Attached interactions need recovery through their parent Thing.');
	return { entry, thingtime: value.thingtime as string[] };
}

/** Planning/hashing happens outside write transactions. Commit rechecks the
 * exact content head and the complete canonical component comparison preimage,
 * then uses normal local validators and one atomic content/Timeline writer. */
export class LocalTimelineVersions {
	constructor(private db: WorkspaceDatabase, private lease: WorkspaceLease, private things = new LocalThings(db, { kind: 'anonymous' }, lease)) {}
	async request(input: VersionRequest, signal?: AbortSignal) {
		this.lease.assertCurrent();
		signal?.throwIfAborted();
		const request = parseVersionRequest(input),
			signature = await hashText(versionRequestIdentity(request));
		const checkedLease: WorkspaceLease = {
			assertCurrent: () => {
				this.lease.assertCurrent();
				signal?.throwIfAborted();
			},
			onInvalidate: (cb) => {
				const unsubscribe = this.lease.onInvalidate(cb);
				signal?.addEventListener('abort', cb, { once: true });
				return () => {
					unsubscribe();
					signal?.removeEventListener('abort', cb);
				};
			}
		};
		const read = <T>(run: (tx: WorkspaceTransaction) => Promise<T>) => this.db.transaction({ kind: 'anonymous' }, 'readonly', checkedLease, run);
		const committedId = request.operationId ? `version-${request.operationId}` : null;
		const replay = async (tx: WorkspaceTransaction) => {
			if (!committedId) return null;
			const entry = await localTimelineEntry(tx, committedId);
			if (
				entry &&
				(entry.event.operationId !== signature || entry.event.actorId !== owner || entry.event.source !== 'api' || entry.event.mode !== 'revision')
			)
				reject(409, 'This operation id was already used for another version request.');
			return entry;
		};
		if (request.command === 'apply-version') {
			const prior = await read(replay);
			if (prior) return { ok: true as const, entry: prior };
		}
		const entries = (_owner: string, ids: string[]) =>
			read(async (tx) => {
				const found: TimelineEntry[] = [];
				for (const id of ids) {
					const entry = await localTimelineEntry(tx, id);
					if (entry) found.push(entry);
				}
				return found;
			});
		let liveText = '';
		const plan = await prepareVersionChange(owner, request, {
			reject,
			entries,
			find: (id) =>
				read(async (tx) => {
					const doc = await tx.get<LocalThing>('things', id);
					if (!doc || doc.thingtime.includes('action-run')) return null;
					const head = await localTimelineHead(tx, id);
					return { ...doc, shareId: doc.id, ownerId: owner, acl: [], timelineHeadId: head?.event.id };
				}),
			nodes: async (_owner, ids) =>
				(
					await entries(owner, ids)
				).map(({ event }) => ({ id: event.id, thingId: event.thingId, parentIds: event.parentIds, afterAdapter: event.after?.adapter ?? null })),
			snapshot: async (_owner, entry, side) => entry.event[side],
			deleted: (_owner, id) => read((tx) => deletedState(tx, id)),
			folderExists: (_owner, id) => read(async (tx) => !!(await tx.get<LocalThing>('things', id))?.thingtime.includes('folder')),
			recorded: async (_owner, sources) => {
				if (sources.some(({ event }) => event.dependencies.some((link) => !link.thingId.startsWith(COMPONENT_BINDING_PREFIX))))
					reject(422, 'This version has dependencies this comparison cannot yet restore.');
				const captures = await read((tx) =>
					localRecordedComponents(
						tx,
						sources.flatMap(({ event }) => event.dependencies)
					)
				);
				return sources.map(({ event, content }) =>
					componentDefinitionFields(
						webpageComponentRefs(content.crystal?.blocks),
						componentVersionBindings(componentVersion(event, content.crystal?.blocks, captures), captures)
					)
				);
			},
			live: async (doc, current, result) => {
				const values = await read(async (tx) => liveValues(await allThings(tx), doc, current, result));
				liveText = componentComparisonText(values);
				return { ...values, fingerprint: await hashText(liveText) };
			},
			compare: tools.comparePublishedComponents,
			hash: (value) => hashText(JSON.stringify(value))
		});
		checkedLease.assertCurrent();
		if (request.command === 'preview-version') return { ok: true as const, preview: plan.preview };
		const { source, doc, recovery, headId, current, merged, refs, components } = plan;
		// Precompute the exact server SHA-256 identities before entering IndexedDB.
		const hashes = new Map<string, string>();
		if (request.componentMode === 'recorded')
			for (const field of Object.values(components!.result)) {
				if (field.present === false) return reject(422, 'Some component definitions were not recorded.');
				const value = { operationId: request.operationId!, component: field.value };
				hashes.set(componentComparisonText(value), await hash(value));
			}
		const copyTools = createPublishedComponentTools(
			(value) => {
				const result = hashes.get(componentComparisonText(value));
				if (!result) return reject(409, 'The recorded component plan changed.');
				return result;
			},
			(message) => reject(422, message)
		);
		const copies =
			request.componentMode === 'recorded' && refs.length
				? copyTools.planPublishedComponentCopies(request.operationId!, merged.value, components!.result)
				: { copies: [], content: merged.value };
		const capture: LocalMutationCapture = {
			id: committedId!,
			operationId: signature,
			source: 'api',
			clientId: null,
			operation: recovery ? 'create' : request.mode === 'undo' ? 'restore' : request.mode,
			parentIds: [...new Set([headId, source.event.id])],
			label: recovery
				? 'Recovered deleted Thing'
				: request.mode === 'undo'
				? TIMELINE_UNDO_LABEL
				: request.mode === 'merge'
				? 'Merged branch into current version'
				: 'Restored earlier version'
		};
		checkedLease.assertCurrent();
		// Reuse the configured normal writer (including builtins) under the same lease.
		await this.things.versionTransaction(async (writer) => {
			checkedLease.assertCurrent();
			if (await replay(writer.tx)) return;
			const existing = await writer.tx.get<LocalThing>('things', source.event.thingId),
				head = await localTimelineHead(writer.tx, source.event.thingId);
			if (head?.event.id !== headId || (recovery ? !!existing : !existing || existing.updatedAt !== doc.updatedAt))
				reject(409, 'Thing changed after the version preview. Refresh and compare again.');
			if (components && componentComparisonText(liveValues(await allThings(writer.tx), doc, current, merged.value)) !== liveText)
				reject(409, 'A component changed after the preview. Refresh and compare again.');
			for (const copy of copies.copies)
				await writer.create({ thingtime: ['component'], crystal: copy.crystal }, copy.shareId, {
					...capture,
					id: 'version-copy-' + copy.shareId,
					operation: 'create',
					parentIds: [],
					label: 'Copied recorded component for restored page'
				});
			const content = copies.content as any;
			if (recovery) await writer.create({ ...content, thingtime: recovery.thingtime }, source.event.thingId, capture);
			else await writer.update({ ...content, id: source.event.thingId, replaceCrystal: true, expectedUpdatedAt: doc.updatedAt }, capture);
			checkedLease.assertCurrent();
		}, signal);
		const entry = await read(replay);
		if (!entry) reject(409, 'Version was saved but its Timeline receipt could not be read. Retry this operation.');
		return { ok: true as const, entry };
	}
}
