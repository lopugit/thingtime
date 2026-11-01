import { changesRootIdentity, rootIdentity } from '~/utils/rootIdentity';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
export const inviteRequest = async (body: Record<string, unknown>, register = false) => {
	await requireThingtimeCapability(register ? 'api.auth-register' : 'api.auth-invites', register ? '1.3.0' : '2.1.0');
	const response = await fetch(register ? '/api/v1/auth/register' : '/api/v1/auth/invites', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		cache: 'no-store',
		referrerPolicy: 'no-referrer'
	});
	const data = await response.json();
	if (!response.ok || !data.ok) throw new Error(data.error || 'The invite request failed. Please try again.');
	if (register && changesRootIdentity('/api/v1/auth/register', data)) rootIdentity.changed();
	return data;
};
