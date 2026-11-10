// Account history preferences — the shared contract for the Settings → History
// category, the per-Thing pause verb and the sync hold. Server-safe: no React,
// no IndexedDB, no window. The record lives on the user Thing's packed
// `secure.meta.historyPrefs` blob (home-pinned, never a public projection); the
// client caches it per owner in localStorage and sweeps it on sign-out.
//
// Honest semantics: `syncHold` pauses every device's pending-queue upload for
// the account (nothing is deleted); `retention` is stored only (no retention
// policy runs yet); `pausedThingIds` stops CLIENT draft capture for those
// Things in the Builder page and definition editors — canonical server
// revisions keep recording. Ids only: no labels, no timestamps.
export const HISTORY_RETENTION = ['forever', '90d', 'named'] as const;
export type HistoryRetention = (typeof HISTORY_RETENTION)[number];
export type HistoryPrefs = { syncHold: boolean; retention: HistoryRetention; pausedThingIds: string[] };
export const DEFAULT_HISTORY_PREFS: HistoryPrefs = Object.freeze({ syncHold: false, retention: 'forever', pausedThingIds: [] });
export const HISTORY_PAUSED_THINGS_MAX = 200;
/** Mirrors the Timeline id rule in contract.ts (not thingActions' 160-char rule). */
export const HISTORY_THING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
/** Pause/resume are deltas: the server computes union(pause) \ resume inside its CAS write; the list is never replaced wholesale. */
export type HistoryPrefsPatch = { syncHold?: boolean; retention?: HistoryRetention; pause?: string[]; resume?: string[] };
const HISTORY_PATCH_KEYS = ['syncHold', 'retention', 'pause', 'resume'];

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const thingId = (value: unknown): value is string => typeof value === 'string' && HISTORY_THING_ID_PATTERN.test(value);
const retention = (value: unknown): value is HistoryRetention => typeof value === 'string' && (HISTORY_RETENTION as readonly string[]).includes(value);
const unique = (ids: Iterable<string>) => [...new Set(ids)];

/** Lenient read of a stored record: anything invalid or unknown falls back to the default; ids are filtered, deduped and capped. Always returns fresh objects. */
export function parseHistoryPrefs(stored: unknown): HistoryPrefs {
	if (!object(stored)) return { ...DEFAULT_HISTORY_PREFS, pausedThingIds: [] };
	return {
		syncHold: stored.syncHold === true,
		retention: retention(stored.retention) ? stored.retention : DEFAULT_HISTORY_PREFS.retention,
		pausedThingIds: Array.isArray(stored.pausedThingIds) ? unique(stored.pausedThingIds.filter(thingId)).slice(0, HISTORY_PAUSED_THINGS_MAX) : []
	};
}

const idList = (value: unknown, key: 'pause' | 'resume'): string[] => {
	if (!Array.isArray(value)) throw new TypeError(`${key} must be a list of Thing ids`);
	if (value.length > HISTORY_PAUSED_THINGS_MAX) throw new TypeError(`${key} lists at most ${HISTORY_PAUSED_THINGS_MAX} Thing ids`);
	if (!value.every(thingId)) throw new TypeError(`${key} contains an invalid Thing id`);
	return unique(value);
};

/** Strict wire validation: unknown keys, wrong types, invalid ids, an empty (no-op) patch or more than 200 ids in one list throw a TypeError whose message is safe to return. */
export function parseHistoryPrefsPatch(input: unknown): HistoryPrefsPatch {
	if (!object(input)) throw new TypeError('prefs must be an object');
	const patch: HistoryPrefsPatch = {};
	for (const key of Object.keys(input)) {
		if (!HISTORY_PATCH_KEYS.includes(key)) throw new TypeError(`Unknown history preference: ${key.slice(0, 40)}`);
		const value = input[key];
		if (key === 'syncHold') { if (typeof value !== 'boolean') throw new TypeError('syncHold must be true or false'); patch.syncHold = value; }
		else if (key === 'retention') { if (!retention(value)) throw new TypeError(`retention must be one of ${HISTORY_RETENTION.join(', ')}`); patch.retention = value; }
		else { const ids = idList(value, key as 'pause' | 'resume'); if (ids.length) patch[key as 'pause' | 'resume'] = ids; }
	}
	if (!Object.keys(patch).length) throw new TypeError('History preference patch is empty');
	return patch;
}

/** Pure merge: scalars override, pausedThingIds = union(current, pause) \ resume in first-seen order. Throws a RangeError when the result would exceed the cap (nothing is applied). */
export function applyHistoryPrefsPatch(current: HistoryPrefs, patch: HistoryPrefsPatch): HistoryPrefs {
	const ids = new Set(current.pausedThingIds);
	for (const id of patch.pause ?? []) ids.add(id);
	for (const id of patch.resume ?? []) ids.delete(id);
	if (ids.size > HISTORY_PAUSED_THINGS_MAX) throw new RangeError(`Too many paused Things (max ${HISTORY_PAUSED_THINGS_MAX})`);
	return { syncHold: patch.syncHold ?? current.syncHold, retention: patch.retention ?? current.retention, pausedThingIds: [...ids] };
}
