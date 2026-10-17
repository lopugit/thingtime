import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailHandler } from './_mail';
const owner = { id: 'owner_one', temporary: false } as any;
const defaults = {
	getCurrentUser: async () => owner,
	getAuthToken: async () => 'session',
	ownerVaultConfigured: () => true,
	enforceRateLimit: async () => ({ allowed: true } as any),
	listMail: async () => ({ records: [], nextCursor: null }),
	saveMailAccount: async () => ({ id: 'account_one' } as any),
	saveMailInbox: async () => ({ id: 'inbox_one' } as any),
	deleteMailRecord: async () => {},
	syncMailAccount: async () => ({ folders: [], messages: [], nextCursor: null })
};
const request = (body: any, headers = {}, ownerId = owner.id) =>
	new Request(`https://thingtime.example/api/v1/mail?expectedOwnerId=${ownerId}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.example', ...headers },
		body: JSON.stringify({ expectedOwnerId: owner.id, ...body })
	});
test('mail route enforces origin, actor identity, and private response headers', async () => {
	const handler = createMailHandler(defaults);
	const good = await handler({ request: request({ operation: 'sync' }) });
	assert.equal(good.status, 200);
	assert.equal(good.headers.get('Cache-Control'), 'private, no-store');
	assert.equal((await handler({ request: request({ operation: 'sync' }, { Origin: 'https://attacker.example' }) })).status, 403);
	assert.equal((await handler({ request: request({ operation: 'sync', expectedOwnerId: 'other' }) })).status, 409);
	assert.equal((await handler({ request: request({ operation: 'sync' }, {}, 'other') })).status, 409);
});
test('mail route refuses anonymous, temporary and service users before touching storage', async () => {
	for (const user of [null, { ...owner, temporary: true }, { ...owner, accountKind: 'service' }]) {
		let calls = 0;
		const handler = createMailHandler({
			...defaults,
			getCurrentUser: async () => user as any,
			listMail: async () => {
				calls++;
				return { records: [], nextCursor: null };
			}
		});
		assert.equal((await handler({ request: request({ operation: 'sync' }) })).status, 401);
		assert.equal(calls, 0);
	}
});
test('provider exceptions are redacted and session revocation suppresses results', async () => {
	const handler = createMailHandler({
		...defaults,
		syncMailAccount: async () => {
			throw new Error('PASS super-secret-private-host');
		}
	});
	const response = await handler({ request: request({ operation: 'sync' }) });
	assert.equal(response.status, 503);
	assert.equal((await response.text()).includes('super-secret'), false);
	let calls = 0;
	const revoked = createMailHandler({ ...defaults, getCurrentUser: async () => (++calls === 1 ? owner : null) });
	assert.equal((await revoked({ request: request({ operation: 'sync' }) })).status, 401);
});
