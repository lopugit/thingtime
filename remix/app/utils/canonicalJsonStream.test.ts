import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes, parseJsonBytes, CANONICAL_JSON_CHUNK_BYTES } from './canonicalJsonStream';
import { copyBoundedJson } from './boundedJson';

const text = (value: unknown) => Buffer.concat([...canonicalJsonBytes(value)]).toString('utf8');
async function* split(bytes: Uint8Array, size: number) { for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size); }

test('streaming canonical bytes preserve legacy JSON order, escaping, scalars and inert persisted tags', async () => {
	const value = JSON.parse('{"z":false,"10":10,"2":2,"01":1,"a":[null,0,-0,"2026-01-02T00:00:00.000Z",{"ttype":"function","source":"throw Error()"},{"ttype":"date","iso":"2026-01-02T00:00:00.000Z"}],"__proto__":{"safe":true}}');
	const legacy = JSON.stringify(copyBoundedJson(value, { maxBytes: Infinity, maxNodes: Infinity, maxDepth: Infinity, sortKeys: true }));
	assert.equal(text(value), legacy);
	const recovered = await parseJsonBytes(split(Buffer.from(legacy), 1));
	assert.deepEqual(recovered, JSON.parse(legacy));
	assert.equal(Object.getPrototypeOf(recovered), Object.prototype);
	assert.equal(({} as any).safe, undefined);
	for (const value of [null, true, 0, 1e300, '', '\u0000\n"\\\ud800\udfff✨'])
		assert.deepEqual(await parseJsonBytes(split(Buffer.from(text(value)), 1)), value);
});

test('large Unicode scalars cross JSON fragment and UTF8 input boundaries without corruption', async () => {
	const value = { value: ('a'.repeat(8190) + '✨😀\ud800"\\\n').repeat(20) };
	const chunks = [...canonicalJsonBytes(value)];
	assert(chunks.every(chunk => chunk.length <= CANONICAL_JSON_CHUNK_BYTES));
	assert.equal(Buffer.concat(chunks).toString(), JSON.stringify(value));
	assert.deepEqual(await parseJsonBytes(split(Buffer.concat(chunks), 37)), value);
});

test('traversal is iterative for depth and width and has no node count ceiling', async () => {
	let deep: any = { leaf: true };
	for (let n = 0; n < 2000; n++) deep = { child: deep };
	const value = { deep, wide: Array.from({ length: 150_000 }, (_, n) => n) };
	const recovered = await parseJsonBytes((async function* () { yield* canonicalJsonBytes(value); })()) as any;
	assert.deepEqual(recovered.wide, value.wide);
	for (let n = 0; n < 2000; n++) recovered.deep = recovered.deep.child;
	assert.deepEqual(recovered.deep, { leaf: true });
	let visits = 0;
	assert.throws(() => [...canonicalJsonBytes(value, () => { if (++visits === 2) throw Error('cancelled'); })], /cancelled/);
});

test('unsupported live graph values refuse; persisted local graph text remains exact data', async () => {
	const cyclic: any = {}; cyclic.self = cyclic;
	let calls = 0;
	const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { calls++; return 1; } });
	for (const value of [cyclic, accessor, new Date(), new Map(), undefined, NaN, Infinity, () => 1, BigInt(1), new Array(2), { [Symbol()]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })])
		assert.throws(() => text(value));
	assert.equal(calls, 0);
	const local = '[{"self":"0","date":"1"},{"ttype":"date","iso":"2026-01-02T00:00:00.000Z"}]';
	assert.equal(await parseJsonBytes(split(Buffer.from(text(local)), 1)), local);
	for (const invalid of ['{"a":', '{}{}', '1e999', '"\u0000"']) {
		if (invalid === '1e999') assert.throws(() => text(Infinity));
		else await assert.rejects(parseJsonBytes(split(Buffer.from(invalid), 1)));
	}
});

test('wide array traversal yields bounded buffers before visiting the remaining values', () => {
	let inspected = 0;
	const array = new Proxy(new Array(500_000).fill(null), {
		getOwnPropertyDescriptor(target, key) { inspected++; return Reflect.getOwnPropertyDescriptor(target, key); }
	});
	const iterator = canonicalJsonBytes(array);
	assert.equal(iterator.next().value!.length, CANONICAL_JSON_CHUNK_BYTES);
	assert(inspected < 20_000, 'a chunk is yielded without copying or enqueuing the entire tree');
	iterator.return(undefined);
});

test('fresh worker measures input-width reflection overhead within an explicit 128MiB JS heap', (t) => {
	const script = `import { canonicalJsonBytes } from ${JSON.stringify(fileURLToPath(new URL('./canonicalJsonStream.ts', import.meta.url)))};
		const source = new Array(500000).fill(null); global.gc();
		const baselineHeapBytes = process.memoryUsage().heapUsed;
		let peakHeapBytes=baselineHeapBytes, bytes=0, largestChunk=0;
		for (const chunk of canonicalJsonBytes(source)) {
			bytes+=chunk.length; largestChunk=Math.max(largestChunk,chunk.length);
			peakHeapBytes=Math.max(peakHeapBytes,process.memoryUsage().heapUsed);
		}
		console.log(JSON.stringify({items:source.length,bytes,largestChunk,baselineHeapBytes,peakHeapBytes,peakRssKiB:process.resourceUsage().maxRSS}));`;
	const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--expose-gc', '--import', 'tsx', '--input-type=module', '--eval', script],
		{ cwd: process.cwd(), encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
	assert.equal(child.status, 0, child.stderr);
	const measurement = JSON.parse(child.stdout);
	assert.equal(measurement.bytes, 2_500_001); assert.equal(measurement.largestChunk, CANONICAL_JSON_CHUNK_BYTES);
	assert(measurement.peakHeapBytes < 128 * 1024 * 1024);
	assert(measurement.peakHeapBytes > measurement.baselineHeapBytes);
	t.diagnostic(JSON.stringify(measurement));
});
