import React from 'react';

import { useThingtime } from '~/components/Thingtime/useThingtime';
import { normalizeLopuPosition, readLopuPositionCache, writeLopuPositionCache, type LopuPosition } from './lopuPosition';

// Lopu toast placement preference — persisted at thingtime.settings.lopu.position
// (the useDrawer/useTtTheme pattern: ignoreUndoRedo so it stays out of the
// ctrl+z timeline, its own namespace, broadcast across tabs) and mirrored into
// the synchronous tt-lopu-position cache that useLopu reads at fire time.
// While the localforage blob is still restoring, the cache is the last-known
// value, so a toast fired during boot already lands in the chosen corner.
export const useLopuPosition = () => {
	const { thingtime, setThingtime, loading } = useThingtime();

	const stored = thingtime?.settings?.lopu?.position;
	const position: LopuPosition = loading && typeof stored === 'undefined' ? readLopuPositionCache() : normalizeLopuPosition(stored);

	// Keep the fire-time cache aligned with the blob once it has restored —
	// covers a broadcast from another tab and a restored/imported snapshot.
	React.useEffect(() => {
		if (loading) return;
		writeLopuPositionCache(position);
	}, [loading, position]);

	const setPosition = React.useCallback(
		(value: unknown) => {
			const next = normalizeLopuPosition(value);
			// Cache first so the confirmation toast fired right after lands there.
			writeLopuPositionCache(next);
			setThingtime?.('settings.lopu.position', next, { ignoreUndoRedo: true, namespace: 'lopu' });
		},
		[setThingtime]
	);

	return { position, setPosition, loading };
};

// Mounted once under ThingtimeProvider (root.tsx) so the fire-time cache follows
// the persisted preference even when no settings surface is open.
export const LopuPositionSync = () => {
	useLopuPosition();
	return null;
};
