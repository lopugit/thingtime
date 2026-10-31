import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBuilderThings, requestBuilderThingsPage } from './useBuilderThings';

const thing = (id: string) => ({ id, crystal: { name: id } });

test('Builder passes each kind and cursor through and retains continuation after an empty visible page', async () => {
	const requests: any[] = [];
	const list = async (args: any) => {
		requests.push(args);
		return args.cursor
			? { ok: true, things: [], nextCursor: 'older' }
			: { ok: true, things: Array.from({ length: 50 }, (_, i) => thing(`page-${i}`)), nextCursor: 'next' };
	};
	const first = await requestBuilderThingsPage(list, 'webpage', undefined, new AbortController().signal);
	assert.equal(first.rows.length, 50);
	const second = await requestBuilderThingsPage(list, 'webpage', first.nextCursor!, new AbortController().signal);
	assert.deepEqual(second, { rows: [], nextCursor: 'older' });
	await requestBuilderThingsPage(list, 'component', undefined, new AbortController().signal);
	assert.deepEqual(requests, [
		{ thingtime: 'webpage', limit: 50, cursor: undefined },
		{ thingtime: 'webpage', limit: 50, cursor: 'next' },
		{ thingtime: 'component', limit: 50, cursor: undefined }
	]);
});

test('overlapping pages are deduplicated without losing older things or updated content', () => {
	assert.deepEqual(mergeBuilderThings([thing('one'), thing('two')], [{ id: 'two', crystal: { name: 'Updated' } }, thing('three')]), [
		thing('one'),
		{ id: 'two', crystal: { name: 'Updated' } },
		thing('three')
	]);
});

test('stalled reads time out and abort even when the request ignores cancellation', async () => {
	let signal: AbortSignal;
	await assert.rejects(
		requestBuilderThingsPage(
			async (_, options) => {
				signal = options.signal;
				return new Promise(() => {});
			},
			'webpage',
			undefined,
			new AbortController().signal,
			5
		),
		/timed out/
	);
	assert.equal(signal!.aborted, true);
});

test('unmount or identity changes cancel a pending read and pre-cancelled reads never start', async () => {
	const parent = new AbortController();
	let signal: AbortSignal;
	let started: () => void;
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	const pending = requestBuilderThingsPage(
		async (_, options) => {
			signal = options.signal;
			started();
			return new Promise(() => {});
		},
		'component',
		undefined,
		parent.signal
	);
	await ready;
	parent.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(signal!.aborted, true);
	await assert.rejects(
		requestBuilderThingsPage(
			async () => {
				assert.fail('must not start');
			},
			'webpage',
			undefined,
			parent.signal
		),
		{ name: 'AbortError' }
	);
});

test('errors and malformed responses are not interpreted as empty libraries', async () => {
	for (const response of [null, { ok: false }, { ok: true }, { ok: true, things: {} }]) {
		await assert.rejects(requestBuilderThingsPage(async () => response, 'webpage', undefined, new AbortController().signal));
	}
	const error = { status: 503, error: 'Unavailable' };
	await assert.rejects(
		requestBuilderThingsPage(
			async () => {
				throw error;
			},
			'component',
			undefined,
			new AbortController().signal
		),
		(value) => value === error
	);
	await assert.rejects(
		requestBuilderThingsPage(async () => ({ ok: true, things: [], nextCursor: 'same' }), 'webpage', 'same', new AbortController().signal),
		/did not advance/
	);
});

test('successful reads clear their deadline and accept a genuinely empty final page', async () => {
	let signal: AbortSignal;
	assert.deepEqual(
		await requestBuilderThingsPage(
			async (_, options) => {
				signal = options.signal;
				return { ok: true, things: [], nextCursor: null };
			},
			'component',
			undefined,
			new AbortController().signal,
			5
		),
		{ rows: [], nextCursor: null }
	);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(signal!.aborted, false);
});
