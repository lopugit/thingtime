import { MAPBOX_SDK_VERSION } from '../../../library/mapSdks';

const mapboxBaseUrl = '/vendor/mapbox-gl/v' + MAPBOX_SDK_VERSION;
const mapboxScriptUrl = mapboxBaseUrl + '/mapbox-gl.js';
const mapboxStylesUrl = mapboxBaseUrl + '/mapbox-gl.css';

const pendingByDocument = new WeakMap<Document, Promise<any>>();

export function loadMapbox(document: Document): Promise<any> {
	const view = document.defaultView as (Window & { mapboxgl?: any }) | null;
	if (!view) return Promise.reject(new Error('Map is unavailable in this document.'));
	if (view.mapboxgl?.Map) return Promise.resolve(view.mapboxgl);
	const existing = pendingByDocument.get(document);
	if (existing) return existing;
	// The SDK uses realm-specific DOM constructors. Builder viewport iframes
	// load their own same-origin vendor assets and worker in their document.
	const pending = new Promise((resolve, reject) => {
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
		const failed = () => {
			view.clearTimeout(timeout);
			script.remove();
			reject(new Error('Map could not load.'));
		};
		const timeout = view.setTimeout(failed, 15_000);
		script.onload = () => {
			if (!view.mapboxgl?.Map) return failed();
			view.clearTimeout(timeout);
			resolve(view.mapboxgl);
		};
		script.onerror = failed;
		document.head.appendChild(script);
	}).catch((error) => {
		pendingByDocument.delete(document);
		throw error;
	});
	pendingByDocument.set(document, pending);
	return pending;
}
