import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLidarScanClient, parseLidarScanItems, supportsLidarLibrary, type LidarScanItem, type LidarScanSnapshot } from './lidarScanBridge';
import { lidarSaveMenu, lidarScanThing } from './lidarScanLibrary';
import type { ThingtimeBridgeMessage } from '../../utils/nativeBridge';
const item: LidarScanItem = { scanId: randomUUID(), createdAt: '2026-11-12T01:00:00Z', byteCount: 11_360_000_000, frameCount: 4500, available: true, deviceSaved: false, isPartial: true };

test('inventory projects safe metadata, preserves large partial scans, rejects duplicate IDs', () => {
	assert.deepEqual(parseLidarScanItems([{ ...item, archiveURL: '/private/scan.tar' }]), [item]);
	assert.equal(parseLidarScanItems([item, item]), null);
	assert.equal(parseLidarScanItems([{ ...item, byteCount: Number.MAX_SAFE_INTEGER + 1 }]), null);
	assert.equal(parseLidarScanItems([{ ...item, available: 'yes' }]), null);
	const thing = lidarScanThing(item, 'owner');
	assert.equal(thing.crystal.size, item.byteCount);
	assert.ok(thing.tags.includes('Partial'));
	assert.equal(thing.libraryArchivePresentation, 'metadata');
});

test('library saves require exact scan and destination, fence identity, retain inventory during upload', () => {
	const sent: ThingtimeBridgeMessage[] = [], states: LidarScanSnapshot[] = [];
	let current = true;
	const client = createLidarScanClient({ scope: { ownerId: 'owner', origin: 'https://thingtime.com' }, library: true,
		newId: randomUUID, isCurrent: () => current, send: value => sent.push(value), update: value => states.push(value) });
	const reply = (result: Record<string, unknown>, extra: Record<string, unknown> = {}) => client.receive({ type: 'lidar-scan-result', payload: { ...(sent.at(-1)!.payload as object), supported: true, ...result, ...extra } });
	client.request('status');
	assert.equal(reply({ state: 'pending', scanId: item.scanId, scans: [item] }, { ownerId: 'other' }), false);
	assert.ok(reply({ state: 'pending', scanId: item.scanId, scans: [item] }));
	assert.equal(client.request('save', { scanId: randomUUID(), destination: 'cloud' }), false);
	assert.ok(client.request('save', { scanId: item.scanId, destination: 'device' }));
	assert.equal((sent.at(-1)!.payload as { destination: string }).destination, 'device');
	assert.equal(reply({ state: 'device-saved', scanId: randomUUID(), scans: [item] }), false);
	assert.ok(reply({ state: 'device-saved', scanId: item.scanId, scans: [{ ...item, deviceSaved: true }] }));
	assert.equal(states.at(-1)?.result?.scans?.[0].deviceSaved, true);
	assert.ok(client.request('save', { scanId: item.scanId, destination: 'cloud' }));
	assert.ok(reply({ state: 'saving', scanId: item.scanId }));
	assert.equal(states.at(-1)?.result?.scans?.length, 1);
	current = false;
	assert.equal(reply({ state: 'saved', scanId: item.scanId, fileThingId: item.scanId }), false);
	client.close(false);
});

test('capability and menus distinguish local, cloud, and unavailable archives', () => {
	assert.equal(supportsLidarLibrary({ version: '1.0.0', platform: 'ios', isNativeWebView: true, lidarVersion: '1.0.0', postMessage() {} }), false);
	assert.equal(supportsLidarLibrary({ version: '1.0.0', platform: 'ios', isNativeWebView: true, lidarVersion: '1.1.0', postMessage() {} }), true);
	const choices = lidarSaveMenu({ ...item, deviceSaved: true }, false, true).sections[0].actions;
	assert.equal(choices[0].disabled, true);
	assert.equal(choices[1].disabled, false);
	assert.ok(lidarSaveMenu({ ...item, fileThingId: item.scanId }, false, true).sections[0].actions.every(choice => choice.disabled));
	assert.ok(lidarSaveMenu({ ...item, available: false }, false, true).sections[0].actions.every(choice => choice.disabled));
});
