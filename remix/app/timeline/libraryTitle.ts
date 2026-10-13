import type { TimelineSnapshot } from './contract.ts';

export const LIBRARY_TITLE_ADAPTER = 'library-title';

/** Display metadata only. The shared format never includes a managed Thing's
 * payload, original name, credentials, file keys or archived messages. */
export function libraryTitleSnapshot(title: unknown): TimelineSnapshot {
	if (title !== undefined && title !== null && (typeof title !== 'string' || title.length > 120)) throw new Error('Invalid library title history');
	return { adapter: LIBRARY_TITLE_ADAPTER, version: 1, value: { title: title ?? null } } as TimelineSnapshot;
}

export function libraryTitleValue(snapshot: TimelineSnapshot): { title: string | null } {
	const value = snapshot.value;
	if (snapshot.adapter !== LIBRARY_TITLE_ADAPTER || snapshot.version !== 1 || !value || typeof value !== 'object' || Array.isArray(value) ||
		Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, 'title') ||
		(value.title !== null && typeof value.title !== 'string')) throw new Error('Invalid library title history');
	libraryTitleSnapshot(value.title);
	return { title: value.title as string | null };
}
