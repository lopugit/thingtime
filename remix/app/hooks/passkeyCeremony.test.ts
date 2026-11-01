import assert from 'node:assert/strict';
import test from 'node:test';
import { PasskeyCeremonies, authenticatePasskey, createPasskey, passkeyErrorMessage } from './passkeyCeremony';
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

test('late autofill options cannot open a sheet after an explicit click', async () => {
	const manager = new PasskeyCeremonies();
	const options = deferred();
	let staleCalls = 0;
	const background = manager.run({}, true, async (signal) => {
		await options.promise;
		signal.throwIfAborted();
		staleCalls++;
	});
	const foreground = deferred();
	const manual = manager.run({}, false, () => foreground.promise);
	options.resolve();
	await assert.rejects(background, { name: 'AbortError' });
	assert.equal(staleCalls, 0);
	foreground.resolve();
	await manual;
});
test('old cleanup, delayed autofill and repeated clicks cannot interrupt the current click', async () => {
	const manager = new PasskeyCeremonies();
	const old = {};
	const current = {};
	const wait = deferred();
	let live!: AbortSignal;
	const pending = manager.run(current, false, (signal) => {
		live = signal;
		return wait.promise;
	});
	manager.cancel(old);
	assert.equal(live.aborted, false);
	await assert.rejects(
		manager.run(old, true, async () => {}),
		{ name: 'AbortError' }
	);
	await assert.rejects(
		manager.run(current, false, async () => {}),
		{ name: 'AbortError' }
	);
	manager.cancel(current);
	assert.equal(live.aborted, true);
	wait.resolve();
	await assert.rejects(pending, { name: 'AbortError' });
});
test('unmount during options prevents stale work and permits retry', async () => {
	const manager = new PasskeyCeremonies();
	const owner = {};
	const wait = deferred();
	const pending = manager.run(owner, true, async (signal) => {
		await wait.promise;
		signal.throwIfAborted();
	});
	manager.cancel(owner);
	wait.resolve();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(await manager.run({}, false, async () => 'retry'), 'retry');
});
test('conditional effect abort belongs only to that request', async () => {
	const manager = new PasskeyCeremonies();
	const cancel = new AbortController();
	const wait = deferred();
	const pending = manager.run(
		{},
		true,
		async (signal) => {
			await wait.promise;
			signal.throwIfAborted();
		},
		cancel.signal
	);
	cancel.abort();
	wait.resolve();
	await assert.rejects(pending, { name: 'AbortError' });
});
test('native codecs preserve credentials and attach caller cancellation', async () => {
	const original = Object.getOwnPropertyDescriptor(navigator, 'credentials');
	const bytes = Uint8Array.from([0, 255, 128, 63]).buffer;
	const encoded = Buffer.from(bytes).toString('base64url');
	const signal = new AbortController().signal;
	const credential = {
		id: encoded,
		rawId: bytes,
		authenticatorAttachment: 'platform',
		getClientExtensionResults: () => ({}),
		response: {
			clientDataJSON: bytes,
			authenticatorData: bytes,
			signature: bytes,
			userHandle: bytes,
			attestationObject: bytes,
			getTransports: () => ['internal', 'hybrid']
		}
	};
	Object.defineProperty(navigator, 'credentials', {
		configurable: true,
		value: {
			get: async (args: any) => {
				assert.equal(args.signal, signal);
				assert.equal(args.mediation, 'conditional');
				assert.deepEqual(args.publicKey.allowCredentials, []);
				assert.deepEqual(args.publicKey.challenge, bytes);
				return credential;
			},
			create: async (args: any) => {
				assert.equal(args.signal, signal);
				assert.deepEqual(args.publicKey.user.id, bytes);
				assert.deepEqual(args.publicKey.excludeCredentials[0].id, bytes);
				return credential;
			}
		}
	});
	try {
		const auth = await authenticatePasskey({ challenge: encoded, rpId: 'thingtime.com' }, signal, true);
		assert.equal(auth.response.userHandle, encoded);
		assert.equal(auth.response.signature, encoded);
		const reg = await createPasskey(
			{
				challenge: encoded,
				rp: { name: 'Thingtime', id: 'thingtime.com' },
				user: { id: encoded, name: 'test', displayName: 'Test' },
				pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
				excludeCredentials: [{ id: encoded, type: 'public-key' }]
			},
			signal
		);
		assert.deepEqual(reg.response.transports, ['internal', 'hybrid']);
		assert.equal(reg.response.attestationObject, encoded);
	} finally {
		if (original) Object.defineProperty(navigator, 'credentials', original);
		else delete (navigator as any).credentials;
	}
});
test('errors explain origin and duplicate failures without raw provider internals', () => {
	assert.match(passkeyErrorMessage({ name: 'SecurityError' }), /Safari or Chrome/);
	assert.match(passkeyErrorMessage({ name: 'InvalidStateError' }), /already saved/);
});


test('cancel and timeout settle even when a password manager ignores AbortSignal', async () => {
 const manager = new PasskeyCeremonies(5); const owner = {};
 const pending = manager.run(owner, false, () => new Promise(() => {}));
 manager.cancel(owner);
 await assert.rejects(pending, { name: 'AbortError' });
 await assert.rejects(manager.run({}, false, () => new Promise(() => {})), { name: 'TimeoutError' });
 assert.equal(await manager.run({}, false, async () => 'recovered'), 'recovered');
});
