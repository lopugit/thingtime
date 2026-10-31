import type { LibraryExample } from './types';
export const LIBRARY_REQUEST_REQUIREMENT = ['api.library-request', '1.2.0'] as const;
export const MAX_INPUT_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 256 * 1024;
export function parseExampleInput(text: string): Record<string, unknown> {
	if (new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES) throw new Error('Keep example inputs below 16 KB.');
	const input = JSON.parse(text);
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Inputs must be a JSON object.');
	return input;
}
// Only the immutable catalogue chooses origins, paths, headers and parameter names.
export function buildExampleRequest(example: LibraryExample, input: Record<string, unknown>, apiKey = '') {
	const request = example.request;
	if (!request) throw new Error('This example is not an API request.');
	parseExampleInput(JSON.stringify(input));
	const substitute = (value: string, path = false) =>
		value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key) => {
			const raw = input[key];
			if ((typeof raw !== 'string' && typeof raw !== 'number') || !String(raw).trim() || String(raw).length > 300)
				throw new Error(`Enter a valid ${key}.`);
			const text = String(raw);
			if (path && (text === '.' || text === '..' || /[/\\?#\s]/.test(text))) throw new Error(`Enter a valid ${key}.`);
			return path ? encodeURIComponent(text) : text;
		});
	const url = new URL(substitute(request.url, true));
	const templateOrigin = new URL(request.url).origin;
	if (url.protocol !== 'https:' || url.origin !== templateOrigin || url.username || url.password) throw new Error('Unsupported provider address.');
	for (const [key, value] of Object.entries(request.params || {})) url.searchParams.set(key, substitute(value));
	const headers: Record<string, string> = { Accept: 'application/json', ...request.headers };
	if (request.auth) {
		if (!apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error('Enter an API key for this provider.');
		if (example.provider === 'Stripe' && !/^(sk|rk)_test_/.test(apiKey)) throw new Error('Use a Stripe test-mode secret or restricted key.');
		if (request.auth.type === 'bearer') headers.Authorization = `Bearer ${apiKey.trim()}`;
		else if (request.auth.type === 'header') headers[request.auth.name!] = (request.auth.prefix || '') + apiKey.trim();
		else if (request.auth.type === 'query') url.searchParams.set(request.auth.name!, apiKey.trim());
		else throw new Error('Unsupported authentication.');
	}
	// Body templates are owned by the catalogue. Callers cannot choose fields,
	// methods or URLs; a whole-field placeholder preserves JSON number types.
	const template = (value: unknown): unknown => {
		if (typeof value === 'string') {
			const match = /^\{([A-Za-z][A-Za-z0-9_]*)\}$/.exec(value);
			if (match) {
				substitute(value);
				return input[match[1]];
			}
			return substitute(value);
		}
		if (Array.isArray(value)) return value.map(template);
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, template(child)]));
		return value;
	};
	const method = request.method || 'GET';
	if (method !== 'GET' && method !== 'POST') throw new Error('Unsupported method.');
	const body = request.body ? JSON.stringify(template(request.body)) : undefined;
	if (body) headers['Content-Type'] = 'application/json';
	return { url, headers, method, body };
}
export async function readBoundedJson(response: Response) {
	if (!response.ok || !response.body) throw new Error(`Provider returned HTTP ${response.status}. Check access, input and quota.`);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = '',
		bytes = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.byteLength;
			if (bytes > MAX_RESPONSE_BYTES) throw new Error('The provider response exceeds this demo’s 256 KB limit. Try a narrower query.');
			text += decoder.decode(part.value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
