import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceLastSeenLabel, deviceServicePresentation, deviceConnectorPresentation, deviceHealthPresentation } from './deviceStatusPresentation';
import type { DeviceSummary } from './deviceTypes';
const now = Date.parse('2026-11-06T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();
const summary = (overrides: Partial<DeviceSummary> = {}) => ({ lastSeenAt: ago(125_000), transportStatus: 'offline', serviceStatus: 'degraded', pairingStatus: 'paired', ...overrides } as DeviceSummary);
test('last seen uses contact time with two readable units at boundaries', () => {
 for (const [age, text] of [[0, 'just now'], [9999, 'just now'], [10_000, '10s ago'], [59_000, '59s ago'], [60_000, '1m ago'], [125_000, '2m 5s ago'], [3_600_000, '1h ago'], [3_665_000, '1h 1m ago'], [86_400_000, '1d ago'], [90_000_000, '1d 1h ago']] as const) assert.equal(deviceLastSeenLabel(ago(age), now), `Last seen ${text}`);
});
test('missing, invalid or future times are unknown; small clock skew is tolerated', () => {
 for (const value of [undefined, null, '', 'bad', ago(-60_001)]) assert.equal(deviceLastSeenLabel(value, now), 'Last seen unknown');
 assert.equal(deviceLastSeenLabel(ago(-60_000), now), 'Last seen just now');
 assert.equal(deviceLastSeenLabel(ago(1000), NaN), 'Last seen unknown');
});
test('offline and stale paired devices have one neutral badge', () => {
 for (const transportStatus of ['offline', 'backoff', 'connecting', 'online'] as const) assert.deepEqual(deviceHealthPresentation(summary({ transportStatus }), now), [{ label: 'Last seen 2m 5s ago', tone: 'neutral' }]);
 assert.deepEqual(deviceHealthPresentation(summary({ lastSeenAt: null }), now), [{ label: 'Last seen unknown', tone: 'neutral' }]);
 assert.deepEqual(deviceHealthPresentation(summary({ serviceStatus: 'running', transportStatus: 'online', lastSeenAt: ago(1000) }), now), [{ label: 'online', tone: 'positive' }]);
});
test('pairing, approval and version problems retain safety status', () => {
 for (const [status, tone] of [['needs-approval', 'warning'], ['starting', 'warning'], ['version-mismatch', 'negative'], ['stopped', 'neutral']] as const) assert.deepEqual(deviceServicePresentation(status, ago(1000), now), { label: status, tone });
 const badges = deviceHealthPresentation(summary({ pairingStatus: 'revoked', serviceStatus: 'version-mismatch' }), now);
 assert.ok(badges.some(b => b.label === 'revoked' && b.tone === 'negative'));
 assert.ok(badges.some(b => b.label === 'version-mismatch' && b.tone === 'negative'));
});
test('service and connector degraded share neutral contact presentation; errors remain explicit', () => {
 for (const present of [deviceServicePresentation, deviceConnectorPresentation]) assert.deepEqual(present('degraded', ago(125_000), now), { label: 'Last seen 2m 5s ago', tone: 'neutral' });
 assert.deepEqual(deviceConnectorPresentation('error'), { label: 'error', tone: 'negative' });
 assert.deepEqual(deviceConnectorPresentation('update-required'), { label: 'update-required', tone: 'warning' });
 assert.deepEqual(deviceConnectorPresentation('ready'), { label: 'ready', tone: 'positive' });
});
