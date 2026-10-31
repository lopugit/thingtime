import assert from 'node:assert/strict';
import test from 'node:test';
import { StyleTune } from './StyleTune';

test('style tunes initialize independently when the browser omits randomUUID', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	const tunes: StyleTune[] = [];
	try {
		for (const crypto of [{}, undefined]) {
			Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
			for (let index = 0; index < 20; index++) {
				tunes.push(new StyleTune({ api: {}, block: { id: 'same-saved-block' } }));
			}
		}
		assert.equal(new Set(tunes.map((tune) => tune.tuneId)).size, tunes.length);
		assert.ok(tunes.every((tune) => tune.save() === undefined));
	} finally {
		tunes.forEach((tune) => tune.destroy());
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
		else Reflect.deleteProperty(globalThis, 'crypto');
	}
});
