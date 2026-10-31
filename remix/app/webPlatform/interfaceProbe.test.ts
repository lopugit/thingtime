import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPlatformInterface } from './interfaceProbe';

test('document inspection reports accessor presence without invoking native receiver getters', () => {
	let reads = 0;
	const fixture = Object.create(Object.defineProperty({}, 'inherited', { value: 42 }));
	Object.defineProperties(fixture, {
		classList: {
			get() {
				reads++;
				throw new Error('Illegal invocation');
			}
		},
		prototype: {
			get() {
				reads++;
				throw new Error('Do not enumerate through a getter');
			}
		}
	});
	const root = { Element: { prototype: fixture } };
	const getter = inspectPlatformInterface('Element.prototype.classList', root);
	assert.equal(getter.available, true);
	assert.equal(getter.type, 'accessor');
	assert.ok('getter' in getter);
	assert.equal(getter.getter, true);
	assert.equal(inspectPlatformInterface('Element.prototype.inherited', root).type, 'number');
	assert.equal(inspectPlatformInterface('Element.prototype.absent', root).available, false);
	const unresolved = inspectPlatformInterface('Element.prototype.classList.length', root);
	assert.equal(unresolved.available, null);
	assert.ok('requiresReceiver' in unresolved);
	assert.equal(unresolved.requiresReceiver, 'Element.prototype.classList');
	assert.ok(inspectPlatformInterface('Element.prototype', root).members.includes('classList'));
	assert.equal(reads, 0);
});

test('interface descriptors distinguish a present undefined value and bound inspection paths', () => {
	assert.equal(inspectPlatformInterface('present', { present: undefined }).available, true);
	for (const path of ['', 'Element.constructor', '__proto__.value', 'a.'.repeat(10), 'a();throw 1'])
		assert.throws(() => inspectPlatformInterface(path, {}), /inspection path/);
});
