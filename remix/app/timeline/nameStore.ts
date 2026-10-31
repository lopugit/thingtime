import { timelineScopeKey, TIMELINE_PAGE_SIZE, type TimelineEvent, type TimelineScope } from './contract.ts';
import { parseTimelineVersionName, TIMELINE_VERSION_NAME_KIND, type TimelineVersionName } from './versionNames.ts';

export const TIMELINE_NAME_CACHE_LIMIT = 1280;
/** One accepted name-change effect event, read from its recorded snapshots:
 * `name` is the record after the change (null once cleared) and `prior` the
 * record it replaced (null for a first naming). Not a name effect → null. */
export type TimelineVersionNameEffect = { eventId: string; name: TimelineVersionName | null; prior: TimelineVersionName | null };

/** The server's `updatedAt` orders name changes; the revision breaks a
 * same-millisecond tie (revisions also stay monotonic across a clear). */
const newer = (incoming: TimelineVersionName, cached: TimelineVersionName | undefined) =>
	!cached || incoming.updatedAt > cached.updatedAt || (incoming.updatedAt === cached.updatedAt && incoming.revision >= cached.revision);

export function timelineVersionNameEffect(event: TimelineEvent): TimelineVersionNameEffect | null {
	if (event.mode !== 'effect' || (event.after ?? event.before)?.adapter !== TIMELINE_VERSION_NAME_KIND) return null;
	const name = event.after ? parseTimelineVersionName(event.after.value) : null;
	const prior = event.before ? parseTimelineVersionName(event.before.value) : null;
	const eventId = (name ?? prior)?.eventId;
	if (!eventId || (name && prior && name.eventId !== prior.eventId) || event.dependencies[0]?.eventId !== eventId || [name, prior].some(record => record && record.ownerId !== event.ownerId)) throw new Error('Invalid Timeline version name effect');
	return { eventId, name, prior };
}

/** Cache only, in memory, per connection: the server is authoritative for
 * every name and there is no offline name queue. A page read that carries
 * `names` replaces the cached names of its events; accepted name-change effect
 * events keep already-loaded versions current between page reads. */
export class TimelineNameStore {
	readonly key: string;
	private cache = new Map<string, { name: TimelineVersionName; accessedAt: number }>();
	/** A cleared name leaves a tombstone timestamp: an older naming effect that arrives
	 * later (paging older history) can never resurrect it; a newer naming replaces it. */
	private cleared = new Map<string, string>();
	constructor(readonly scope: TimelineScope, private now = Date.now) { this.key = timelineScopeKey(scope); this.scope = Object.freeze({ ...scope }); }
	private prune() {
		if (this.cache.size <= TIMELINE_NAME_CACHE_LIMIT) return;
		const kept = [...this.cache].sort((a, b) => b[1].accessedAt - a[1].accessedAt || b[1].name.updatedAt.localeCompare(a[1].name.updatedAt)).slice(0, TIMELINE_NAME_CACHE_LIMIT);
		this.cache = new Map(kept);
		if (this.cleared.size > TIMELINE_NAME_CACHE_LIMIT) this.cleared = new Map([...this.cleared].sort((a, b) => b[1].localeCompare(a[1])).slice(0, TIMELINE_NAME_CACHE_LIMIT));
	}
	/** `events` makes the server authoritative for those events: a loaded event
	 * without a name in `names` loses its cached name. One name per event. */
	accept(inputs: TimelineVersionName[], options: { events?: string[] } = {}): void {
		const names = inputs.map(parseTimelineVersionName);
		const ids = new Set(names.map(name => name.eventId));
		if (names.length > TIMELINE_PAGE_SIZE || ids.size !== names.length || names.some(name => name.ownerId !== this.scope.ownerId)) throw new Error('Invalid version name response scope');
		const readAt = new Date(this.now()).toISOString();
		for (const eventId of options.events ?? []) if (!ids.has(eventId)) { this.cache.delete(eventId); this.cleared.set(eventId, readAt); }
		for (const name of names) { this.cache.set(name.eventId, { name, accessedAt: this.now() }); this.cleared.delete(name.eventId); }
		this.prune();
	}
	/** Applies one accepted `timeline-version-name` effect event; any other event
	 * is ignored. An older effect never overwrites a newer cached record. */
	applyEffect(event: TimelineEvent): boolean {
		const effect = timelineVersionNameEffect(event);
		if (!effect) return false;
		if (event.ownerId !== this.scope.ownerId) throw new Error('Invalid version name response scope');
		const cached = this.cache.get(effect.eventId)?.name;
		const tombstone = this.cleared.get(effect.eventId);
		if (effect.name) {
			if (newer(effect.name, cached) && !(tombstone && effect.name.updatedAt <= tombstone)) { this.cache.set(effect.eventId, { name: effect.name, accessedAt: this.now() }); this.cleared.delete(effect.eventId); }
		} else if (effect.prior && newer(effect.prior, cached)) {
			this.cache.delete(effect.eventId);
			if (!tombstone || event.occurredAt > tombstone) this.cleared.set(effect.eventId, event.occurredAt);
		}
		this.prune();
		return true;
	}
	forEvents(eventIds: string[]): Map<string, TimelineVersionName> {
		const names = new Map<string, TimelineVersionName>();
		for (const eventId of eventIds) { const row = this.cache.get(eventId); if (row) names.set(eventId, row.name); }
		return names;
	}
	clear() { this.cache.clear(); this.cleared.clear(); }
}
