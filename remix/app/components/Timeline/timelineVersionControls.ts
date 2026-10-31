import type { LocalTimelineRow } from '../../timeline/localStore';
import type { TimelineEvent } from '../../timeline/contract';
import { TIMELINE_UNDO_LABEL } from '../../timeline/publishedVersion';
import { TIMELINE_VERSION_NAME_MAX_CHARS } from '../../timeline/versionNames';

/** Why a Versions-tab control strip is inert, in the words the row shows.
 * Naming needs a synced saved version with content; export also covers synced
 * deletions (the server resolves their `before` content). Both are online only. */
export type VersionControlState = { name: boolean; export: boolean; title: string };
export function versionControlState(row: Pick<LocalTimelineRow, 'status' | 'event'>, verified: boolean): VersionControlState {
	const { event } = row;
	if (event.mode !== 'revision') return { name: false, export: false, title: 'Only saved versions can be named or exported' };
	if (row.status !== 'accepted') return { name: false, export: false, title: 'Sync this version first' };
	if (!verified) return { name: false, export: false, title: 'Reconnect to name or export versions' };
	if (event.after === null) return { name: false, export: true, title: 'Only saved versions can be named' };
	return { name: true, export: true, title: '' };
}

/* eslint-disable no-control-regex -- the stripped control range is the point of this check */
/** Mirrors the server name rule (branches.ts): trimmed, bounded, no control characters. */
export const normalizeVersionName = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, TIMELINE_VERSION_NAME_MAX_CHARS);
/* eslint-enable no-control-regex */

const short = (id: string) => id.slice(0, 12);
/** The detail header's ancestry line. An undo is captured as a two-parent
 * restore whose first parent is the head it continued from and whose second is
 * the change it reverted (versions.ts capture order); a one-parent undo undid
 * the head itself. The label is the only signal old and new clients share. */
export function historyAncestryLine(event: Pick<TimelineEvent, 'parentIds' | 'operation' | 'label'>): string {
	const parents = event.parentIds;
	if (!parents.length) return 'First recorded moment';
	if (event.operation === 'restore' && event.label === TIMELINE_UNDO_LABEL) return `Undid ${short(parents[1] ?? parents[0])} · continues from ${short(parents[0])}`;
	return `${parents.length === 2 ? 'Combined from' : 'Continues from'} ${parents.map(short).join(' + ')}`;
}
