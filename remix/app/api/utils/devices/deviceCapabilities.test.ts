import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_DEVICE_CAPABILITIES, normalizeCapabilities, safeCapabilities } from './deviceCapabilities';

test('the native Mac capability vocabulary survives admission and owner projection', () => {
	const source = readFileSync(new URL('../../../../../macos/ThingtimeNode/Sources/ThingtimeNodeCore/NodeController.swift', import.meta.url), 'utf8');
	const base = source.split('private static let basePairingCapabilities = [')[1].split(']')[0];
	const runtime = source.split('public static func runtimeCapabilities(for device: DeviceTelemetry)')[1].split('private func executePairingClaimAttempt')[0];
	const capabilities = [...new Set([...`${base}\n${runtime}`.matchAll(/"([a-z][a-z0-9.:-]+)"/g)].map((match) => match[1]))].sort();
	assert.ok(capabilities.includes('system.menu-bar.read.v1'));
	assert.ok(capabilities.includes('script.bash.v1'));
	assert.ok(capabilities.length > 64, 'exercise the full Mac that exceeded the old limit');
	assert.deepEqual(normalizeCapabilities(capabilities), capabilities);
	assert.deepEqual(safeCapabilities(capabilities), capabilities);
});

test('capability count and identifier validation remain bounded', () => {
	const capabilities = Array.from({ length: MAX_DEVICE_CAPABILITIES }, (_, i) => `test.${i}`);
	assert.equal(normalizeCapabilities(capabilities)?.length, MAX_DEVICE_CAPABILITIES);
	assert.equal(normalizeCapabilities([...capabilities, 'one.too.many']), null);
	assert.equal(safeCapabilities([...capabilities, 'one.too.many']).length, MAX_DEVICE_CAPABILITIES);
	for (const value of [null, {}, [''], ['bad capability'], [1]]) assert.equal(normalizeCapabilities(value), null);
	assert.deepEqual(normalizeCapabilities(['test.read', 'test.read']), ['test.read']);
	assert.deepEqual(normalizeCapabilities(undefined), []);
});
