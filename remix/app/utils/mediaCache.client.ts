import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

const SETTINGS_KEY = 'tt-media-preferences-v1';
let memoryPreferences = { cache: true, previews: true };
export const mediaPreferences = () => {
	try {
		return { cache: true, previews: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
	} catch {
		return memoryPreferences;
	}
};
export const setMediaPreferences = (value: { cache: boolean; previews: boolean }) => {
	memoryPreferences = value;
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
	} catch {
		/* memory preference still applies */
	}
	window.dispatchEvent(new CustomEvent('tt-media-preferences', { detail: value }));
	void mediaCacheMessage('tt-media-config', { enabled: value.cache });
};
export type MediaCacheStatus = { backend: string; bytes: number; entries: number; enabled: boolean };
export async function mediaCacheMessage(type: string, data = {}): Promise<MediaCacheStatus | null> {
	if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return null;
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => {
			channel.port1.close();
			resolve(null);
		}, 3000);
		channel.port1.onmessage = (event) => {
			clearTimeout(timer);
			channel.port1.close();
			resolve(event.data);
		};
		navigator.serviceWorker.controller!.postMessage({ type, ...data }, [channel.port2]);
	});
}
let registration: Promise<void> | undefined;
export function registerMediaCache() {
	return (registration ||= initializeMediaCache());
}
async function initializeMediaCache() {
	if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
	try {
		await Promise.race([
			requireThingtimeCapability('api.attachment-content', '1.1.0'),
			new Promise((_, reject) => setTimeout(() => reject(new Error('Capability timeout')), 4000))
		]);
		await navigator.serviceWorker.register('/media-cache-sw.mjs', { type: 'module', scope: '/', updateViaCache: 'none' });
		const sync = () => void mediaCacheMessage('tt-media-config', { enabled: mediaPreferences().cache });
		navigator.serviceWorker.addEventListener('controllerchange', sync);
		window.addEventListener('storage', (event) => {
			if (event.key === SETTINGS_KEY) sync();
		});
		if (!navigator.serviceWorker.controller)
			await new Promise<void>((resolve) => {
				const done = () => {
					navigator.serviceWorker.removeEventListener('controllerchange', done);
					resolve();
				};
				navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
				setTimeout(done, 1500);
			});
		sync();
	} catch {
		/* Native browser HTTP caching remains available. */
	}
}
