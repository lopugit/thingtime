import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { rootIdentity } from '../../../utils/rootIdentity';
const requirements: string[][] = [];
mock.module(new URL('../capabilities/requireCapability.client.ts', import.meta.url).href, {
	namedExports: { requireThingtimeCapability: async (feature: string, version: string) => { requirements.push([feature, version]); } }
});
const { inviteRequest } = await import('../../../components/Invites/inviteClient');
test('successful invite signup invalidates prior root identity; previews and failed signups do not', async () => {
	const before = rootIdentity.read().generation;
	let status = 200;
	const request = mock.method(globalThis, 'fetch', async () =>
		Response.json(status === 200 ? { ok: true, user: { id: 'new-user' } } : { ok: false, error: 'Invite unavailable' }, { status })
	);
	try {
		await inviteRequest({ intent: 'preview', token: 'test-only' });
		assert.deepEqual(requirements.at(-1), ['api.auth-invites', '2.1.0']);
		assert.equal(rootIdentity.read().generation, before);
		status = 409;
		await assert.rejects(() => inviteRequest({ inviteToken: 'test-only' }, true));
		assert.equal(rootIdentity.read().generation, before);
		status = 200;
		await inviteRequest({ inviteToken: 'test-only' }, true);
		assert.deepEqual(requirements.at(-1), ['api.auth-register', '1.3.0']);
		assert.equal(rootIdentity.read().generation, before + 1);
		assert.equal(rootIdentity.read().pending, true);
	} finally {
		request.mock.restore();
		rootIdentity.confirm(rootIdentity.read().generation);
	}
});
