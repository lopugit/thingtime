import { isIP } from 'node:net';

export const ADMIN_INTEGRATION_SCHEMA_VERSION = 1;
export const ADMIN_INTEGRATION_MAX_RESPONSE_BYTES = 64 * 1024;
export const ADMIN_INTEGRATION_MAX_REQUEST_BYTES = 32 * 1024;

export type EndpointProvider = 'vercel' | 'generic';
export type EndpointWriteMode = 'none' | 'create-only' | 'write';
export type ProxyOperation = 'read' | 'create' | 'write';

export type StoredAdminIntegrationEndpoint = {
	id: string;
	label: string;
	provider: EndpointProvider;
	origin: string;
	secretId: string;
	allowedPathPrefixes: string[];
	allowRead: boolean;
	writeMode: EndpointWriteMode;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
	schemaVersion: number;
};

export type PublicAdminIntegrationEndpoint = Omit<StoredAdminIntegrationEndpoint, 'createdAt' | 'updatedAt' | 'schemaVersion'> & {
	createdAt: string;
	updatedAt: string;
};

export type EndpointInput = {
	label?: unknown;
	provider?: unknown;
	origin?: unknown;
	secretId?: unknown;
	allowedPathPrefixes?: unknown;
	allowRead?: unknown;
	writeMode?: unknown;
};

const TEXT_MAX = 120;
const SECRET_ID = /^[A-Za-z0-9_-]{16,96}$/;
const PATH_PREFIX = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/;
const FORBIDDEN_HEADER = /^(authorization|cookie|host|connection|content-length|x-forwarded-|proxy-|sec-)/i;
const SECRET_FIELD = /(authorization|credential|cookie|pass(word)?|private.?key|secret|token|api.?key|^key$|^value$)/i;

const asText = (value: unknown, max = TEXT_MAX): string | null => {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text && text.length <= max ? text : null;
};

const isUnsafeHostname = (hostname: string) => {
	const host = hostname.toLowerCase();
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		isIP(host) !== 0 ||
		host === 'metadata.google.internal'
	);
};

const configuredGenericHosts = () =>
	new Set(
		(process.env.THINGTIME_ADMIN_PROXY_ALLOWED_HOSTS || '')
			.split(',')
			.map((value) => value.trim().toLowerCase())
			.filter(Boolean)
	);

export const normalizeIntegrationOrigin = (value: unknown, provider: EndpointProvider): string | null => {
	if (typeof value !== 'string' || value.length > 2048) return null;
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
		if (isUnsafeHostname(url.hostname)) return null;
		if (provider === 'vercel') return url.origin === 'https://api.vercel.com' ? url.origin : null;
		return configuredGenericHosts().has(url.hostname.toLowerCase()) ? url.origin : null;
	} catch {
		return null;
	}
};

export const normalizePathPrefixes = (value: unknown): string[] | null => {
	if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
	const unique = new Set<string>();
	for (const item of value) {
		const prefix = asText(item, 240);
		if (!prefix || !PATH_PREFIX.test(prefix) || prefix.includes('..') || prefix.includes('//') || prefix.includes('?') || prefix.includes('#'))
			return null;
		unique.add(prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
	}
	return [...unique].sort();
};

export const normalizeEndpointInput = (
	input: EndpointInput
): Omit<StoredAdminIntegrationEndpoint, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'schemaVersion'> | null => {
	const label = asText(input.label);
	const provider = input.provider === 'vercel' || input.provider === 'generic' ? input.provider : null;
	const secretId = asText(input.secretId, 96);
	const writeMode = input.writeMode === 'none' || input.writeMode === 'create-only' || input.writeMode === 'write' ? input.writeMode : null;
	if (!label || !provider || !secretId || !SECRET_ID.test(secretId) || !writeMode) return null;
	const origin = normalizeIntegrationOrigin(input.origin, provider);
	const allowedPathPrefixes = normalizePathPrefixes(input.allowedPathPrefixes);
	if (!origin || !allowedPathPrefixes) return null;
	const allowRead = input.allowRead === true;
	// A generic upstream cannot be made safely create-only without a
	// provider-specific existence API and conditional create semantics. Refuse
	// the misleading configuration rather than silently emulating an upsert.
	if (provider === 'generic' && writeMode === 'create-only') return null;
	if (!allowRead && writeMode === 'none') return null;
	return { label, provider, origin, secretId, allowedPathPrefixes, allowRead, writeMode };
};

export const publicEndpoint = (record: StoredAdminIntegrationEndpoint): PublicAdminIntegrationEndpoint => ({
	id: record.id,
	label: record.label,
	provider: record.provider,
	origin: record.origin,
	secretId: record.secretId,
	allowedPathPrefixes: [...record.allowedPathPrefixes],
	allowRead: record.allowRead,
	writeMode: record.writeMode,
	createdBy: record.createdBy,
	createdAt: new Date(record.createdAt).toISOString(),
	updatedAt: new Date(record.updatedAt).toISOString()
});

export const operationAllowed = (endpoint: Pick<StoredAdminIntegrationEndpoint, 'allowRead' | 'writeMode'>, operation: ProxyOperation): boolean => {
	if (operation === 'read') return endpoint.allowRead;
	if (operation === 'create') return endpoint.writeMode === 'create-only' || endpoint.writeMode === 'write';
	return endpoint.writeMode === 'write';
};

export const methodForOperation = (operation: ProxyOperation): 'GET' | 'POST' | 'PATCH' => {
	if (operation === 'read') return 'GET';
	return operation === 'create' ? 'POST' : 'PATCH';
};

export const resolveEndpointPath = (
	endpoint: Pick<StoredAdminIntegrationEndpoint, 'origin' | 'allowedPathPrefixes'>,
	path: unknown,
	query?: unknown
): URL | null => {
	const text = asText(path, 512);
	if (
		!text ||
		!text.startsWith('/') ||
		text.includes('://') ||
		text.includes('..') ||
		text.includes('//') ||
		text.includes('?') ||
		text.includes('#')
	)
		return null;
	const allowed = endpoint.allowedPathPrefixes.some((prefix) => text === prefix || text.startsWith(`${prefix}/`));
	if (!allowed) return null;
	try {
		const url = new URL(text, endpoint.origin);
		if (url.origin !== endpoint.origin) return null;
		if (query !== undefined) {
			if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query as Record<string, unknown>).length > 16) return null;
			for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
				if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) return null;
				const stringValue = asText(value, 256);
				if (!stringValue) return null;
				url.searchParams.set(key, stringValue);
			}
		}
		return url;
	} catch {
		return null;
	}
};

const safeHeader = (value: unknown): string | null => {
	const text = asText(value, 512);
	return text && !/[\r\n]/.test(text) ? text : null;
};

export const normalizeProxyHeaders = (value: unknown): Record<string, string> | null => {
	if (value === undefined) return {};
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value as Record<string, unknown>).length > 8) return null;
	const headers: Record<string, string> = {};
	for (const [name, rawValue] of Object.entries(value as Record<string, unknown>)) {
		if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || FORBIDDEN_HEADER.test(name)) return null;
		// The proxy intentionally keeps caller headers tiny and non-sensitive.
		// Providers get authentication exclusively from the encrypted vault.
		const lower = name.toLowerCase();
		if (lower !== 'accept' && lower !== 'idempotency-key') return null;
		const headerValue = safeHeader(rawValue);
		if (!headerValue) return null;
		headers[name] = headerValue;
	}
	return headers;
};

export const redactSensitiveValue = (value: unknown, depth = 0): unknown => {
	if (depth > 12) return '[redacted: depth]';
	if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitiveValue(item, depth + 1));
	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
			result[key] = SECRET_FIELD.test(key) ? '[redacted]' : redactSensitiveValue(item, depth + 1);
		}
		return result;
	}
	if (typeof value === 'string') return value.length > 2048 ? `${value.slice(0, 2048)}…` : value;
	return value;
};

export const vercelCreateOnlyIdentity = (
	path: URL,
	body: unknown
): { project: string; key: string; targets: string[]; resourceKey: string } | null => {
	const match = path.pathname.match(/^\/v(?:9|10)\/projects\/([^/]+)\/env$/);
	if (!match || !body || typeof body !== 'object' || Array.isArray(body)) return null;
	const item = body as Record<string, unknown>;
	const key = asText(item.key, 256);
	const value = typeof item.value === 'string' && item.value.length <= 32 * 1024 ? item.value : null;
	const targets = Array.isArray(item.target) ? item.target : typeof item.target === 'string' ? [item.target] : [];
	const normalizedTargets = [
		...new Set(targets.filter((target): target is string => target === 'production' || target === 'preview' || target === 'development'))
	].sort();
	if (!key || value === null || !normalizedTargets.length || normalizedTargets.length !== targets.length) return null;
	const project = decodeURIComponent(match[1]);
	if (!project || project.length > 200) return null;
	return { project, key, targets: normalizedTargets, resourceKey: `${project}:${key}:${normalizedTargets.join(',')}` };
};
