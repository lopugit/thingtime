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
	/** True when the caller aborted the request — a cancellation, not a failure. */
	aborted?: boolean;
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

// A credential does not only ride under a telling key — it also rides inside a
// value, as URI userinfo (`scheme://user:password@host`). The case that forced
// this: MongoEndpointConfig posts a connection string under the key `url`
// (useApi mongodb.endpoint.set / endpoints.add), and `url` is deliberately not
// in the key vocabulary above — ordinary non-secret urls are exactly what this
// panel exists to show. api/utils/mongodb/endpoint.ts keeps that URI
// "SERVER-SIDE ONLY, never echo it ... back to a client" and scrubs it from its
// own error text; a log that stored it verbatim would hand it straight back
// through copy-as-curl. Only the userinfo is replaced, so the row still reads
// (scheme + host survive) while the credential cannot be copied out.
//
// The `@` run is greedy to the LAST `@` of the authority, not the first, which
// is how RFC 3986 / WHATWG delimit userinfo. It matters: an unencoded `@` in
// the password (Atlas issues passwords containing `@`, and percent-encoding it
// is the step people skip) would otherwise end the match at that `@` and leave
// the tail of the credential behind — `://•••@ssw0rd@host` — in the row and in
// any curl copied from it. `/?#` still terminate the scan, so ordinary paths
// and queries may hold `@` freely (this app puts @handles in paths).
const URI_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i;

export const redactUriCredentials = (value: string): string => value.replace(URI_USERINFO, `$1${REDACTED}@`);

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
	if (typeof value === 'string') return redactUriCredentials(value);
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
	// userinfo sits in the authority, ahead of any query — scrub it first so an
	// absolute request url is covered by the same rule request bodies are
	const safe = redactUriCredentials(url);
	const queryStart = safe.indexOf('?');
	if (queryStart === -1) return safe;

	const path = safe.slice(0, queryStart);
	const [query, ...fragmentParts] = safe.slice(queryStart + 1).split('#');
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

export type ApiStatusTone = 'ok' | 'warn' | 'danger' | 'muted';

/**
 * How a logged call should read in the panel. A deliberate cancellation is not
 * a failure: the app aborts in-flight GETs on unmount and on re-poll all over
 * (thing.tsx, CIControlDashboard, SensitiveThingReveal, useLopu), and every one
 * of those callers already treats AbortError as a non-event. Painting them the
 * same red as a dead network would send a reader chasing a request that was
 * fine — in the one panel whose whole job is to report honestly.
 */
export const describeApiStatus = (entry: Pick<ApiLogEntry, 'status' | 'aborted'>): { label: string; tone: ApiStatusTone } => {
	if (entry.aborted) return { label: 'cancelled', tone: 'muted' };
	if (entry.status === 0) return { label: '✕', tone: 'danger' };
	if (entry.status >= 500) return { label: String(entry.status), tone: 'danger' };
	if (entry.status >= 400) return { label: String(entry.status), tone: 'warn' };
	return { label: String(entry.status), tone: 'ok' };
};

// same single-quote escaping the API docs' curl examples use
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

// Must match the cookie auth/authCookie.ts actually issues (`createCookie('tt_auth')`).
// A placeholder under any other name produces a curl that stays anonymous even
// after the caller pastes their real value in — the request would 401 and the
// panel would be lying about being ready to paste.
const AUTH_COOKIE_NAME = 'tt_auth';

/**
 * A ready-to-paste curl for a logged call, mirroring the docs examples' shape.
 * The session cookie is httpOnly (unreadable from JS by design), so the line
 * ships as a placeholder for the caller to fill from devtools.
 */
export const buildCurlForEntry = (entry: ApiLogEntry, origin: string): string => {
	const lines = [`curl -X ${entry.method} ${shellQuote(`${origin}${entry.url}`)}`];
	lines.push(`  -b ${shellQuote(`${AUTH_COOKIE_NAME}=<your session cookie>`)}`);
	if (entry.body !== undefined) {
		lines.push(`  -H ${shellQuote('Content-Type: application/json')}`);
		lines.push(`  --data ${shellQuote(JSON.stringify(entry.body))}`);
	}
	return lines.join(' \\\n');
};
