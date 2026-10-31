export type LopuNetworkRequest = {
	url: string;
	method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	headers: Record<string, string>;
	body?: string;
};
export function parseLopuNetworkRequest(raw: unknown): LopuNetworkRequest {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an HTTP request.');
	const input = raw as Record<string, unknown>;
	if (typeof input.url !== 'string' || input.url.length > 4096) throw new Error('Provide a public HTTPS URL.');
	const url = new URL(input.url);
	if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
		throw new Error('Only HTTPS on port 443 without URL credentials is supported.');
	const method = input.method === undefined ? 'GET' : String(input.method).toUpperCase();
	if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Unsupported HTTP method.');
	const headers: Record<string, string> = {};
	if (input.headers !== undefined) {
		if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) throw new Error('Headers must be an object.');
		const entries = Object.entries(input.headers);
		if (entries.length > 12) throw new Error('Too many headers.');
		for (const [key, value] of entries) {
			const name = key.toLowerCase();
			if (
				!['accept', 'content-type', 'authorization', 'x-api-key', 'idempotency-key'].includes(name) ||
				typeof value !== 'string' ||
				value.length > 4096 ||
				/[\r\n\0]/.test(value)
			)
				throw new Error('Unsupported request header.');
			headers[name] = value;
		}
	}
	if (input.body !== undefined && (typeof input.body !== 'string' || new TextEncoder().encode(input.body).byteLength > 32 * 1024))
		throw new Error('Request body must be text under 32 KiB.');
	if ((method === 'GET' || method === 'HEAD') && input.body !== undefined) throw new Error('GET and HEAD cannot have a body.');
	url.hash = '';
	return {
		url: url.href,
		method: method as LopuNetworkRequest['method'],
		headers,
		...(input.body !== undefined ? { body: input.body as string } : {})
	};
}
