import { MAPBOX_SDK_VERSION } from '../../../library/mapSdks';

const mapboxBaseUrl = `/vendor/mapbox-gl/v${MAPBOX_SDK_VERSION}`;
const mapboxScriptUrl = `${mapboxBaseUrl}/mapbox-gl.js`;
const mapboxStylesUrl = `${mapboxBaseUrl}/mapbox-gl.css`;

let pending: Promise<any> | null = null;

export function loadMapbox(): Promise<any> {
	if (typeof window === 'undefined') return Promise.reject(new Error('Map is unavailable on this device.'));
	const existing = (window as any).mapboxgl;
	if (existing?.Map) return Promise.resolve(existing);
	if (pending) return pending;
	// The build stages the official npm distribution under this origin. This
	// loader also works in IIFE embeds; the SDK's blob worker is allowed by CSP.
	pending = new Promise((resolve, reject) => {
		if (!document.querySelector('link[data-tt-mapbox-css]')) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = mapboxStylesUrl;
			link.dataset.ttMapboxCss = '';
			document.head.appendChild(link);
		}
		const script = document.createElement('script');
		script.src = mapboxScriptUrl;
		script.async = true;
		const timeout = window.setTimeout(() => { script.remove(); reject(new Error('Map could not load.')); }, 15000);
		script.onload = () => { window.clearTimeout(timeout); resolve((window as any).mapboxgl); };
		script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error('Map could not load.')); };
		document.head.appendChild(script);
	}).catch((error) => { pending = null; throw error; });
	return pending;
}
