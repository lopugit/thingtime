const MAX_CAUSE_DEPTH = 3;
const MAX_DIAGNOSTIC_STRING_CHARS = 16 * 1024;
const MAX_ERROR_LABELS = 12;
export const MAX_ADMIN_DIAGNOSTIC_CHARS = 48 * 1024;

export type AdminErrorDiagnostic = {
	detail: string;
	redactions: number;
	truncated: boolean;
};

type CaptureState = {
	redactions: number;
	truncated: boolean;
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

const redactText = (value: string, state: CaptureState): string => {
	// Bound first: no thrown string can make the regex work or output allocation
	// exceed a fixed cost while an admin failure is being prepared.
	let redacted = boundedText(value, state);
	const replace = (pattern: RegExp, replacement: string) => {
		const matches = redacted.match(pattern);
		if (matches?.length) state.redactions += matches.length;
		redacted = redacted.replace(pattern, replacement);
	};

	replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi, '[redacted-private-key]');
	replace(/\b(mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|rediss):\/\/[^\s"'<>]+/gi, '$1://[redacted]');
	replace(/(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, '$1[redacted]@');
	replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]');
	replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]');
	replace(/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '[redacted-access-key]');
	replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+|sk_(?:live|test)_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+)\b/g, '[redacted-token]');

	const sensitiveLabel =
		'(?:[A-Za-z0-9]+[_-])*(?:password|passwd|secret|credential|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|jwt|session(?:[_-]?(?:id|jti))?|email|owner[_-]?id|user[_-]?id|share[_-]?id|document[_-]?id|target[_-]?id|app[_-]?id|client[_-]?id)';
	replace(new RegExp(`(["']?${sensitiveLabel}["']?\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}\\]]+)`, 'gi'), '$1[redacted]');
	replace(new RegExp(`([?&]${sensitiveLabel}=)[^&#\\s]+`, 'gi'), '$1[redacted]');
	replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]');
	replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-uuid]');
	replace(/\b[0-9a-f]{24}\b/gi, '[redacted-object-id]');
	replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1[redacted-user]');
	return redacted;
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

export const captureAdminErrorDiagnostic = (error: unknown): AdminErrorDiagnostic => {
	try {
		const state: CaptureState = { redactions: 0, truncated: false };
		const snapshot = errorSnapshot(error, state);
		let detail = JSON.stringify(snapshot, null, 2);
		if (detail.length > MAX_ADMIN_DIAGNOSTIC_CHARS) {
			state.truncated = true;
			const suffix = '\n…[diagnostic truncated]';
			detail = `${detail.slice(0, MAX_ADMIN_DIAGNOSTIC_CHARS - suffix.length)}${suffix}`;
		}
		return { detail, redactions: state.redactions, truncated: state.truncated };
	} catch {
		return {
			detail: JSON.stringify({ name: 'UnserializableError', message: 'The thrown value could not be captured safely.' }, null, 2),
			redactions: 0,
			truncated: true
		};
	}
};
