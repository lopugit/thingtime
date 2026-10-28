import { MAPBOX_SCRIPT, MAPBOX_STYLES } from '../../../library/mapSdks';

let pending: Promise<any> | null = null;

export function loadMapbox(): Promise<any> {
	if (typeof window === 'undefined') return Promise.reject(new Error('Map is unavailable on this device.'));
	const existing = (window as any).mapboxgl;
	if (existing?.Map) return Promise.resolve(existing);
	if (pending) return pending;
	pending = new Promise((resolve, reject) => {
		if (!document.querySelector('link[data-tt-mapbox-css]')) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = MAPBOX_STYLES;
			link.dataset.ttMapboxCss = '';
			document.head.appendChild(link);
		}
		const script = document.createElement('script');
		script.src = MAPBOX_SCRIPT;
		script.async = true;
		const timeout = window.setTimeout(() => { script.remove(); reject(new Error('Map could not load.')); }, 15000);
		script.onload = () => { window.clearTimeout(timeout); resolve((window as any).mapboxgl); };
		script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error('Map could not load.')); };
		document.head.appendChild(script);
	}).catch((error) => { pending = null; throw error; });
	return pending;
}
