import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExampleRequest } from './request';
import { LIBRARY_EXAMPLES } from './catalog';
import { exampleThings } from './reuse';
import { validateThingtimeCrystal } from '../schemas/registry';

test('500 unique real examples with version-pinned modules or explicit provider requests', () => {
	assert.equal(LIBRARY_EXAMPLES.length, 500);
	assert.equal(new Set(LIBRARY_EXAMPLES.map((x) => x.id)).size, 500);
	assert.ok(new Set(LIBRARY_EXAMPLES.map((x) => x.provider)).size >= 40);
	for (const example of LIBRARY_EXAMPLES) {
		assert.ok(example.code || example.request, example.id);
		if (example.code)
			assert.doesNotThrow(() => new (Object.getPrototypeOf(async function () {}).constructor)('m', 'input', 'root', example.code), example.id);
		assert.ok(example.docs.startsWith('http'), example.id);
		if (example.module) assert.match(example.module, /@\d+\.\d+\.\d+(?:\/auto)?\?bundle$/);
		if (example.request)
			assert.doesNotThrow(
				() => buildExampleRequest(example, example.input, example.provider === 'Stripe' ? 'sk_test_fixture' : 'test-fixture'),
				example.id
			);
		for (const thing of exampleThings(example, '00000000')) {
			const result = validateThingtimeCrystal(thing.thingtime, thing.crystal);
			assert.ok(result.ok, `${example.id} ${thing.thingtime}: ${'error' in result ? result.error : ''}`);
			if (thing.thingtime[0] === 'action' && result.ok) assert.deepEqual(result.crystal.steps, thing.crystal.steps);
		}
	}
});
