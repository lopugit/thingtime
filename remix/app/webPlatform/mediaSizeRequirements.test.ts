import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaConversionProgram } from './mediaConversionProgram';
import { hasMediaSizeContract, requireMediaSizeWriteCapability, MEDIA_SIZE_WRITE_REQUIREMENTS } from './mediaSizeRequirements';
import { createThingtimeCapabilityChecker } from '../api/utils/capabilities/requireCapability.client';
const legacy = mediaConversionProgram();
const media = { ...legacy.media!, output: { ...legacy.media!.output, maxOutputSize: { op: 'input', name: 'maximum' }, maxOutputUnit: 'MB' } };
const element = { tag: 'tt-media-pipeline', props: { pipeline: media } };

test('detects real nested media containers and programs, including blank saved limits and cyclic trees', () => {
	for (const value of [
		element,
		{ blocks: [{ kind: 'container', children: [{ kind: 'element', ...element }] }] },
		{ render: { tag: 'section', children: [element] } },
		{ tag: 'tt-web-platform', props: { program: { ...legacy, media } } },
		{ ...legacy, media }
	])
		assert.equal(hasMediaSizeContract(value), true);
	const cycle: any = { blocks: [] };
	cycle.blocks.push(cycle, { render: element });
	assert.equal(hasMediaSizeContract(cycle), true);
	const blank = { ...media, output: { ...legacy.media!.output, maxOutputSize: '' } };
	assert.equal(hasMediaSizeContract({ tag: 'tt-media-pipeline', props: { pipeline: blank } }), true);
});
test('ordinary Things, unrelated size data and legacy media do not require a new gate', async () => {
	const cycle: any = { children: [] };
	cycle.children.push(cycle);
	for (const value of [
		{ maxOutputSize: 5, maxOutputUnit: 'MB' },
		{ media: { output: { maxOutputSize: 5 } } },
		{ tag: 'section', props: { pipeline: media } },
		{ tag: 'tt-media-pipeline', props: { pipeline: { output: { maxOutputSize: 5 } } } },
		{ tag: 'tt-media-pipeline', props: { pipeline: legacy.media } },
		{ tag: 'tt-web-platform', props: { program: legacy } },
		legacy,
		cycle
	]) {
		assert.equal(hasMediaSizeContract(value), false);
		await requireMediaSizeWriteCapability(value, 'create', async () => {
			assert.fail('ordinary/legacy writes must preserve prior requirements');
		});
	}
});
test('all write paths negotiate compatible contracts and reject old, missing, breaking and wrong-origin manifests', async (t) => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://media.test' } } });
	try {
		let body: any;
		t.mock.method(globalThis, 'fetch', async () => Response.json(body));
		for (const operation of ['create', 'upsert', 'update'] as const) {
			const { feature, minimumVersion } = MEDIA_SIZE_WRITE_REQUIREMENTS[operation];
			for (const version of [minimumVersion, operation === 'update' ? '1.14.0' : '1.43.0']) {
				body = { schemaVersion: 1, origin: 'https://media.test', features: { [feature]: { version } } };
				await requireMediaSizeWriteCapability({ blocks: [element] }, operation, createThingtimeCapabilityChecker());
			}
			for (const version of [undefined, operation === 'update' ? '1.12.0' : '1.41.0', '2.0.0']) {
				body = { schemaVersion: 1, origin: 'https://media.test', features: version ? { [feature]: { version } } : {} };
				await assert.rejects(requireMediaSizeWriteCapability(element, operation, createThingtimeCapabilityChecker()), /incompatible/);
			}
			body = { schemaVersion: 1, origin: 'https://other.test', features: { [feature]: { version: minimumVersion } } };
			await assert.rejects(requireMediaSizeWriteCapability(element, operation, createThingtimeCapabilityChecker()), /incompatible/);
		}
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
