// The Lopu chat transport: POST /api/v1/lopu/chats/reply (credentials
// included, JSON body) and the NDJSON reader — the `useLopuStream` loop from
// useLopu.tsx generalised so every consumer (the shared chat store, tests)
// parses the stream identically. Pure fetch/Response code, no React.

import { recordApiCall } from '~/hooks/apiRequestLog';
import { isLopuChatEvent, type LopuChatEvent } from './lopuTurnCore';

export const LOPU_REPLY_PATH = '/api/v1/lopu/chats/reply';

// Design note §2.6
export type LopuReplyContext = {
	route?: string;
	page?: {
		id?: string;
		source?: 'user' | 'system';
		pageKey?: string;
		siteRoute?: string;
		updatedAt?: string;
		blocks?: unknown[];
	};
	selectedBlockId?: string;
	viewport?: 'mobile' | 'desktop';
};

export type LopuReplyBody = {
	chatId?: string;
	text: string;
	requestId: string;
	model?: string;
	effort?: string;
	speed?: string;
	// one of the viewer's Secure Vault providers (GET /ai/models → vaultProviders[].id);
	// the server resolves the credential, the client only ever names it
	providerId?: string;
	context?: LopuReplyContext;
};

// A non-OK reply response (401/409/429/5xx) — carries the API's `{ ok:false,
// error }` payload so callers can `catch (err) { err?.error }` like every other
// useApi failure.
export class LopuStreamError extends Error {
	ok = false as const;
	status: number;
	error: string;
	retryAfter: string | null;

	constructor(status: number, error: string, retryAfter: string | null = null) {
		super(error);
		this.name = 'LopuStreamError';
		this.status = status;
		this.error = error;
		this.retryAfter = retryAfter;
	}
}

/**
 * Fire the streamed turn. Returns the RAW Response (NDJSON body) — readNdjson
 * consumes it. Recorded in the DevKit request log like every useApi call.
 */
export const postLopuReply = async (body: LopuReplyBody, options?: { signal?: AbortSignal }): Promise<Response> => {
	const started = performance.now();
	let response: Response;
	try {
		response = await fetch(LOPU_REPLY_PATH, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
			body: JSON.stringify(body),
			signal: options?.signal
		});
	} catch (error) {
		const aborted = error instanceof Error && error.name === 'AbortError';
		recordApiCall({
			at: Date.now(),
			method: 'POST',
			url: LOPU_REPLY_PATH,
			status: 0,
			ok: false,
			aborted,
			durationMs: Math.round(performance.now() - started),
			body
		});
		throw error;
	}
	recordApiCall({
		at: Date.now(),
		method: 'POST',
		url: LOPU_REPLY_PATH,
		status: response.status,
		ok: response.ok,
		durationMs: Math.round(performance.now() - started),
		body
	});
	return response;
};

const errorFromResponse = async (response: Response): Promise<LopuStreamError> => {
	let message = `Lopu could not reply (HTTP ${response.status})`;
	try {
		const payload = await response.json();
		if (payload && typeof payload.error === 'string' && payload.error) message = payload.error;
	} catch {
		// non-JSON body — keep the status message
	}
	return new LopuStreamError(response.status, message, response.headers.get('Retry-After'));
};

/**
 * Read an NDJSON response line by line, calling onEvent for every parsed
 * event in order. Resolves when the body ends; rejects with LopuStreamError
 * for a non-OK response and with the AbortError when `signal` fires.
 * Malformed lines are skipped (never abort a whole reply over one bad frame).
 */
export const readNdjson = async (
	response: Response,
	onEvent: (event: LopuChatEvent) => void,
	signal?: AbortSignal
): Promise<{ events: number }> => {
	if (!response.ok) throw await errorFromResponse(response);
	if (!response.body) throw new LopuStreamError(response.status, 'Lopu sent an empty reply');

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let events = 0;

	const onAbort = () => {
		reader.cancel().catch(() => {});
	};
	if (signal) {
		if (signal.aborted) {
			onAbort();
			throw abortError();
		}
		signal.addEventListener('abort', onAbort, { once: true });
	}

	const deliver = (line: string) => {
		if (!line.trim()) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return;
		}
		if (!isLopuChatEvent(parsed)) return;
		events += 1;
		onEvent(parsed);
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';
			for (const line of lines) deliver(line);
			if (signal?.aborted) throw abortError();
		}
		// a final line without a trailing newline still counts
		buffer += decoder.decode();
		if (buffer.trim()) deliver(buffer);
		if (signal?.aborted) throw abortError();
	} finally {
		if (signal) signal.removeEventListener('abort', onAbort);
	}
	return { events };
};

const abortError = (): Error => {
	try {
		return new DOMException('The Lopu reply was stopped', 'AbortError');
	} catch {
		const error = new Error('The Lopu reply was stopped');
		error.name = 'AbortError';
		return error;
	}
};

export const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';
