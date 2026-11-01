import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostMediaPipeline } from './hostMediaPipeline';
import { mediaConversionProgram } from './mediaConversionProgram';
const program = mediaConversionProgram();
const defaults = Object.fromEntries(program.parameters!.map((parameter) => [parameter.name, parameter.default]));
test('image loading failures terminate the worker and report bounded errors', async () => {
	let stopped = false;
	const results: any[] = [];
	const host = createHostMediaPipeline(
		program.media!,
		defaults,
		() => ({
			postMessage() {
				throw new Error('must not post');
			},
			terminate() {
				stopped = true;
			},
			onmessage: null,
			onerror: null
		}),
		(_, result) => results.push(result),
		async () => {
			throw new Error('x'.repeat(900));
		}
	);
	host.receive({ type: 'tt-platform-media-start', requestId: 1, file: new Blob(['image'], { type: 'image/png' }) });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(stopped, true);
	assert.equal(results.at(-1).type, 'error');
	assert.equal(results.at(-1).message.length, 700);
	host.dispose();
});
test('empty MIME TGA filename selects local image assets and forwards name', async () => {
	const sent: any[] = [];
	const host = createHostMediaPipeline(
		program.media!,
		defaults,
		() => ({
			postMessage(value) {
				sent.push(value);
			},
			terminate() {},
			onmessage: null,
			onerror: null
		}),
		() => {},
		async () => ({ magick: new Uint8Array() })
	);
	host.receive({ type: 'tt-platform-media-start', requestId: 1, file: new Blob(['image']), name: 'example.TGA' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(sent.length, 1);
	assert.equal(sent[0].name, 'example.TGA');
	assert.ok(sent[0].assets.magick instanceof Uint8Array);
	host.dispose();
});
