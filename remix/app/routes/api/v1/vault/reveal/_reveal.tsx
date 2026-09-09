import { createHash } from 'node:crypto';
import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { revealAdminSecret } from '~/api/utils/admin/integrations';
import { getAuthToken } from '~/api/utils/auth/authCookie';
import { resolveTokenUser } from '~/api/utils/auth/getCurrentUser';
import { confirmCurrentPassword } from '~/api/utils/auth/passwordConfirmation';
import { deriveWebAuthnParams, finishVaultPasskeyVerification, startVaultPasskeyVerification } from '~/api/utils/auth/passkeys';
import { revealLopuCredential } from '~/api/utils/ciControl/credentialVault';
import { revealUserVaultValue } from '~/api/utils/lopu/userVault';
import { enforceFixedRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const defaults = {
	getAuthToken,
	resolveTokenUser,
	confirmCurrentPassword,
	startVaultPasskeyVerification,
	finishVaultPasskeyVerification,
	revealAdminSecret,
	revealLopuCredential,
	revealUserVaultValue,
	enforceFixedRateLimit
};
const fields = new Set(['vault', 'id', 'action', 'password', 'ticket', 'response']);
const deny = (status: number, error: string) => json({ ok: false, error }, { status });

// No bulk export or generic secure-field decoder. Read one selected saved
// external credential only after fresh verification, with live authorization.
export const createVaultRevealAction = (overrides: Partial<typeof defaults> = {}) => {
	const deps = { ...defaults, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAdminPrivateResponse(async () => {
			try {
				if (request.method !== 'POST') return deny(405, 'Method not allowed');
				if (request.headers.get('Origin') !== deriveWebAuthnParams(request).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')
					return deny(403, 'Same-origin verification is required');
				if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return deny(415, 'JSON is required');
				const token = await deps.getAuthToken(request);
				const account = token ? await deps.resolveTokenUser(token) : null;
				if (!account) return deny(401, 'Sign in again to verify your account');
				if (account.user.temporary) return deny(403, 'A full account is required');
				const body = await readJsonBody(request, 24 * 1024);
				if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !fields.has(key)))
					return deny(400, 'Invalid verification request');
				const { vault, id, action } = body;
				if (
					!['ci', 'admin', 'personal'].includes(vault) ||
					typeof id !== 'string' ||
					!/^[a-zA-Z0-9_-]{1,256}$/.test(id) ||
					!['options', 'reveal'].includes(action)
				)
					return deny(400, 'Invalid vault selection');
				if (vault !== 'personal' && !account.user.isAdmin) return deny(403, 'Admins only');
				const options = action === 'options';
				const limit = await deps.enforceFixedRateLimit(request, options ? 'auth.vaultRevealOptions' : 'auth.vaultReveal', `user:${account.user.id}`, {
					limit: options ? 10 : 5,
					windowMs: 15 * 60_000
				});
				if (!limit.allowed)
					return limit.unavailable
						? deny(503, 'Verification is temporarily unavailable')
						: json({ ok: false, error: 'Too many verification attempts. Try again later.' }, rateLimitedResponseInit(limit));
				const binding = createHash('sha256')
					.update(JSON.stringify([account.claims.jti, vault, id]))
					.digest('hex');
				if (options) {
					if (body.password !== undefined || body.ticket !== undefined || body.response !== undefined)
						return deny(400, 'Invalid verification request');
					const result = await deps.startVaultPasskeyVerification(request, account.user.id, binding);
					return json(result, { status: 'status' in result ? result.status : 200 });
				}
				let verified = false;
				if (typeof body.password === 'string' && body.ticket === undefined && body.response === undefined) {
					verified = (await deps.confirmCurrentPassword(account.user.id, body.password)) === 'confirmed';
				} else if (
					body.password === undefined &&
					typeof body.ticket === 'string' &&
					body.ticket.length < 8192 &&
					body.response &&
					typeof body.response === 'object'
				) {
					verified = await deps.finishVaultPasskeyVerification(request, account.user.id, binding, body.ticket, body.response);
				} else return deny(400, 'Choose one verification method');
				if (!verified) return deny(401, 'Verification failed. Use your current password or try your passkey again.');
				// Authentication may take time: repeat session/role checks before decrypting.
				const fresh = await deps.resolveTokenUser(token!);
				if (!fresh || fresh.user.id !== account.user.id || fresh.user.temporary || (vault !== 'personal' && !fresh.user.isAdmin))
					return deny(403, 'Your access changed. Sign in again.');
				const value =
					vault === 'ci'
						? await deps.revealLopuCredential(id)
						: vault === 'admin'
						? await deps.revealAdminSecret(id)
						: await deps.revealUserVaultValue(fresh.user.id, id);
				if (value === null) return deny(404, 'Vault entry not found');
				return json({ ok: true, vault, id, value });
			} catch (error) {
				if (error instanceof Response) throw error;
				return deny(503, 'Vault verification is temporarily unavailable');
			}
		});
};
export const action = createVaultRevealAction();
export const loader = async () => withAdminPrivateResponse(() => deny(405, 'Method not allowed'));
