// DevKit request log (claude-todo/10 ⌨️): a small client-side ring buffer of
// the most recent API calls made through useApi/useAsyncFetcher — method,
// path, status, duration — plus a copy-as-curl builder in the same style the
// API docs generate. Pure module (no React, no DOM beyond none at all) so the
// buffer, redaction, and curl output unit-test in Node.

export type ApiLogEntry = {
	id: number;
	at: number;
	method: string;
	url: string;
	/** HTTP status; 0 when the request never got a response (network error). */
	status: number;
	ok: boolean;
	durationMs: number;
	/** JSON request body, already redacted — only kept for curl generation. */
	body?: unknown;
};

export const MAX_API_LOG_ENTRIES = 20;

// Values under keys matching this are replaced before an entry is stored, so
// the log (and any curl copied from it) never carries credentials — the log
// records login calls, after all.
const SENSITIVE_KEY = /pass|token|secret|authorization|code|challenge|apikey|api_key/i;
const REDACTED = '•••';
const MAX_REDACT_DEPTH = 6;

export const redactSensitive = (value: unknown, depth = 0): unknown => {
	if (depth > MAX_REDACT_DEPTH) return REDACTED;
	if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, depth + 1));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(entry, depth + 1);
		}
		return out;
	}
	return value;
};

let nextId = 1;
let entries: ApiLogEntry[] = [];
const listeners = new Set<() => void>();

// The body is not the only place a credential can ride: query strings carry
// them too (a PAT on ?token=, a one-time ?code= coming back from an OAuth
// provider). Redacting only the body would leave the log — and any curl copied
// out of it — holding a live credential, which is exactly what the contract
// above promises it never does. Same key vocabulary as the body redactor, so
// the two cannot drift.
export const redactUrl = (url: string): string => {
	const queryStart = url.indexOf('?');
	if (queryStart === -1) return url;

	const path = url.slice(0, queryStart);
	const [query, ...fragmentParts] = url.slice(queryStart + 1).split('#');
	const fragment = fragmentParts.length ? `#${fragmentParts.join('#')}` : '';

	// Hand-parsed rather than via URLSearchParams so a relative URL needs no
	// base and the surviving params keep their original encoding verbatim.
	const redacted = query
		.split('&')
		.map((pair) => {
			if (!pair) return pair;
			const eq = pair.indexOf('=');
			if (eq === -1) return pair;
			const name = pair.slice(0, eq);
			let decodedName = name;
			try {
				decodedName = decodeURIComponent(name.replace(/\+/g, ' '));
			} catch {
				// a malformed escape stays as written — still worth matching on
			}
			return SENSITIVE_KEY.test(decodedName) ? `${name}=${REDACTED}` : pair;
		})
		.join('&');

	return `${path}?${redacted}${fragment}`;
};

export const recordApiCall = (entry: Omit<ApiLogEntry, 'id' | 'body'> & { body?: unknown }): void => {
	try {
		const stored: ApiLogEntry = {
			...entry,
			id: nextId++,
			url: redactUrl(entry.url),
			body: entry.body === undefined ? undefined : redactSensitive(entry.body)
		};
		entries = [stored, ...entries].slice(0, MAX_API_LOG_ENTRIES);
		listeners.forEach((listener) => {
			try {
				listener();
			} catch {
				// a broken subscriber must never break request handling
			}
		});
	} catch {
		// telemetry only — swallow everything
	}
};

/** Newest first. The array identity changes per record, so it works with useSyncExternalStore. */
export const getApiCalls = (): ApiLogEntry[] => entries;

export const subscribeApiCalls = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const clearApiCalls = (): void => {
	entries = [];
	listeners.forEach((listener) => {
		try {
			listener();
		} catch {
			// ignore
		}
	});
};

// same single-quote escaping the API docs' curl examples use
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * A ready-to-paste curl for a logged call, mirroring the docs examples' shape.
 * The session cookie is httpOnly (unreadable from JS by design), so the line
 * ships as a placeholder for the caller to fill from devtools.
 */
export const buildCurlForEntry = (entry: ApiLogEntry, origin: string): string => {
	const lines = [`curl -X ${entry.method} ${shellQuote(`${origin}${entry.url}`)}`];
	lines.push(`  -b ${shellQuote('tt_session=<your session cookie>')}`);
	if (entry.body !== undefined) {
		lines.push(`  -H ${shellQuote('Content-Type: application/json')}`);
		lines.push(`  --data ${shellQuote(JSON.stringify(entry.body))}`);
	}
	return lines.join(' \\\n');
};
