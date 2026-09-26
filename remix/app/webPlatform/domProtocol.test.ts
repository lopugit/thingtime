import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { compilePlatformProgram } from './compiler';
import { compilePlatformWorker } from './workerSource';
import { array, awaited, declare, domCall, domDocument, domGet, fn, get, global, method, returns, variable } from './programBuilders';

async function run(steps: unknown[], reply: (request: any) => unknown, input = {}) {
	const requests: any[] = [],
		results: any[] = [];
	const context: any = { inputJSON: JSON.stringify(input) };
	context.postMessage = (value: any) => {
		if (value.type === 'tt-platform-dom') {
			// structuredClone, not JSON: the real worker boundary rejects an
			// uncloneable argument instead of silently dropping it.
			requests.push(structuredClone(value));
			const response = structuredClone({ type: 'tt-platform-dom-result', id: value.id, result: reply(value) });
			queueMicrotask(() => context.onmessage({ data: response }));
		} else if (value.type !== 'tt-platform-worker-ready') results.push(JSON.parse(JSON.stringify(value)));
	};
	await vm.runInNewContext(`${compilePlatformWorker({ version: 1, title: 'DOM program', steps })};onmessage({data:JSON.parse(inputJSON)})`, context, {
		timeout: 1000
	});
	return { requests, results, context };
}

test('the compiled worker routes document handles across awaited program steps', async () => {
	const handle = { $dom: 'run:1', type: 'Document' };
	const result = await run([declare('doc', domDocument()), ...returns(domGet(variable('doc'), 'nodeType'))], (request) => ({
		value: request.action === 'document' ? handle : 9
	}));
	assert.deepEqual(result.requests, [
		{ type: 'tt-platform-dom', id: 1, action: 'document', target: null, key: '', args: [] },
		{ type: 'tt-platform-dom', id: 2, action: 'get', target: handle, key: 'nodeType', args: [] }
	]);
	assert.deepEqual(result.results, [{ ok: true, result: 9 }]);
	await result.context.onmessage({ data: { type: 'tt-platform-dom-result', id: 2, result: { value: 123 } } });
	await result.context.onmessage({ data: {} });
	assert.equal(result.results.length, 1, 'late replies and duplicate input cannot rerun a program');
});

test('native DOM exceptions remain catchable while unsupported members stay explicit', async () => {
	const steps = [{ op: 'try', body: returns(domDocument()), error: 'error', catch: returns(get(variable('error'), 'name')) }];
	const caught = await run(steps, () => ({ error: { name: 'SyntaxError', message: 'Invalid selector' } }));
	assert.deepEqual(caught.results, [{ ok: true, result: 'SyntaxError' }]);
	const missing = await run(returns(domDocument()), () => ({ error: { name: 'UnsupportedDOMMember', message: 'Missing moveBefore' } }));
	assert.deepEqual(missing.results, [{ ok: false, result: { status: 'unsupported', message: 'Missing moveBefore' } }]);
});

test('DOM syntax never interpolates member source and reserves its backing helper', () => {
	for (const value of [
		{ op: 'dom', action: 'eval' },
		{ op: 'dom', action: 'get', target: null, key: 'x);throw 1' },
		{ op: 'global', name: '__ttDom' }
	])
		assert.throws(() => compilePlatformProgram({ version: 1, title: 'Invalid DOM', steps: returns(value) }));
	assert.match(
		compilePlatformProgram({ version: 1, title: 'Allowed member data', steps: returns(domCall(null, 'append', ['literal'])) }),
		/__ttDom\("call"/
	);
});

test('repeated handles retain receiver identity and undefined native returns stay undefined', async () => {
	const handle = { $dom: 'run:1', type: 'Document' };
	const result = await run([
		declare('a', domDocument()), declare('b', domDocument()),
		...returns({ op: 'binary', operator: '===', left: variable('a'), right: variable('b') })
	], () => ({ value: handle }));
	assert.deepEqual(result.results, [{ ok: true, result: true }]);
	const voidResult = await run(returns(domDocument()), () => ({ value: undefined }));
	assert.deepEqual(voidResult.results, [{ ok: true, result: '[undefined]' }]);
});

test('a refused DOM request leaves the frame-side request numbering intact', async () => {
	// The bridge accepts a request only when its id equals its own request count,
	// so a refused request must not consume an id. Exceeding the concurrency
	// budget and posting an uncloneable argument are both catchable program
	// errors; neither may desynchronise the operations that follow.
	const concurrent = { op: 'dom', action: 'document' };
	const attempt = (body: unknown[]) => [{ op: 'try', body, error: 'e', catch: [] }, ...returns(domDocument())];
	const budget = await run(
		attempt([{ op: 'expression', value: awaited(method(global('Promise'), 'all', [array(...Array.from({ length: 33 }, () => concurrent))])) }]),
		() => ({ value: null })
	);
	const uncloneable = await run(attempt(returns(domCall(null, 'append', [fn([], 1)]))), () => ({ value: null }));
	for (const { requests } of [budget, uncloneable])
		assert.deepEqual(
			requests.map((request) => request.id),
			requests.map((_, index) => index + 1),
			'posted DOM request ids stay contiguous'
		);
	assert.deepEqual(budget.results, [{ ok: true, result: null }]);
	assert.deepEqual(uncloneable.results, [{ ok: true, result: null }]);
});

test('an ordinary parameter named type cannot impersonate a bridge reply before execution', async () => {
	const result = await run(returns(42), () => ({}), { type: 'tt-platform-dom-result', id: 1 });
	assert.deepEqual(result.results, [{ ok: true, result: 42 }]);
});
