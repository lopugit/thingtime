import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { actionHttpEndpoint, type PreparedBrowserAction } from '~/schemas/browserActions';
import { executeBrowserAction, type BrowserActionHost, type BrowserActionTrace } from './browserActionRuntime';

// The browser transport uses its existing session, never a saved token, custom
// header, remote origin or redirect. The API independently checks actor identity.
export function createBrowserActionHost(actor: () => string | undefined, transport: typeof fetch = fetch, requireCapability = requireThingtimeCapability): BrowserActionHost {
	const assertIdentity = (id: string) => { if (actor() !== id) throw new Error('The active account changed. Run the action again.'); };
	const request: BrowserActionHost['request'] = async (step, id, signal) => {
		assertIdentity(id);
		if (!actionHttpEndpoint(step.method, step.path)) throw new Error('Invalid Action request destination');
		await requireCapability('api.actions-run', '1.7.0');
		await requireCapability(step.feature, step.minimumVersion);
		assertIdentity(id);
		signal.throwIfAborted();
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(step.query)) {
			if (value == null || value === '') continue;
			if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Query values must be text, numbers or booleans');
			query.set(key, String(value));
		}
		const response = await transport(`${step.path}${query.size ? `?${query}` : ''}`, {
			method: step.method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
			headers: { Accept: 'application/json', 'Content-Type': 'application/json', [EXPECTED_ACTOR_HEADER]: id },
			...(step.body === undefined ? {} : { body: JSON.stringify(step.body) })
		});
		assertIdentity(id);
		const data = await readActionResponse(response, step.maxResultBytes, signal);
		assertIdentity(id);
		if (!response.ok || data?.ok === false) throw new Error(data?.error || `Request failed (${response.status})`);
		return data;
	};
	return { assertIdentity, request, prepare: async (action, inputs, id, signal) => {
		const response: any = await request({ path: '/api/v1/actions/run', method: 'POST', feature: 'api.actions-run', minimumVersion: '1.7.0', maxResultBytes: 256 * 1024, query: {}, body: { action, inputs, source: 'component', execution: 'browser' } }, id, signal);
		if (response.status !== 'prepared') throw new Error('Use a browser Action when composing browser flows');
		return response;
	} };
}

export async function finishBrowserAction(response: any, host: BrowserActionHost) {
	if (response?.status !== 'prepared' || response?.execution !== 'browser') return response;
	const start = Date.now();
	const trace: BrowserActionTrace[] = [];
	const trackedHost = { ...host, recordStep: (entry: BrowserActionTrace) => { trace.push(entry); host.recordStep?.(entry); } };
	try {
		const result = await executeBrowserAction(response as PreparedBrowserAction, trackedHost);
		return { ok: true, status: 'ok', execution: 'browser', actionId: response.actionId, result, cache: 'no-store', durationMs: Date.now() - start, opsUsed: trace.length, trace };
	} catch (error) {
		return { ok: true, status: 'error', execution: 'browser', actionId: response.actionId, result: null, cache: 'no-store', error: error instanceof Error ? error.message : 'Browser action failed', durationMs: Date.now() - start, opsUsed: trace.length, trace };
	}
}

// Bound the stream before JSON parsing, not only the materialized result.
export async function readActionResponse(response: Response, maximum: number, signal: AbortSignal): Promise<any> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error('The API returned an empty response');
	const parts: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maximum) throw new Error('The API response exceeds this Action’s byte budget');
			parts.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
		return JSON.parse(new TextDecoder().decode(bytes));
	} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
