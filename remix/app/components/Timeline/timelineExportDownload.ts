import { parseTimelineVersionExport } from '../../timeline/exportVersion';
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

/** Validate the exact selected version before producing a file. */
export function timelineExportRecord(input: unknown, event: Pick<TimelineEvent, 'id' | 'thingId' | 'ownerId'>): Record<string, any> {
 return parseTimelineVersionExport(input,event);
}
export const timelineExportText = (record: Record<string, any>) => JSON.stringify(record, null, 2);

/** Browser only: saves through the shared anchor-click download helper. Returns the file name for the inline notice. */
export function downloadTimelineVersionExport(input: unknown, event: Pick<TimelineEvent, 'id' | 'thingId' | 'ownerId'>): string {
	const assertAvailable = (input as any)?.assertAvailable;
	if (typeof assertAvailable === 'function') assertAvailable();
	const record = timelineExportRecord(input, event);
	const filename = timelineExportFilename(event.thingId, event.id);
	if (typeof Blob === 'undefined') throw new Error('Downloads need a browser.');
	const text = timelineExportText(record);
	if (typeof assertAvailable === 'function') assertAvailable();
	triggerDownload(new Blob([text], { type: 'application/json' }), filename);
	return filename;
}
