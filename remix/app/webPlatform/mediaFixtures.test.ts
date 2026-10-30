import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { mediaRecipe } from './mediaFixtures';
import { compilePlatformWorker } from './workerSource';
import { resolveDOMScalar, validateLiveDOMBinding } from './liveDOM';
import { localPlatformResource } from './mediaPolicy';
import { AUDIO_SAMPLE, VIDEO_SAMPLE } from './mediaSamples';

test('media catalogue programs contain native receivers and preserve edited saved controls', () => {
	const fixtures = WEB_FEATURES.flatMap((f) => (mediaRecipe(f) ? [{ f, p: mediaRecipe(f)!.program }] : []));
	assert.ok(fixtures.length > 80);
	for (const { f, p } of fixtures) {
		assert.equal(featureCoverage(f), 'interactive', f.name);
		assert.doesNotThrow(() => compilePlatformWorker(p), f.name);
		assert.ok(p.dom!.some((d) => d.method === 'play'));
		assert.ok(p.dom!.some((d) => d.property === 'currentTime' && d.value));
		const component = componentForFeature(f.id);
		const program = (component.render.children.find((n) => n.tag === 'tt-web-platform') as any).props.program;
		program.parameters.find((v: any) => v.name === 'time').default = 0.25;
		program.parameters.find((v: any) => v.name === 'muted').default = false;
		const saved = JSON.parse(JSON.stringify(component));
		assert.deepEqual(saved, component);
		assert.doesNotThrow(() => compilePlatformWorker(program));
	}
	for (const name of [
		'HTMLMediaElement.srcObject',
		'HTMLMediaElement.setMediaKeys',
		'HTMLVideoElement.requestPictureInPicture',
		'HTMLMediaElement.captureStream'
	])
		assert.equal(mediaRecipe(WEB_FEATURES.find((f) => f.name === name)!), undefined, name);
});

test('native setter grammar refuses ambiguous operations, object coercion and inherited inputs', () => {
	const binding = { target: '#sample', property: 'volume', value: { op: 'input', name: 'volume' } };
	assert.doesNotThrow(() => validateLiveDOMBinding(binding));
	for (const change of [
		{ method: 'play' },
		{ args: [] },
		{ property: 'src' },
		{ property: 'constructor' },
		{ value: {} },
		{ value: { op: 'input', name: true } },
		{ value: Infinity }
	])
		assert.throws(() => validateLiveDOMBinding({ ...binding, ...change }));
	assert.equal(resolveDOMScalar(binding.value, { volume: 0 }), 0);
	assert.equal(resolveDOMScalar({ op: 'input', name: 'muted' }, { muted: false }), false);
	assert.throws(() => resolveDOMScalar(binding.value, Object.create({ volume: 1 })));
	assert.throws(() => resolveDOMScalar(binding.value, { volume: { op: 'input', name: 'nested' } }));
	assert.throws(() => validateLiveDOMBinding({ target: '#sample', value: 0 }));
	assert.throws(() => validateLiveDOMBinding({ target: '#sample', property: 'duration', value: 1 }));
});

test('media resources are bounded inert bytes on specific element source attributes', () => {
	assert.ok(localPlatformResource(AUDIO_SAMPLE, 'audio', 'src'));
	assert.ok(localPlatformResource(VIDEO_SAMPLE, 'video', 'src'));
	assert.ok(localPlatformResource(VIDEO_SAMPLE, 'source', 'src'));
	for (const url of [
		'https://example.com/movie.mp4',
		'blob:example',
		// eslint-disable-next-line no-script-url -- hostile resource regression
		'javascript:alert(1)',
		'data:text/html;base64,AAAA',
		'data:video/mp4;base64,!!!!',
		'data:video/mp4;base64,' + 'A'.repeat(20000)
	])
		assert.equal(localPlatformResource(url, 'video', 'src'), false);
	assert.equal(localPlatformResource(VIDEO_SAMPLE, 'iframe', 'src'), false);
	assert.equal(localPlatformResource(VIDEO_SAMPLE, 'video', 'poster'), false);
	const wav = Buffer.from(AUDIO_SAMPLE.split(',')[1], 'base64');
	assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
	assert.equal(wav.readUInt32LE(40), 8000);
	assert.equal(wav.length, 8044);
	assert.equal(Buffer.from(VIDEO_SAMPLE.split(',')[1], 'base64').toString('ascii', 4, 8), 'ftyp');
});
