import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileDeviceScope, readMobileDeviceObservation, observeMobileDevice, publishMobileDeviceObservation } from './mobileDeviceObservations';
test('mounted setup subscribers reconcile paired to revoked without a second timer, isolated by owner/origin', () => {
	const scope = mobileDeviceScope('https://presence.test', 'owner');
	const seen: string[] = [];
	const stop = observeMobileDevice(scope, (status) => seen.push(status.state));
	publishMobileDeviceObservation(scope, { state: 'paired', deviceId: 'saved' });
	publishMobileDeviceObservation(mobileDeviceScope('https://other.test', 'owner'), { state: 'unpaired' });
	publishMobileDeviceObservation(mobileDeviceScope('https://presence.test', 'other'), { state: 'unpaired' });
	publishMobileDeviceObservation(scope, { state: 'revoked' });
	assert.deepEqual(seen, ['paired', 'revoked']);
	assert.deepEqual(readMobileDeviceObservation(scope), { state: 'revoked' });
	stop();
	publishMobileDeviceObservation(scope, { state: 'pending' });
	assert.equal(seen.length, 2);
});
