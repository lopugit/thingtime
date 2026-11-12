import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CATALOGUE_FRAME_BYTES, readCatalogueStream, writeCatalogueStream, type CatalogueHeader, type CatalogueSink } from './catalogueStream';

const header: CatalogueHeader = { version: 1, domain: 'themes', origin: 'https://example.test', ownerId: 'synthetic', dataPlane: 'home', storagePlane: 'home', generation: 'snapshot-1' };
async function wire(values = [{ id: 'one', value: { text: 'hello' } }]) {
	const frames: Uint8Array[] = [];
	async function* source() { yield* values; }
	await writeCatalogueStream(header, source(), async frame => { frames.push(frame); });
	return new TextDecoder().decode(Buffer.concat(frames));
}
function body(text: string, width = 313) {
	const data = new TextEncoder().encode(text); let offset = 0;
	return new ReadableStream<Uint8Array>({ pull(controller) {
		if (offset === data.length) controller.close();
		else { controller.enqueue(data.subarray(offset, offset + width)); offset = Math.min(offset + width, data.length); }
	} });
}
function staging() {
	const entries: Array<{ id: string; value: unknown }> = []; let complete = false;
	return { entries, get complete() { return complete; }, sink: {
		async entry(id, value) { entries.push({ id, value }); }, async complete() { complete = true; }
	} satisfies CatalogueSink };
}
test('streams beyond former total count/byte ceilings with bounded frames and exact unicode', async () => {
	const values = Array.from({ length: 120 }, (_, index) => ({ id: String(index).padStart(5, '0'), value: { text: '🙂'.repeat(20_000) } }));
	const text = await wire(values); assert.ok(Buffer.byteLength(text) > 8 * 1024 * 1024);
	for (const frame of text.trimEnd().split('\n')) assert.ok(Buffer.byteLength(frame) <= CATALOGUE_FRAME_BYTES);
	const staged = staging(); const receipt = await readCatalogueStream(body(text), header, staged.sink);
	assert.equal(receipt.entries, 120); assert.equal(staged.complete, true); assert.deepEqual(staged.entries, values);
});
test('empty catalogue is valid, but completion waits for clean EOF', async () => {
	const text = await wire([]); let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode(text)); } });
	const staged = staging(), pending = readCatalogueStream(stream, header, staged.sink);
	await new Promise(resolve => setImmediate(resolve)); assert.equal(staged.complete, false);
	controller.close(); assert.equal((await pending).entries, 0); assert.equal(staged.complete, true);
});
test('rejects wrong identity/version, malformed/order/digest/count/duplicate/truncated/trailing frames without admission', async () => {
	const text = await wire(), frames = text.trimEnd().split('\n').map(line => JSON.parse(line));
	const encode = (items: unknown[]) => items.map(value => JSON.stringify(value) + '\n').join('');
	const cases = [
		encode([{ ...frames[0], ownerId: 'other' }, ...frames.slice(1)]),
		encode([{ ...frames[0], domain: 'algorithms' }, ...frames.slice(1)]),
		encode([{ ...frames[0], origin: 'https://foreign.test' }, ...frames.slice(1)]),
		encode([{ ...frames[0], dataPlane: 'foreign' }, ...frames.slice(1)]),
		encode([{ ...frames[0], storagePlane: 'foreign' }, ...frames.slice(1)]),
		encode([{ ...frames[0], version: 2 }, ...frames.slice(1)]),
		encode([frames[0], { ...frames[1], ordinal: 1 }, frames[2]]),
		encode([frames[0], { ...frames[1], chunk: 1 }, frames[2]]),
		encode([frames[0], { ...frames[1], data: 'e30=' }, frames[2]]),
		encode([frames[0], frames[1], { ...frames[2], digest: '0'.repeat(64) }]),
		encode([frames[0], frames[1], { ...frames[2], entries: 0 }]),
		encode([frames[0], frames[1], { ...frames[2], bytes: 0 }]),
		encode([frames[0], frames[1], { ...frames[1], ordinal: 1 }, frames[2]]),
		encode([frames[0], { ...frames[1], final: false }, frames[2]]),
		encode([frames[0], frames[1]]), text.slice(0, -1), text + '\n', text + '{}\n', '[]\n',
		'x'.repeat(CATALOGUE_FRAME_BYTES + 1), text.replace('"type":"entry"', '"unknown":1,"type":"entry"')
	];
	for (const invalid of cases) {
		const staged = staging(); await assert.rejects(readCatalogueStream(body(invalid), header, staged.sink)); assert.equal(staged.complete, false);
	}
});
test('structural defects reject even when transcript digest and terminal totals are consistent', async t => {
	type EntryFrame = { type: 'entry'; ordinal: number; id: string; chunk: number; data: string; final: boolean };
	const entry = (id: string, ordinal = 0): EntryFrame => ({ type: 'entry', ordinal, id, chunk: 0, data: Buffer.from('1').toString('base64'), final: true });
	const cases: Array<[string, EntryFrame[], number]> = [
		['duplicate IDs', [entry('a'), entry('a', 1)], 2],
		['out-of-order IDs', [entry('b'), entry('a', 1)], 2],
		['skipped ordinal', [{ ...entry('a'), ordinal: 1 }], 1],
		['skipped chunk', [{ ...entry('a'), chunk: 1 }], 1],
		['ID changes mid-entry', [{ ...entry('a'), data: Buffer.from(' ').toString('base64'), final: false }, { ...entry('b'), chunk: 1 }], 1],
		['unfinished entry', [{ ...entry('a'), final: false }], 0]
	];
	for (const [name, frames, entries] of cases) await t.test(name, async () => {
		const prefix = [{ type: 'start', ...header }, ...frames].map(frame => JSON.stringify(frame) + '\n').join('');
		// Independent Node crypto implementation signs the deliberately invalid
		// structure. Totals agree with its payload and completed-entry markers.
		const terminal = { type: 'end', entries, bytes: frames.reduce((total, frame) => total + Buffer.from(frame.data, 'base64').length, 0),
			digest: createHash('sha256').update(prefix).digest('hex') };
		const staged = staging();
		await assert.rejects(readCatalogueStream(body(prefix + JSON.stringify(terminal) + '\n'), header, staged.sink));
		assert.equal(staged.complete, false);
	});
});
test('sink failures and identity changes cancel and release the stream', async () => {
	for (const changed of [false, true]) {
		let cancelled = false, current = true;
		const stream = new ReadableStream<Uint8Array>({ start(c) { void wire().then(text => c.enqueue(new TextEncoder().encode(text))); }, cancel() { cancelled = true; } });
		await assert.rejects(readCatalogueStream(stream, header, {
			async entry() { if (changed) current = false; else throw Error('staging failed'); },
			async complete() { assert.fail('must not admit'); }
		}, { check() { if (!current) throw Error('identity changed'); } }));
		assert.equal(cancelled, true); assert.equal(stream.locked, false);
	}
});
test('abort and stalled reads/sinks release resources', async () => {
	for (const mode of ['abort', 'read', 'sink']) {
		let cancelled = false; const controller = new AbortController();
		const stream = new ReadableStream<Uint8Array>({ async start(c) {
			if (mode === 'sink') c.enqueue(new TextEncoder().encode(await wire()));
		}, cancel() { cancelled = true; } });
		const pending = readCatalogueStream(stream, header, { entry: () => new Promise(() => {}), async complete() { assert.fail(); } },
			{ signal: controller.signal, stallTimeoutMs: 20 });
		if (mode === 'abort') controller.abort();
		await assert.rejects(pending); assert.equal(cancelled, true); assert.equal(stream.locked, false);
	}
});
test('producer preserves backpressure and rejects duplicate IDs', async () => {
	let pulled = 0, writes = 0, release!: () => void;
	async function* source() { pulled++; yield { id: 'a', value: 1 }; pulled++; yield { id: 'a', value: 2 }; }
	const pending = writeCatalogueStream(header, source(), async () => {
		if (++writes === 1) await new Promise<void>(resolve => { release = resolve; });
	});
	await new Promise(resolve => setImmediate(resolve)); assert.equal(pulled, 0); release();
	await assert.rejects(pending); assert.equal(writes, 2);
});
test('producer stalls abort the source and release its iterator', async () => {
	let signal!: AbortSignal, returned = false;
	const source = (value: AbortSignal): AsyncIterable<{ id: string; value: unknown }> => {
		signal = value;
		return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}),
			async return() { returned = true; return { done: true, value: undefined }; } }) };
	};
	await assert.rejects(writeCatalogueStream(header, source, async () => {}, { stallTimeoutMs: 20 }));
	await new Promise(resolve => setImmediate(resolve)); assert.equal(signal.aborted, true); assert.equal(returned, true);
});
test('stalled entry write times out, aborts its signal and closes source without another pull or terminal', { timeout: 1000 }, async () => {
	let pulls = 0, returned = false, writerSignal!: AbortSignal;
	const frames: Array<{ type: string }> = [];
	async function* source() {
		try {
			pulls++; yield { id: 'a', value: 1 };
			pulls++; yield { id: 'b', value: 2 };
		} finally { returned = true; }
	}
	await assert.rejects(writeCatalogueStream(header, source(), async (bytes, signal) => {
		const frame = JSON.parse(new TextDecoder().decode(bytes)); frames.push(frame);
		if (frame.type === 'entry') { writerSignal = signal; await new Promise<void>(() => {}); }
	}, { stallTimeoutMs: 20 }), { name: 'TimeoutError' });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(writerSignal.aborted, true); assert.equal(returned, true); assert.equal(pulls, 1);
	assert.deepEqual(frames.map(frame => frame.type), ['start', 'entry']);
});
test('late sink completion receives cancellation and cannot admit when fenced', async () => {
	let release!: () => void, admitted = false, completionSignal!: AbortSignal;
	const pending = readCatalogueStream(body(await wire([])), header, {
		async entry() {}, async complete(_receipt, signal) {
			completionSignal = signal; await new Promise<void>(resolve => { release = resolve; });
			signal.throwIfAborted(); admitted = true;
		}
	}, { stallTimeoutMs: 20 });
	await assert.rejects(pending); assert.equal(completionSignal.aborted, true); release();
	await new Promise(resolve => setImmediate(resolve)); assert.equal(admitted, false);
});
