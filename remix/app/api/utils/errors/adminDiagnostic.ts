import { randomUUID } from 'node:crypto';

const MAX_CAUSE_DEPTH = 3;
const MAX_DIAGNOSTIC_STRING_CHARS = 16 * 1024;
const MAX_ERROR_LABELS = 12;
const RAW_REDACTION_LOOKAHEAD_CHARS = 512;
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
	revealDisabled: boolean;
	allowPublicRevealPlaceholders: boolean;
	markerNonce: string;
	approvedObjectIds: Set<string>;
	deniedObjectIds: Set<string>;
	revealableObjectIds: Map<string, AdminDiagnosticRevealable & { marker: string }>;
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

const objectIdPlaceholder = (index: number): string => `[redacted MongoDB ObjectId #${index}]`;

const MONGODB_OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const MONGODB_OBJECT_ID_SEARCH_PATTERN = /(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/gi;
const REVEAL_PLACEHOLDER_SOURCE = '\\[redacted MongoDB ObjectId #(?:[1-9]|[12][0-9]|3[0-2])\\]';
const identifierLabel =
	'(?:\\$oid|_id|object[_-]?id|document[_-]?id|thing[_-]?id|record[_-]?id|source[_-]?id|target[_-]?id|owner[_-]?id|user[_-]?id|share[_-]?id|app[_-]?id|client[_-]?id)';
const ASSIGNMENT_LABEL_PATTERN = /(^|[^A-Za-z0-9])(["']?)([-_$A-Za-z0-9][_$A-Za-z0-9-]*(?:[ \t]+[-_$A-Za-z0-9][_$A-Za-z0-9-]*){0,3})\2([ \t]*[:=][ \t]*)/gim;
const CLI_OPTION_PATTERN = /(^|\s)(--[A-Za-z0-9][A-Za-z0-9_-]*)([ \t]+)/gim;
const CREDENTIAL_COMPONENTS = new Set([
	'authorization',
	'cookie',
	'cookies',
	'credential',
	'credentials',
	'email',
	'emails',
	'jwt',
	'key',
	'keys',
	'passphrase',
	'passphrases',
	'passwd',
	'passwds',
	'password',
	'passwords',
	'private',
	'secure',
	'secret',
	'secrets',
	'sensitive',
	'session',
	'sessions',
	'token',
	'tokens'
]);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const exactRevealIdentifierValuePattern = (tokenSource: string): RegExp =>
	new RegExp(
		`^(?:${tokenSource}|["']${tokenSource}["']|(?:new\\s+)?ObjectId\\s*\\(\\s*["']${tokenSource}["']\\s*\\)|\\{\\s*["']?\\$oid["']?\\s*[:=]\\s*["']${tokenSource}["']\\s*\\})$`,
		'i'
	);

const credentialLabelComponents = (value: string): string[] =>
	value
		.replace(/^[-_$]+/, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

const isCredentialLabel = (value: string): boolean =>
	credentialLabelComponents(value).some((component) => CREDENTIAL_COMPONENTS.has(component));

const truncateSanitizedText = (value: string, maxChars: number, suffix: string): string => {
	const limit = Math.max(0, maxChars - suffix.length);
	const candidate = value.slice(0, limit);
	let boundary = -1;
	for (let index = candidate.length - 1; index >= 0; index -= 1) {
		if (/\s/.test(candidate[index])) {
			boundary = index;
			break;
		}
	}
	const safePrefix = boundary >= 0 ? candidate.slice(0, boundary).trimEnd() : '';
	return `${safePrefix}${suffix}`;
};

const createCaptureState = (context: AdminDiagnosticRevealContext = {}, allowPublicRevealPlaceholders = false): CaptureState => {
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
		revealDisabled: false,
		allowPublicRevealPlaceholders,
		markerNonce: randomUUID().replace(/-/g, ''),
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
	if (state.revealDisabled || !state.approvedObjectIds.has(value) || state.deniedObjectIds.has(value)) return '[redacted-object-id]';
	const existing = state.revealableObjectIds.get(value);
	if (existing) return existing.marker;
	if (state.revealableObjectIds.size >= MAX_ADMIN_DIAGNOSTIC_REVEALABLES) {
		// The detail remains safely redacted, but the bounded private lookup table
		// deliberately stops growing. `truncated` covers every capture safety cap.
		state.truncated = true;
		return '[redacted-object-id]';
	}

	const index = state.revealableObjectIds.size + 1;
	const revealable: AdminDiagnosticRevealable & { marker: string } = {
		reference: `mongodb-object-id-${index}`,
		kind: 'mongodb-object-id',
		label: `MongoDB ObjectId #${index}`,
		placeholder: objectIdPlaceholder(index),
		value,
		marker: `\u{e000}thingtime-reveal-${state.markerNonce}-${index}\u{e001}`
	};
	state.revealableObjectIds.set(value, revealable);
	return revealable.marker;
};

const redactText = (value: string, state: CaptureState, maxChars = MAX_DIAGNOSTIC_STRING_CHARS): string => {
	// Inspect a fixed lookahead beyond the eventual output boundary so tokens
	// crossing that boundary are redacted whole. If raw input is omitted, all
	// reveal eligibility is disabled: an unseen suffix might otherwise contain
	// a credential occurrence that should veto an earlier approved identifier.
	const rawTruncated = value.length > maxChars;
	if (rawTruncated) {
		state.truncated = true;
		state.revealDisabled = true;
	}
	let redacted = rawTruncated ? value.slice(0, maxChars + RAW_REDACTION_LOOKAHEAD_CHARS) : value;
	const replace = (pattern: RegExp, replacement: (...args: any[]) => string) => {
		redacted = redacted.replace(pattern, (...args) => {
			const next = replacement(...args);
			if (next !== args[0]) state.redactions += 1;
			return next;
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
	if (!state.allowPublicRevealPlaceholders) {
		replace(new RegExp(REVEAL_PLACEHOLDER_SOURCE, 'g'), () => '[redacted-placeholder]');
	}

	// Header values are a single irreversible unit. In particular, a Cookie or
	// Set-Cookie line can contain many semicolon-separated credentials.
	replace(/\b((?:set-cookie|cookie|authorization|proxy-authorization)\s*:)[^\r\n]*/gi, (match, prefix) => {
		rememberIrreversibleObjectIds(match, state);
		return `${prefix} [redacted credential field and remainder]`;
	});

	// Credential-shaped values are never retained for reveal, even when the value
	// happens to look exactly like an ObjectId. Parse the whole bounded assignment
	// label, normalize camelCase, separators, plural forms, CLI dashes and sigils,
	// then redact the remainder of the field. This intentionally treats any
	// standalone key/keys component as sensitive (for example signingKey).
	let credentialBoundary: { index: number; valueStart: number } | null = null;
	for (const [pattern, labelIndex] of [
		[ASSIGNMENT_LABEL_PATTERN, 3],
		[CLI_OPTION_PATTERN, 2]
	] as const) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(redacted))) {
			if (!isCredentialLabel(match[labelIndex])) continue;
			const candidate = { index: match.index, valueStart: match.index + match[0].length };
			if (!credentialBoundary || candidate.index < credentialBoundary.index) credentialBoundary = candidate;
			break;
		}
	}
	if (credentialBoundary) {
		const sensitiveRemainder = redacted.slice(credentialBoundary.index);
		rememberIrreversibleObjectIds(sensitiveRemainder, state);
		const next = `${redacted.slice(0, credentialBoundary.valueStart)}[redacted credential field and remainder]`;
		if (next !== redacted) state.redactions += 1;
		redacted = next;
	}
	// Query strings are an irreversible unit: they are routinely copied into
	// errors without enough schema context to distinguish ids from credentials.
	replace(/\?[^#\s"'<>]+/g, (match) => {
		rememberIrreversibleObjectIds(match, state);
		return '?[redacted-query]';
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
		replace(new RegExp(`(?<![0-9a-f])${objectId}(?![0-9a-f])`, 'gi'), () => captureObjectId(objectId, state));
	}

	const internalMarkerSource = [...state.revealableObjectIds.values()].map((entry) => escapeRegExp(entry.marker)).join('|');
	const revealTokenSource = internalMarkerSource
		? `(?:${REVEAL_PLACEHOLDER_SOURCE}|${internalMarkerSource})`
		: REVEAL_PLACEHOLDER_SOURCE;
	const exactRevealValue = exactRevealIdentifierValuePattern(revealTokenSource);
	const mongoToken = `(?:[0-9a-f]{24}|${revealTokenSource})`;
	const identifierValue =
		`(?:(?:new\\s+)?ObjectId\\s*\\(\\s*["']${mongoToken}["']\\s*\\)|` +
		`\\{\\s*["']?\\$oid["']?\\s*[:=]\\s*["']${mongoToken}["']\\s*\\}|` +
		`"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|` +
		`${revealTokenSource}|[^\\s,;}\\]]+)`;
	redacted = redacted.replace(
		new RegExp(
			`(^|[^A-Za-z0-9_$-])(["']?${identifierLabel}["']?\\s*[:=]\\s*)(${identifierValue})`,
			'gim'
		),
		(_match, leading, prefix, candidate) => {
			const next = exactRevealValue.test(String(candidate)) ? `${leading}${prefix}${candidate}` : `${leading}${prefix}[redacted]`;
			if (next !== _match) state.redactions += 1;
			return next;
		}
	);
	replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => '[redacted-email]');
	replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, () => '[redacted-uuid]');
	replace(/(?<![0-9a-f])[0-9a-f]{24}(?![0-9a-f])/gi, () => '[redacted-object-id]');
	replace(/(\/(?:Users|home)\/)[^/\s]+/g, (_match, prefix) => `${prefix}[redacted-user]`);

	if (rawTruncated || redacted.length > maxChars) {
		state.truncated = true;
		redacted = truncateSanitizedText(redacted, maxChars, '\n…[text truncated after redaction]');
	}
	return redacted;
};

// Read one named data property without invoking accessors or enumerating an
// arbitrary exception graph. A short prototype walk preserves standard Error
// fields while keeping work fixed even for unusually wide thrown objects.
type PropertyLookup = { kind: 'data'; value: unknown } | { kind: 'accessor' } | null;

const propertyLookup = (value: object, key: string): PropertyLookup => {
	let cursor: object | null = value;
	for (let depth = 0; cursor && depth < 6; depth += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
		if (descriptor) return 'value' in descriptor ? { kind: 'data', value: descriptor.value } : { kind: 'accessor' };
		cursor = Object.getPrototypeOf(cursor);
	}
	return null;
};

const dataProperty = (value: object, key: string): unknown => {
	const lookup = propertyLookup(value, key);
	return lookup?.kind === 'data' ? lookup.value : undefined;
};

// Node 24 represents an untouched native Error stack as a lazy own accessor.
// Cache V8's exact accessor identities once so we can materialize that useful
// stack without ever calling an accessor supplied by a thrown object.
const nativeErrorStackDescriptor = Object.getOwnPropertyDescriptor(new Error(), 'stack');
const nativeErrorStackGetter = nativeErrorStackDescriptor && !('value' in nativeErrorStackDescriptor) ? nativeErrorStackDescriptor.get : undefined;
const nativeErrorStackSetter = nativeErrorStackDescriptor && !('value' in nativeErrorStackDescriptor) ? nativeErrorStackDescriptor.set : undefined;

const safeTextProperty = (value: object, key: string, state: CaptureState): string | undefined => {
	const property = dataProperty(value, key);
	return typeof property === 'string' && property ? redactText(property, state) : undefined;
};

const formattedErrorHeader = (name: string, message: string): string => {
	if (!name) return message;
	if (!message) return name;
	return `${name}: ${message}`;
};

const sanitizedStack = (
	rawStack: string,
	rawName: string | undefined,
	rawMessage: string | undefined,
	safeName: string,
	safeMessage: string,
	state: CaptureState
): string => {
	if (rawName !== undefined && rawMessage !== undefined) {
		const rawHeader = formattedErrorHeader(rawName, rawMessage);
		if (rawStack === rawHeader || rawStack.startsWith(`${rawHeader}\n`)) {
			const frames = rawStack === rawHeader ? '' : rawStack.slice(rawHeader.length + 1);
			const safeFrames = frames ? redactText(frames, state) : '';
			const safeHeader = formattedErrorHeader(safeName, safeMessage);
			return safeFrames ? `${safeHeader}\n${safeFrames}` : safeHeader;
		}
	}
	return redactText(rawStack, state);
};

const safeStackProperty = (
	value: object,
	state: CaptureState,
	rawName: string | undefined,
	rawMessage: string | undefined,
	safeName: string,
	safeMessage: string
): string | undefined => {
	const stackLookup = propertyLookup(value, 'stack');
	if (stackLookup?.kind === 'data') {
		return typeof stackLookup.value === 'string' && stackLookup.value
			? sanitizedStack(stackLookup.value, rawName, rawMessage, safeName, safeMessage, state)
			: undefined;
	}

	const descriptor = Object.getOwnPropertyDescriptor(value, 'stack');
	const safeNativeInputs =
		propertyLookup(value, 'name')?.kind === 'data' &&
		typeof rawName === 'string' &&
		propertyLookup(value, 'message')?.kind === 'data' &&
		typeof rawMessage === 'string';
	if (
		!safeNativeInputs ||
		!descriptor ||
		'value' in descriptor ||
		!nativeErrorStackGetter ||
		descriptor.get !== nativeErrorStackGetter ||
		descriptor.set !== nativeErrorStackSetter
	) {
		return undefined;
	}
	try {
		const nativeStack = Reflect.apply(nativeErrorStackGetter, value, []);
		return typeof nativeStack === 'string' && nativeStack
			? sanitizedStack(nativeStack, rawName, rawMessage, safeName, safeMessage, state)
			: undefined;
	} catch {
		return undefined;
	}
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

	const rawNameValue = dataProperty(thrown, 'name');
	const rawMessageValue = dataProperty(thrown, 'message');
	const rawName = typeof rawNameValue === 'string' ? rawNameValue : undefined;
	const rawMessage = typeof rawMessageValue === 'string' ? rawMessageValue : undefined;
	const name = (rawName ? redactText(rawName, state) : undefined) || (thrown instanceof Error ? 'Error' : 'NonErrorThrow');
	const message =
		(rawMessage ? redactText(rawMessage, state) : undefined) ||
		(thrown instanceof Error ? 'The error had no message.' : 'A non-Error object was thrown.');
	const snapshot: ErrorSnapshot = { name, message };
	const stack = safeStackProperty(thrown, state, rawName, rawMessage, name, message);
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

const sanitizeStoredSnapshot = (value: unknown, state: CaptureState, depth = 0): Record<string, unknown> | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const snapshot: Record<string, unknown> = {};
	const rawNameValue = dataProperty(value, 'name');
	const rawMessageValue = dataProperty(value, 'message');
	const rawName = typeof rawNameValue === 'string' ? rawNameValue : undefined;
	const rawMessage = typeof rawMessageValue === 'string' ? rawMessageValue : undefined;
	const safeName = rawName ? redactText(rawName, state) : undefined;
	const safeMessage = rawMessage ? redactText(rawMessage, state) : undefined;
	if (safeName) snapshot.name = safeName;
	if (safeMessage) snapshot.message = safeMessage;
	const stack = safeStackProperty(value, state, rawName, rawMessage, safeName || '', safeMessage || '');
	if (stack) snapshot.stack = stack;
	for (const key of ['codeName', 'syscall'] as const) {
		const text = safeTextProperty(value, key, state);
		if (text) snapshot[key] = text;
	}
	for (const key of ['code', 'errno'] as const) {
		const code = safeCodeProperty(value, key, state);
		if (code !== undefined) snapshot[key] = code;
	}
	for (const key of ['status', 'statusCode'] as const) {
		const number = safeNumberProperty(value, key);
		if (number !== undefined) snapshot[key] = number;
	}
	const errorLabels = safeErrorLabels(value, state);
	if (errorLabels) snapshot.errorLabels = errorLabels;
	const cause = dataProperty(value, 'cause');
	if (cause !== undefined) {
		if (depth < MAX_CAUSE_DEPTH) {
			const nested = sanitizeStoredSnapshot(cause, state, depth + 1);
			if (nested) snapshot.cause = nested;
		} else {
			state.truncated = true;
		}
	}
	return Object.keys(snapshot).length ? snapshot : null;
};

// Re-scrub stored envelopes at both write and read boundaries. This keeps a
// manually constructed or legacy-corrupt diagnostic from bypassing password
// confirmation by placing a raw identifier beside an otherwise valid
// descriptor placeholder. Parsed snapshots retain only the same closed fields
// as fresh captures; non-JSON legacy detail is scrubbed as bounded plain text.
export const sanitizeStoredAdminDiagnosticDetail = (value: unknown): AdminErrorDiagnostic => {
	const state = createCaptureState({}, true);
	const source = typeof value === 'string' ? value : '';
	let detail: string;
	const unavailableDetail = () =>
		JSON.stringify(
			{
				name: 'UnavailableDiagnostic',
				message: 'The stored diagnostic did not match the supported error snapshot.'
			},
			null,
			2
		);
	const firstNonWhitespace = source.match(/\S/)?.[0];
	if (source.length > MAX_ADMIN_DIAGNOSTIC_CHARS && (firstNonWhitespace === '{' || firstNonWhitespace === '[')) {
		state.truncated = true;
		detail = unavailableDetail();
	} else if (source.length > MAX_ADMIN_DIAGNOSTIC_CHARS) {
		detail = redactText(source, state, MAX_ADMIN_DIAGNOSTIC_CHARS);
	} else {
		try {
			const snapshot = sanitizeStoredSnapshot(JSON.parse(source), state);
			detail = snapshot ? JSON.stringify(snapshot, null, 2) : unavailableDetail();
		} catch {
			detail = redactText(source, state, MAX_ADMIN_DIAGNOSTIC_CHARS);
		}
	}
	if (detail.length > MAX_ADMIN_DIAGNOSTIC_CHARS) {
		state.truncated = true;
		detail = truncateSanitizedText(detail, MAX_ADMIN_DIAGNOSTIC_CHARS, '\n…[diagnostic truncated after redaction]');
	}
	return { detail, redactions: state.redactions, truncated: state.truncated, revealables: [] };
};

export const captureAdminErrorDiagnostic = (
	error: unknown,
	revealContext: AdminDiagnosticRevealContext = {}
): AdminErrorDiagnostic => {
	try {
		const state = createCaptureState(revealContext);
		const snapshot = errorSnapshot(error, state);
		let detail = JSON.stringify(snapshot, null, 2);
		if (detail.length > MAX_ADMIN_DIAGNOSTIC_CHARS) {
			state.truncated = true;
			detail = truncateSanitizedText(detail, MAX_ADMIN_DIAGNOSTIC_CHARS, '\n…[diagnostic truncated after redaction]');
		}
		// Generated markers carry per-capture random provenance until every scrub and
		// output bound is complete. Attacker-authored public placeholder text can
		// therefore never keep a raw lookup-table entry alive after its real marker
		// was removed. Only then convert surviving markers to public placeholders.
		const revealables: AdminDiagnosticRevealable[] = [];
		for (const [value, entry] of state.revealableObjectIds) {
			const eligible = !state.revealDisabled && !state.deniedObjectIds.has(value) && detail.includes(entry.marker);
			detail = detail.split(entry.marker).join(eligible ? entry.placeholder : '[redacted-object-id]');
			if (eligible) {
				const { marker: _marker, ...publicEntry } = entry;
				revealables.push(publicEntry);
			}
		}
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
