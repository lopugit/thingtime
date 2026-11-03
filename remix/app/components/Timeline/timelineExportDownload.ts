import type { TimelineEvent } from '../../timeline/contract';
import { triggerDownload } from '../Marketing/marketingDownload';

/** One exported version is one JSON file. The name carries both ids so a
 * folder of exports stays sortable by Thing; ids may contain `/`, `:` and `@`
 * (contract.ts id rule), which are not file-name safe on every platform. */
export const TIMELINE_EXPORT_FILENAME_MAX_CHARS = 120;
const EXTENSION = '.json';
const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');
export const timelineExportFilename = (thingId: string, eventId: string) =>
	`${`history-${safe(thingId)}-${safe(eventId)}`.slice(0, TIMELINE_EXPORT_FILENAME_MAX_CHARS - EXTENSION.length)}${EXTENSION}`;

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
/** The transport may hand back the `{ ok, export }` envelope or the export
 * record itself. Either way the file must describe exactly the selected
 * version of this owner's Thing; anything else is refused before download. */
export function timelineExportRecord(input: unknown, event: Pick<TimelineEvent, 'id' | 'thingId' | 'ownerId'>): Record<string, any> {
	const record = object(input) && object(input.export) ? input.export : input;
	if (!object(record) || record.formatVersion !== 1 || !object(record.event) || !object(record.content)) throw new Error('The export is not a version file.');
	if (record.event.id !== event.id || record.event.thingId !== event.thingId || record.event.ownerId !== event.ownerId) throw new Error('The export belongs to another version.');
	return record;
}
export const timelineExportText = (record: Record<string, any>) => JSON.stringify(record, null, 2);

/** Browser only: saves through the shared anchor-click download helper. Returns the file name for the inline notice. */
export function downloadTimelineVersionExport(input: unknown, event: Pick<TimelineEvent, 'id' | 'thingId' | 'ownerId'>): string {
	const record = timelineExportRecord(input, event);
	const filename = timelineExportFilename(event.thingId, event.id);
	if (typeof Blob === 'undefined') throw new Error('Downloads need a browser.');
	triggerDownload(new Blob([timelineExportText(record)], { type: 'application/json' }), filename);
	return filename;
}
