// Shared SDK loader. Data lookup and record actions belong to saved Actions.
let sdk: Promise<any> | null = null;
let sdkKey: string | null = null;
export function loadGoogleMaps(key: string): Promise<any> {
	if (sdkKey && sdkKey !== key) return Promise.reject(new Error('Map environment changed. Reload this page to use its Google Maps key.'));
	if (sdk) return sdk;
	sdkKey = key;
	sdk = new Promise((resolve, reject) => {
		const w = window as any;
		if (w.google?.maps?.importLibrary) {
			resolve(w.google.maps);
			return;
		}
		const script = document.createElement('script');
		const callback = '__thingtimeMapsReady';
		const timeout = window.setTimeout(() => {
			delete w[callback];
			script.remove();
			reject(new Error('Google Maps timed out. Check your connection and API restrictions.'));
		}, 15000);
		w[callback] = () => {
			clearTimeout(timeout);
			delete w[callback];
			resolve(w.google.maps);
		};
		const url = new URL('https://maps.googleapis.com/maps/api/js');
		url.searchParams.set('key', key);
		url.searchParams.set('v', 'weekly');
		url.searchParams.set('loading', 'async');
		url.searchParams.set('callback', callback);
		script.src = url.toString();
		script.async = true;
		script.onerror = () => {
			clearTimeout(timeout);
			delete w[callback];
			script.remove();
			reject(new Error('Google Maps could not load. Check your connection and API restrictions.'));
		};
		document.head.appendChild(script);
	}).catch((error) => {
		sdk = null;
		sdkKey = null;
		throw error;
	});
	return sdk;
}
