import { json, readJsonBody } from '~/api/http';
import { inspectAdminCredentialImport } from '~/api/utils/admin/integrations';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { CREDENTIAL_IMPORT_BSON_LIMIT, CredentialImportError, isImportObject, validateImportOrigin } from '~/api/utils/credentials/importCore';
import {
	browserCredentialImport,
	credentialImportStatus,
	directCredentialImport,
	importBrowserActor,
	startCredentialImport,
	uploadCredentialImport
} from '~/api/utils/credentials/importService';
import { getDeploymentDataEnvironment } from '~/api/utils/deployment/dataEnvironment';
import { enforceFixedRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { CREDENTIAL_IMPORT_HEADERS, type CredentialImportOperation } from '~/credentials/importContract';

const rawType = 'application/octet-stream';
const jsonType = 'application/json';
const mediaType = (request: Request) => request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
// Status accepts a 36-character UUID and a 43-character verifier only. One
// KiB covers both keys and values even with six-byte JSON escapes for every
// character (576 bytes), plus punctuation and formatting. This bound never
// applies to targets/labels or credential bytes.
const statusMetadataBytes = 1024;
const metadata = async (request: Request, fields: readonly string[], maxBytes = CREDENTIAL_IMPORT_BSON_LIMIT) => {
	// Credential bytes use a separate media type and never enter this parser.
	if (mediaType(request) !== jsonType) throw new CredentialImportError('content_type');
	const parsed: unknown = await readJsonBody(request, maxBytes);
	if (!isImportObject(parsed) || Object.keys(parsed).some(key => !fields.includes(key))) throw new CredentialImportError('invalid_request');
	return parsed;
};
const targetHeader = (request: Request): unknown => {
	const header = request.headers.get(CREDENTIAL_IMPORT_HEADERS.target);
	if (!header || !/^[A-Za-z0-9_-]+$/.test(header)) throw new CredentialImportError('invalid_target');
	try {
		const bytes = Buffer.from(header, 'base64url');
		if (bytes.toString('base64url') !== header) throw new Error();
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new CredentialImportError('invalid_target');
	}
};

const limit = async (request: Request, action: string, identity: string | null, limit: number, cost = 1) => {
	const outcome = await enforceFixedRateLimit(request, `credential-import:${action}`, identity, { limit, windowMs: 60_000, cost });
	if (outcome.allowed) return null;
	const error = new CredentialImportError(outcome.unavailable ? 'unavailable' : 'rate_limited');
	return json({ ok: false, code: error.code, error: error.message }, { ...rateLimitedResponseInit(outcome), status: error.status });
};
const success = (result: object) => json({ ok: true, ...result });
const failure = (error: CredentialImportError) => json({ ok: false, code: error.code, error: error.message }, {
	status: error.status,
	...(error.code === 'method_not_allowed' ? { headers: { Allow: 'POST' } } : {})
});

export const credentialImportAction = (operation: CredentialImportOperation) => ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		try {
			if (request.method !== 'POST') throw new CredentialImportError('method_not_allowed');
			if (new URL(request.url).search) throw new CredentialImportError('invalid_request');
			const origin = resolvePublicOrigin(request).origin;
			const environment = getDeploymentDataEnvironment()?.id;
			validateImportOrigin(origin, environment);
			const context = { origin, environment: environment! };
			if (request.headers.get('Origin') !== null && request.headers.get('Origin') !== origin) throw new CredentialImportError('origin_mismatch');

			const browser = operation === 'direct' || operation === 'inspect' || operation === 'approve' || operation === 'revoke';
			if (browser) {
				const actor = await importBrowserActor(request, origin);
				const limited = await limit(request, 'browser', actor.accountId, 60);
				if (limited) return limited;
				if (operation !== 'direct') {
					const fields = await metadata(request, operation === 'inspect' ? ['requestId', 'label'] : ['requestId']);
					if (operation === 'inspect' && Object.prototype.hasOwnProperty.call(fields, 'label')) {
						if (Object.prototype.hasOwnProperty.call(fields, 'requestId')) throw new CredentialImportError('invalid_request');
						return success({ secret: await inspectAdminCredentialImport(fields.label) });
					}
					return success({ intent: await browserCredentialImport(operation, context, actor, fields.requestId) });
				}
				if (mediaType(request) !== rawType) throw new CredentialImportError('content_type');
				return success({ receipt: await directCredentialImport(context, actor, targetHeader(request), async () => new Uint8Array(await request.arrayBuffer())) });
			}

			if (operation === 'start') {
				const limited = await limit(request, 'start', null, 12);
				if (limited) return limited;
				const globallyLimited = await limit(request, 'start', 'all-origins', 100);
				if (globallyLimited) return globallyLimited;
				const body = await metadata(request, ['requestId', 'expectedAccountId', 'challenge', 'target']);
				// Separate aggregate byte budget bounds anonymously retained data;
				// valid large metadata can proceed after budget replenishes.
				const cost = Math.ceil(Buffer.byteLength(JSON.stringify(body), 'utf8') / (256 * 1024));
				const storageLimited = await limit(request, 'pending-bytes', 'all-origins', 100, cost);
				if (storageLimited) return storageLimited;
				return success(await startCredentialImport(context, body));
			}
			const limited = await limit(request, operation, null, operation === 'status' ? 90 : 12);
			if (limited) return limited;
			if (operation === 'status') {
				const { requestId, verifier } = await metadata(request, ['requestId', 'verifier'], statusMetadataBytes);
				return success(await credentialImportStatus(context, requestId, verifier));
			}
			if (mediaType(request) !== rawType) throw new CredentialImportError('content_type');
			return success({ receipt: await uploadCredentialImport(
				context, request.headers.get(CREDENTIAL_IMPORT_HEADERS.request), request.headers.get(CREDENTIAL_IMPORT_HEADERS.verifier),
				async () => new Uint8Array(await request.arrayBuffer())
			) });
		} catch (error) {
			// Neither parser/Mongo error objects nor request headers/bodies are
			// forwarded to the application error log or the browser.
			if (error instanceof CredentialImportError) return failure(error);
			if (error instanceof Response && error.status === 413) {
				if (operation === 'status') {
					return json({ ok: false, code: 'too_large', error: 'The status control message exceeds 1 KiB.' }, { status: 413 });
				}
				return failure(new CredentialImportError('too_large'));
			}
			return failure(new CredentialImportError('unavailable'));
		}
	});
