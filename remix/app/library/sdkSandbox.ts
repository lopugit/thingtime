import type { LibraryExample } from './types';
import { parseExampleInput } from './request';
import { MAPBOX_SCRIPT, MAPBOX_STYLES, GOOGLE_MAPS_SCRIPT } from './mapSdks';
const js = (value: unknown) =>
	JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
export function validateSdkInput(example: LibraryExample, input: Record<string, unknown>, key: string) {
	parseExampleInput(JSON.stringify(input));
	if (!example.sdk || !example.code) throw new Error('Unsupported browser SDK.');
	if (typeof key !== 'string' || key.length > 4096 || !key.trim() || /\s/.test(key)) throw new Error('Enter a valid browser key.');
	if (example.sdk.type === 'mapbox' && !key.startsWith('pk.')) throw new Error('Use a Mapbox public pk… token, never a secret token.');
	if (example.sdk.type === 'google-maps' && !/^AIza[A-Za-z0-9_-]+$/.test(key)) throw new Error('Enter a Google Maps browser API key.');
	for (const [field, min, max] of [
		['lat', -90, 90],
		['latitude', -90, 90],
		['lng', -180, 180],
		['longitude', -180, 180],
		['zoom', 0, 22],
		['radius', 1, 50000]
	] as const) {
		if (
			(field in input || field in example.input) &&
			(typeof input[field] !== 'number' || !Number.isFinite(input[field]) || (input[field] as number) < min || (input[field] as number) > max)
		)
			throw new Error(`Enter a valid ${field} (${min} to ${max}).`);
	}
	if (('points' in input || 'points' in example.input) && (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 100))
		throw new Error('Use 2 to 100 points.');
	if (Array.isArray(input.points))
		for (const point of input.points) {
			const lng = example.sdk.type === 'mapbox' ? point?.[0] : point?.lng;
			const lat = example.sdk.type === 'mapbox' ? point?.[1] : point?.lat;
			if (
				typeof lng !== 'number' ||
				!Number.isFinite(lng) ||
				Math.abs(lng) > 180 ||
				typeof lat !== 'number' ||
				!Number.isFinite(lat) ||
				Math.abs(lat) > 90
			)
				throw new Error('Every point needs valid longitude and latitude coordinates.');
		}
	for (const field of ['query', 'placeId', 'label'])
		if (field in example.input && (typeof input[field] !== 'string' || !(input[field] as string).trim() || (input[field] as string).length > 300))
			throw new Error(`Enter a valid ${field}.`);
}
// Public browser keys may reach only their SDK's opaque-origin frame. Private
// REST credentials never enter this path. No user-provided source or URL runs.
export function sdkSandbox(example: LibraryExample, input: Record<string, unknown>, runId: string, apiKey: string) {
	validateSdkInput(example, input, apiKey);
	const mapbox = example.sdk!.type === 'mapbox';
	const csp = mapbox
		? "default-src 'none'; script-src 'unsafe-inline' https://api.mapbox.com; connect-src https://api.mapbox.com https://events.mapbox.com; style-src 'unsafe-inline' https://api.mapbox.com; img-src data: blob: https://api.mapbox.com; worker-src blob:; font-src data:;"
		: "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com blob:; connect-src https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:; img-src data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; worker-src blob:;";
	const load = mapbox
		? `await loadScript(${js(MAPBOX_SCRIPT)});`
		: `await new Promise((resolve,reject)=>{window.gm_authFailure=()=>reject(new Error('Google authentication failed'));window.ttMapsReady=resolve;loadScript(${js(
				GOOGLE_MAPS_SCRIPT
		  )}+'?v=quarterly&loading=async&callback=ttMapsReady&key='+encodeURIComponent(apiKey)).catch(reject)});`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="origin"><meta http-equiv="Content-Security-Policy" content="${csp} base-uri 'none'; form-action 'none'"><style>html,body{margin:0;font:13px system-ui;background:#fafafb;color:#24242b}*{box-sizing:border-box}#preview{height:400px;width:100%;overflow:auto}ul{padding:8px 24px}li{margin:8px 0;overflow-wrap:anywhere}</style>${
		mapbox ? `<link rel="stylesheet" href="${MAPBOX_STYLES}">` : ''
	}</head><body><div id="preview"></div><script>
 const apiKey=${js(apiKey)},input=${js(input)},root=document.getElementById('preview');
 let done=false;const send=(ok,result)=>{if(done)return;done=true;let text=JSON.stringify(result)??'null';text=text.split(apiKey).join('[redacted]');parent.postMessage({type:'tt-library',runId:${js(
		runId
 )},ok,text:text.slice(0,65536)},'*')};
 const loadScript=url=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=reject;document.head.append(script)});
 window.gm_authFailure=()=>send(false,'Check API activation, billing and browser key restrictions.');
 (async()=>{try{${load}window.gm_authFailure=()=>send(false,'Check API activation, billing and browser key restrictions.');const result=await(async()=>{${
		example.code
	}})();send(true,result)}catch{send(false,'Check API activation, billing, key restrictions and inputs.')}})();
 </script></body></html>`;
}
