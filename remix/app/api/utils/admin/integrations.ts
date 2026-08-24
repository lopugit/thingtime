import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
	ADMIN_INTEGRATION_MAX_REQUEST_BYTES,
	ADMIN_INTEGRATION_MAX_RESPONSE_BYTES,
	ADMIN_INTEGRATION_SCHEMA_VERSION,
	methodForOperation,
	normalizeEndpointInput,
	normalizeProxyHeaders,
	operationAllowed,
	publicEndpoint,
	redactSensitiveValue,
	resolveEndpointPath,
	type EndpointInput,
	type ProxyOperation,
	type StoredAdminIntegrationEndpoint,
	vercelCreateOnlyIdentity
} from './integrationCore';
import {
	getAdminIntegrationAuditCollection,
	getAdminIntegrationClaimsCollection,
	getAdminIntegrationEndpointsCollection,
	getAdminIntegrationSecretsCollection
} from '../mongodb/collections';
import { enforceRateLimit, rateLimitedResponseInit } from '../rateLimit/enforce';

const VAULT_AAD_PREFIX = 'thingtime-admin-vault:v1:';
const AUDIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const SECRET_LABEL_MAX = 120;

export type PublicAdminSecret = {
	id: string;
	label: string;
	createdAt: string;
	updatedAt: string;
	createdBy: string;
};

type StoredAdminSecret = {
	id: string;
	label: string;
	cipherText: string;
	iv: string;
	tag: string;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
	schemaVersion: number;
};

type ProxyResult = {
	status: number;
	body: unknown;
	requestId: string | null;
};

const opaqueId = (prefix: string) => `${prefix}_${randomBytes(18).toString('base64url')}`;
const boundedText = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null);

const vaultKey = (): Buffer | null => {
	const source = process.env.THINGTIME_ADMIN_VAULT_KEY?.trim();
	if (!source) return null;
	try {
		const decoded = Buffer.from(source, 'base64url');
		return decoded.byteLength === 32 ? decoded : null;
	} catch {
		return null;
	}
};

export const vaultConfigured = () => vaultKey() !== null;

const encryptSecret = (id: string, value: string) => {
	const key = vaultKey();
	if (!key) throw new Error('Secret vault is unavailable. Configure THINGTIME_ADMIN_VAULT_KEY with a 32-byte base64url key.');
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(`${VAULT_AAD_PREFIX}${id}`));
	const cipherText = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	return { cipherText: cipherText.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
};

const decryptSecret = (record: StoredAdminSecret) => {
	const key = vaultKey();
	if (!key) throw new Error('Secret vault is unavailable.');
	try {
		const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64url'));
		cipher.setAAD(Buffer.from(`${VAULT_AAD_PREFIX}${record.id}`));
		cipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
		return Buffer.concat([cipher.update(Buffer.from(record.cipherText, 'base64url')), cipher.final()]).toString('utf8');
	} catch {
		throw new Error('Stored secret cannot be decrypted with the configured vault key.');
	}
};

const publicSecret = (record: StoredAdminSecret): PublicAdminSecret => ({
	id: record.id,
	label: record.label,
	createdAt: new Date(record.createdAt).toISOString(),
	updatedAt: new Date(record.updatedAt).toISOString(),
	createdBy: record.createdBy
});

const readBoundedJson = async (response: Response): Promise<unknown> => {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		length += value.byteLength;
		if (length > ADMIN_INTEGRATION_MAX_RESPONSE_BYTES) {
			await reader.cancel().catch(() => {});
			throw new Error('Upstream response exceeded the proxy limit.');
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const text = new TextDecoder().decode(merged);
	if (!text) return null;
	// A generic text/binary response could echo a credential. The proxy is a
	// JSON control-plane adapter, not a download tunnel, so omit non-JSON data
	// instead of trying to redact an unstructured blob.
	if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) return '[omitted non-JSON upstream response]';
	try {
		return redactSensitiveValue(JSON.parse(text));
	} catch {
		return '[omitted malformed JSON upstream response]';
	}
};

const redactUpstreamHeaders = (response: Response) => {
	const requestId = response.headers.get('x-vercel-id') || response.headers.get('x-request-id');
	return requestId && requestId.length <= 240 ? requestId : null;
};

const fetchUpstream = async (url: URL, init: RequestInit): Promise<ProxyResult> => {
	let response: Response;
	try {
		response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch {
		throw new Error('Upstream request could not be completed.');
	}
	const body = await readBoundedJson(response);
	return { status: response.status, body, requestId: redactUpstreamHeaders(response) };
};

const assertVercelEnvAbsent = async (url: URL, secret: string, identity: NonNullable<ReturnType<typeof vercelCreateOnlyIdentity>>) => {
	const listing = new URL(`/v9/projects/${encodeURIComponent(identity.project)}/env`, url.origin);
	// `teamId` / `slug` are Vercel's public project-scoping query options. The
	// proxy never accepts a full upstream URL, so these remain bounded here.
	for (const key of ['teamId', 'slug']) {
		const value = url.searchParams.get(key);
		if (value) listing.searchParams.set(key, value);
	}
	const result = await fetchUpstream(listing, { method: 'GET', headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' } });
	if (result.status < 200 || result.status >= 300) throw new Error(`Vercel existence check failed (${result.status}).`);
	const envs = result.body && typeof result.body === 'object' && Array.isArray((result.body as any).envs) ? (result.body as any).envs : [];
	const exists = envs.some((item: any) => {
		if (!item || item.key !== identity.key) return false;
		const target = Array.isArray(item.target) ? item.target : typeof item.target === 'string' ? [item.target] : [];
		return target.some((entry: string) => identity.targets.includes(entry));
	});
	if (exists) throw new Error('Create-only policy blocked this request because that Vercel environment variable already exists.');
};

const audit = async (input: {
	endpointId: string;
	actorId: string;
	operation: ProxyOperation;
	path: string;
	status: number;
	resourceKey?: string | null;
	outcome: 'allowed' | 'blocked' | 'failed';
}) => {
	const now = new Date();
	await (
		await getAdminIntegrationAuditCollection()
	).insertOne({
		id: opaqueId('audit'),
		endpointId: input.endpointId,
		actorId: input.actorId,
		operation: input.operation,
		path: input.path,
		status: input.status,
		resourceKey: input.resourceKey ?? null,
		outcome: input.outcome,
		createdAt: now,
		expiresAt: new Date(now.getTime() + AUDIT_TTL_MS),
		schemaVersion: ADMIN_INTEGRATION_SCHEMA_VERSION
	});
};

const claimCreate = async (endpointId: string, resourceKey: string) => {
	const now = new Date();
	try {
		await (
			await getAdminIntegrationClaimsCollection()
		).insertOne({
			endpointId,
			resourceKey,
			createdAt: now,
			expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
			schemaVersion: ADMIN_INTEGRATION_SCHEMA_VERSION
		});
		return true;
	} catch (error: any) {
		if (error?.code === 11000) return false;
		throw error;
	}
};

const releaseCreate = async (endpointId: string, resourceKey: string) => {
	await (await getAdminIntegrationClaimsCollection()).deleteOne({ endpointId, resourceKey });
};

export const listAdminIntegrations = async () => {
	const [secrets, endpoints, auditRows] = await Promise.all([
		(
			await getAdminIntegrationSecretsCollection()
		)
			.find({}, { projection: { cipherText: 0, iv: 0, tag: 0 } })
			.sort({ label: 1 })
			.limit(200)
			.toArray(),
		(await getAdminIntegrationEndpointsCollection()).find({}).sort({ label: 1 }).limit(200).toArray(),
		(await getAdminIntegrationAuditCollection()).find({}).sort({ createdAt: -1 }).limit(50).toArray()
	]);
	return {
		vaultConfigured: vaultConfigured(),
		secrets: secrets.map((record: StoredAdminSecret) => publicSecret(record)),
		endpoints: endpoints.map((record: StoredAdminIntegrationEndpoint) => publicEndpoint(record)),
		audit: auditRows.map((row: any) => ({
			id: String(row.id),
			endpointId: String(row.endpointId),
			operation: row.operation,
			path: String(row.path),
			status: Number(row.status),
			outcome: row.outcome,
			createdAt: new Date(row.createdAt).toISOString()
		}))
	};
};

export const createAdminSecret = async (input: { label?: unknown; value?: unknown }, actorId: string) => {
	const label = boundedText(input.label, SECRET_LABEL_MAX);
	const value =
		typeof input.value === 'string' && input.value.length > 0 && input.value.length <= ADMIN_INTEGRATION_MAX_REQUEST_BYTES ? input.value : null;
	if (!label || !value) throw new Error('Secret label and a non-empty value are required.');
	const id = opaqueId('secret');
	const encrypted = encryptSecret(id, value);
	const now = new Date();
	const record: StoredAdminSecret = {
		id,
		label,
		...encrypted,
		createdAt: now,
		updatedAt: now,
		createdBy: actorId,
		schemaVersion: ADMIN_INTEGRATION_SCHEMA_VERSION
	};
	await (await getAdminIntegrationSecretsCollection()).insertOne(record);
	return publicSecret(record);
};

export const deleteAdminSecret = async (id: unknown) => {
	const secretId = boundedText(id, 96);
	if (!secretId) throw new Error('Secret id is required.');
	const referenced = await (await getAdminIntegrationEndpointsCollection()).findOne({ secretId }, { projection: { id: 1 } });
	if (referenced) throw new Error('Detach this secret from its endpoint before deleting it.');
	await (await getAdminIntegrationSecretsCollection()).deleteOne({ id: secretId });
};

export const saveAdminEndpoint = async (input: EndpointInput & { id?: unknown }, actorId: string) => {
	const normalized = normalizeEndpointInput(input);
	if (!normalized) throw new Error('Endpoint policy is invalid or not safely supported.');
	const secret = await (await getAdminIntegrationSecretsCollection()).findOne({ id: normalized.secretId }, { projection: { id: 1 } });
	if (!secret) throw new Error('Select a stored write-only secret for this endpoint.');
	const suppliedId = boundedText(input.id, 96);
	const endpoints = await getAdminIntegrationEndpointsCollection();
	const now = new Date();
	if (suppliedId) {
		const previous = await endpoints.findOne({ id: suppliedId });
		if (!previous) throw new Error('Endpoint was not found.');
		await endpoints.updateOne({ id: suppliedId }, { $set: { ...normalized, updatedAt: now } });
		return publicEndpoint({ ...previous, ...normalized, updatedAt: now });
	}
	const record: StoredAdminIntegrationEndpoint = {
		id: opaqueId('endpoint'),
		...normalized,
		createdAt: now,
		updatedAt: now,
		createdBy: actorId,
		schemaVersion: ADMIN_INTEGRATION_SCHEMA_VERSION
	};
	await endpoints.insertOne(record);
	return publicEndpoint(record);
};

export const deleteAdminEndpoint = async (id: unknown) => {
	const endpointId = boundedText(id, 96);
	if (!endpointId) throw new Error('Endpoint id is required.');
	await (await getAdminIntegrationEndpointsCollection()).deleteOne({ id: endpointId });
};

export const proxyAdminIntegration = async (
	request: Request,
	actorId: string,
	input: { endpointId?: unknown; operation?: unknown; path?: unknown; query?: unknown; body?: unknown; headers?: unknown }
) => {
	const endpointId = boundedText(input.endpointId, 96);
	const operation = input.operation === 'read' || input.operation === 'create' || input.operation === 'write' ? input.operation : null;
	if (!endpointId || !operation) throw new Error('Endpoint and operation are required.');
	const limit = await enforceRateLimit(request, 'admin.integrations', `admin:${actorId}`, { failClosed: true });
	if (!limit.allowed) return { ok: false as const, error: 'Integration proxy is rate limited.', init: rateLimitedResponseInit(limit) };
	const endpoint = (await getAdminIntegrationEndpointsCollection()).findOne({ id: endpointId }) as Promise<StoredAdminIntegrationEndpoint | null>;
	const resolvedEndpoint = await endpoint;
	if (!resolvedEndpoint || !operationAllowed(resolvedEndpoint, operation)) throw new Error('This endpoint policy does not allow that operation.');
	const url = resolveEndpointPath(resolvedEndpoint, input.path, input.query);
	const callerHeaders = normalizeProxyHeaders(input.headers);
	if (!url || !callerHeaders) throw new Error('Proxy path, query, or headers are not allowed by this endpoint policy.');
	if (operation !== 'read' && (!input.body || typeof input.body !== 'object' || Array.isArray(input.body)))
		throw new Error('Writes require a JSON object body.');
	const serialised = operation === 'read' ? '' : JSON.stringify(input.body);
	if (serialised.length > ADMIN_INTEGRATION_MAX_REQUEST_BYTES) throw new Error('Proxy request body is too large.');
	const secretRecord = (await (await getAdminIntegrationSecretsCollection()).findOne({ id: resolvedEndpoint.secretId })) as StoredAdminSecret | null;
	if (!secretRecord) throw new Error('The endpoint secret no longer exists.');
	const secret = decryptSecret(secretRecord);
	let claim: { resourceKey: string } | null = null;
	try {
		if (operation === 'create' && resolvedEndpoint.writeMode === 'create-only') {
			if (resolvedEndpoint.provider !== 'vercel') throw new Error('Create-only is only available for the Vercel endpoint adapter.');
			const identity = vercelCreateOnlyIdentity(url, input.body);
			if (!identity) throw new Error('Create-only Vercel writes must create one project environment variable with key, value, and standard target.');
			if (!(await claimCreate(resolvedEndpoint.id, identity.resourceKey)))
				throw new Error('A create-only request for this environment variable is already in progress.');
			claim = { resourceKey: identity.resourceKey };
			await assertVercelEnvAbsent(url, secret, identity);
		}
		const result = await fetchUpstream(url, {
			method: methodForOperation(operation),
			headers: {
				Authorization: `Bearer ${secret}`,
				Accept: 'application/json',
				...(operation === 'read' ? {} : { 'Content-Type': 'application/json' }),
				...callerHeaders
			},
			...(operation === 'read' ? {} : { body: serialised })
		});
		await audit({
			endpointId: resolvedEndpoint.id,
			actorId,
			operation,
			path: url.pathname,
			status: result.status,
			resourceKey: claim?.resourceKey,
			outcome: result.status >= 200 && result.status < 300 ? 'allowed' : 'failed'
		});
		return { ok: true as const, result };
	} catch (error) {
		await audit({
			endpointId: resolvedEndpoint.id,
			actorId,
			operation,
			path: url.pathname,
			status: 409,
			resourceKey: claim?.resourceKey,
			outcome: 'blocked'
		}).catch(() => {});
		throw error;
	} finally {
		if (claim) await releaseCreate(resolvedEndpoint.id, claim.resourceKey).catch(() => {});
	}
};
