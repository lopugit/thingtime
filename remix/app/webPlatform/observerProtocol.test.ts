import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { compilePlatformWorker } from './workerSource';
import { runPlatformWorker, type DOMCallback } from './workerLifecycle';
import { observerArgument } from './observerSupport';
import { array, awaited, call, declare, domCallback, domConstruct, domGet, fn, get, global, method, returns, variable as v } from './programBuilders';

test('an unsupported native read inside an authored callback retains its availability result', async () => {
	const results: unknown[] = [];
	const context: any = {};
	let delivered!: () => void;
	const completion = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	context.postMessage = (data: any) => {
		if (data.type === 'tt-platform-dom')
			queueMicrotask(async () => {
				const result =
					data.action === 'construct'
						? { value: { $dom: 'owned:1', type: 'IntersectionObserver' } }
						: { error: { name: 'UnsupportedDOMMember', message: 'Missing native observer field' } };
				await context.onmessage({ data: { type: 'tt-platform-dom-result', id: data.id, result } });
				if (data.action === 'construct') {
					await context.onmessage({
						data: { type: 'tt-platform-dom-callback', id: data.args[0].$callback, args: [[{ $dom: 'owned:2', type: 'IntersectionObserverEntry' }]] }
					});
					delivered();
				}
			});
		else if (data.type !== 'tt-platform-worker-ready') results.push(structuredClone(data));
	};
	const source = compilePlatformWorker({
		version: 1,
		title: 'Callback availability',
		steps: [
			declare('pending', method(global('Promise'), 'withResolvers')),
			declare(
				'observer',
				domConstruct('IntersectionObserver', [domCallback({ ...fn(['records'], domGet(get(v('records'), 0), 'isVisible')), async: true })])
			),
			...returns(awaited(get(v('pending'), 'promise')))
		]
	});
	vm.runInNewContext(source + ';void onmessage({data:{}})', context, { timeout: 1000 });
	await completion;
	assert.deepEqual(results, [{ ok: false, result: { status: 'unsupported', message: 'Missing native observer field' } }]);
});

test('authored callbacks receive native handles through the existing worker transport', async () => {
	const requests: any[] = [],
		results: any[] = [];
	const handle = { $dom: 'owned:1', type: 'ResizeObserver' };
	const entry = { $dom: 'owned:2', type: 'ResizeObserverEntry' };
	const context: any = {};
	context.postMessage = (raw: any) => {
		const data = structuredClone(raw);
		if (data.type === 'tt-platform-dom') {
			requests.push(data);
			queueMicrotask(async () => {
				await context.onmessage({ data: { type: 'tt-platform-dom-result', id: data.id, result: { value: handle } } });
				await context.onmessage({ data: { type: 'tt-platform-dom-callback', id: data.args[0].$callback, args: [[entry], handle] } });
			});
		} else if (data.type !== 'tt-platform-worker-ready') results.push(structuredClone(data));
	};
	const source = compilePlatformWorker({
		version: 1,
		title: 'Native callback',
		steps: [
			declare('pending', method(global('Promise'), 'withResolvers')),
			declare(
				'observer',
				domConstruct('ResizeObserver', [
					domCallback(fn(['records', 'observer'], call(get(v('pending'), 'resolve'), [array(v('records'), v('observer'))])))
				])
			),
			declare('delivered', awaited(get(v('pending'), 'promise'))),
			...returns({ op: 'binary', operator: '===', left: get(v('delivered'), 1), right: v('observer') })
		]
	});
	await vm.runInNewContext(source + ';onmessage({data:{}})', context, { timeout: 1000 });
	assert.deepEqual(requests[0].args, [{ $callback: 1 }]);
	assert.deepEqual(results, [{ ok: true, result: true }]);
});

test('native callbacks share the hard worker deadline and become inert after Stop', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const mode of ['stop', 'deadline', 'error']) {
		let deliver!: DOMCallback,
			releases = 0;
		const messages: unknown[] = [],
			results: unknown[] = [];
		const worker: any = { postMessage: (x: unknown) => messages.push(x), terminate: () => {}, onmessage: null, onerror: null };
		const stop = runPlatformWorker(
			worker,
			{},
			(ok, result) => results.push({ ok, result }),
			() => releases++,
			(_request, callback) => {
				deliver = callback;
				return { value: null };
			}
		);
		worker.onmessage({ data: { type: 'tt-platform-worker-ready' } });
		worker.onmessage({ data: { type: 'tt-platform-dom', id: 1 } });
		deliver(1, ['first']);
		assert.deepEqual(messages.at(-1), { type: 'tt-platform-dom-callback', id: 1, args: ['first'] });
		if (mode === 'stop') stop();
		else if (mode === 'deadline') t.mock.timers.tick(2000);
		else deliver(1, [], 'Observer callback budget exceeded');
		const count = messages.length;
		deliver(1, ['late']);
		assert.equal(messages.length, count);
		assert.equal(releases, 1);
		assert.equal(results.length, mode === 'stop' ? 0 : 1);
	}
});

test('observer options bound native work and reject foreign receivers and unknown fields', () => {
	const receiver = () => {
		throw new Error('foreign receiver');
	};
	for (const value of [
		null,
		[],
		{ threshold: -1 },
		{ threshold: [1.1] },
		{ threshold: Array(33).fill(0) },
		{ delay: 1001 },
		{ rootMargin: 'var(--x)' },
		{ rootMargin: '100000px' },
		{ trackVisibility: 'true' },
		{ extra: 1 }
	])
		assert.throws(() => observerArgument(value, 'observer-intersection', receiver));
	assert.throws(() => observerArgument({ root: {} }, 'observer-intersection', receiver), /foreign/);
	assert.throws(() => observerArgument({ attributeFilter: Array(33).fill('x') }, 'observer-mutation', receiver), /budget/);
	assert.throws(() => observerArgument({ box: 'margin-box' }, 'observer-resize', receiver));
	assert.deepEqual(observerArgument({ threshold: [0, 0.5, 1], rootMargin: '-2px 25%', delay: 100 }, 'observer-intersection', receiver), {
		threshold: [0, 0.5, 1],
		rootMargin: '-2px 25%',
		delay: 100
	});
});
