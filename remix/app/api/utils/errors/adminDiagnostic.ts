const MAX_CAUSE_DEPTH = 3;
const MAX_DIAGNOSTIC_STRING_CHARS = 16 * 1024;
const MAX_ERROR_LABELS = 12;
export const MAX_ADMIN_DIAGNOSTIC_CHARS = 48 * 1024;
export const MAX_ADMIN_DIAGNOSTIC_REVEALABLES = 32;

export type AdminDiagnosticRevealable = {
	reference: string;
	kind: 'mongodb-object-id';
	label: string;
	placeholder: string;
	value: string;
};

export type AdminErrorDiagnostic = {
	detail: string;
	redactions: number;
	truncated: boolean;
	revealables: AdminDiagnosticRevealable[];
};

type CaptureState = {
	redactions: number;
	truncated: boolean;
	approvedObjectIds: Set<string>;
	deniedObjectIds: Set<string>;
	revealableObjectIds: Map<string, AdminDiagnosticRevealable>;
};

export type AdminDiagnosticRevealContext = {
	// Values become revealable only when an authored server-side caller supplies
	// this typed context. Error-message syntax alone never grants reveal access.
	mongodbObjectIds?: readonly string[];
};

type ErrorSnapshot = {
	name: string;
	message: string;
	stack?: string;
	code?: string | number;
	codeName?: string;
	errno?: string | number;
	syscall?: string;
	status?: number;
	statusCode?: number;
	errorLabels?: string[];
	cause?: ErrorSnapshot;
};

const boundedText = (value: string, state: CaptureState): string => {
	if (value.length <= MAX_DIAGNOSTIC_STRING_CHARS) return value;
	state.truncated = true;
	const suffix = '\n…[string truncated before redaction]';
	return `${value.slice(0, MAX_DIAGNOSTIC_STRING_CHARS - suffix.length)}${suffix}`;
};

const objectIdPlaceholder = (index: number): string => `[redacted MongoDB ObjectId #${index}]`;

const MONGODB_OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const MONGODB_OBJECT_ID_SEARCH_PATTERN = /\b[0-9a-f]{24}\b/gi;
const REVEAL_PLACEHOLDER_PATTERN = /\[redacted MongoDB ObjectId #(?:[1-9]|[12][0-9]|3[0-2])\]/;

const credentialLabel =
	'(?:' +
	'(?:[A-Za-z0-9]+[_-])*(?:' +
	'(?:hashed?[_-]?)?password(?:[_-]?(?:hash|digest))?|' +
	'passwd(?:[_-]?(?:hash|digest))?|' +
	'passphrase|' +
	'(?:refresh|access|auth|session|client|api|private)?[_-]?(?:secret|token|credential)(?:[_-]?(?:hash|digest))?|' +
	'api[_-]?key(?:[_-]?(?:hash|digest))?|' +
	'access[_-]?key(?:[_-]?(?:hash|digest))?|' +
	'private[_-]?key(?:[_-]?(?:hash|digest))?|' +
	'authorization|cookie|jwt|session(?:[_-]?(?:id|jti|token|hash|digest))?|email' +
	')' +
	')';
const identifierLabel =
	'(?:\$oid|_id|object[_-]?id|document[_-]?id|thing[_-]?id|record[_-]?id|source[_-]?id|target[_-]?id|owner[_-]?id|user[_-]?id|share[_-]?id|app[_-]?id|client[_-]?id)';
const sensitiveQueryLabel = `(?:${credentialLabel}|${identifierLabel})`;

const createCaptureState = (context: AdminDiagnosticRevealContext = {}): CaptureState => {
	const approvedObjectIds = new Set<string>();
	let truncated = false;
	if (Array.isArray(context.mongodbObjectIds)) {
		for (const candidate of context.mongodbObjectIds) {
			if (typeof candidate !== 'string' || !MONGODB_OBJECT_ID_PATTERN.test(candidate)) continue;
			if (approvedObjectIds.size >= MAX_ADMIN_DIAGNOSTIC_REVEALABLES) {
				truncated = true;
				break;
			}
			approvedObjectIds.add(candidate.toLowerCase());
		}
	}
	return {
		redactions: 0,
		truncated,
		approvedObjectIds,
		deniedObjectIds: new Set(),
		revealableObjectIds: new Map()
	};
};

const rememberIrreversibleObjectIds = (value: string, state: CaptureState) => {
	for (const match of value.matchAll(MONGODB_OBJECT_ID_SEARCH_PATTERN)) {
		state.deniedObjectIds.add(match[0].toLowerCase());
	}
};

const captureObjectId = (rawValue: string, state: CaptureState): string => {
	const value = rawValue.toLowerCase();
	if (!state.approvedObjectIds.has(value) || state.deniedObjectIds.has(value)) return '[redacted-object-id]';
	const existing = state.revealableObjectIds.get(value);
	if (existing) return existing.placeholder;
	if (state.revealableObjectIds.size >= MAX_ADMIN_DIAGNOSTIC_REVEALABLES) {
		// The detail remains safely redacted, but the bounded private lookup table
		// deliberately stops growing. `truncated` covers every capture safety cap.
		state.truncated = true;
		return '[redacted-object-id]';
	}

	const index = state.revealableObjectIds.size + 1;
	const revealable: AdminDiagnosticRevealable = {
		reference: `mongodb-object-id-${index}`,
		kind: 'mongodb-object-id',
		label: `MongoDB ObjectId #${index}`,
		placeholder: objectIdPlaceholder(index),
		value
	};
	state.revealableObjectIds.set(value, revealable);
	return revealable.placeholder;
};

const redactText = (value: string, state: CaptureState, maxChars = MAX_DIAGNOSTIC_STRING_CHARS): string => {
	// Bound first: no thrown string can make the regex work or output allocation
	// exceed a fixed cost while an admin failure is being prepared.
	let redacted =
		maxChars === MAX_DIAGNOSTIC_STRING_CHARS
			? boundedText(value, state)
			: value.length <= maxChars
			? value
			: (() => {
					state.truncated = true;
					const suffix = '\n…[diagnostic truncated before redaction]';
					return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
			  })();
	const replace = (pattern: RegExp, replacement: string | ((...args: any[]) => string)) => {
		if (typeof replacement === 'string') {
			const matches = redacted.match(pattern);
			if (matches?.length) state.redactions += matches.length;
			redacted = redacted.replace(pattern, replacement);
			return;
		}
		redacted = redacted.replace(pattern, (...args) => {
			state.redactions += 1;
			return replacement(...args);
		});
	};

	replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi, (match) => {
		rememberIrreversibleObjectIds(match, state);
		return '[redacted-private-key]';
	});
	replace(/\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|rediss):\/\/[^\s"'<>]+/gi, (match, scheme) => {
		rememberIrreversibleObjectIds(match, state);
		return `${scheme}://[redacted]`;
	});
	replace(/(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, (match, scheme) => {
		rememberIrreversibleObjectIds(match, state);
		return `${scheme}[redacted]@`;
	});
	replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match, scheme) => {
		rememberIrreversibleObjectIds(match, state);
		return `${scheme} [redacted]`;
	});
	replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, (match) => {
		rememberIrreversibleObjectIds(match, state);
		return '[redacted-jwt]';
	});
	replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, (match) => {
		rememberIrreversibleObjectIds(match, state);
		return '[redacted-access-key]';
	});
	replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk_(?:live|test)_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, (match) => {
		rememberIrreversibleObjectIds(match, state);
		return '[redacted-token]';
	});

	// Header values are a single irreversible unit. In particular, a Cookie or
	// Set-Cookie line can contain many semicolon-separated credentials.
	replace(/\b((?:set-cookie|cookie|authorization|proxy-authorization)\s*:)[^\r\n]*/gi, (match, prefix) => {
		rememberIrreversibleObjectIds(match, state);
		return `${prefix} [redacted]`;
	});

	// Credential-shaped values are never retained for reveal, even when the value
	// happens to look exactly like an ObjectId. Identifier values are handled in
	// a separate, closed allowlist below so future reveal support cannot turn into
	// a generic secret recovery mechanism.
	// Once a credential assignment starts, redact the rest of that bounded line.
	// This deliberately over-redacts structured/multi-token values rather than
	// guessing where a nested object or array ends and accidentally retaining it.
	replace(new RegExp(`(["']?${credentialLabel}["']?\\s*[:=]\\s*)[^\\r\\n]*`, 'gi'), (match, prefix) => {
		rememberIrreversibleObjectIds(match, state);
		return `${prefix}[redacted]`;
	});
	// URLs are an irreversible boundary: query strings may be copied into logs or
	// diagnostics without enough context to prove that a 24-hex value is an id.
	replace(new RegExp(`([?&]${sensitiveQueryLabel}=)[^&#\\s]+`, 'gi'), (match, prefix) => {
		rememberIrreversibleObjectIds(match, state);
		return `${prefix}[redacted]`;
	});

	// Reveal permission is structural, not inferred from prose. Replace only ids
	// supplied by an authored typed context; every other 24-hex value is scrubbed
	// irreversibly below. Textual order determines stable descriptor numbering.
	const lower = redacted.toLowerCase();
	const approved = [...state.approvedObjectIds]
		.filter((objectId) => !state.deniedObjectIds.has(objectId))
		.map((objectId, order) => ({ objectId, order, index: lower.indexOf(objectId) }))
		.filter(({ index }) => index >= 0)
		.sort((left, right) => left.index - right.index || left.order - right.order);
	for (const { objectId } of approved) {
		replace(new RegExp(`\\b${objectId}\\b`, 'gi'), () => captureObjectId(objectId, state));
	}

	const mongoToken = `(?:[0-9a-f]{24}|\\[redacted MongoDB ObjectId #(?:[1-9]|[12][0-9]|3[0-2])\\])`;
	const identifierValue =
		`(?:(?:new\\s+)?ObjectId\\s*\\(\\s*["']${mongoToken}["']\\s*\\)|` +
		`\\{\\s*["']?\\$oid["']?\\s*[:=]\\s*["']${mongoToken}["']\\s*\\}|` +
		`"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|` +
		`\\[redacted MongoDB ObjectId #(?:[1-9]|[12][0-9]|3[0-2])\\]|[^\\s,;}\\]]+)`;
	replace(
		new RegExp(
			`(^|[^A-Za-z0-9_$-])(["']?${identifierLabel}["']?\\s*[:=]\\s*)(${identifierValue})`,
			'gim'
		),
		(_match, leading, prefix, candidate) => {
			const replacement = REVEAL_PLACEHOLDER_PATTERN.test(String(candidate)) ? candidate : '[redacted]';
			return `${leading}${prefix}${replacement}`;
		}
	);
	replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]');
	replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-uuid]');
	replace(/\b[0-9a-f]{24}\b/gi, '[redacted-object-id]');
	replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1[redacted-user]');
	return redacted;
};

// Re-scrub stored envelopes at both write and read boundaries. This keeps a
// manually constructed or legacy-corrupt diagnostic from bypassing password
// confirmation by placing a raw identifier beside an otherwise valid
// descriptor placeholder.
export const sanitizeStoredAdminDiagnosticDetail = (value: unknown): AdminErrorDiagnostic => {
	const state = createCaptureState();
	const detail = redactText(typeof value === 'string' ? value : '', state, MAX_ADMIN_DIAGNOSTIC_CHARS);
	return { detail, redactions: state.redactions, truncated: state.truncated, revealables: [] };
};

// Read one named data property without invoking accessors or enumerating an
// arbitrary exception graph. A short prototype walk preserves standard Error
// fields while keeping work fixed even for unusually wide thrown objects.
const dataProperty = (value: object, key: string): unknown => {
	let cursor: object | null = value;
	for (let depth = 0; cursor && depth < 4; depth += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
		if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
		cursor = Object.getPrototypeOf(cursor);
	}
	return undefined;
};

const safeTextProperty = (value: object, key: string, state: CaptureState): string | undefined => {
	const property = dataProperty(value, key);
	return typeof property === 'string' && property ? redactText(property, state) : undefined;
};

const safeNumberProperty = (value: object, key: string): number | undefined => {
	const property = dataProperty(value, key);
	return typeof property === 'number' && Number.isFinite(property) ? property : undefined;
};

const safeCodeProperty = (value: object, key: string, state: CaptureState): string | number | undefined => {
	const property = dataProperty(value, key);
	if (typeof property === 'number' && Number.isFinite(property)) return property;
	return typeof property === 'string' && property ? redactText(property, state) : undefined;
};

const safeErrorLabels = (value: object, state: CaptureState): string[] | undefined => {
	const labels = dataProperty(value, 'errorLabels');
	if (!Array.isArray(labels)) return undefined;
	if (labels.length > MAX_ERROR_LABELS) state.truncated = true;
	const output: string[] = [];
	for (let index = 0; index < Math.min(labels.length, MAX_ERROR_LABELS); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(labels, String(index));
		if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
			output.push(redactText(descriptor.value, state));
		}
	}
	return output.length ? output : undefined;
};

const errorSnapshot = (thrown: unknown, state: CaptureState, depth = 0): ErrorSnapshot => {
	if (!thrown || typeof thrown !== 'object') {
		return {
			name: 'NonErrorThrow',
			message: redactText(typeof thrown === 'string' ? thrown : `A ${typeof thrown} value was thrown.`, state)
		};
	}

	const name = safeTextProperty(thrown, 'name', state) || (thrown instanceof Error ? 'Error' : 'NonErrorThrow');
	const message =
		safeTextProperty(thrown, 'message', state) || (thrown instanceof Error ? 'The error had no message.' : 'A non-Error object was thrown.');
	const snapshot: ErrorSnapshot = { name, message };
	const stack = safeTextProperty(thrown, 'stack', state);
	const code = safeCodeProperty(thrown, 'code', state);
	const codeName = safeTextProperty(thrown, 'codeName', state);
	const errno = safeCodeProperty(thrown, 'errno', state);
	const syscall = safeTextProperty(thrown, 'syscall', state);
	const status = safeNumberProperty(thrown, 'status');
	const statusCode = safeNumberProperty(thrown, 'statusCode');
	const errorLabels = safeErrorLabels(thrown, state);
	if (stack) snapshot.stack = stack;
	if (code !== undefined) snapshot.code = code;
	if (codeName) snapshot.codeName = codeName;
	if (errno !== undefined) snapshot.errno = errno;
	if (syscall) snapshot.syscall = syscall;
	if (status !== undefined) snapshot.status = status;
	if (statusCode !== undefined) snapshot.statusCode = statusCode;
	if (errorLabels) snapshot.errorLabels = errorLabels;

	const cause = dataProperty(thrown, 'cause');
	if (cause !== undefined) {
		if (depth < MAX_CAUSE_DEPTH) snapshot.cause = errorSnapshot(cause, state, depth + 1);
		else state.truncated = true;
	}
	return snapshot;
};

export const captureAdminErrorDiagnostic = (
	error: unknown,
	revealContext: AdminDiagnosticRevealContext = {}
): AdminErrorDiagnostic => {
	try {
		const state = createCaptureState(revealContext);
		const snapshot = errorSnapshot(error, state);
		let detail = JSON.stringify(snapshot, null, 2);
		for (const [value, entry] of state.revealableObjectIds) {
			if (state.deniedObjectIds.has(value)) detail = detail.split(entry.placeholder).join('[redacted-object-id]');
		}
		if (detail.length > MAX_ADMIN_DIAGNOSTIC_CHARS) {
			state.truncated = true;
			const suffix = '\n…[diagnostic truncated]';
			detail = `${detail.slice(0, MAX_ADMIN_DIAGNOSTIC_CHARS - suffix.length)}${suffix}`;
		}
		// Never retain a value whose placeholder was itself removed by the final
		// whole-diagnostic bound. The normal read response exposes descriptors only;
		// raw values stay inside the protected diagnostic envelope.
		const revealables = [...state.revealableObjectIds.values()].filter(
			(entry) => !state.deniedObjectIds.has(entry.value) && detail.includes(entry.placeholder)
		);
		return { detail, redactions: state.redactions, truncated: state.truncated, revealables };
	} catch {
		return {
			detail: JSON.stringify({ name: 'UnserializableError', message: 'The thrown value could not be captured safely.' }, null, 2),
			redactions: 0,
			truncated: true,
			revealables: []
		};
	}
};
