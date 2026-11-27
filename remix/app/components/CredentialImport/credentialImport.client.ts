import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { rootIdentity } from '~/utils/rootIdentity';

import {
	CREDENTIAL_IMPORT_API_PATH, CREDENTIAL_IMPORT_BASE_VERSION, CREDENTIAL_IMPORT_FEATURE, CREDENTIAL_IMPORT_HEADERS,
	type CredentialImportFormat, type CredentialImportTarget
} from '~/credentials/importContract';

type ImportScope = { origin: string; actor: string; generation: number };

const importFormatLabels: Record<CredentialImportFormat, string> = {
	'google-oauth': 'Google OAuth client',
	'oauth-client': 'Connections OAuth client',
	json: 'Provider JSON',
	text: 'Provider text'
};
export const importFormatLabel = (format: CredentialImportFormat) => importFormatLabels[format];

export class CredentialImportError extends Error {
	constructor(message: string, readonly status: number) { super(message); }
}

export const inCredentialFrame = () => typeof window !== 'undefined' && window.top !== window.self;

export async function credentialImportRequest<T>(
	scope: ImportScope, action: 'inspect' | 'approve' | 'revoke' | 'direct',
	body: BodyInit, headers: Record<string, string>, signal: AbortSignal
): Promise<T> {
	const assertCurrent = () => {
		signal.throwIfAborted();
		if (inCredentialFrame()) throw new Error('Open credential import in its own tab to continue.');
		if (window.location.origin !== scope.origin || rootIdentity.read().generation !== scope.generation || rootIdentity.read().pending) {
			throw new DOMException('The signed-in account changed.', 'AbortError');
		}
	};
	assertCurrent();
	try {
		await requireThingtimeCapability(CREDENTIAL_IMPORT_FEATURE, CREDENTIAL_IMPORT_BASE_VERSION, scope.origin, {
			fetch: globalThis.fetch, currentOrigin: () => window.location.origin, signal
		});
	} catch {
		assertCurrent();
		throw new Error('Credential import is unavailable on this Thingtime server. Retry to check again.');
	}
	assertCurrent();
	const response = await fetch(new URL(`${CREDENTIAL_IMPORT_API_PATH}/${action}`, scope.origin), {
		method: 'POST', body, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
		headers: { Accept: 'application/json', [CREDENTIAL_IMPORT_HEADERS.expectedActor]: scope.actor, ...headers },
		credentials: 'same-origin', cache: 'no-store', redirect: 'error'
	});
	const data = await response.json().catch(() => null);
	assertCurrent();
	if (!response.ok || data?.ok !== true) {
		// Never display arbitrary server text near credentials.
		const message: Record<number, string> = {
			400: 'Check the credential format, destination and callback, then try again.',
			401: 'Sign in again to continue.',
			403: 'This account cannot access the credential import.',
			404: 'This handoff request is unavailable for this account.',
			409: 'The destination or request changed. Refresh its metadata before retrying.',
			410: 'This handoff request expired. Ask the sender to start a new request.',
			413: 'This credential exceeds the server’s encrypted record or request capacity.',
			429: 'Too many credential import requests. Try again shortly.',
			422: 'The credential does not match the selected format or destination.'
		};
		throw new CredentialImportError(message[response.status] || 'Credential import could not be completed. Check its status before retrying.', response.status);
	}
	return data as T;
}

export function encodeImportTarget(target: CredentialImportTarget): string {
	const bytes = new TextEncoder().encode(JSON.stringify(target));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Validation only. The original bytes stay in the transient adapter. */
export function validateCredential(raw: string, format: CredentialImportFormat, callbackUrl?: string): string {
	if (!raw.trim()) return 'Choose a credential file or paste a value.';
	if (format === 'text') return '';
	let json;
	try {
		json = JSON.parse(raw.replace(/^\uFEFF/, ''));
	} catch {
		return 'Choose a valid JSON credential export.';
	}
	if (format !== 'google-oauth') return '';
	const web = json?.web;
	if (!web || !json || Object.prototype.hasOwnProperty.call(json, 'installed') || typeof web.client_id !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(web.client_id) ||
		typeof web.client_secret !== 'string' || !web.client_secret || /\s/.test(web.client_secret)) {
		return 'Choose a Google OAuth JSON export for a Web application.';
	}
	if (!Array.isArray(web.redirect_uris) || web.redirect_uris.some((uri: unknown) => typeof uri !== 'string') || !callbackUrl || !web.redirect_uris.includes(callbackUrl)) {
		return 'Register the displayed callback in Google and use an export that includes it.';
	}
	return '';
}
