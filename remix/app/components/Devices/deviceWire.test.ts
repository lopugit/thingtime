import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicDevice, PublicDeviceApproval, PublicDeviceCommand, PublicDeviceScreenSession } from './useDeviceApi';
import { publicDeviceApprovalToRuntime, publicDeviceCommandToRuntime, publicDeviceScreenToRuntime, publicDeviceToRuntime } from './useDeviceStore';

const device = (): PublicDevice => ({
	id: 'macbook-pro',
	name: 'Lopu’s MacBook Pro',
	platform: 'macos',
	model: 'MacBookPro18,3',
	osVersion: '15.6',
	appVersion: '1.0.0',
	capabilities: ['system.volume.set', 'system.audio.mute.set', 'system.audio.output.set', 'app.focus'],
	pairedAt: '2026-08-18T00:00:00.000Z',
	online: false,
	lastSeenAt: '2026-08-18T00:01:00.000Z',
	lastSyncAt: null,
	syncStatus: null,
	watchHealth: null,
	createdThingCount: 0,
	recentThings: [],
	locked: false,
	volume: 0.42,
	brightness: 0.7,
	battery: { level: 0.84, charging: true },
	openApps: [{ id: 'com.openai.chat', name: 'ChatGPT', frontmost: true, hidden: false }],
	state: {
		id: 'state-1',
		revision: 7,
		locked: false,
		volume: 0.42,
		muted: false,
		brightness: 0.7,
		battery: { level: 0.84, charging: true },
		openApps: [{ id: 'com.openai.chat', name: 'ChatGPT', frontmost: true, hidden: false }],
		wifi: { powerOn: true, ssid: 'Example network' },
		audioDevices: [
			{
				id: 'BuiltInOutputDevice',
				name: 'MacBook Speakers',
				hasInput: false,
				hasOutput: true,
				isDefaultInput: false,
				isDefaultOutput: true,
				isDefaultSoundEffectsOutput: true
			}
		],
		observedAt: '2026-08-18T00:01:00.000Z',
		updatedAt: '2026-08-18T00:01:00.000Z'
	},
	connectors: [
		{
			documentId: 'connector-row-1',
			revision: 6,
			id: 'chatgpt',
			kind: 'chatgpt-desktop',
			label: 'ChatGPT Desktop',
			status: 'connected',
			capabilities: ['session.create', 'session.send'],
			projects: [],
			updatedAt: '2026-08-18T00:01:00.000Z'
		}
	],
	pendingCommandCount: 2,
	pendingApprovalCount: 1,
	permissionMode: 'always-allow'
});

test('watchOS projections retain direct-sync health and created Thing provenance', () => {
	const watch: PublicDevice = {
		...device(),
		id: 'watch-1',
		name: 'Lopu’s Apple Watch',
		platform: 'watchos',
		model: 'Watch',
		osVersion: '26.5',
		appVersion: '23',
		online: true,
		lastSeenAt: '2026-09-05T01:00:05.000Z',
		lastSyncAt: '2026-09-05T01:00:04.000Z',
		syncStatus: 'healthy',
		watchHealth: { batteryLevel: 0.72, lowPowerMode: false, error: null, updatedAt: '2026-09-05T01:00:04.000Z' },
		createdThingCount: 1,
		recentThings: [{ id: 'thing-1', label: 'Uploaded from Apple Watch: Recording.m4a', createdAt: '2026-09-05T01:00:00.000Z' }],
		capabilities: ['watch.notifications.read', 'watch.things.create'],
		state: null,
		connectors: [],
		battery: null,
		openApps: [],
		locked: null,
		volume: null,
		brightness: null,
		pendingCommandCount: 0,
		pendingApprovalCount: 0
	};
	const runtime = publicDeviceToRuntime(watch);
	assert.equal(runtime.summary?.transportStatus, 'online');
	assert.equal(runtime.summary?.syncStatus, 'healthy');
	assert.equal(runtime.summary?.system?.batteryPercent, 0.72);
	assert.equal(runtime.summary?.createdThingCount, 1);
	assert.equal(runtime.summary?.recentThings?.[0]?.id, 'thing-1');
});

test('dedicated PublicDevice projections become capability-driven cached runtime state', () => {
	const runtime = publicDeviceToRuntime(device());
	assert.equal(runtime.summary?.serviceStatus, 'degraded');
	assert.equal(runtime.summary?.transportStatus, 'offline');
	assert.equal(runtime.summary?.pairingStatus, 'paired');
	assert.equal(runtime.summary?.revision, 7);
	assert.equal(runtime.summary?.permissionMode, 'always-allow');
	assert.ok(runtime.summary?.capabilities.some((capability) => capability.id === 'system.volume.write'));
	assert.ok(runtime.summary?.capabilities.some((capability) => capability.id === 'system.audio.mute.write'));
	assert.ok(runtime.summary?.capabilities.some((capability) => capability.id === 'apps.launch'));
	assert.equal(runtime.snapshot?.observed.activeAppBundleId, 'com.openai.chat');
	assert.equal(runtime.snapshot?.connectors[0]?.status, 'ready');
	assert.ok(runtime.snapshot?.connectors[0]?.capabilities.some((capability) => capability.id === 'ai.session.create'));
});

test('wire command revisions remain monotonic and preserve desired-state reconciliation', () => {
	const base: PublicDeviceCommand = {
		id: 'command-1',
		requestId: 'request-1',
		deviceId: 'macbook-pro',
		kind: 'system.volume.set',
		status: 'queued',
		input: { level: 0.25 },
		requiresApproval: false,
		approvalState: 'not-required',
		error: null,
		outputRef: null,
		createdAt: '2026-08-18T00:02:00.000Z',
		updatedAt: '2026-08-18T00:02:00.000Z',
		claimedAt: null,
		leaseExpiresAt: null,
		completedAt: null
	};
	const queued = publicDeviceCommandToRuntime(base);
	const running = publicDeviceCommandToRuntime({ ...base, status: 'running' }, queued);
	assert.equal(queued.action, 'set-volume');
	assert.deepEqual(queued.desired, { volume: 0.25 });
	assert.ok(running.revision > queued.revision);
	assert.equal(running.idempotencyKey, 'request-1');
});

test('approval and screen projections expose lifecycle without inventing a media stream', () => {
	const approval: PublicDeviceApproval = {
		id: 'approval-1',
		deviceId: 'macbook-pro',
		commandId: 'command-1',
		requestId: 'approval-request-1',
		kind: 'screen-recording',
		prompt: 'Allow view-only screen access?',
		status: 'pending',
		createdAt: '2026-08-18T00:03:00.000Z',
		expiresAt: '2026-08-18T00:08:00.000Z',
		decidedAt: null
	};
	const screen: PublicDeviceScreenSession = {
		id: 'screen-1',
		deviceId: 'macbook-pro',
		requestId: 'screen-request-1',
		status: 'connecting',
		viewOnly: true,
		createdAt: '2026-08-18T00:03:00.000Z',
		updatedAt: '2026-08-18T00:03:01.000Z',
		startedAt: null,
		endedAt: null,
		error: null
	};
	assert.equal(publicDeviceApprovalToRuntime(approval).status, 'pending');
	const runtimeScreen = publicDeviceScreenToRuntime(screen);
	assert.equal(runtimeScreen.status, 'starting');
	assert.equal(runtimeScreen.controlEnabled, false);
});
