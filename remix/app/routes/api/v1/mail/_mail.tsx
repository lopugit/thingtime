import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { internalRequestActor } from '~/api/utils/auth/internalRequestActor';
import { resolvePublicOrigin } from '~/api/utils/auth/publicOrigin';
import { withVaultRequest } from '~/api/utils/auth/vaultRequest';
import { ownerVaultConfigured } from '~/api/utils/auth/vaultCipher';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { StorageMutationError } from '~/api/utils/storage/storageCore';
import {
	listMail,
	saveMailAccount,
	saveMailInbox,
	deleteMailRecord,
	syncMailAccount,
	googleMailAction,
	googleMailDrafts
} from '~/api/utils/mail/store';
import { MailActionError, MailError, validateMailAccount } from '~/mail/model';
import { googleMailOAuth } from '~/api/utils/mail/googleOAuth';
import { fetchMailBatch } from '~/api/utils/mail/provider';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization', 'Referrer-Policy': 'no-referrer' };
const defaults = {
	getCurrentUser,
	getAuthToken,
	ownerVaultConfigured,
	enforceRateLimit,
	listMail,
	saveMailAccount,
	saveMailInbox,
	deleteMailRecord,
	syncMailAccount,
	fetchMailBatch,
	googleMailOAuth,
	googleMailAction,
	googleMailDrafts
};
export function createMailHandler(overrides: Partial<typeof defaults> = {}, relayOnly = false) {
	const deps = { ...defaults, ...overrides };
	return async ({ request }: { request: Request }) =>
		withVaultRequest(request, async () => {
			const token = internalRequestActor(request) ? null : await deps.getAuthToken(request);
			const user = token ? await deps.getCurrentUser(request) : null;
			if (!user || user.temporary || user.accountKind === 'service')
				return json({ ok: false, error: 'Sign in to your Thingtime account.' }, { status: 401, headers });
			if (!(relayOnly ? ['POST'] : ['GET', 'POST']).includes(request.method))
				return json({ ok: false, error: 'Method not allowed.' }, { status: 405, headers: { ...headers, Allow: relayOnly ? 'POST' : 'GET, POST' } });
			const limit = await deps.enforceRateLimit(request, request.method === 'GET' ? 'mail.read' : 'mail.write', `user:${user.id}`, {
				failClosed: true
			});
			if (!limit.allowed) {
				const init = rateLimitedResponseInit(limit),
					privateHeaders = new Headers(init.headers);
				Object.entries(headers).forEach(([key, value]) => privateHeaders.set(key, value));
				return json({ ok: false, error: 'Please wait before trying again.' }, { ...init, headers: privateHeaders });
			}
			try {
				const url = new URL(request.url);
				if (url.searchParams.get('expectedOwnerId') !== user.id) throw new MailError(409, 'Your active account changed. Reopen Mail.');
				if (request.method === 'GET') {
					const page = await deps.listMail(user.id, url.searchParams.get('kind') || 'mail-account', url.searchParams.get('cursor'));
					if ((await deps.getCurrentUser(request))?.id !== user.id) throw new MailError(401, 'Your session ended.');
					return json(
						{
							ok: true,
							ownerId: user.id,
							configured: deps.ownerVaultConfigured(),
							...page
						},
						{ headers }
					);
				}
				const origin = request.headers.get('Origin');
				if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== resolvePublicOrigin(request).origin))
					throw new MailError(403, 'Use the same Thingtime origin.');
				if (requireJsonContentType(request)) throw new MailError(415, 'Use application/json.');
				const body = await readJsonBody(request, 64 * 1024);
				if (body?.expectedOwnerId !== user.id) throw new MailError(409, 'Your active account changed. Reopen Mail.');
				if (relayOnly) {
					if (body.operation !== 'relay') throw new MailError(400, 'Use the relay operation.');
					const account = validateMailAccount(body.account);
					if (!account.sync.local || account.sync.transport !== 'relay')
						throw new MailError(403, 'Choose Thingtime API relay in this account’s device sync settings.');
					const budget = await deps.enforceRateLimit(request, 'mail.sync', `user:${user.id}`, { failClosed: true });
					if (!budget.allowed) throw new MailError(429, 'Please wait before syncing again.');
					const batch = await deps.fetchMailBatch(
						account,
						{ protocol: body.protocol, path: body.path, cursor: body.cursor, discover: body.discover === true },
						request.signal
					);
					if ((await deps.getCurrentUser(request))?.id !== user.id) throw new MailError(401, 'Your session ended.');
					return json({ ok: true, ownerId: user.id, version: 1, ...batch }, { headers });
				}
				if (typeof body.operation === 'string' && body.operation.startsWith('google-')) await deps.googleMailOAuth.authorize(user.id, token!);
				if (!deps.ownerVaultConfigured()) throw new MailError(503, 'Cloud mail encryption is not configured on this deployment.');
				let result: object;
				switch (body.operation) {
					case 'google-begin':
					case 'google-status':
					case 'google-finish':
					case 'google-cancel':
						result = await deps.googleMailOAuth.operate(user.id, token!, request, body);
						break;
					case 'save-account':
						result = { account: await deps.saveMailAccount(user.id, body) };
						break;
					case 'save-inbox':
						result = { inbox: await deps.saveMailInbox(user.id, body) };
						break;
					case 'delete':
						await deps.deleteMailRecord(user.id, body.kind, body.id, body.revision);
						result = {};
						break;
					case 'google-action':
					case 'google-drafts': {
						const budget = await deps.enforceRateLimit(request, 'mail.sync', `user:${user.id}`, { failClosed: true });
						if (!budget.allowed) throw new MailError(429, 'Please wait before trying another Gmail action.');
						result =
							body.operation === 'google-action'
								? await deps.googleMailAction(user.id, body, request.signal)
								: await deps.googleMailDrafts(user.id, body, request.signal);
						break;
					}
					case 'google-relay':
					case 'sync': {
						const budget = await deps.enforceRateLimit(request, 'mail.sync', `user:${user.id}`, { failClosed: true });
						if (!budget.allowed) throw new MailError(429, 'Please wait before syncing again.');
						result = await deps.syncMailAccount(
							user.id,
							body.id,
							{ protocol: body.protocol, path: body.path, cursor: body.cursor, discover: body.discover === true },
							request.signal,
							undefined,
							body.operation === 'google-relay'
						);
						break;
					}
					default:
						throw new MailError(400, 'Unknown mail operation.');
				}
				if ((await deps.getCurrentUser(request))?.id !== user.id) throw new MailError(401, 'Your session ended.');
				return json({ ok: true, ownerId: user.id, ...result }, { headers });
			} catch (error) {
				if (error instanceof MailError || error instanceof StorageMutationError)
					return json(
						{ ok: false, error: error.message, ...(error instanceof MailActionError ? { actionOutcome: error.actionOutcome } : {}) },
						{ status: error.status, headers }
					);
				if (error instanceof Response) return json({ ok: false, error: 'Invalid request body.' }, { status: error.status, headers });
				if ((error as any)?.code === 11000)
					return json({ ok: false, error: 'Mail changed while saving. Retry the same save.' }, { status: 409, headers });
				// Provider exceptions can include server commands, addresses or passwords.
				// Never forward/log the exception or request body.
				return json(
					{ ok: false, error: 'Mail is unavailable. Check the server, app password and encryption setup, then retry.' },
					{ status: 503, headers }
				);
			}
		});
}
export const loader = createMailHandler();
export const action = loader;
