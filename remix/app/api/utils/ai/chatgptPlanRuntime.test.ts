import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGPTPlanRuntime, ChatGPTPlanRuntimeError, getChatGPTPlanRuntime } from './chatgptPlanRuntime';
import type { ChatGPTStorageRecord, ChatGPTPlanStorage } from './chatgptPlanStorage';
import { ChatGPTPlanError, SCOPES, type ChatGPTAuthorizationAttempt, type ChatGPTCredentials } from './chatgptPlanProtocol';

const scope = { ownerId: 'user-one', origin: 'http://127.0.0.1:19101', sessionId: 'session-one' };
const models = [
	{ slug: 'model-one', displayName: 'Model one' },
	{ slug: 'model-two', displayName: 'Model two' }
];
function credential(attempt: ChatGPTAuthorizationAttempt): ChatGPTCredentials {
	return {
		hostId: attempt.hostId,
		clientId: 'oaiapp_test',
		issuer: 'https://auth.openai.com',
		subject: 'subject-one',
		email: 'person@example.test',
		idToken: 'private-id-token',
		accessToken: 'private-access-token',
		refreshToken: 'private-refresh-token',
		tokenType: 'Bearer',
		scopes: [...SCOPES],
		expiresAt: Date.now() + 3600_000
	};
}
const gate = () => {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { release, promise };
};
async function fixture(t: TestContext, overrides: ConstructorParameters<typeof ChatGPTPlanRuntime>[1] = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-chatgpt-runtime-'));
	const runtime = new ChatGPTPlanRuntime(directory, {
		exchange: async (attempt) => credential(attempt),
		models: async () => models,
		identity: async () => ({ issuer: 'https://auth.openai.com', subject: 'subject-one', email: 'person@example.test' }),
		revoke: async () => undefined,
		...overrides
	});
	t.after(async () => {
		await runtime.close();
		await rm(directory, { recursive: true, force: true });
	});
	return { directory, runtime };
}
function callback(authorizationUrl: string) {
	const auth = new URL(authorizationUrl);
	const url = new URL(auth.searchParams.get('redirect_uri')!);
	url.search = new URLSearchParams({ state: auth.searchParams.get('state')!, code: 'fixture-code', client_id: 'oaiapp_test' }).toString();
	return url;
}
async function connect(runtime: ChatGPTPlanRuntime) {
	const { authorizationUrl } = await runtime.begin(scope, async () => true);
	const result = await fetch(callback(authorizationUrl));
	assert.equal(result.status, 200);
	return (await runtime.list(scope)).accounts[0];
}

test('private files and public projections preserve owner and origin isolation', async (t) => {
	const { runtime, directory } = await fixture(t);
	const account = await connect(runtime);
	assert.equal(account.connected, true);
	assert.equal(account.model, 'model-one');
	assert.equal((await stat(directory)).mode & 0o777, 0o700);
	assert.equal((await stat(join(directory, 'accounts.json'))).mode & 0o777, 0o600);
	const projection = JSON.stringify(await runtime.status(scope));
	assert.equal(projection.includes('private-'), false);
	assert.equal(projection.includes('oaiapp_'), false);
	assert.deepEqual((await runtime.list({ ...scope, ownerId: 'user-two' })).accounts, []);
	assert.deepEqual((await runtime.list({ ...scope, origin: 'http://127.0.0.1:19102' })).accounts, []);
	await assert.rejects(
		runtime.resolveProvider({ ...scope, ownerId: 'user-two' }, account.id),
		(error: unknown) => error instanceof ChatGPTPlanRuntimeError && error.code === 'account_missing'
	);
	assert.equal((await runtime.resolveProvider(scope, account.id)).token, 'private-access-token');
	await runtime.selectModel(scope, account.id, 'model-two');
	assert.equal((await runtime.resolveProvider(scope, account.id)).model, 'model-two');
	await assert.rejects(runtime.selectModel(scope, account.id, 'not-in-catalog'));
});

test('state mismatch does not consume sign-in and callback exchange is one-use', async (t) => {
	const entered = gate();
	const proceed = gate();
	let exchanges = 0;
	const { runtime } = await fixture(t, {
		exchange: async (attempt) => {
			exchanges++;
			entered.release();
			await proceed.promise;
			return credential(attempt);
		}
	});
	const { authorizationUrl } = await runtime.begin(scope, async () => true);
	const url = callback(authorizationUrl);
	const wrong = new URL(url);
	wrong.searchParams.set('state', 'wrong');
	assert.equal((await fetch(wrong)).status, 400);
	const first = fetch(url);
	await entered.promise;
	assert.equal((await fetch(url)).status, 400);
	proceed.release();
	assert.equal((await first).status, 200);
	assert.equal(exchanges, 1);
});

test('cancel fences late exchange without retaining credentials', async (t) => {
	const entered = gate();
	const proceed = gate();
	let revoked = 0;
	const { runtime, directory } = await fixture(t, {
		exchange: async (attempt) => {
			entered.release();
			await proceed.promise;
			return credential(attempt);
		},
		revoke: async () => {
			revoked++;
		}
	});
	const { authorizationUrl, attemptId } = await runtime.begin(scope, async () => true);
	const pending = fetch(callback(authorizationUrl));
	await entered.promise;
	await runtime.cancel({ ...scope, sessionId: 'different-session' }, attemptId);
	await runtime.cancel(scope, attemptId);
	proceed.release();
	assert.equal((await pending).status, 400);
	assert.equal(revoked, 1);
	assert.equal((await runtime.list(scope)).accounts[0].connected, false);
	assert.equal((await readFile(join(directory, 'accounts.json'), 'utf8')).includes('private-'), false);
});

test('session revoked during model discovery clears durable credentials', async (t) => {
	const entered = gate();
	const proceed = gate();
	let valid = true;
	const { runtime, directory } = await fixture(t, {
		models: async () => {
			entered.release();
			await proceed.promise;
			return models;
		}
	});
	const { authorizationUrl } = await runtime.begin(scope, async () => valid);
	const pending = fetch(callback(authorizationUrl));
	await entered.promise;
	valid = false;
	proceed.release();
	assert.equal((await pending).status, 400);
	assert.equal((await readFile(join(directory, 'accounts.json'), 'utf8')).includes('private-'), false);
});

test('refresh serializes rotation and terminal failure retains registration only', async (t) => {
	let now = Date.now();
	let refreshes = 0;
	let fail = false;
	const { runtime, directory } = await fixture(t, {
		now: () => now,
		refresh: async (value) => {
			refreshes++;
			if (fail) throw new ChatGPTPlanError('invalid_grant', 401);
			return { ...value, accessToken: 'rotated-access', refreshToken: 'rotated-refresh', expiresAt: now + 3600_000 };
		}
	});
	const account = await connect(runtime);
	now += 3600_000;
	const results = await Promise.all([runtime.resolveProvider(scope, account.id), runtime.resolveProvider(scope, account.id)]);
	assert.equal(refreshes, 1);
	assert.equal(results[0].token, 'rotated-access');
	assert.equal(results[1].token, 'rotated-access');
	assert.equal((await readFile(join(directory, 'accounts.json'), 'utf8')).includes('rotated-refresh'), true);
	fail = true;
	now += 3600_000;
	await assert.rejects(runtime.resolveProvider(scope, account.id));
	const stored = await readFile(join(directory, 'accounts.json'), 'utf8');
	assert.equal(stored.includes('rotated-refresh'), false);
	assert.equal(stored.includes('oaiapp_test'), true);
	const retry = await runtime.begin(scope, async () => true, account.id);
	const auth = new URL(retry.authorizationUrl);
	assert.equal(auth.searchParams.get('client_id'), 'oaiapp_test');
	assert.equal(auth.searchParams.has('id_token_hint'), false);
});

test('exchange failure preserves registration and failed revoke still clears local tokens', async (t) => {
	let fail = true;
	const { runtime, directory } = await fixture(t, {
		exchange: async (attempt) => {
			if (fail) throw new ChatGPTPlanError('invalid_grant', 400);
			return credential(attempt);
		},
		revoke: async () => {
			throw new Error('private-token-error');
		}
	});
	const start = await runtime.begin(scope, async () => true);
	assert.equal((await fetch(callback(start.authorizationUrl))).status, 400);
	const account = (await runtime.list(scope)).accounts[0];
	const retry = await runtime.begin(scope, async () => true, account.id);
	assert.equal(new URL(retry.authorizationUrl).searchParams.get('client_id'), 'oaiapp_test');
	fail = false;
	assert.equal((await fetch(callback(retry.authorizationUrl))).status, 200);
	assert.deepEqual(await runtime.disconnect(scope, account.id), { remoteRevoked: false });
	assert.equal((await readFile(join(directory, 'accounts.json'), 'utf8')).includes('private-'), false);
	await assert.rejects(runtime.resolveProvider(scope, account.id));
});

test('single runtime owns rotation and restart preserves host identity', async (t) => {
	const { runtime, directory } = await fixture(t);
	await runtime.list(scope);
	const first = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8'));
	const competing = new ChatGPTPlanRuntime(directory);
	await assert.rejects(competing.list(scope), /Another runtime owns/);
	await competing.close();
	await runtime.close();
	const restarted = new ChatGPTPlanRuntime(directory);
	await restarted.list(scope);
	const second = JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8'));
	assert.equal(first.hostId, second.hostId);
	await restarted.close();
});

test('hosted deployment cannot activate public local runtime', () => {
	const oldDirectory = process.env.THINGTIME_CHATGPT_PLAN_DIR;
	const oldVercel = process.env.VERCEL;
	try {
		process.env.THINGTIME_CHATGPT_PLAN_DIR = '/tmp/never-opened-chatgpt-test';
		process.env.VERCEL = '1';
		assert.equal(getChatGPTPlanRuntime(), null);
	} finally {
		if (oldDirectory === undefined) delete process.env.THINGTIME_CHATGPT_PLAN_DIR;
		else process.env.THINGTIME_CHATGPT_PLAN_DIR = oldDirectory;
		if (oldVercel === undefined) delete process.env.VERCEL;
		else process.env.VERCEL = oldVercel;
	}
});

test('failed discovery after session revocation cannot retain credentials', async (t) => {
	const entered = gate();
	const proceed = gate();
	let valid = true;
	let revoked = 0;
	const { runtime, directory } = await fixture(t, {
		models: async () => {
			entered.release();
			await proceed.promise;
			throw new ChatGPTPlanError('network_error', 503);
		},
		revoke: async () => {
			revoked++;
		}
	});
	const start = await runtime.begin(scope, async () => valid);
	const pending = fetch(callback(start.authorizationUrl));
	await entered.promise;
	valid = false;
	proceed.release();
	assert.equal((await pending).status, 400);
	assert.equal(revoked, 1);
	assert.equal((await runtime.list(scope)).accounts[0].connected, false);
	assert.equal((await readFile(join(directory, 'accounts.json'), 'utf8')).includes('private-'), false);
});

test('disconnect cancels an issued inference lease immediately while model work is queued', async (t) => {
	const entered = gate();
	const proceed = gate();
	let block = false;
	const { runtime } = await fixture(t, {
		models: async () => {
			if (block) {
				entered.release();
				await proceed.promise;
			}
			return models;
		}
	});
	const account = await connect(runtime);
	const lease = await runtime.resolveProvider(scope, account.id);
	assert.equal(lease.authSignal.aborted, false);
	block = true;
	const selection = runtime.selectModel(scope, account.id, 'model-two');
	await entered.promise;
	const disconnect = runtime.disconnect(scope, account.id);
	assert.equal(lease.authSignal.aborted, true);
	proceed.release();
	await selection;
	await disconnect;
	await assert.rejects(runtime.resolveProvider(scope, account.id));
});

test('cancelled or failed reconnect preserves the existing usable session and inference lease', async (t) => {
	const entered = gate();
	const proceed = gate();
	let reconnect = false;
	let fail = false;
	const { runtime } = await fixture(t, {
		exchange: async (attempt) => {
			if (reconnect) {
				entered.release();
				await proceed.promise;
			}
			return { ...credential(attempt), accessToken: reconnect ? 'candidate-access-token' : 'original-access-token' };
		},
		models: async () => {
			if (fail) throw new ChatGPTPlanError('network_error', 503);
			return models;
		}
	});
	const account = await connect(runtime);
	const original = await runtime.resolveProvider(scope, account.id);
	reconnect = true;
	const pendingAttempt = await runtime.begin(scope, async () => true, account.id);
	assert.equal(original.authSignal.aborted, false);
	const pending = fetch(callback(pendingAttempt.authorizationUrl));
	await entered.promise;
	await runtime.cancel(scope, pendingAttempt.attemptId);
	proceed.release();
	assert.equal((await pending).status, 400);
	const retained = await runtime.resolveProvider(scope, account.id);
	assert.equal(retained.token, 'original-access-token');
	assert.equal(retained.authSignal, original.authSignal);
	assert.equal(retained.authSignal.aborted, false);
	assert.equal((await runtime.list(scope)).accounts[0].connected, true);
	fail = true;
	const failure = await runtime.begin(scope, async () => true, account.id);
	assert.equal((await fetch(callback(failure.authorizationUrl))).status, 400);
	assert.equal((await runtime.resolveProvider(scope, account.id)).token, 'original-access-token');
	assert.equal(original.authSignal.aborted, false);
});

test('successful reconnect commits new credentials and replaces the inference lease', async (t) => {
	let generation = 0;
	const { runtime } = await fixture(t, {
		exchange: async (attempt) => ({ ...credential(attempt), accessToken: `access-generation-${++generation}` })
	});
	const account = await connect(runtime);
	const old = await runtime.resolveProvider(scope, account.id);
	const reconnect = await runtime.begin(scope, async () => true, account.id);
	assert.equal(old.authSignal.aborted, false);
	assert.equal((await fetch(callback(reconnect.authorizationUrl))).status, 200);
	const replacement = await runtime.resolveProvider(scope, account.id);
	assert.equal(old.authSignal.aborted, true);
	assert.notEqual(replacement.authSignal, old.authSignal);
	assert.equal(replacement.authSignal.aborted, false);
	assert.equal(replacement.token, 'access-generation-2');
});

test('encrypted move disables source before delivery, binds destination, and imports once without copying host identity', async (t) => {
	const source = await fixture(t);
	const target = await fixture(t);
	const account = await connect(source.runtime);
	const lease = await source.runtime.resolveProvider(scope, account.id);
	const destination = { ownerId: 'destination-owner', origin: 'https://personal.example.test', sessionId: 'destination-session' };
	const recipient = await target.runtime.prepareImport(destination, async () => true);
	const bundle = await source.runtime.moveAccount(scope, account.id, recipient, async () => true);
	assert.equal(JSON.stringify(bundle).includes('private-access-token'), false);
	assert.equal(lease.authSignal.aborted, true);
	await assert.rejects(source.runtime.resolveProvider(scope, account.id));
	assert.deepEqual(await source.runtime.moveAccount(scope, account.id, recipient), bundle);
	await assert.rejects(target.runtime.importAccount({ ...destination, sessionId: 'wrong-session' }, bundle));
	await assert.rejects(target.runtime.importAccount(destination, { ...bundle, ciphertext: `${bundle.ciphertext.slice(0, -2)}AA` }));
	const imported = await target.runtime.importAccount(destination, bundle, async () => true);
	assert.equal(imported.connected, true);
	assert.equal((await target.runtime.resolveProvider(destination, imported.id)).token, 'private-access-token');
	assert.equal((await target.runtime.importAccount(destination, bundle)).id, imported.id);
	assert.equal((await target.runtime.list(destination)).accounts.length, 1);
	const sourceFile = JSON.parse(await readFile(join(source.directory, 'accounts.json'), 'utf8'));
	const targetFile = JSON.parse(await readFile(join(target.directory, 'accounts.json'), 'utf8'));
	assert.notEqual(sourceFile.hostId, targetFile.hostId);
	assert.equal(targetFile.accounts[0].credentials.hostId, targetFile.hostId);
	assert.equal(targetFile.recipients.length, 0);
	assert.equal(sourceFile.accounts[0].credentials, undefined);
	assert.equal((await target.runtime.status(destination)).canAuthorize, false);
	await assert.rejects(
		target.runtime.begin(destination, async () => true),
		/local Thingtime app/
	);
});

test('transfer checks live session and recipient validity before disabling source', async (t) => {
	const source = await fixture(t);
	const target = await fixture(t);
	const account = await connect(source.runtime);
	const destination = { ...scope, ownerId: 'target', origin: 'https://target.example.test' };
	const recipient = await target.runtime.prepareImport(destination);
	await assert.rejects(source.runtime.moveAccount(scope, account.id, recipient, async () => false));
	await assert.rejects(source.runtime.moveAccount(scope, account.id, { ...recipient, expiresAt: Date.now() - 1 }));
	assert.equal((await source.runtime.resolveProvider(scope, account.id)).authSignal.aborted, false);
	const bundle = await source.runtime.moveAccount(scope, account.id, recipient);
	await assert.rejects(target.runtime.importAccount(destination, bundle, async () => false));
	assert.equal((await target.runtime.list(destination)).accounts.length, 0);
	assert.equal((await target.runtime.importAccount(destination, bundle)).connected, true);
});

test('database-backed runtime keeps only host identity on disk and writes account state through adapter', async (t) => {
	let rows: ChatGPTStorageRecord[] = [];
	let authorityChecks = 0;
	const storage: ChatGPTPlanStorage = {
		load: async () => rows,
		assertAuthority: async () => {
			authorityChecks++;
		},
		save: async (records) => {
			rows = structuredClone(records);
		},
		close: async () => undefined
	};
	const { runtime, directory } = await fixture(t, { storage });
	const account = await connect(runtime);
	assert.equal((await runtime.status(scope)).storageMode, 'mongodb');
	assert.equal(authorityChecks > 0, true);
	const identity = await readFile(join(directory, 'identity.json'), 'utf8');
	assert.equal(identity.includes('private-'), false);
	assert.deepEqual(JSON.parse(identity).accounts, []);
	await assert.rejects(readFile(join(directory, 'accounts.json')));
	assert.equal(
		rows.some((row) => row.type === 'account' && row.id === account.id),
		true
	);
});

test('moving an account cancels older pending OAuth reconnects', async (t) => {
	const source = await fixture(t);
	const target = await fixture(t);
	const account = await connect(source.runtime);
	const pending = await source.runtime.begin(scope, async () => true, account.id);
	const destination = { ownerId: 'target-user', origin: 'https://target.example.test', sessionId: 'target-session' };
	const descriptor = await target.runtime.prepareImport(destination);
	await source.runtime.moveAccount(scope, account.id, descriptor);
	const status = await source.runtime.status(scope);
	assert.equal(status.attempts.find((attempt) => attempt.id === pending.attemptId)?.status, 'cancelled');
	await assert.rejects(fetch(callback(pending.authorizationUrl)));
	await assert.rejects(source.runtime.resolveProvider(scope, account.id));
});

test('recipient expiry during identity validation preserves source authority', async (t) => {
	let now = Date.now();
	let delayIdentity = false;
	const source = await fixture(t, {
		now: () => now,
		identity: async () => {
			if (delayIdentity) now += 16 * 60_000;
			return { issuer: 'https://auth.openai.com', subject: 'subject-one', email: 'person@example.test' };
		}
	});
	const target = await fixture(t, { now: () => now });
	const account = await connect(source.runtime);
	const recipient = await target.runtime.prepareImport({ ...scope, ownerId: 'destination-owner' });
	delayIdentity = true;
	await assert.rejects(source.runtime.moveAccount(scope, account.id, recipient), /expired/);
	assert.equal((await source.runtime.resolveProvider(scope, account.id)).authSignal.aborted, false);
	assert.equal((await source.runtime.list(scope)).accounts[0].connected, true);
});

test('oversized transfer preserves source credentials, inference lease, and pending reconnect', async (t) => {
	const accessToken = 'x'.repeat(128 * 1024);
	const source = await fixture(t, { exchange: async (attempt) => ({ ...credential(attempt), accessToken }) });
	const target = await fixture(t);
	const account = await connect(source.runtime);
	const lease = await source.runtime.resolveProvider(scope, account.id);
	const pending = await source.runtime.begin(scope, async () => true, account.id);
	const recipient = await target.runtime.prepareImport({ ...scope, ownerId: 'destination-owner' });
	await assert.rejects(
		source.runtime.moveAccount(scope, account.id, recipient),
		(error: unknown) => error instanceof ChatGPTPlanRuntimeError && error.code === 'transfer_too_large' && error.status === 413
	);
	assert.equal(lease.authSignal.aborted, false);
	assert.equal((await source.runtime.resolveProvider(scope, account.id)).token, accessToken);
	const status = await source.runtime.status(scope);
	assert.equal(status.accounts[0].connected, true);
	assert.equal(status.attempts.find((attempt) => attempt.id === pending.attemptId)?.status, 'pending');
	const saved = JSON.parse(await readFile(join(source.directory, 'accounts.json'), 'utf8'));
	assert.equal(saved.accounts[0].credentials.accessToken, accessToken);
	assert.equal(saved.outbound?.length ?? 0, 0);
});
