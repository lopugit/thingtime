import { CHARACTER_HEADER } from '~/components/Characters/CharacterScope';
import { EXPECTED_DATA_PLANE_HEADER, isDataPlane } from '~/utils/dataPlane';
import { validateLiveSource } from '~/schemas/liveSources';

export type LiveSourceStreamBinding = {
	path: string;
	feature: string;
	minimumVersion: string;
};

export type LiveSourceStreamOptions = {
	path: string;
	inputs: Record<string, unknown>;
	dataPlane: string | null;
	characterId?: string;
	signal: AbortSignal;
	onSnapshot: (result: unknown) => void;
	onForbidden: () => void;
	fetcher?: typeof fetch;
};

/** Only accept a clean same-origin API path; auth and plane data travel in headers. */
export const buildLiveSourceRequest = (options: Pick<LiveSourceStreamOptions, 'path' | 'inputs' | 'dataPlane' | 'characterId'> & { signal?: AbortSignal }) => {
	const { path, inputs, dataPlane, characterId } = options;
	if (!path.startsWith('/api/v1/') || path.startsWith('//') || /[?#\\]/.test(path) || /%2f|%5c/i.test(path)) {
		throw new Error('Live source path must be a same-origin API path without query or credentials');
	}
	if (dataPlane !== null && !isDataPlane(dataPlane)) throw new Error('Live source data plane is invalid');
	const url = new URL(path, 'https://thingtime.invalid');
	for (const [key, value] of Object.entries(inputs)) {
		if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || value === null || value === undefined) continue;
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') url.searchParams.set(key, String(value));
		else if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) url.searchParams.set(key, value.join(','));
	}
	// Streaming mode is transport-owned, never overridden by saved inputs.
	url.searchParams.set('stream', '1');
	return {
		url: `${url.pathname}${url.search}`,
		init: {
			method: 'GET',
			credentials: 'include' as const,
			cache: 'no-store' as const,
			signal: options.signal,
			headers: {
				Accept: 'text/event-stream',
				...(dataPlane ? { [EXPECTED_DATA_PLANE_HEADER]: dataPlane } : {}),
				...(characterId ? { [CHARACTER_HEADER]: characterId } : {})
			}
		}
	};
};

const parseSnapshot = (data: string): unknown => {
	return JSON.parse(data);
};

/** Consume one SSE response. The caller owns reconnect/backoff and cancellation. */
export const consumeLiveSourceStream = async (options: LiveSourceStreamOptions): Promise<void> => {
	const { url, init } = buildLiveSourceRequest(options);
	const response = await (options.fetcher || fetch)(url, init);
	if ([401, 403, 404, 409].includes(response.status)) {
		options.onForbidden();
		throw Object.assign(new Error('Live source access is no longer available'), { terminal: true });
	}
	if (!response.ok || !response.body) throw new Error(`Live source request failed (${response.status})`);
	if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new Error('Live source response is not an event stream');

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let eventName = 'message';
	let dataLines: string[] = [];
	const abortReader = () => { void reader.cancel(); };
	options.signal.addEventListener('abort', abortReader, { once: true });
	const dispatch = () => {
		const currentEvent = eventName;
		eventName = 'message';
		if (!dataLines.length) {
			if (currentEvent === 'forbidden') {
				options.onForbidden();
				throw Object.assign(new Error('Live source access is no longer available'), { terminal: true });
			}
			return;
		}
		const data = dataLines.join('\n');
		dataLines = [];
		if (currentEvent === 'error') throw new Error('Live source is reconnecting');
		if (currentEvent === 'snapshot') options.onSnapshot(parseSnapshot(data));
		else if (currentEvent === 'forbidden') {
			options.onForbidden();
			throw Object.assign(new Error('Live source access is no longer available'), { terminal: true });
		}
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			if (done) buffer += '\n';
			let newline = buffer.indexOf('\n');
			while (newline >= 0) {
				const line = buffer.slice(0, newline).replace(/\r$/, '');
				buffer = buffer.slice(newline + 1);
				if (!line) dispatch();
				else if (!line.startsWith(':')) {
					const colon = line.indexOf(':');
					const field = colon < 0 ? line : line.slice(0, colon);
					const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
					if (field === 'event') eventName = value;
					else if (field === 'data') dataLines.push(value);
				}
				newline = buffer.indexOf('\n');
			}
			if (done) break;
		}
		if (dataLines.length) dispatch();
	} finally {
		options.signal.removeEventListener('abort', abortReader);
		try { await reader.cancel(); } catch { /* response may already be closed */ }
	}
};

export const validateLiveSourceStream = (stream: LiveSourceStreamBinding): boolean => !!validateLiveSource(stream);
