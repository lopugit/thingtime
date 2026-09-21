import type { LibraryExample } from '../../../library/types';
import { buildExampleRequest, readBoundedJson } from '../../../library/request';
export async function runLibraryRequest(example: LibraryExample, input: Record<string, unknown>, apiKey: string, transport: typeof fetch = fetch) {
	apiKey = apiKey.trim();
	const { url, headers, method, body } = buildExampleRequest(example, input, apiKey);
	const response = await transport(url, { method, body, headers, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(12000) });
	const result = await readBoundedJson(response);
	// Defend against an upstream echoing the supplied credential in a successful response.
	return JSON.parse(JSON.stringify(result).split(JSON.stringify(apiKey).slice(1, -1)).join('[redacted]'));
}
