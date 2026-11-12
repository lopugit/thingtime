import assert from 'node:assert/strict';
import test from 'node:test';

import { batteryFromLocalSnapshot, mayReadLocalBattery } from './useLocalDeviceBattery';

test('reads a local battery only for a paired device in the current account', () => {
	assert.equal(mayReadLocalBattery('this-mac', ['this-mac'], ['this-mac'], true, false), true);
	assert.equal(mayReadLocalBattery('other-mac', ['other-mac'], ['this-mac'], true, false), false);
	assert.equal(mayReadLocalBattery('this-mac', ['other-mac'], ['this-mac'], true, false), false);
	assert.equal(mayReadLocalBattery('this-mac', ['this-mac'], ['this-mac'], true, true), false);
	assert.equal(mayReadLocalBattery('this-mac', ['this-mac'], ['this-mac'], false, false), false);
});

test('projects native battery readings without exposing unrelated telemetry', () => {
	const battery = batteryFromLocalSnapshot({
		battery: {
			level: 1, isCharging: false, isExternalPower: true, cycleCount: 282,
			currentMA: 0, fullChargeCapacityMAh: 5044, adapterWatts: 100,
			serial: 'private'
		},
		hostName: 'private-host'
	});
	assert.equal(battery?.cycleCount, 282);
	assert.equal(battery?.currentMA, 0);
	assert.equal(battery?.charging, false);
	assert.equal(battery?.adapterWatts, 100);
	assert.equal('serial' in (battery || {}), false);
	assert.equal('hostName' in (battery || {}), false);
});

test('rejects missing and malformed native snapshots', () => {
	assert.equal(batteryFromLocalSnapshot({ battery: { cycleCount: '282', level: NaN } }), null);
	assert.equal(batteryFromLocalSnapshot({ battery: null }), null);
	assert.equal(batteryFromLocalSnapshot(null), null);
});
