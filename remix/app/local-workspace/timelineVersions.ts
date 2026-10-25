import { workspaceScopeKey } from './storage';
import type { TimelineSnapshot } from '../timeline/contract';
import { prepareVersionChange, type VersionContentAdapter } from '../timeline/versionPlan';
import { parseVersionRequest, versionRequestIdentity, TIMELINE_UNDO_LABEL, type VersionRequest } from '../timeline/publishedVersion';
import { createPublishedComponentTools, componentComparisonText, componentDefinitionFields } from '../timeline/publishedComponentTools';
import { componentValues, definitionSnapshot } from '../timeline/componentDefinitions';
import { componentVersion, componentVersionBindings } from '../timeline/componentMerge';
import { COMPONENT_BINDING_PREFIX, componentBindingSnapshot, webpageComponentRefs } from '../timeline/componentBindings';
import type { TimelineEntry, TimelineEvent, TimelineReceipt } from '../timeline/contract';
import { isProtectedThingtime } from '../schemas/registry';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { localTimelineEntry, localTimelineHead, localRecordedComponents, LOCAL_TIMELINE_OWNER, type LocalMutationCapture } from './timeline';
import { LocalThings, type LocalThing } from './things';
import { resolveWorkspacePage } from './webpageResolution';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceTransaction, type WorkspaceScope } from './storage';

export type LocalVersionUpdateWriter = {
 tx: WorkspaceTransaction;
 recover?(input: any, id: string, capture: LocalMutationCapture): Promise<unknown>;
 update(input: { id: string; crystal: any; expectedUpdatedAt?: string }, capture: LocalMutationCapture): Promise<unknown>;
};
/** Only dedicated writers can opt exact protected kinds into History edits. */
export type LocalProtectedVersionWriter = {
 matches(doc: LocalThing): boolean;
 scope?: WorkspaceScope;
 recovery?: { adapter: string; read(tx: WorkspaceTransaction, id: string, snapshot: TimelineSnapshot): Promise<{ doc: LocalThing; content: VersionContentAdapter }> };
 content(doc: any): VersionContentAdapter;
 read?(tx: WorkspaceTransaction, id: string): Promise<LocalThing | undefined>;
 transaction<T>(run: (writer: LocalVersionUpdateWriter) => Promise<T>, signal?: AbortSignal): Promise<T>;
};

type VersionEntry = { event: TimelineEvent; receipt: TimelineReceipt | null };
export type LocalVersionAuthority<Entry extends VersionEntry> = {
 scope: WorkspaceScope;
 ownerId: string;
 entry(tx: WorkspaceTransaction, id: string): Promise<Entry | null>;
 head(tx: WorkspaceTransaction, id: string): Promise<Entry | null>;
 recorded(tx: WorkspaceTransaction, wanted: TimelineEvent['dependencies']): Promise<Pick<TimelineEntry, 'event'>[]>;
 thing(tx: WorkspaceTransaction, id: string): Promise<LocalThing | undefined>;
 deviceDrafts: boolean;
};
const anonymousAuthority: LocalVersionAuthority<TimelineEntry> = {
 scope: {kind:'anonymous'}, ownerId:LOCAL_TIMELINE_OWNER,
 entry:localTimelineEntry,head:localTimelineHead,recorded:localRecordedComponents,
 thing:(tx,id)=>tx.get<LocalThing>('things',id),deviceDrafts:false
};
const reject = (status: number, message: string): never => {
	throw new WorkspaceError('LOCAL_VERSION', message, status);
};
const hashText = (text: string) => transferChecksum(new TextEncoder().encode(text));
const hash = (value: unknown) => hashText(componentComparisonText(value));
const tools = createPublishedComponentTools(componentComparisonText, (message) => reject(422, message));
function liveVersion(all: LocalThing[], page: any, content: any, owner: string) {
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
const liveValues = (all: LocalThing[], page: any, current: any, result: any, owner: string) => ({
	current: liveVersion(all, page, current, owner),
	result: liveVersion(all, page, result, owner)
});
const allThings = async (tx: WorkspaceTransaction) => (await tx.list<LocalThing>('things')).map((row) => row.value);
async function deletedState<Entry extends VersionEntry>(tx: WorkspaceTransaction, id: string, authority: LocalVersionAuthority<Entry>, writers: LocalProtectedVersionWriter[]) {
	if (await tx.get('things', id)) reject(409, 'This Thing is already present. Refresh History before restoring it.');
	const entry = await authority.head(tx, id);
	if (!entry || entry.event.operation !== 'delete' || entry.event.after !== null || !entry.event.before)
		reject(409, 'A recorded deletion is required to recover this Thing.');
	const writer = writers.find(writer => writer.recovery?.adapter === entry.event.before!.adapter);
	if (writer?.recovery) {
		if (writer.scope && workspaceScopeKey(writer.scope) !== workspaceScopeKey(authority.scope)) reject(409, 'Recovery belongs to another workspace.');
		const recovered = await writer.recovery.read(tx, id, entry.event.before!);
		if (!writer.matches(recovered.doc)) reject(409, 'This recovery belongs to another dedicated writer.');
		return { entry, thingtime: recovered.doc.thingtime, doc: recovered.doc, content: recovered.content, writer };
	}
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
export class LocalTimelineVersions<Entry extends VersionEntry = TimelineEntry> {
	constructor(private db: WorkspaceDatabase, private lease: WorkspaceLease, private things = new LocalThings(db, { kind: 'anonymous' }, lease), private authority: LocalVersionAuthority<Entry> = anonymousAuthority as unknown as LocalVersionAuthority<Entry>, private protectedWriters: LocalProtectedVersionWriter[] = []) {}
	async request(input: VersionRequest, signal?: AbortSignal) {
		this.lease.assertCurrent();
		const owner = this.authority.ownerId;
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
		const read = <T>(run: (tx: WorkspaceTransaction) => Promise<T>) => this.db.transaction(this.authority.scope, 'readonly', checkedLease, run);
		const committedId = request.operationId ? `version-${request.operationId}` : null;
		const replay = async (tx: WorkspaceTransaction) => {
			if (!committedId) return null;
			const entry = await this.authority.entry(tx, committedId);
			if (
				entry &&
				(entry.event.operationId !== signature || entry.event.actorId !== owner || entry.event.source !== (this.authority.deviceDrafts ? 'client' : 'api') || entry.event.mode !== (this.authority.deviceDrafts ? 'draft' : 'revision'))
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
				const found: Entry[] = [];
				for (const id of ids) {
					const entry = await this.authority.entry(tx, id);
					if (entry) found.push(entry);
				}
				return found;
			});
		let liveText = '';
		let protectedWriter: LocalProtectedVersionWriter | undefined;
		let plan: Awaited<ReturnType<typeof prepareVersionChange<Entry>>>;
		try {
		plan = await prepareVersionChange(owner, request, {
			reject,
			contentAdapter: doc => { protectedWriter = this.protectedWriters.find(writer => writer.matches(doc)); return protectedWriter?.content(doc) ?? null; },
			canUndoDraft: event => this.authority.deviceDrafts && event.mode === 'draft' && event.source === 'client' && event.actorId === owner && event.ownerId === owner && !!event.clientId,
			entries,
			find: (id) =>
				read(async (tx) => {
					const doc = await this.authority.thing(tx, id);
					if (!doc || doc.thingtime.includes('action-run')) return null;
					const head = await this.authority.head(tx, id);
					return { ...doc, shareId: doc.id, ownerId: owner, acl: this.authority.deviceDrafts ? (doc as any).acl : [], timelineHeadId: head?.event.id };
				}),
			nodes: async (_owner, ids) =>
				(
					await entries(owner, ids)
				).map(({ event }) => ({ id: event.id, thingId: event.thingId, parentIds: event.parentIds, afterAdapter: event.after?.adapter ?? null })),
			snapshot: async (_owner, entry, side) => entry.event[side],
			deleted: (_owner, id) => read(async (tx) => {
				const state = await deletedState(tx, id, this.authority, this.protectedWriters);
				if ('writer' in state) protectedWriter = state.writer;
				return state;
			}),
			folderExists: (_owner, id) => read(async (tx) => !!(await tx.get<LocalThing>('things', id))?.thingtime.includes('folder')),
			recorded: async (_owner, sources) => {
				if (sources.some(({ event }) => event.dependencies.some((link) => !link.thingId.startsWith(COMPONENT_BINDING_PREFIX))))
					reject(422, 'This version has dependencies this comparison cannot yet restore.');
				const captures = await read((tx) =>
					this.authority.recorded(
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
				const values = await read(async (tx) => liveValues(await allThings(tx), doc, current, result, owner));
				liveText = componentComparisonText(protectedWriter ? { ...values, protectedContent: protectedWriter.content(doc).current, updatedAt: doc.updatedAt } : values);
				return { ...values, fingerprint: await hashText(liveText) };
			},
			compare: tools.comparePublishedComponents,
			hash: (value) => hashText(JSON.stringify(value))
		});
		} catch (error) {
			checkedLease.assertCurrent();
			// Another tab may commit this exact operation after the initial replay
			// read but before planning. Its receipt wins over a stale-head refusal.
			if (request.command === 'apply-version') { const prior = await read(replay); if (prior) return { ok: true as const, entry: prior }; }
			throw error;
		}
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
			...(!this.authority.deviceDrafts ? {source: 'api' as const, clientId: null} : {}),
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
		const commit = async (writer: LocalVersionUpdateWriter & Partial<Pick<Parameters<Parameters<LocalThings['versionTransaction']>[0]>[0], 'create' | 'recover'>>) => {
			checkedLease.assertCurrent();
			if (await replay(writer.tx)) return;
			const existing = await writer.tx.get<LocalThing>('things', source.event.thingId),
				head = await this.authority.head(writer.tx, source.event.thingId);
			if (head?.event.id !== headId || (recovery ? !!existing : !existing || existing.updatedAt !== doc.updatedAt))
				reject(409, 'Thing changed after the version preview. Refresh and compare again.');
			if (components) {
				const values = liveValues(await allThings(writer.tx), doc, current, merged.value, owner);
				const recoveryState = recovery && protectedWriter ? await deletedState(writer.tx, source.event.thingId, this.authority, this.protectedWriters) : null;
				const protectedDoc = recoveryState && 'doc' in recoveryState ? recoveryState.doc : protectedWriter ? await this.authority.thing(writer.tx, source.event.thingId) : null;
				const actual = protectedWriter ? { ...values, protectedContent: protectedWriter.content(protectedDoc!).current, updatedAt: protectedDoc!.updatedAt } : values;
				if (componentComparisonText(actual) !== liveText) reject(409, protectedWriter ? 'Content changed after the preview. Refresh and compare again.' : 'A component changed after the preview. Refresh and compare again.');
			}
			if ((copies.copies.length && !writer.create) || (recovery && !writer.recover)) reject(422, 'This protected content requires its dedicated recovery editor.');
			for (const copy of copies.copies)
				await writer.create!({ thingtime: ['component'], crystal: copy.crystal }, copy.shareId, {
					...capture,
					id: 'version-copy-' + copy.shareId,
					operation: 'create',
					parentIds: [],
					label: 'Copied recorded component for restored page'
				});
			const content = copies.content as any;
			if (recovery) await writer.recover!({ ...content, thingtime: recovery.thingtime }, source.event.thingId, capture);
			else await writer.update({ ...content, id: source.event.thingId, expectedUpdatedAt: doc.updatedAt, ...(!protectedWriter ? { replaceCrystal: true } : {}) }, capture);
			checkedLease.assertCurrent();
		};
		if (protectedWriter) await protectedWriter.transaction(commit, signal);
		else await this.things.versionTransaction(commit, signal);
		const entry = await read(replay);
		if (!entry) reject(409, 'Version was saved but its Timeline receipt could not be read. Retry this operation.');
		return { ok: true as const, entry };
	}
}
