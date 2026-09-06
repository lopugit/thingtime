import React from 'react';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import type { SubspaceFeedSort } from './subspaceTypes';

// The subspace feature's user-facing knobs (AI_ALL "feature customization
// defaults"): whether up/down vote pills show on posts and comments, and the
// default sort a subspace opens on. Per-browser preferences in the sync
// localCache tier (tt-subspace-prefs) — they gate first paint, so the async
// thingtime blob can't seed them — with an in-tab pub/sub so every mounted
// card repaints when /settings flips a switch.

export type SubspacePrefs = { showVotes: boolean; defaultSort: SubspaceFeedSort; showVotesOnComments: boolean };

const KEY = 'tt-subspace-prefs';
export const DEFAULT_SUBSPACE_PREFS: SubspacePrefs = { showVotes: true, showVotesOnComments: true, defaultSort: 'hot' };

const SORTS: SubspaceFeedSort[] = ['hot', 'new', 'top', 'rising', 'controversial'];

const normalize = (value: unknown): SubspacePrefs => {
	const raw = value && typeof value === 'object' ? (value as Partial<SubspacePrefs>) : {};
	return {
		showVotes: raw.showVotes !== false,
		showVotesOnComments: raw.showVotesOnComments !== false,
		defaultSort: SORTS.includes(raw.defaultSort as SubspaceFeedSort) ? (raw.defaultSort as SubspaceFeedSort) : 'hot'
	};
};

let current: SubspacePrefs | null = null;
const listeners = new Set<() => void>();

export const readSubspacePrefs = (): SubspacePrefs => {
	if (!current) current = normalize(readLocalCache<SubspacePrefs>(KEY));
	return current;
};

export const writeSubspacePrefs = (patch: Partial<SubspacePrefs>) => {
	current = normalize({ ...readSubspacePrefs(), ...patch });
	writeLocalCache(KEY, current);
	listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const useSubspacePrefs = (): [SubspacePrefs, (patch: Partial<SubspacePrefs>) => void] => {
	const prefs = React.useSyncExternalStore(subscribe, readSubspacePrefs, () => DEFAULT_SUBSPACE_PREFS);
	return [prefs, writeSubspacePrefs];
};
