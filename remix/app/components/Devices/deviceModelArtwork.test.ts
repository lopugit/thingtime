import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceModelArtwork } from './deviceModelArtwork';

test('public identifiers select verified artwork without treating unknown identifiers as serial lookups', () => {
	assert.equal(deviceModelArtwork('iPhone16,2', 'ios').match, 'model');
	assert.equal(deviceModelArtwork('Mac15,10', 'macos').match, 'family');
	assert.equal(deviceModelArtwork('Mac15,11', 'macos').src, null);
	assert.equal(deviceModelArtwork('unknown-private-serial', 'ios').src, null);
	assert.equal(deviceModelArtwork(undefined, 'watchos').fallback, '⌚');
	assert.ok(deviceModelArtwork('iPhone16,2').licenseUrl);
});
