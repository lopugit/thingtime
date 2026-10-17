import { TIMELINE_SNAPSHOT_PARTS_ADAPTER, parseTimelineSnapshotReference } from './snapshotParts.ts';
import { TIMELINE_EVENT_MAX_BYTES, parseTimelineEvent, parseTimelineEntry, type TimelineEntry, type TimelineEvent, type TimelineReceipt, type TimelineSnapshot } from './contract.ts';
import { parseTimelineNote, TIMELINE_NOTES_PER_EVENT, type TimelineNote } from './notes.ts';
import { copyBoundedJson } from '../utils/boundedJson.ts';
import { versionContent } from './versions.ts';
import { parseTimelineVersionName, type TimelineVersionName } from './versionNames.ts';
import { createVersionGraphTools, type TimelineGraphNode } from './versionGraph.ts';

/** The existing History archive contract, shared by account and local authority.
 * This is a version archive, not a thingtime.transfer bundle. It never borrows
 * current Thing content or resolves dependency references against live Things. */
export type TimelineExportSource = { event: TimelineEvent; receipt: TimelineReceipt | null };
export type TimelineVersionExport<Receipt extends TimelineReceipt | null = TimelineReceipt> = {
	formatVersion: 1;
	exportedAt: string;
	event: TimelineEvent;
	receipt: Receipt;
	content: TimelineSnapshot;
	notes: TimelineNote[];
	name: TimelineVersionName | null;
	/** Device context may omit notes/names that were never retained or are still queued. */
	context?: { source: 'device'; complete: false };
};
type Dependencies<Entry extends TimelineExportSource> = {
	entries: (ids: string[]) => Promise<Entry[]>;
	nodes: (ids: string[]) => Promise<TimelineGraphNode[]>;
	snapshot: (entry: Entry, side: 'before' | 'after') => Promise<TimelineSnapshot | null>;
	notes: (entry: Entry) => Promise<TimelineNote[]>;
	names: (entry: Entry) => Promise<TimelineVersionName[]>;
	now: () => Date;
	refuse: (status: number, message: string) => never;
	retainedLocation: 'your account' | 'this device';
	allowClientDrafts?: boolean;
	context?: TimelineVersionExport['context'];
};
export function createVersionExportReader<Entry extends TimelineExportSource = TimelineEntry>(deps: Dependencies<Entry>) {
	const { refuse } = deps;
	const { restorableContent, loadVersionGraph, versionContentSources, createVersionContentReader } = createVersionGraphTools(refuse);
	const tooLarge = `This version is too large to export in one file. It remains retained in ${deps.retainedLocation}.`;
	return async (ownerId: string, eventId: string): Promise<TimelineVersionExport<Entry['receipt']> | null> => {
		if (typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(eventId)) refuse(400, 'Invalid Timeline export request');
		const read = deps.entries;
		const source = (await read([eventId]))[0];
		if (!source || source.event.ownerId !== ownerId || source.event.id !== eventId) return null;
		if (source.event.mode !== 'revision' && !(deps.allowClientDrafts && isClientDraftVersion(source.event))) refuse(422, 'Only saved versions can be exported.');
		if (source.receipt === null && (!deps.allowClientDrafts || !isClientDraftVersion(source.event) || !deps.context)) refuse(422, 'An unacknowledged version must remain a device-authored draft.');
		const side = source.event.after ? 'after' : 'before';
		const retained = source.event[side];
		// A parts snapshot may hold up to 128 MiB; refuse from its reference before any part document is read.
		if (retained?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER && parseTimelineSnapshotReference(retained.value).bytes > TIMELINE_EVENT_MAX_BYTES)
			refuse(413, tooLarge);
		let value: ReturnType<typeof restorableContent>;
		if (source.event.after) {
			const compact = !['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(source.event.after.adapter);
			const graph = compact
				? await loadVersionGraph([eventId], source.event.thingId, (ids) => deps.nodes(ids))
				: new Map<string, TimelineGraphNode>();
			if (compact) {
				// A compact version resolves through its saved ancestor; that ancestor's parts reference is checked before any part is read.
				const ancestors = versionContentSources(graph, source).selected.filter((id) => id !== eventId);
				for (const ancestor of ancestors.length ? await read(ancestors) : []) {
					const after = ancestor.event.after;
					if (after?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER && parseTimelineSnapshotReference(after.value).bytes > TIMELINE_EVENT_MAX_BYTES)
						refuse(413, tooLarge);
				}
			}
			value = await createVersionContentReader(graph, read, (entry) => deps.snapshot(entry, 'after'))(source);
		} else value = restorableContent(await deps.snapshot(source, 'before'));
		const [notes, names] = await Promise.all([deps.notes(source), deps.names(source)]);
		const result: TimelineVersionExport<Entry['receipt']> = {
			formatVersion: 1,
			exportedAt: deps.now().toISOString(),
			event: source.event,
			receipt: source.receipt,
			content: { adapter: 'thing-content', version: 1, value },
			notes,
			name: names[0] ?? null,
			...(deps.context ? {context: deps.context} : {})
		};
		if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TIMELINE_EVENT_MAX_BYTES) refuse(413, tooLarge);
		return result;
	};
}

/** A retained draft does not imply that any account mutation was executed. */
export const isClientDraftVersion = (event: TimelineEvent) => event.mode === 'draft' && event.source === 'client' && event.actorId === event.ownerId && event.clientId !== null;

/** Archive validation is shared by network reads, local exports and downloads.
 * Network responses still require a real receipt; a device archive can explicitly
 * retain an unacknowledged client draft without weakening parseTimelineEntry. */
export function parseTimelineVersionExport(input: unknown, expected: {ownerId:string;id:string;thingId?:string}, requireReceipt=false): TimelineVersionExport<TimelineReceipt|null> {
 const envelope=input as any;
 const raw=envelope?.export ?? input;
 if(envelope?.export && envelope.ok!==true)throw new Error('Invalid Timeline export');
 const data=copyBoundedJson(raw,{maxBytes:TIMELINE_EVENT_MAX_BYTES,maxDepth:100,maxNodes:220_000},'Timeline export') as any;
 if(!data || data.formatVersion!==1 || !data.event || !data.content)throw new Error('The export is not a version file.');
 const event=parseTimelineEvent(data.event);
 if(event.id!==expected.id||event.ownerId!==expected.ownerId||(expected.thingId!==undefined&&event.thingId!==expected.thingId))throw new Error('The export belongs to another version.');
 const context=data.context;
 if(context!==undefined && (!context||Object.keys(context).length!==2||context.source!=='device'||context.complete!==false))throw new Error('Invalid Timeline export context');
 if(event.mode!=='revision'&&!isClientDraftVersion(event))throw new Error('This event is not an exportable version.');
 const receipt=data.receipt===null?null:parseTimelineEntry({event,receipt:data.receipt}).receipt;
 if(receipt===null&&(requireReceipt||!isClientDraftVersion(event)||!context))throw new Error('This export needs an authority receipt or an explicit device draft.');
 if(typeof data.exportedAt!=='string'||!Number.isFinite(Date.parse(data.exportedAt))||new Date(data.exportedAt).toISOString()!==data.exportedAt)throw new Error('Invalid Timeline export date');
 if(data.content.adapter!=='thing-content'||data.content.version!==1)throw new Error('Invalid Timeline export content');
 versionContent(data.content);
 if(!Array.isArray(data.notes)||data.notes.length>TIMELINE_NOTES_PER_EVENT)throw new Error('Invalid Timeline export notes');
 const notes=data.notes.map(parseTimelineNote),name=data.name===null?null:parseTimelineVersionName(data.name);
 if(new Set(notes.map((note:TimelineNote)=>note.id)).size!==notes.length||[...notes,...(name?[name]:[])].some(row=>row.ownerId!==event.ownerId||row.eventId!==event.id||row.thingId!==event.thingId))throw new Error('Timeline export context belongs to another version.');
 return {...data,event,receipt,notes,name};
}
