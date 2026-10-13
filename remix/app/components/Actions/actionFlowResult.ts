import type { PreparedBrowserAction } from '~/schemas/browserActions';
import { executeBrowserAction, type BrowserActionHost, type BrowserActionTrace } from './browserActionRuntime';

export async function finishBrowserAction(response: any, host: BrowserActionHost) {
	if (response?.status !== 'prepared' || response?.execution !== 'browser') return response;
	const start = Date.now();
	const trace: BrowserActionTrace[] = [];
	const trackedHost = { ...host, recordStep: (entry: BrowserActionTrace) => { trace.push(entry); host.recordStep?.(entry); } };
	try {
		const result = await executeBrowserAction(response as PreparedBrowserAction, trackedHost);
		return { ok: true, status: 'ok', execution: 'browser', actionId: response.actionId, result, cache: 'no-store', durationMs: Date.now() - start, opsUsed: trace.length, trace };
	} catch (error) {
		return { ok: true, status: 'error', execution: 'browser', actionId: response.actionId, result: null, cache: 'no-store', error: error instanceof Error ? error.message : 'Browser action failed', errorStatus: (error as { status?: number })?.status, durationMs: Date.now() - start, opsUsed: trace.length, trace };
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
