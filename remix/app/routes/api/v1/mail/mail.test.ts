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

const relayAccount = () => ({
	id: 'account_one',
	name: 'Relay',
	address: 'person@example.com',
	revision: 0,
	sync: { cloud: false, local: true, transport: 'relay' },
	servers: { imap: { host: 'imap.example.com', port: 993, security: 'tls', username: 'person@example.com', password: 'fixture-private' } }
});
test('relay reads without vault or mail persistence and requires explicit transport consent', async () => {
	let calls = 0;
	const handler = createMailHandler(
		{
			...defaults,
			ownerVaultConfigured: () => false,
			saveMailAccount: async () => {
				throw new Error('must not save');
			},
			fetchMailBatch: async (account, sync) => {
				calls++;
				assert.equal(account.servers.imap?.password, 'fixture-private');
				assert.equal(sync.protocol, 'imap');
				return { folders: [], messages: [], nextCursor: null };
			}
		},
		true
	);
	const body = { operation: 'relay', protocol: 'imap', account: relayAccount() };
	const result = await handler({ request: request(body) });
	assert.equal(result.status, 200);
	assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await result.json(), { ok: true, ownerId: owner.id, version: 1, folders: [], messages: [], nextCursor: null });
	for (const transport of ['connector', 'native', undefined]) {
		const account = relayAccount();
		(account.sync as any).transport = transport;
		assert.equal((await handler({ request: request({ ...body, account }) })).status, 403);
	}
	assert.equal((await handler({ request: request({ ...body, operation: 'save-account' }) })).status, 400);
	assert.equal((await handler({ request: new Request('https://thingtime.example/api/v1/mail/sync') })).status, 405);
	assert.equal(calls, 1);
});
test('relay enforces owner, origin, rate and revoked session; provider failures stay redacted', async () => {
	const body = { operation: 'relay', protocol: 'imap', account: relayAccount() };
	let calls = 0;
	const transport = async () => {
		calls++;
		return { folders: [], messages: [], nextCursor: null };
	};
	const handler = createMailHandler({ ...defaults, fetchMailBatch: transport }, true);
	assert.equal((await handler({ request: request(body, { Origin: 'https://other.example' }) })).status, 403);
	assert.equal((await handler({ request: request(body, {}, 'other') })).status, 409);
	assert.equal((await handler({ request: request({ ...body, expectedOwnerId: 'other' }) })).status, 409);
	assert.equal(calls, 0);
	const limited = createMailHandler(
		{ ...defaults, fetchMailBatch: transport, enforceRateLimit: async (_r, key) => ({ allowed: key !== 'mail.sync' } as any) },
		true
	);
	assert.equal((await limited({ request: request(body) })).status, 429);
	assert.equal(calls, 0);
	let auth = 0;
	const revoked = createMailHandler({ ...defaults, fetchMailBatch: transport, getCurrentUser: async () => (++auth === 1 ? owner : null) }, true);
	assert.equal((await revoked({ request: request(body) })).status, 401);
	const failed = createMailHandler(
		{
			...defaults,
			fetchMailBatch: async () => {
				throw new Error('PASS fixture-private');
			}
		},
		true
	);
	const failure = await failed({ request: request(body) });
	assert.equal(failure.status, 503);
	assert.equal((await failure.text()).includes('fixture-private'), false);
});
