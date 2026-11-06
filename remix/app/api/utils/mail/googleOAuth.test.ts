import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleMailOAuth } from './googleOAuth';
const origin = 'https://thingtime.test',
	owner = 'owner_one';
function fixture() {
	const rows: any[] = [],
		accounts = new Map();
	let revoked = false,
		purpose = 'browser',
		release: (() => void) | undefined;
	const matches = (row: any, filter: any) =>
		Object.entries(filter).every(([key, val]: [string, any]) =>
			val?.$in ? val.$in.includes(row[key]) : val?.$gt ? row[key] > val.$gt : row[key] === val
		);
	const collection: any = {
		insertOne: async (doc: any) => {
			rows.push(doc);
		},
		findOne: async (filter: any) => rows.find((row) => matches(row, filter)),
		updateOne: async (filter: any, update: any) => {
			const row = rows.find((row) => matches(row, filter));
			if (!row) return { matchedCount: 0 };
			Object.assign(row, update.$set);
			for (const key of Object.keys(update.$unset || {})) delete row[key];
			return { matchedCount: 1 };
		}
	};
	const api = createGoogleMailOAuth({
		getAuthOtpsCollection: async () => collection,
		ensureIndexes: async () => {},
		verifyJwt: async (token: string) => ({ sub: owner, jti: token }),
		getLiveSession: async () => (revoked ? null : ({ userId: owner, purpose } as any)),
		googleMailConfig: async () => ({ clientId: 'fixture', clientSecret: 'secret', redirectUri: origin + '/api/v1/mail/google/callback' }),
		seal: async (_owner, _id, value) => JSON.stringify(value) as any,
		open: async (doc) => JSON.parse(doc.encryptedValue),
		exchangeGoogleMail: async () => {
			if (release)
				await new Promise<void>((r) => {
					release = r;
				});
			return { address: 'reader@example.com', grant: { subject: 'subject', refreshToken: 'secret-refresh', clientId: 'fixture' } };
		},
		connectGoogleMailAccount: async (_owner, id) => {
			accounts.set(id, true);
			return {} as any;
		}
	});
	const request = new Request(origin + '/api/v1/mail');
	const op = (body: any, token = 'session-one', req = request) => api.operate(owner, token, req, body);
	return {
		api,
		op,
		rows,
		accounts,
		revoke: () => {
			revoked = true;
		},
		restrict: () => {
			purpose = 'pat';
		},
		delay: () => {
			release = () => {};
		},
		release: () => release?.()
	};
}
async function begin(f: ReturnType<typeof fixture>) {
	const result = await f.op({ operation: 'google-begin' });
	const url = new URL(result.authorizeUrl!);
	assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
	assert.equal(url.searchParams.get('access_type'), 'offline');
	assert.equal(url.searchParams.get('client_secret'), null);
	return {
		flowId: result.flowId!,
		callback: new Request(origin + '/api/v1/mail/google/callback?code=fixture&state=' + url.searchParams.get('state'))
	};
}
test('Google callback is one use, links only after original session confirms verified address, retries converge', async () => {
	const f = fixture(),
		flow = await begin(f);
	await f.api.callback(flow.callback);
	assert.equal(f.accounts.size, 0);
	await assert.rejects(f.api.callback(flow.callback), /already used/);
	await assert.rejects(f.op({ operation: 'google-status', flowId: flow.flowId }, 'another-session'), /expired/);
	const status = await f.op({ operation: 'google-status', flowId: flow.flowId });
	assert.equal(status.address, 'reader@example.com');
	assert.equal(JSON.stringify(status).includes('secret'), false);
	await assert.rejects(f.op({ operation: 'google-finish', flowId: flow.flowId, address: 'different@example.com' }), /Confirm/);
	await f.op({ operation: 'google-finish', flowId: flow.flowId, address: status.address });
	await f.op({ operation: 'google-finish', flowId: flow.flowId, address: status.address });
	assert.equal(f.accounts.size, 1);
	assert.equal(f.rows[0].encryptedValue, undefined);
});
test('revocation, expiry, wrong origin and scoped credentials fail closed', async () => {
	for (const mode of ['revoke', 'expire', 'origin'] as const) {
		const f = fixture(),
			flow = await begin(f);
		if (mode === 'revoke') f.revoke();
		if (mode === 'expire') f.rows[0].expiresAt = new Date(0);
		await assert.rejects(f.api.callback(mode === 'origin' ? new Request(flow.callback.url.replace(origin, 'https://other.test')) : flow.callback));
		assert.equal(f.accounts.size, 0);
	}
	const f = fixture();
	f.restrict();
	await assert.rejects(begin(f), /Sign in/);
});
test('cancellation fences an in-flight exchange and removes temporary secrets', async () => {
	const f = fixture(),
		flow = await begin(f);
	f.delay();
	const pending = f.api.callback(flow.callback);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await f.op({ operation: 'google-cancel', flowId: flow.flowId });
	f.release();
	await assert.rejects(pending, /cancelled/);
	assert.equal(f.rows[0].encryptedValue, undefined);
	assert.equal(f.accounts.size, 0);
});
