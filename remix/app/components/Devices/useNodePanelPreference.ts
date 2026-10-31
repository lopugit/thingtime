import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { getElectronBridge } from '~/utils/electronBridge';
import { nodePanelPreferenceKey } from './localNodePanel';
const eventName = 'thingtime-node-panel-preference';
const notify = () => window.dispatchEvent(new Event(eventName));
const subscribe = (onChange: () => void) => {
	window.addEventListener(eventName, onChange);
	window.addEventListener('storage', onChange);
	return () => {
		window.removeEventListener(eventName, onChange);
		window.removeEventListener('storage', onChange);
	};
};
type Preference = { value: boolean; persisted: boolean; ready: boolean; revision: number; scope?: string; pending?: Promise<void> };
const desktopPreferences = new Map<string, Preference>();
function desktopPreference(key: string): Preference {
	let entry = desktopPreferences.get(key);
	if (!entry) {
		// Desktop's loopback origin changes between launches. Preserve a cache when
		// available; otherwise avoid flashing setup while the durable preference loads.
		const cached = readLocalCache<unknown>(key);
		entry = { value: typeof cached === 'boolean' ? cached : true, persisted: cached === true, ready: false, revision: 0 };
		desktopPreferences.set(key, entry);
	}
	return entry;
}
async function loadDesktopPreference(key: string, accountId: string) {
	const entry = desktopPreference(key);
	if (entry.pending) return entry.pending;
	if (entry.ready) return;
	const revision = entry.revision;
	entry.pending = (async () => {
		try {
			const result = await getElectronBridge()!.getNodePanelPreference!({ accountId });
			entry.scope = result.scope;
			entry.persisted = result.dismissed;
			if (entry.revision === revision) {
				entry.value = result.dismissed;
				writeLocalCache(key, entry.value);
			}
			entry.ready = true;
		} catch {
			// A failed preference read must never conceal node recovery indefinitely.
			if (entry.revision === revision) entry.value = false;
		} finally {
			entry.pending = undefined;
			notify();
		}
	})();
	return entry.pending;
}
export function useNodePanelPreference(userId?: string | null) {
	const accountId = userId || 'signed-out';
	const key = nodePanelPreferenceKey(accountId);
	const bridge = getElectronBridge();
	const durable = Boolean(bridge?.getNodePanelPreference && bridge?.setNodePanelPreference);
	const lopu = useLopu();
	const dismissed = useSyncExternalStore(
		subscribe,
		() => (durable ? desktopPreference(key).value : readLocalCache<boolean>(key) === true),
		() => false
	);
	useEffect(() => {
		if (!durable) return;
		const refresh = () => {
			void loadDesktopPreference(key, accountId);
		};
		refresh();
		window.addEventListener('focus', refresh);
		return () => window.removeEventListener('focus', refresh);
	}, [durable, key, accountId]);
	const setDismissed = useCallback(
		(value: boolean) => {
			const entry = durable ? desktopPreference(key) : undefined;

			const revision = entry ? ++entry.revision : 0;
			if (entry) entry.value = value;
			writeLocalCache(key, value);
			notify();
			if (!entry) return;
			void (async () => {
				try {
					await loadDesktopPreference(key, accountId);
					if (!entry.scope) throw new Error('Desktop settings are unavailable. Please try again.');
					const saved = await getElectronBridge()!.setNodePanelPreference!({ accountId, scope: entry.scope, dismissed: value });
					entry.persisted = saved.dismissed;
				} catch (error) {
					if (entry.revision !== revision) return;
					entry.value = entry.persisted;
					entry.ready = false;
					writeLocalCache(key, entry.persisted);
					notify();
					lopu({
						title: 'Could not save the connection panel preference',
						description: error instanceof Error ? error.message : 'Please try again.',
						status: 'error'
					});
				}
			})();
		},
		[key, accountId, durable, lopu]
	);
	return [dismissed, setDismissed] as const;
}
