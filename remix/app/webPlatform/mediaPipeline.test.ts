import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaConversionProgram } from './mediaConversionProgram';
import { validateMediaPipeline, resolveMediaSettings, validateMediaSettings, mediaDimensions } from './mediaPipeline';
import { MediaOutput } from './mediaOutput';
import { mediaExport } from './mediaExport';
import { snapshotPlatformDraft } from './draft';
const program = mediaConversionProgram();
const defaults = Object.fromEntries(program.parameters!.map((p) => [p.name, p.default]));
test('media programs roundtrip as saved data and edited defaults without file bytes', () => {
	const draft = snapshotPlatformDraft(JSON.stringify(program), { videoBitrate: { type: 'number', value: '450000' } });
	const restored = JSON.parse(JSON.stringify(draft.program));
	const settings = resolveMediaSettings(restored.media, draft.input);
	assert.equal(settings.videoBitrate, 450000);
	assert.deepEqual(restored.media, program.media);
	assert.deepEqual(mediaDimensions(1920, 1080, settings), { width: 1280, height: 720 });
	assert.deepEqual(mediaDimensions(640, 480, settings), { width: 640, height: 480 });
	assert.equal(resolveMediaSettings(program.media!, { ...defaults, frameRate: 29.97 }).frameRate, 29.97);
});
test('media rejects external authority, coercion, invalid dimensions and missing inputs', () => {
	for (const extra of [{ url: 'https://example.com/a.mp4' }, { source: 'fetch()' }, { credentialId: 'private' }])
		assert.throws(() => validateMediaPipeline({ ...program.media, ...extra }));
	assert.throws(() => validateMediaPipeline({ ...program.media, start: '#media-file' }));
	assert.throws(() => validateMediaPipeline({ ...program.media, file: 'body input' }));
	assert.throws(() => resolveMediaSettings(program.media!, {}));
	assert.throws(() => validateMediaSettings({ ...defaults, format: { toString: () => 'mp4' } }));
	for (const value of [0, -1, Infinity, NaN, '720', 1.5, 2 ** 32]) assert.throws(() => validateMediaSettings({ ...defaults, maxWidth: value }));
	assert.throws(() => validateMediaSettings({ ...defaults, audio: 'silent-fallback' }));
});
test('muxer chunks preserve header rewrites across page boundaries', async () => {
	const output = new MediaOutput();
	const bytes = new Uint8Array(1024 * 1024 + 8).fill(7);
	output.write(bytes, 0);
	output.write(new Uint8Array([1, 2, 3, 4]), 1024 * 1024 - 2);
	const result = new Uint8Array(await output.blob('video/webm').arrayBuffer());
	assert.equal(result.length, bytes.length);
	assert.deepEqual([...result.subarray(1024 * 1024 - 3, 1024 * 1024 + 3)], [7, 1, 2, 3, 4, 7]);
	for (const offset of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => output.write(new Uint8Array([1]), offset));
});
test('download accepts real local video Blobs and refuses URL or MIME confusion', () => {
	const blob = new Blob(['video'], { type: 'video/mp4' });
	assert.deepEqual(mediaExport({ blob, name: 'my-video.mp4' }), { blob, name: 'my-video.mp4' });
	assert.equal(mediaExport(null), null);
	for (const value of [
		{ blob, name: '../video.mp4' },
		{ blob, name: 'video.html' },
		{ blob, name: 'video.webm' },
		{ blob: 'https://example.com/x', name: 'video.mp4' },
		{ blob: new Blob([], { type: 'video/mp4' }), name: 'video.mp4' }
	])
		assert.throws(() => mediaExport(value));
});

test('secure host fences cancellation, replacement and disposal without trusting frame settings', async () => {
	const { createHostMediaPipeline } = await import('./hostMediaPipeline');
	const ports: any[] = [],
		received: any[] = [];
	const create = () => {
		const port = {
			postMessage(value: any) {
				this.sent = value;
			},
			terminate() {
				this.stopped = true;
			},
			onmessage: null,
			onerror: null
		};
		ports.push(port);
		return port as any;
	};
	const host = createHostMediaPipeline(program.media!, defaults, create, (id, result) => received.push({ id, result }));
	const file = new Blob(['selected']);
	host.receive({ type: 'tt-platform-media-start', requestId: 1, file, settings: { url: 'https://example.com' } });
	assert.equal(ports[0].sent.settings.format, 'mp4');
	assert.equal(ports[0].sent.settings.url, undefined);
	host.receive({ type: 'tt-platform-media-start', requestId: 1, file });
	assert.equal(ports.length, 1);
	host.receive({ type: 'tt-platform-media-cancel', requestId: 2 });
	assert.equal(ports[0].stopped, true);
	ports[0].onmessage({ data: { type: 'complete', blob: file } });
	assert.equal(received.length, 0);
	host.receive({ type: 'tt-platform-media-start', requestId: 3, file });
	ports[1].onmessage({ data: { type: 'progress', percent: 20 } });
	assert.equal(received[0].id, 3);
	host.dispose();
	ports[1].onmessage({ data: { type: 'complete', blob: file } });
	assert.equal(received.length, 1);
	assert.equal(ports[1].stopped, true);
	host.receive({ type: 'tt-platform-media-start', requestId: 4, file });
	assert.equal(ports.length, 2);
});

test('image settings and exports are optional for legacy saved video programs, strict when supplied', () => {
 const legacy = { ...program.media!, output: Object.fromEntries(Object.entries(program.media!.output).filter(([key]) => !key.startsWith('image'))) };
 assert.equal(resolveMediaSettings(legacy as any, defaults).format, 'mp4');
 for (const patch of [{ imageQuality: 0 }, { imageQuality: '80' }, { imageQuality: NaN }, { imageQuality: 101 }, { imageFormat: {} }, { imageBackground: 'url(https://example.com)' }])
  assert.throws(() => validateMediaSettings({ ...defaults, ...patch }));
 for (const [type, extension] of Object.entries({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif' })) {
  const blob = new Blob(['encoded'], { type });
  assert.ok(mediaExport({ blob, name: `output.${extension}` }));
  assert.throws(() => mediaExport({ blob, name: 'output.html' }));
 }
});

test('Start uses current parameters without replacing the selected file surface', async () => {
 const { createHostMediaPipeline } = await import('./hostMediaPipeline');
 let current = { ...defaults };
 const sent: any[] = [];
 const host = createHostMediaPipeline(program.media!, () => current, () => ({ postMessage: value => sent.push(value), terminate() {}, onmessage: null, onerror: null }), () => {});
 current = { ...current, videoBitrate: 250000 };
 host.receive({ type:'tt-platform-media-start', requestId:1, file:new Blob(['video'], {type:'video/mp4'}) });
 assert.equal(sent[0].settings.videoBitrate, 250000);
 host.dispose();
});

test('cancel during image codec loading cannot start or publish a stale job', async () => {
 const { createHostMediaPipeline } = await import('./hostMediaPipeline');
 let finish!: (assets: any) => void;
 const sent: any[] = [], received: any[] = [];
 const host = createHostMediaPipeline(program.media!, defaults, () => ({ postMessage:value=>sent.push(value), terminate() {}, onmessage:null, onerror:null }), (_,value)=>received.push(value), () => new Promise(resolve=>{finish=resolve;}));
 host.receive({ type:'tt-platform-media-start', requestId:1, file:new Blob(['image'], {type:'image/png'}) });
 host.receive({ type:'tt-platform-media-cancel', requestId:2 });
 finish({magick:new Uint8Array()});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,0);
 assert.equal(received.filter(value=>value.type==='complete').length,0);
 host.dispose();
});

test('maximum size normalizes decimal units once and strictly validates authored and worker boundaries', () => {
	const pipeline = {
		...program.media!,
		output: {
			...program.media!.output,
			maxOutputSize: { op: 'input' as const, name: 'maximum' },
			maxOutputUnit: { op: 'input' as const, name: 'unit' }
		}
	};
	for (const [maximum, unit, bytes] of [
		[1.25, 'MB', 1250000],
      [1.001, 'KB', 1001],
		[4, 'KB', 4000],
		['', 'MB', undefined]
	] as const) {
		const settings = resolveMediaSettings(pipeline, { ...defaults, maximum, unit });
		assert.equal(settings.maxOutputBytes, bytes);
		assert.equal(validateMediaSettings(settings).maxOutputBytes, bytes);
	}
	for (const maximum of [0, -1, NaN, Infinity, '4', true, null, {}, Number.MAX_SAFE_INTEGER, 0.00001]) {
		assert.throws(() => resolveMediaSettings(pipeline, { ...defaults, maximum, unit: 'KB' }));
	}
	for (const maximum of [null, '', '4', NaN, Infinity, 0, 1.2, Number.MAX_SAFE_INTEGER + 1])
		assert.throws(() => validateMediaSettings({ ...defaults, maxOutputBytes: maximum }));
	assert.throws(() => validateMediaPipeline({ ...program.media!, output: { ...program.media!.output, maxOutputSize: -1 } }));
	assert.throws(() => resolveMediaSettings(pipeline, { ...defaults, maximum: '', unit: 'GiB' }));
});

test('host refuses an oversize worker completion before any preview or download publication', async () => {
	const { createHostMediaPipeline } = await import('./hostMediaPipeline');
	let port: any;
	const received: any[] = [];
	const pipeline = { ...program.media!, output: { ...program.media!.output, maxOutputSize: 4, maxOutputUnit: 'bytes' } };
	const host = createHostMediaPipeline(
		pipeline,
		defaults,
		() =>
			(port = {
				postMessage() {},
				terminate() {
					this.stopped = true;
				},
				onmessage: null,
				onerror: null
			}),
		(_, result) => received.push(result)
	);
	host.receive({ type: 'tt-platform-media-start', requestId: 1, file: new Blob(['video']) });
	port.onmessage({ data: { type: 'complete', blob: new Blob(['12345'], { type: 'video/mp4' }) } });
	assert.equal(port.stopped, true);
	assert.equal(received[0].type, 'error');
	assert.match(received[0].message, /maximum output size/);
	host.receive({ type: 'tt-platform-media-start', requestId: 2, file: new Blob(['video']) });
	port.onmessage({ data: { type: 'complete', blob: new Blob(['1234'], { type: 'video/mp4' }) } });
	assert.equal(received[1].type, 'complete');
	host.dispose();
});
