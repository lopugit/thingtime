import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEVICE_DRAWER_DEFAULT_WIDTH,
	DEVICE_DRAWER_MAX_WIDTH,
	DEVICE_DRAWER_MIN_WIDTH,
	DEVICE_DRAWER_MOBILE_MIN_WIDTH,
	clampDeviceDrawerWidth,
	deviceDrawerMaximumWidth,
	deviceDrawerMinimumWidth
} from './deviceDrawerLayout';

test('device drawer width stays within desktop and viewport bounds', () => {
	assert.equal(deviceDrawerMaximumWidth(1_440), DEVICE_DRAWER_MAX_WIDTH);
	assert.equal(deviceDrawerMaximumWidth(700), 700);
	assert.equal(deviceDrawerMaximumWidth(Number.NaN), DEVICE_DRAWER_DEFAULT_WIDTH);
	assert.equal(clampDeviceDrawerWidth(100, 1_440), DEVICE_DRAWER_MIN_WIDTH);
	assert.equal(clampDeviceDrawerWidth(740, 1_440), 740);
	assert.equal(clampDeviceDrawerWidth(1_200, 1_440), DEVICE_DRAWER_MAX_WIDTH);
	assert.equal(clampDeviceDrawerWidth(900, 700), 700);
});

test('device drawer remains resizable across narrow mobile viewports', () => {
	assert.equal(deviceDrawerMinimumWidth(390), DEVICE_DRAWER_MOBILE_MIN_WIDTH);
	assert.equal(deviceDrawerMaximumWidth(390), 390);
	assert.equal(clampDeviceDrawerWidth(560, 390), 390);
	assert.equal(clampDeviceDrawerWidth(330, 390), 330);
	assert.equal(clampDeviceDrawerWidth(100, 390), DEVICE_DRAWER_MOBILE_MIN_WIDTH);
	assert.equal(deviceDrawerMinimumWidth(260), 260);
	assert.equal(clampDeviceDrawerWidth(100, 260), 260);
});

test('invalid resize values recover to the default width', () => {
	assert.equal(clampDeviceDrawerWidth(Number.NaN, 1_440), DEVICE_DRAWER_DEFAULT_WIDTH);
	assert.equal(clampDeviceDrawerWidth(Number.POSITIVE_INFINITY, 1_440), DEVICE_DRAWER_DEFAULT_WIDTH);
});
