import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ThingtimeBridgeMessage, ThingtimeNativeBridge } from '../../utils/nativeBridge';
import { createLidarScanClient, isLidarScanInput, lidarAppLink, supportsLidarScan, type LidarScanSnapshot } from './lidarScanBridge';

const ownerId = 'fixture-owner';
const origin = 'https://scan.example.invalid';
const scanId = '510fbf8b-5c32-4ddc-8089-c70b392d3aae';
const bridge: ThingtimeNativeBridge = { version: '1.0.0', isNativeWebView: true, platform: 'ios', postMessage() {} };
function fixture() {
	const sent: ThingtimeBridgeMessage[] = [];
	const states: LidarScanSnapshot[] = [];
	let current = true;
	const client = createLidarScanClient({ scope: { ownerId, origin }, send: message => { sent.push(message); },
		isCurrent: () => current, update: state => { states.push(state); }, newId: randomUUID });
	const reply = (fields: Record<string, unknown>, request = sent.at(-1)) => {
		const requestFields = request?.payload as Record<string, unknown>;
		return { type: 'lidar-scan-result', payload: { requestId: requestFields.requestId, ownerId, origin, supported: true, ...fields } };
	};
	return { client, sent, states, reply, change: () => { current = false; } };
}

test('only a compatible iOS bridge can use the typed LiDAR action', () => {
	for (const version of [undefined, '0.9.0', '2.0.0', '1.00.0', '1.0.0-rc.1']) {
		assert.equal(supportsLidarScan({ ...bridge, lidarVersion: version }), false);
	}
	assert.equal(supportsLidarScan({ ...bridge, platform: 'macos', lidarVersion: '1.0.0' }), false);
	for (const version of ['1.0.0', '1.0.1', '1.2.0']) assert.ok(supportsLidarScan({ ...bridge, lidarVersion: version }));
	assert.ok(isLidarScanInput({ op: 'native', capability: 'lidar.scan' }));
	for (const input of [{ callback: 'https://external.invalid' }, { ownerId }, { origin }, { action: 'retry' }, { capability: 'other' }]) {
		assert.equal(isLidarScanInput({ op: 'native', capability: 'lidar.scan', ...input }), false);
	}
});

test('external iOS handoff carries only the current HTTPS origin', () => {
	for (const [agent, platform, touches] of [['iPhone', 'iPhone', 1], ['Macintosh', 'MacIntel', 5]] as const) {
		const link = new URL(lidarAppLink(origin, agent, platform, touches)!);
		assert.equal(link.protocol, 'thingtime:');
		assert.equal(link.host, 'scan');
		assert.equal(link.pathname, '/lidar');
		assert.deepEqual([...link.searchParams], [['origin', origin]]);
	}
	assert.equal(lidarAppLink(origin, 'Macintosh', 'MacIntel', 0), null);
	for (const invalid of ['https://example.invalid/other', 'http://example.invalid', 'https://name@example.invalid', 'file:///']) {
		assert.equal(lidarAppLink(invalid, 'iPhone', 'iPhone', 1), null);
	}
});

test('one start accepts only ordered responses for its scan and ignores duplicate receipts', () => {
	const { client, sent, states, reply } = fixture();
	assert.equal(client.request('start'), false);
	assert.ok(client.request('status'));
	const status = sent.at(-1);
	for (const fields of [{ origin: 'https://other.invalid' }, { ownerId: 'another-owner' }, { requestId: randomUUID() }]) {
		assert.equal(client.receive(reply({ state: 'idle', ...fields })), false);
	}
	assert.ok(client.receive(reply({ state: 'idle' })));
	assert.ok(client.request('start'));
	assert.equal(client.request('start'), false);
	assert.equal(client.request('status'), false);
	const activeId = (sent.at(-1)?.payload as { requestId: string }).requestId;
	assert.equal(client.receive(reply({ state: 'idle' }, status)), false);
	assert.equal(client.receive(reply({ state: 'capturing', scanId })), false);
	assert.ok(client.receive(reply({ state: 'capturing', scanId: activeId })));
	assert.ok(client.receive(reply({ state: 'saving', scanId: activeId })));
	assert.equal(client.receive(reply({ state: 'capturing', scanId: activeId })), false);
	assert.equal(client.receive(reply({ state: 'saved', scanId: activeId, fileThingId: 'https://other.invalid' })), false);
	const completion = reply({ state: 'saved', scanId: activeId, fileThingId: activeId });
	assert.ok(client.receive(completion));
	assert.equal(client.receive(completion), false);
	assert.deepEqual(states.at(-1), { result: { state: 'saved', supported: true, scanId: activeId, fileThingId: activeId } });
	client.close(false);
});

test('status recovers a retained scan and retry sends its exact identity without starting a new capture', () => {
	const { client, sent, reply, states } = fixture();
	assert.ok(client.request('status'));
	assert.ok(client.receive(reply({ state: 'saving', scanId })));
	assert.ok(client.receive(reply({ state: 'pending', scanId })));
	assert.equal(client.request('start'), false);
	assert.ok(client.request('retry'));
	assert.deepEqual(sent.at(-1)?.payload, { ownerId, origin, requestId: (sent.at(-1)?.payload as { requestId: string }).requestId, action: 'retry', scanId });
	assert.equal(client.receive(reply({ state: 'saved', scanId: randomUUID(), fileThingId: randomUUID() })), false);
	assert.ok(client.receive(reply({ state: 'saved', scanId, fileThingId: scanId, isPartial: true, detail: 'Capture interrupted.' })));
	assert.deepEqual(states.at(-1)?.result, { state: 'saved', supported: true, scanId, fileThingId: scanId, isPartial: true, detail: 'Capture interrupted.' });
	client.close(false);
});

test('foreground status replaces a suspended observation and fences out the old request', () => {
	const { client, sent, reply, states, change } = fixture();
	assert.ok(client.request('status'));
	assert.ok(client.receive(reply({ state: 'idle' })));
	assert.ok(client.request('start'));
	const start = sent.at(-1)!;
	const id = (start.payload as { requestId: string }).requestId;
	assert.ok(client.receive(reply({ state: 'saving', scanId: id })));
	assert.ok(client.refresh());
	assert.deepEqual(sent.map(message => (message.payload as { action: string }).action), ['status', 'start', 'status']);
	assert.equal(client.receive(reply({ state: 'saved', scanId: id, fileThingId: id }, start)), false);
	assert.ok(client.receive(reply({ state: 'pending', scanId: id })));
	assert.equal(states.at(-1)?.result?.state, 'pending');
	assert.ok(client.request('retry'));
	assert.equal((sent.at(-1)?.payload as { scanId: string }).scanId, id);
	change();
	assert.equal(client.refresh(), false);
	client.close(false);
});

test('account or plane invalidation rejects late replies and suspends exactly once', () => {
	const { client, sent, states, reply, change } = fixture();
	assert.ok(client.request('status'));
	const lateReply = reply({ state: 'saved', scanId, fileThingId: scanId });
	change();
	assert.equal(client.receive(lateReply), false);
	assert.equal(client.request('start'), false);
	client.close(true);
	client.close(true);
	assert.equal(sent.length, 2);
	assert.deepEqual(sent[1].payload, { ownerId, origin, requestId: (sent[1].payload as { requestId: string }).requestId, action: 'suspend' });
	assert.equal(states.length, 1);
});

test('an unacknowledged start can be reconciled only with status', () => {
	const states: LidarScanSnapshot[] = [];
	let unavailable = false;
	const client = createLidarScanClient({ scope: { ownerId, origin }, send: () => { if (unavailable) throw Error('bridge failed'); },
		isCurrent: () => true, update: value => { states.push(value); }, newId: () => scanId });
	assert.ok(client.request('status'));
	assert.ok(client.receive({ type: 'lidar-scan-result', payload: { requestId: scanId, ownerId, origin, supported: true, state: 'idle' } }));
	unavailable = true;
	assert.equal(client.request('start'), false);
	assert.ok(states.at(-1)?.connectionError);
	assert.equal(client.request('start'), false);
	unavailable = false;
	assert.ok(client.request('status'));
	client.close(false);
});
