import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRouter, type LoaderFunctionArgs } from 'react-router';
import { createRootDataLoader } from './rootDataLoader';
import { fetchRootData, RootDataUnavailableError } from './rootDataRecovery';
import { bindRootIdentityChannel, createRootIdentityState } from './rootIdentity';

const args = (url = 'https://thingtime.test/builder?page=one', controller = new AbortController()) =>
	({ request: new Request(url, { signal: controller.signal }), params: {}, context: {} }) as LoaderFunctionArgs;
const original = { user: { id: 'one' }, clientIdentityGeneration: 0 };
const transient = () => { throw new RootDataUnavailableError(true); };

test('React Router background failure retains loader data without entering the root error boundary; later refresh recovers', async () => {
	let fail = false;
	let revision = 1;
	let calls = 0;
	const identity = createRootIdentityState();
	const loader = createRootDataLoader(async ({ request }) => fetchRootData('/api/root-data', request.signal, async () => {
		calls++;
		if (fail) throw new TypeError('network');
		return Response.json({ ...original, revision });
	}, { timeoutMs: 100, retryDelayMs: 0 }), identity);
	const router = createMemoryRouter([{ id: 'root', path: '*', loader }], { initialEntries: ['/builder?page=one'] });
	try {
		if (!router.state.initialized) await new Promise<void>(resolve => {
			const off = router.subscribe(state => { if (state.initialized) { off(); resolve(); } });
		});
		const data = router.state.loaderData.root;
		fail = true;
		await router.revalidate();
		assert.equal(calls, 3);
		assert.equal(router.state.errors, null);
		assert.equal(router.state.loaderData.root, data);
		fail = false;
		revision = 2;
		await router.revalidate();
		assert.equal((router.state.loaderData.root as { revision: number }).revision, 2);
		assert.equal(router.state.errors, null);
	} finally { router.dispose(); }
});

test('cold start has no fallback', async () => {
	await assert.rejects(createRootDataLoader(transient, createRootIdentityState())(args()), RootDataUnavailableError);
});

for (const changed of ['https://thingtime.test/other', 'https://thingtime.test/builder?page=two', 'https://other.test/builder?page=one']) {
	test(`navigation cannot borrow the previous route: ${changed}`, async () => {
		let fail = false;
		const load = createRootDataLoader(async () => fail ? transient() : original, createRootIdentityState());
		await load(args());
		fail = true;
		await assert.rejects(load(args(changed)), RootDataUnavailableError);
		await assert.rejects(load(args()), RootDataUnavailableError);
	});
}

test('account invalidation discards fallback and old requests cannot repopulate it', async () => {
	const identity = createRootIdentityState();
	let complete: ((data: typeof original) => void) | undefined;
	let mode = 'success';
	const load = createRootDataLoader(async () => mode === 'failure' ? transient() : mode === 'delay'
		? new Promise<typeof original>(resolve => { complete = resolve; }) : original, identity);
	await load(args());
	mode = 'delay';
	const old = load(args());
	identity.changed();
	mode = 'failure';
	await assert.rejects(load(args()), RootDataUnavailableError);
	complete!(original);
	await assert.rejects(old, { name: 'AbortError' });
	identity.confirm(identity.read().generation);
	await assert.rejects(load(args()), RootDataUnavailableError);
});

test('authoritative failure clears fallback, including for subsequent transient errors', async () => {
	let mode = 'success';
	const load = createRootDataLoader(async () => {
		if (mode === 'denied') throw new RootDataUnavailableError();
		return mode === 'failure' ? transient() : original;
	}, createRootIdentityState());
	await load(args());
	mode = 'denied';
	await assert.rejects(load(args()), RootDataUnavailableError);
	mode = 'failure';
	await assert.rejects(load(args()), RootDataUnavailableError);
});

test('abort never returns fallback; successful logout replaces the remembered user', async () => {
	let mode = 'success';
	const controller = new AbortController();
	const load = createRootDataLoader(async () => {
		if (mode === 'abort') { controller.abort(); return transient(); }
		if (mode === 'failure') return transient();
		return mode === 'logout' ? { user: null, clientIdentityGeneration: 0 } : original;
	}, createRootIdentityState());
	await load(args());
	mode = 'abort';
	await assert.rejects(load(args(undefined, controller)), { name: 'AbortError' });
	mode = 'logout';
	await load(args());
	mode = 'failure';
	assert.equal((await load(args())).user, null);
});

test('same-origin identity messages invalidate once, do not echo, and refresh the receiver', () => {
	const identity = createRootIdentityState();
	const channel = new EventTarget() as EventTarget & { postMessage: (value: unknown) => void };
	const sent: unknown[] = [];
	channel.postMessage = value => { sent.push(value); };
	let refreshes = 0;
	const off = bindRootIdentityChannel(identity, channel, () => { refreshes++; });
	identity.changed();
	identity.confirm(1);
	assert.deepEqual(sent, ['identity-changed']);
	channel.dispatchEvent(new MessageEvent('message', { data: 'ignore' }));
	channel.dispatchEvent(new MessageEvent('message', { data: 'identity-changed' }));
	assert.deepEqual(identity.read(), { generation: 2, pending: true });
	assert.equal(refreshes, 1);
	assert.deepEqual(sent, ['identity-changed']);
	off();
	identity.changed();
	assert.equal(sent.length, 1);
});
