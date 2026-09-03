import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import {
	createUserVaultGroup,
	deleteUserVaultRecord,
	listUserVault,
	saveUserVaultProvider,
	saveUserVaultSecret
} from '~/api/utils/lopu/userVault';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	return json({ ok: true, ...(await listUserVault(user.id)) }, { headers: NO_STORE });
};

// Writes: full account only (a guest session must not create vault rows),
// JSON-only (the CSRF fence, before the body is read), fail-closed limit.
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (user.temporary) return json({ ok: false, error: 'Create an account to use the Secure Vault' }, { status: 403, headers: NO_STORE });
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const limit = await enforceRateLimit(request, 'lopu.vault', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		const responseInit = rateLimitedResponseInit(limit);
		return json({ ok: false, error: 'Secure Vault is rate limited.' }, { ...responseInit, headers: { ...responseInit.headers, ...NO_STORE } });
	}
	const body = await readJsonBody(request, 40 * 1024);
	try {
		switch (body?.action) {
			case 'create-group':
				return json({ ok: true, group: await createUserVaultGroup(user.id, body) }, { headers: NO_STORE });
			case 'save-secret':
				return json({ ok: true, entry: await saveUserVaultSecret(user.id, body) }, { headers: NO_STORE });
			case 'save-provider':
				return json({ ok: true, entry: await saveUserVaultProvider(user.id, body) }, { headers: NO_STORE });
			case 'delete':
				await deleteUserVaultRecord(user.id, body?.id);
				return json({ ok: true }, { headers: NO_STORE });
			default:
				return json({ ok: false, error: 'Unknown vault action.' }, { status: 400, headers: NO_STORE });
		}
	} catch (error) {
		return json({ ok: false, error: error instanceof Error ? error.message : 'Secure Vault action failed.' }, { status: 400, headers: NO_STORE });
	}
};
