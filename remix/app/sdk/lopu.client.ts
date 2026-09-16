import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { parseLopuNetworkRequest, type LopuNetworkRequest } from '~/api/utils/lopu/networkCore';

// Browser SDK. First-party credentials only go to the
// same-origin gateway; external requests get only the explicit supplied headers.
export const lopu = {
	async request(input: Partial<LopuNetworkRequest> & { url: string }, options: { signal?: AbortSignal } = {}) {
		const body = parseLopuNetworkRequest(input);
		await requireThingtimeCapability('api.lopu-network', '1.0.0');
		const response = await fetch('/api/v1/lopu/network', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: options.signal
		});
		const result = await response.json();
		if (!response.ok || !result.ok) throw new Error(result.error || 'Network request failed.');
		return result as { ok: true; url: string; status: number; contentType: string; body: string };
	},
	async fetch(url: string, options: { signal?: AbortSignal } = {}) {
		return lopu.request({ url }, options);
	},
	async json(url: string, options: { signal?: AbortSignal } = {}) {
		const result = await lopu.request({ url, headers: { accept: 'application/json' } }, options);
		if (result.status < 200 || result.status >= 300) throw new Error(`HTTP ${result.status}`);
		return JSON.parse(result.body) as unknown;
	}
};
