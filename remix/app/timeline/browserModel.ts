import { readActionOutcome } from './actionOutcome.ts';
import type { TimelineEvent, TimelineSnapshot } from './contract.ts';
import type { LocalTimelineRow } from './localStore.ts';
import { timelineDisplayChanges, timelineChangeLabel, timelineValueLabel } from './changes.ts';
import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from './snapshotParts.ts';

export const HISTORY_LOOKS = ['list', 'cards', 'line', 'frames'] as const;
export type HistoryLook = (typeof HISTORY_LOOKS)[number];
export type HistoryFilters = {
	look: HistoryLook;
	thingId: string;
	related: boolean;
	kind: string;
	source: string;
	operation: string;
	sync: string;
	query: string;
	day: string;
	compact: boolean;
	realTime: boolean;
};
const choice = (value: string | null, values: readonly string[]) => (value && values.includes(value) ? value : '');
export function readHistoryFilters(params: URLSearchParams, initialThing = ''): HistoryFilters {
	const target = params.get('thing') ?? initialThing;
	const day = params.get('day') ?? '';
	const validDay =
		/^\d{4}-\d\d-\d\d$/.test(day) &&
		Number.isFinite(Date.parse(`${day}T12:00:00Z`)) &&
		new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
	return {
		look: (choice(params.get('look'), HISTORY_LOOKS) || 'list') as HistoryLook,
		thingId: /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(target) ? target : '',
		related: params.get('scope') === 'related' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(target),
		kind: choice(params.get('kind'), ['webpage', 'component', 'data', 'post', 'file', 'folder', 'action', 'schema', 'theme']),
		source: choice(params.get('source'), ['client', 'api', 'action', 'ai', 'system']),
		operation: choice(params.get('operation'), ['create', 'update', 'delete', 'restore', 'merge', 'effect']),
		sync: choice(params.get('sync'), ['pending', 'accepted']),
		query: (params.get('q') ?? '').slice(0, 160),
		day: validDay ? day : '',
		compact: params.get('density') === 'compact',
		realTime: params.get('spacing') === 'time'
	};
}
export function writeHistoryFilters(params: URLSearchParams, state: HistoryFilters) {
	const result = new URLSearchParams(params);
	for (const [key, value] of Object.entries({
		look: state.look === 'list' ? '' : state.look,
		thing: state.thingId,
		scope: state.related && state.thingId ? 'related' : '',
		kind: state.kind,
		source: state.source,
		operation: state.operation,
		sync: state.sync,
		q: state.query,
		day: state.day,
		density: state.compact ? 'compact' : '',
		spacing: state.realTime ? 'time' : ''
	})) {
		if (value) result.set(key, value);
		else result.delete(key);
	}
	return result;
}
const object = (value: unknown): Record<string, any> | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
const text = (value: unknown, max = 160) => (typeof value === 'string' ? value.slice(0, max) : '');
/** Presentation only: historical labels never consult today's Thing. */
export function historyContent(snapshot: TimelineSnapshot | null) {
	const value = object(snapshot?.value);
	if (!value || snapshot?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER) return null;
	if (snapshot?.adapter === 'thing-content' || snapshot?.adapter === 'webpage-draft')
		return {
			crystal: object(value.crystal),
			kinds: Array.isArray(value.thingtime)
				? (value.thingtime.filter((kind: unknown) => typeof kind === 'string') as string[])
				: snapshot.adapter === 'webpage-draft'
				? ['webpage']
				: []
		};
	if (snapshot?.adapter === 'definition-source' && typeof value.source === 'string' && value.source.length <= 256_000) {
		try {
			return { crystal: object(JSON.parse(value.source)), kinds: [] };
		} catch {
			return null;
		}
	}
	return null;
}
export const historySource = (event: TimelineEvent) =>
	({ client: 'You · editor', api: 'API', action: 'Action', ai: 'Lopu', system: 'Thingtime' }[event.source]);
export const historyDate = (event: TimelineEvent) => new Date(event.occurredAt);
/** Day grouping follows the viewer's local calendar, including DST. */
export function historyDay(value: Date) {
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function historyDayLabel(key: string) {
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${key}T12:00:00`));
}
export function historyCard(row: LocalTimelineRow) {
	const { event } = row;
	const outcome = readActionOutcome(event);
	const content = historyContent(event.after ?? event.before);
	const crystal = content?.crystal;
	const title =
		(outcome?.actionName ?? '') || text(crystal?.title || crystal?.name) || (event.after?.adapter === 'folder-placement' ? 'Moved Thing' : 'Thing');
	const kind = outcome ? 'action' : content?.kinds[0] ?? '';
	const large = [event.before, event.after].some((snapshot) => snapshot?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER);
	const changes = large || event.mode === 'effect' ? [] : timelineDisplayChanges(event.before, event.after);
	const chips = changes.slice(0, 3).map((change) => ({
		label: timelineChangeLabel(change.path),
		before: timelineValueLabel(change.before, change.path).slice(0, 80),
		after: timelineValueLabel(change.after, change.path).slice(0, 80)
	}));
	const fields = outcome
		? [
				{ name: 'Run', value: outcome.status === 'started' ? 'Accepted' : outcome.status === 'ok' ? 'Finished' : 'Stopped with an error' },
				...(outcome.durationMs === null
					? []
					: [
							{ name: 'Duration', value: `${outcome.durationMs} ms` },
							{ name: 'Operations', value: String(outcome.opsUsed) }
					  ])
		  ]
		: crystal
		? Object.entries(crystal)
				.filter(([key, value]) => !['title', 'name'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value))
				.slice(0, 3)
				.map(([key, value]) => ({ name: timelineChangeLabel([key]), value: String(value).slice(0, 140) }))
		: [];
	return {
		row,
		title,
		kind,
		kinds: outcome ? ['action'] : content?.kinds ?? [],
		chips,
		fields,
		changeCount: changes.length,
		large,
		day: historyDay(historyDate(event)),
		source: historySource(event),
		removed: event.operation === 'delete',
		excerpt: text(crystal?.description || crystal?.text || crystal?.body),
		blockCount: kind === 'webpage' && Array.isArray(crystal?.blocks) ? crystal.blocks.length : null
	};
}
export type HistoryCard = ReturnType<typeof historyCard>;
export function filterHistoryCards(cards: HistoryCard[], filters: HistoryFilters) {
	const query = filters.query.trim().toLocaleLowerCase();
	return cards.filter(
		(card) =>
			(!filters.kind || card.kinds.includes(filters.kind)) &&
			(!filters.source || card.row.event.source === filters.source) &&
			(!filters.operation || card.row.event.operation === filters.operation) &&
			(!filters.sync || card.row.status === filters.sync) &&
			(!filters.day || card.day === filters.day) &&
			(!query ||
				[
					card.title,
					card.row.event.label,
					card.row.event.thingId,
					card.source,
					...card.chips.flatMap((chip) => [chip.label, chip.before, chip.after])
				]
					.join(' ')
					.toLocaleLowerCase()
					.includes(query))
	);
}
/** Stable oldest-first ordering uses server acceptance for committed versions;
 * client clocks never imply ancestry. Coordinates are bounded and non-overlapping. */
export function historyPositions(cards: HistoryCard[], width: number, realTime: boolean) {
	const ordered = [...cards].sort(
		(a, b) =>
			(a.row.receipt?.position ?? Number.MAX_SAFE_INTEGER) - (b.row.receipt?.position ?? Number.MAX_SAFE_INTEGER) ||
			a.row.event.occurredAt.localeCompare(b.row.event.occurredAt) ||
			a.row.event.id.localeCompare(b.row.event.id)
	);
	let previous = 0;
	return ordered.map((card, index) => {
		const gap = index ? Math.max(0, historyDate(card.row.event).getTime() - historyDate(ordered[index - 1].row.event).getTime()) : 0;
		const x = index ? previous + width + 28 + (realTime ? Math.min(360, (gap / 3_600_000) * 12) : 0) : 16;
		previous = x;
		return { card, x, index };
	});
}
/** Comparing captured values is read-only and requires the same adapter/Thing.
 * Placement and split-snapshot records need reconstruction, not a guessed diff. */
export function historyComparison(first: TimelineEvent, second: TimelineEvent) {
	if (first.ownerId !== second.ownerId || first.thingId !== second.thingId) return { error: 'Choose two versions of the same Thing.', changes: [] };
	if (
		first.mode === 'effect' ||
		second.mode === 'effect' ||
		first.after?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER ||
		second.after?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER ||
		first.after?.adapter === 'folder-placement' ||
		second.after?.adapter === 'folder-placement' ||
		(first.after && second.after && first.after.adapter !== second.after.adapter)
	)
		return { error: 'These versions need their full content reconstructed before they can be compared here.', changes: [] };
	const dependencies = (event: TimelineEvent) => JSON.stringify([...event.dependencies].sort((a, b) => a.thingId.localeCompare(b.thingId)));
	return { error: '', changes: timelineDisplayChanges(first.after, second.after), dependenciesChanged: dependencies(first) !== dependencies(second) };
}
