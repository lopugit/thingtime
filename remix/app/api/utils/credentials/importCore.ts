import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
	CREDENTIAL_IMPORT_DESTINATIONS,
	GOOGLE_OAUTH_CREDENTIAL_LABEL,
	type CredentialImportTarget
} from '../../../credentials/importContract';
import { exactOAuthOrigin, oauthRedirectUri } from '../connections/oauthConfig';

// The actual MongoDB limit for a single BSON document, including its envelope.
export const CREDENTIAL_IMPORT_BSON_LIMIT = 16 * 1024 * 1024;

const errors = {
	invalid_request: [400, 'The credential import request is invalid.'],
	invalid_target: [400, 'Choose a valid credential format, destination, and overwrite option.'],
	invalid_credential: [400, 'The credential is empty, malformed, or incompatible with the selected format.'],
	redirect_mismatch: [400, 'The Google web client must register the exact callback for this Thingtime origin.'],
	unauthorized: [401, 'Sign in to the intended administrator account.'],
	origin_mismatch: [403, 'Open the import on the same configured Thingtime origin.'],
	admin_required: [403, 'A current administrator browser session is required.'],
	revoked: [403, 'Approval was withdrawn or its administrator session is no longer valid.'],
	not_found: [404, 'Credential import request was not found.'],
	method_not_allowed: [405, 'Use POST for this operation.'],
	actor_changed: [409, 'The active account changed. Switch to the intended administrator account.'],
	conflict: [409, 'The import or vault record changed. Review the current destination before trying again.'],
	pending: [409, 'Approve this import in Thingtime before sending the credential.'],
	expired: [410, 'This credential import expired. Start a new import.'],
	too_large: [413, 'The import cannot fit in its vault or authorization record.'],
	content_type: [415, 'Use the credential import content type for this operation.'],
	rate_limited: [429, 'Too many credential import requests. Try again shortly.'],
	unavailable: [503, 'Credential import is unavailable on this Thingtime origin.']
} as const;

export class CredentialImportError extends Error {
	readonly status: number;
	constructor(readonly code: keyof typeof errors) {
		super(errors[code][1]);
		this.status = errors[code][0];
	}
}

export const isImportObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
const only = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).every(key => fields.includes(key));
const accountId = /^[A-Za-z0-9_-]{1,128}$/;
const environmentId = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const requestId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const encodedProof = /^[A-Za-z0-9_-]{43}$/;

export const parseImportLabel = (value: unknown) => typeof value === 'string' && value.trim() && value === value.trim()
	&& !/[\p{Cc}\p{Cf}]/u.test(value) ? value : null;
export const parseImportAccountId = (value: unknown) => typeof value === 'string' && accountId.test(value) ? value : null;
export const parseImportRequestId = (value: unknown) => typeof value === 'string' && requestId.test(value) ? value : null;
export const parseImportProof = (value: unknown) => typeof value === 'string' && encodedProof.test(value)
	&& Buffer.from(value, 'base64url').toString('base64url') === value ? value : null;
export const challengeForImportVerifier = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
// Fingerprint equality only. The client verifier never enters the database,
// so a stored fingerprint cannot be used to test guesses of a low entropy secret.
export const fingerprintImportPayload = (verifier: string, bytes: Uint8Array) =>
	createHmac('sha256', Buffer.from(verifier, 'base64url')).update('thingtime-credential-import:v1\0').update(bytes).digest('base64url');

export const importProofMatches = (left: string, right: string) => {
	const a = Buffer.from(left), b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
};

export const validateImportOrigin = (origin: string, environment: string | undefined) => {
	if (!environment || !exactOAuthOrigin(origin)) throw new CredentialImportError('unavailable');
	if (environment === 'production' && new URL(origin).protocol !== 'https:') throw new CredentialImportError('origin_mismatch');
};

export const parseImportTarget = (input: unknown, origin: string, environment: string): CredentialImportTarget => {
	const invalid = () => new CredentialImportError('invalid_target');
	if (!isImportObject(input) || !only(input, ['destination', 'format', 'label', 'environment', 'callbackUrl', 'overwrite'])) throw invalid();
	const { destination, format, callbackUrl, overwrite } = input;
	const label = parseImportLabel(input.label);
	if (destination !== 'admin-provider-vault' || !CREDENTIAL_IMPORT_DESTINATIONS[destination].some(item => item === format)
		|| !label
		|| typeof input.environment !== 'string' || !environmentId.test(input.environment) || input.environment !== environment
		|| !isImportObject(overwrite)) throw invalid();
	if (format !== 'google-oauth' && format !== 'text' && format !== 'json') throw invalid();
	if (format === 'google-oauth') {
		if (label !== GOOGLE_OAUTH_CREDENTIAL_LABEL || !oauthRedirectUri(origin) || callbackUrl !== oauthRedirectUri(origin)) {
			throw new CredentialImportError('redirect_mismatch');
		}
	} else if (label === GOOGLE_OAUTH_CREDENTIAL_LABEL || callbackUrl !== undefined) {
		throw invalid();
	}

	const base: Omit<CredentialImportTarget, 'overwrite'> = { destination, format, label, environment, ...(typeof callbackUrl === 'string' ? { callbackUrl } : {}) };
	if (overwrite.mode === 'create' && only(overwrite, ['mode'])) return { ...base, overwrite: { mode: 'create' } };
	if (overwrite.mode !== 'replace' || !only(overwrite, ['mode', 'expectedId', 'expectedUpdatedAt'])
		|| typeof overwrite.expectedId !== 'string' || !/^secret_[A-Za-z0-9_-]{24}$/.test(overwrite.expectedId)
		|| typeof overwrite.expectedUpdatedAt !== 'string') throw invalid();
	const revision = new Date(overwrite.expectedUpdatedAt);
	if (!Number.isFinite(revision.getTime()) || revision.toISOString() !== overwrite.expectedUpdatedAt) throw invalid();
	return { ...base, overwrite: { mode: 'replace', expectedId: overwrite.expectedId, expectedUpdatedAt: overwrite.expectedUpdatedAt } };
};

type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string };
export type PreparedImport = { type: 'literal'; value: string } | { type: 'google'; client: GoogleClient };

export const prepareCredentialImport = (target: CredentialImportTarget, bytes: Uint8Array): PreparedImport => {
	const invalid = () => new CredentialImportError('invalid_credential');
	let raw: string;
	try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
	catch { throw invalid(); }
	if (!raw.trim()) throw invalid();
	if (target.format === 'text') return { type: 'literal', value: raw };

	let parsed: unknown;
	// Some downloaded JSON files include an encoding marker; literal imports
	// keep the bytes, while syntax validation ignores that leading marker.
	try { parsed = JSON.parse(raw.replace(/^\uFEFF/, '')); }
	catch { throw invalid(); }
	if (target.format === 'json') return { type: 'literal', value: raw };

	if (!isImportObject(parsed) || own(parsed, 'installed') !== undefined || !isImportObject(parsed.web)) throw invalid();
	const { client_id: clientId, client_secret: clientSecret, redirect_uris: redirects } = parsed.web;
	if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
		|| typeof clientSecret !== 'string' || !clientSecret || /[\s\p{Cc}\p{Cf}]/u.test(clientSecret) || !target.callbackUrl
		|| !Array.isArray(redirects) || !redirects.every(value => typeof value === 'string')) throw invalid();
	if (!redirects.includes(target.callbackUrl)) throw new CredentialImportError('redirect_mismatch');
	return { type: 'google', client: { clientId, clientSecret, redirectUri: target.callbackUrl } };
};

/** Preserve all untouched entries and refuse to replace a malformed existing bundle. */
export const mergeGoogleCredentialImport = (previous: string | null, environment: string, origin: string, client: GoogleClient): string => {
	const fail = () => new CredentialImportError('conflict');
	let bundle: unknown;
	try { bundle = previous === null ? { environments: {} } : JSON.parse(previous); } catch { throw fail(); }
	if (!isImportObject(bundle) || !isImportObject(bundle.environments)) throw fail();
	const oldScope = own(bundle.environments, environment);
	const scope = oldScope === undefined ? { origins: {} } : oldScope;
	if (!isImportObject(scope) || !isImportObject(scope.origins)) throw fail();
	return JSON.stringify({
		...bundle,
		environments: {
			...bundle.environments,
			[environment]: { ...scope, origins: { ...scope.origins, [origin]: client } }
		}
	});
};
