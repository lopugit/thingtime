import { useCallback, useSyncExternalStore } from 'react';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { nodePanelPreferenceKey } from './localNodePanel';
const eventName = 'thingtime-node-panel-preference';
const subscribe = (onChange: () => void) => {
	window.addEventListener(eventName, onChange);
	window.addEventListener('storage', onChange);
	return () => {
		window.removeEventListener(eventName, onChange);
		window.removeEventListener('storage', onChange);
	};
};
export function useNodePanelPreference(userId?: string | null) {
	const key = nodePanelPreferenceKey(userId);
	const dismissed = useSyncExternalStore(
		subscribe,
		() => readLocalCache<boolean>(key) === true,
		() => false
	);
	const setDismissed = useCallback(
		(value: boolean) => {
			writeLocalCache(key, value);
			window.dispatchEvent(new Event(eventName));
		},
		[key]
	);
	return [dismissed, setDismissed] as const;
}
