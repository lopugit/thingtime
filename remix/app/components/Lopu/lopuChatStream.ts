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

// A grant from a Confirm card (the `confirm` event): sent back verbatim so the
// server can verify the viewer approved exactly that action.
export type LopuReplyConfirmation = { key: string; token: string };

export type LopuReplyBody = {
	attachmentIds?: string[];
	thingIds?: string[];
	chatId?: string;
	text: string;
	requestId: string;
	model?: string;
	effort?: string;
	speed?: string;
	// one of the viewer's Secure Vault providers (GET /ai/models → vaultProviders[].id);
	// the server resolves the credential, the client only ever names it. null
	// says "Thingtime's models" explicitly (and clears the chat's pin); the key
	// is omitted only when the client does not know the chat's setting
	providerId?: string | null;
	context?: LopuReplyContext;
	confirmations?: LopuReplyConfirmation[];
};

// A non-OK reply response (401/409/429/5xx) — carries the API's `{ ok:false,
// error }` payload so callers can `catch (err) { err?.error }` like every other
// useApi failure.
export class LopuStreamError extends Error {
	ok = false as const;
	status: number;
	error: string;
	retryAfter: string | null;
	// the API's machine-readable refusal (LOPU_UNVERIFIED / LOPU_NO_CREDITS on
	// the 403/402 gate — verified-credits design note §1); null otherwise
	code: string | null;
	// the account balance a 402 reports (micro-USD), when it does
	balanceMicros: number | null;

	constructor(status: number, error: string, retryAfter: string | null = null, extra?: { code?: string | null; balanceMicros?: number | null }) {
		super(error);
		this.name = 'LopuStreamError';
		this.status = status;
		this.error = error;
		this.retryAfter = retryAfter;
		this.code = typeof extra?.code === 'string' && extra.code ? extra.code : null;
		this.balanceMicros = typeof extra?.balanceMicros === 'number' && Number.isFinite(extra.balanceMicros) ? extra.balanceMicros : null;
	}
}

/**
 * Fire the streamed turn. Returns the RAW Response (NDJSON body) — readNdjson
 * consumes it. Recorded in the DevKit request log like every useApi call.
 */
export const postLopuReply = async (body: LopuReplyBody, options?: { signal?: AbortSignal }): Promise<Response> => {
	if (body.attachmentIds?.length || body.thingIds?.length) {
		const { requireThingtimeCapability } = await import('~/api/utils/capabilities/requireCapability.client');
		await requireThingtimeCapability('api.lopu-chats-reply', '1.6.0');
	}
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
	let code: string | null = null;
	let balanceMicros: number | null = null;
	try {
		const payload = await response.json();
		if (payload && typeof payload.error === 'string' && payload.error) message = payload.error;
		if (payload && typeof payload.code === 'string') code = payload.code;
		const balance = payload?.balance ?? payload?.balanceMicros;
		if (typeof balance === 'number' && Number.isFinite(balance)) balanceMicros = balance;
		else if (balance && typeof balance === 'object' && typeof balance.balanceMicros === 'number') balanceMicros = balance.balanceMicros;
	} catch {
		// non-JSON body — keep the status message
	}
	return new LopuStreamError(response.status, message, response.headers.get('Retry-After'), { code, balanceMicros });
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
