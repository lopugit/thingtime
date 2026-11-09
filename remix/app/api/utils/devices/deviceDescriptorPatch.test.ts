import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeviceDescriptorPatch } from './deviceDescriptorPatch';
test('closed hardware metadata patch never accepts identity, platform, name or serial', () => {
	assert.deepEqual(normalizeDeviceDescriptorPatch({ model: ' iPhone17,3 ', osVersion: '26.1' }), { model: 'iPhone17,3', osVersion: '26.1' });
	for (const extra of [{ ownerId: 'other' }, { serialNumber: 'private' }, { platform: 'macos' }, { name: 'renamed' }])
		assert.equal(normalizeDeviceDescriptorPatch({ model: 'iPhone17,3', ...extra }), null);
	for (const value of [null, {}, [], { model: '' }, { model: 3 }, { model: 'iPhone', osVersion: null }, { model: 'iPhone\nprivate' }])
		assert.equal(normalizeDeviceDescriptorPatch(value), null);
});
