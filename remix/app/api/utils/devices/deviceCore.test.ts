import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { isFullAccountSessionPurpose } from '../auth/getCurrentUser.ts';
import { thingUniqueKey } from '../mongodb/uniqueKeys.ts';
import {
	deviceCredentialHash,
	canonicalDevicePairingClaimBytes,
	generateDeviceCredential,
	generateDevicePairingNonce,
	generatePairingSecret,
	normalizeDeviceCredential,
	normalizePairingSecret,
	normalizeDevicePairingNonce,
	normalizeDevicePairingPublicKey,
	normalizeDevicePairingSignature,
	pairingSecretHash,
	verifyDevicePairingClaim
} from './deviceAuth.ts';
import {
	DEVICE_CONNECTOR_CAPABILITIES,
	DEVICE_COMMAND_KINDS,
	DEVICE_PERMISSION_MODES,
	canLeaseDeviceCommand,
	canTransitionDeviceCommand,
	decideDeviceLease,
	deviceConnectorCommandRequiresApproval,
	deviceConnectorSupportsCommand,
	deviceSupportsCommand,
	deviceControlEventLogicalBytes,
	deviceCommandRequiresApproval,
	devicePayloadHash,
	deviceSnapshotHash,
	decideDeviceRevision,
	decodeDeviceEventCursor,
	encodeDeviceEventCursor,
	normalizeDeviceCommand,
	normalizeDeviceConnectorCapability,
	normalizeDeviceConnectors,
	normalizeDeviceDescriptor,
	normalizeDevicePermissionMode,
	normalizeDeviceState,
	MAX_DEVICE_AUDIO_DEVICES,
	MAX_DEVICE_OPEN_APPS,
	retainedDeviceControlEventCount
} from './deviceCore.ts';
import {
	DEVICE_APPROVAL_DEFAULT_TTL_MS,
	DEVICE_APPROVAL_MAX_TTL_MS,
	DEVICE_COMMAND_HEARTBEAT_INTERVAL_MS,
	DEVICE_COMMAND_LEASE_MS,
	MAX_PENDING_APPROVALS_PER_DEVICE,
	availableDeviceApprovalSlot,
	deviceApprovalExpiry,
	deviceSessionSendRedactionFields
} from './deviceCommands.ts';
import {
	DEVICE_CONNECTOR_FRESHNESS_MS,
	DEVICE_CONTROL_EVENT_MAX_BYTES,
	DEVICE_CONTROL_EVENT_MAX_COUNT,
	DEVICE_CONTROL_EVENT_RETENTION_MS,
	claimDevicePairing,
	deviceConnectorIsFresh,
	newDeviceThing
} from './devices.ts';
import { DEVICE_LIVE_CONTROL_EVENT_MAX_BYTES, DEVICE_LIVE_CONTROL_EVENT_MAX_COUNT, DEVICE_LIVE_CONTROL_EVENT_RETENTION_MS } from './deviceLiveAi.ts';

test('device and pairing credentials are strong-shaped and hashes never equal the token', () => {
	const credential = generateDeviceCredential();
	const pairing = generatePairingSecret();
	assert.equal(normalizeDeviceCredential(credential), credential);
	assert.equal(normalizePairingSecret(pairing), pairing);
	assert.notEqual(deviceCredentialHash(credential), credential);
	assert.notEqual(pairingSecretHash(pairing), pairing);
	assert.equal(deviceCredentialHash(credential), deviceCredentialHash(credential));
});

test('Apple Watch is a first-class paired device descriptor', () => {
	assert.deepEqual(
		normalizeDeviceDescriptor({ name: 'Lopu’s Apple Watch', platform: 'watchos', model: 'Watch', osVersion: '26.5', appVersion: '23' }),
		{ name: 'Lopu’s Apple Watch', platform: 'watchos', model: 'Watch', osVersion: '26.5', appVersion: '23' }
	);
});

test('device idempotency hashes share one bounded multikey index field', () => {
	const command = newDeviceThing('device-command', {
		ownerId: 'owner',
		targetId: 'device',
		control: true,
		crystal: { deviceCommandKey: 'command-key' }
	});
	assert.deepEqual(command.uniqueKeys, [thingUniqueKey('deviceUniqueKey', 'command-key')]);
	assert.equal(command.crystal.deviceUniqueKeys, undefined);
	const event = newDeviceThing('device-command-event', {
		ownerId: 'owner',
		targetId: 'device',
		control: true,
		crystal: { deviceEventKey: 'event-key', liveEventSequenceKey: 'sequence-key' }
	});
	assert.deepEqual(event.uniqueKeys, [
		thingUniqueKey('deviceUniqueKey', 'event-key'),
		thingUniqueKey('deviceUniqueKey', 'sequence-key')
	]);
	assert.equal(event.crystal.deviceUniqueKeys, undefined);
});

test('pairing complete proof is canonical Ed25519 and bound to credential, device and both nonces', () => {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const publicKeyRaw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64url');
	const claim = {
		pairingId: 'pairing-id',
		pairingSecret: generatePairingSecret(),
		credential: generateDeviceCredential(),
		publicKey: publicKeyRaw,
		nonce: generateDevicePairingNonce(),
		serverNonce: generateDevicePairingNonce(),
		device: { name: 'MacBook Pro', platform: 'macos' as const, model: null, osVersion: '15.6', appVersion: '1.0' },
		capabilities: ['session.read', 'session.send']
	};
	const bytes = canonicalDevicePairingClaimBytes(claim);
	const signature = sign(null, bytes, privateKey).toString('base64url');
	assert.equal(normalizeDevicePairingPublicKey(publicKeyRaw), publicKeyRaw);
	assert.equal(normalizeDevicePairingNonce(claim.nonce), claim.nonce);
	assert.equal(normalizeDevicePairingSignature(signature), signature);
	assert.equal(verifyDevicePairingClaim(claim, signature), true);
	assert.equal(verifyDevicePairingClaim({ ...claim, credential: generateDeviceCredential() }, signature), false);
	assert.equal(normalizeDevicePairingPublicKey(`${publicKeyRaw}=`), null);
});

test('pairing claim rejects the legacy bare credential request before any challenge lookup', async () => {
	const result = await claimDevicePairing({
		pairingSecret: generatePairingSecret(),
		credential: generateDeviceCredential(),
		device: { name: 'MacBook Pro', platform: 'macos' },
		capabilities: []
	} as any);
	assert.equal(result.ok, false);
	assert.equal(result.ok ? null : result.status, 400);
	assert.match(result.ok ? '' : result.error, /legacy unproved claims are rejected/i);
});

test('device credentials can never resolve as full account sessions', () => {
	assert.equal(isFullAccountSessionPurpose(undefined), true);
	assert.equal(isFullAccountSessionPurpose('browser'), true);
	assert.equal(isFullAccountSessionPurpose('service'), true);
	for (const purpose of ['app', 'app-sandbox', 'pat', 'device-pairing', 'device']) {
		assert.equal(isFullAccountSessionPurpose(purpose), false, purpose);
	}
});

test('state and connector snapshots reject local paths and unknown sensitive fields', () => {
	const normalized = normalizeDeviceState({
		locked: false,
		volume: 0.5,
		muted: true,
		brightness: 1,
		battery: null,
		openApps: [{ id: 'com.openai.chat', name: 'ChatGPT', frontmost: true, hidden: false }],
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
		wifi: { powerOn: true, ssid: 'Thingtime Guest' },
		displays: [{ id: 42, width: 1920, height: 1080, isMain: true, isBuiltIn: false, brightness: 0.6, brightnessControlSupported: true, currentMode: { id: '1920x1080@60000:0', width: 1920, height: 1080, refreshRate: 60 }, availableModes: [{ id: '1920x1080@60000:0', width: 1920, height: 1080, refreshRate: 60 }], originX: 0, originY: 0, mirroredDisplayId: null, hdrActive: false }],
		printers: [{ id: 'printer-1', name: 'Office printer', isDefault: true }],
		cameras: [{ id: 'camera-1', name: 'FaceTime HD', isConnected: true, isPreferred: true, authorization: 'denied' }],
		bluetoothDevices: [{ id: 'bt-opaque', name: 'Headphones', isConnected: true }],
		vpnServices: [{ id: 'vpn-1', name: 'Work VPN', isConnected: false }],
		powerTimers: { displayIdleMinutes: 10, systemSleepMinutes: 30, diskIdleMinutes: 0 },
		appleMusic: { isInstalled: true, isRunning: false },
		spotify: { isInstalled: true, isRunning: false },
		chromeYouTube: { isInstalled: true, isRunning: false }
	});
	assert.ok(normalized);
	assert.deepEqual(normalized?.wifi, { powerOn: true, ssid: 'Thingtime Guest' });
	assert.equal(normalized?.displays?.[0]?.currentMode?.refreshRate, 60);
	assert.equal(normalized?.bluetoothDevices?.[0]?.id, 'bt-opaque');
	assert.deepEqual(normalized?.powerTimers, { displayIdleMinutes: 10, systemSleepMinutes: 30, diskIdleMinutes: 0 });
	assert.deepEqual(normalized?.appleMusic, { isInstalled: true, isRunning: false });
	assert.deepEqual(normalized?.spotify, { isInstalled: true, isRunning: false });
	assert.deepEqual(normalized?.chromeYouTube, { isInstalled: true, isRunning: false });
	assert.deepEqual(
		normalizeDeviceState({ locked: false, battery: { level: 0.5, charging: true }, openApps: [] })?.battery,
		{ level: 0.5, charging: true, isExternalPower: null, isPreventingIdleSleep: false, isLowPowerModeEnabled: false }
	);
	assert.equal(normalizeDeviceState({ locked: false, displays: [{ id: 1, width: 1, height: 1, isMain: true, isBuiltIn: false, brightness: null, brightnessControlSupported: false, currentMode: null, availableModes: [], originX: 0, originY: 0, mirroredDisplayId: null, hdrActive: false, path: '/private' }] }), null);
	assert.equal(normalizeDeviceState({ locked: false, appleMusic: { isInstalled: true, isRunning: false, queue: ['private'] } }), null);
	assert.equal(normalizeDeviceState({ locked: false, spotify: { isInstalled: true, isRunning: false, queue: ['private'] } }), null);
	assert.equal(normalizeDeviceState({ locked: false, chromeYouTube: { isInstalled: true, isRunning: false, activeTab: 'private' } }), null);
	assert.equal(normalizeDeviceState({ locked: false, powerTimers: { displayIdleMinutes: 10, systemSleepMinutes: 30, diskIdleMinutes: 0, profile: 'private' }, openApps: [] }), null);
	assert.equal(normalizeDeviceState({ locked: false, powerTimers: { displayIdleMinutes: 10.5, systemSleepMinutes: 30, diskIdleMinutes: 0 }, openApps: [] }), null);
	assert.equal(normalizeDeviceState({ locked: false, openApps: [{ id: 'x', name: 'X', frontmost: false, path: '/Applications/X.app' }] }), null);
	assert.equal(normalizeDeviceState({ locked: false, volume: 'not-a-level', openApps: [] }), null);
	assert.ok(
		normalizeDeviceState({
			locked: false,
			openApps: Array.from({ length: MAX_DEVICE_OPEN_APPS }, (_, index) => ({ id: `app-${index}`, name: `App ${index}`, frontmost: false }))
		})
	);
	assert.equal(
		normalizeDeviceState({
			locked: false,
			openApps: Array.from({ length: MAX_DEVICE_OPEN_APPS + 1 }, (_, index) => ({ id: `app-${index}`, name: `App ${index}`, frontmost: false }))
		}),
		null
	);
	assert.equal(
		normalizeDeviceState({
			locked: false,
			openApps: [],
			audioDevices: Array.from({ length: MAX_DEVICE_AUDIO_DEVICES + 1 }, (_, index) => ({
				id: `audio-${index}`,
				name: `Audio ${index}`,
				hasInput: true,
				hasOutput: false,
				isDefaultInput: false,
				isDefaultOutput: false,
				isDefaultSoundEffectsOutput: false
			}))
		}),
		null
	);
	const connector = normalizeDeviceConnectors([
		{
			id: 'chatgpt',
			kind: 'chatgpt',
			label: 'ChatGPT',
			status: 'connected',
			capabilities: [' session.send ', 'AI.Session.Read', 'explicit-approval', 'session.read']
		}
	]);
	assert.deepEqual(connector?.[0]?.capabilities, ['explicit-approval', 'read-history', 'send-message']);
	assert.equal(normalizeDeviceConnectorCapability('session.create'), 'create-session');
	assert.equal(normalizeDeviceConnectorCapability('shell.execute'), null);
	assert.deepEqual(DEVICE_CONNECTOR_CAPABILITIES, [
		'read-history',
		'create-session',
		'send-message',
		'steer-turn',
		'interrupt-turn',
		'review-approval',
		'accessibility',
		'explicit-approval'
	]);
	assert.equal(
		normalizeDeviceConnectors([{ id: 'chatgpt', kind: 'chatgpt', label: 'ChatGPT', status: 'connected', capabilities: ['shell.execute'] }]),
		null
	);
	assert.equal(
		normalizeDeviceConnectors([{ id: 'chatgpt', kind: 'chatgpt', label: 'ChatGPT', status: 'connected', capabilities: [], cookie: 'secret' }]),
		null
	);
});

test('connector commands require the matching canonical capability', () => {
	const connector = { capabilities: ['read-history', 'send-message'] };
	assert.equal(deviceConnectorSupportsCommand('session.list', { connectorId: 'chatgpt' }, connector), true);
	assert.equal(deviceConnectorSupportsCommand('session.read', { connectorId: 'chatgpt', sessionId: 'chat-1' }, connector), true);
	assert.equal(
		deviceConnectorSupportsCommand('session.read', { connectorId: 'chatgpt', sessionId: 'chat-1' }, { capabilities: ['AI.Session.Read'] }),
		true
	);
	assert.equal(deviceConnectorSupportsCommand('session.create', { connectorId: 'chatgpt' }, connector), false);
	assert.equal(
		deviceConnectorSupportsCommand('session.send', { connectorId: 'chatgpt', sessionId: 'chat-1', text: 'hello', delivery: 'queue' }, connector),
		true
	);
	assert.equal(
		deviceConnectorSupportsCommand(
			'session.send',
			{ connectorId: 'chatgpt', sessionId: 'chat-1', text: 'hello', delivery: 'steer', expectedTurnId: 'turn-1' },
			connector
		),
		false
	);
	assert.equal(
		deviceConnectorSupportsCommand('session.interrupt', { connectorId: 'chatgpt', sessionId: 'chat-1', turnId: 'turn-1' }, connector),
		false
	);
	assert.equal(
		deviceConnectorSupportsCommand('approval.respond', { connectorId: 'chatgpt', approvalId: 'approval-1', decision: 'approved' }, connector),
		false
	);
	assert.equal(
		deviceConnectorSupportsCommand(
			'session.send',
			{ connectorId: 'chatgpt', sessionId: 'chat-1', text: 'hello', delivery: 'queue' },
			{ capabilities: ['shell.execute'] }
		),
		false
	);
});

test('device-wide commands require the capability from the signed pairing claim', () => {
	assert.equal(deviceSupportsCommand('system.lock', []), false);
	assert.equal(deviceSupportsCommand('system.lock', ['device.lock.read']), false);
	assert.equal(deviceSupportsCommand('system.lock', ['system.lock']), true);
	assert.equal(deviceSupportsCommand('system.lock', ['device.lock.write']), true);
	assert.equal(deviceSupportsCommand('system.volume.set', ['system.volume.read']), false);
	assert.equal(deviceSupportsCommand('system.volume.set', ['system.volume.set']), true);
	assert.equal(deviceSupportsCommand('system.audio.input.volume.set', ['system.audio.input.volume.write']), true);
	assert.equal(deviceSupportsCommand('system.audio.input.mute.set', ['system.audio.input.mute.write']), true);
	assert.equal(deviceSupportsCommand('system.audio.sound-effects.volume.set', ['system.audio.sound-effects.volume.write']), true);
	assert.equal(deviceSupportsCommand('system.audio.sound-effects.mute.set', ['system.audio.sound-effects.mute.write']), true);
	assert.equal(deviceSupportsCommand('system.brightness.set', ['system.brightness.write']), true);
	assert.equal(deviceSupportsCommand('system.power.idle-timer.set', ['system.power.idle-timer.write']), true);
	assert.equal(deviceSupportsCommand('system.policy.airdrop.profile.propose', ['system.policy.airdrop.profile.write']), true);
	assert.equal(deviceSupportsCommand('system.policy.camera.profile.propose', ['system.policy.camera.profile.write']), true);
	assert.equal(deviceSupportsCommand('input.pointer.click', ['input.pointer.write']), true);
	assert.equal(deviceSupportsCommand('input.keyboard.shortcut', ['input.keyboard.write']), true);
	assert.equal(deviceSupportsCommand('input.pointer.move', ['input.keyboard.write']), false);
	assert.equal(deviceSupportsCommand('system.sleep', ['system.power.sleep']), true);
	assert.equal(deviceSupportsCommand('system.sleep', ['system.lock']), false);
	assert.equal(deviceSupportsCommand('screen.start', ['screen.view']), true);
	assert.equal(deviceSupportsCommand('screen.start', ['screen.control']), false);
	// Connector-scoped commands are authorized against their fresh connector
	// snapshot rather than the base device claim.
	assert.equal(deviceSupportsCommand('session.send', []), true);
});

test('command vocabulary is closed and every input envelope is kind-specific', () => {
	assert.deepEqual(DEVICE_COMMAND_KINDS, [
		'connector.start',
		'connector.stop',
		'session.list',
		'session.read',
		'session.create',
		'session.send',
		'session.interrupt',
		'approval.respond',
		'app.focus',
		'app.launch',
		'app.quit',
		'app.force-quit',
		'app.hide',
		'app.unhide',
		'app.hide-others',
		'system.volume.set',
		'system.audio.mute.set',
		'system.audio.input.volume.set',
		'system.audio.input.mute.set',
		'system.audio.output.set',
		'system.audio.input.set',
		'system.audio.sound-effects.volume.set',
		'system.audio.sound-effects.mute.set',
		'system.audio.sound-effects-output.set',
		'system.brightness.set',
		'system.display.brightness.set',
		'system.display.mode.set',
		'system.display.origin.set',
		'system.display.mirroring.set',
		'system.printer.default.set',
		'system.camera.preferred.set',
		'system.bluetooth.device.connection.set',
		'system.vpn.connection.set',
		'system.power.idle-sleep-prevention.set',
		'system.power.idle-timer.set',
		'system.policy.airdrop.profile.propose',
		'system.policy.camera.profile.propose',
		'system.media.apple-music.playback.set',
		'system.media.apple-music.volume.set',
		'system.media.spotify.playback.set',
		'system.media.spotify.volume.set',
		'system.media.chrome-youtube.volume.set',
		'system.lock',
		'system.sleep',
		'system.restart',
		'system.shutdown',
		'system.logout',
		'system.wifi.connect',
		'system.wifi.disconnect',
		'system.wifi.power.set',
		'input.pointer.move',
		'input.pointer.click',
		'input.pointer.scroll',
		'input.keyboard.type',
		'input.keyboard.shortcut',
		'screen.start',
		'screen.stop'
	]);
	assert.equal(normalizeDeviceCommand('session.send', { connectorId: 'chatgpt', sessionId: 'chat-1', text: 'hello', delivery: 'queue' }).ok, true);
	const preserved = normalizeDeviceCommand('session.send', { connectorId: 'chatgpt', sessionId: 'chat-1', text: ' hello ', delivery: 'queue' });
	assert.equal(preserved.ok ? preserved.input.text : null, ' hello ');
	assert.equal(normalizeDeviceCommand('session.send', { connectorId: 'chatgpt', sessionId: 'chat-1', text: 'hello', delivery: 'steer' }).ok, false);
	assert.equal(
		normalizeDeviceCommand('session.send', {
			connectorId: 'chatgpt',
			sessionId: 'chat-1',
			text: 'hello',
			delivery: 'steer',
			expectedTurnId: 'turn-1'
		}).ok,
		true
	);
	assert.equal(normalizeDeviceCommand('session.interrupt', { connectorId: 'chatgpt', sessionId: 'chat-1' }).ok, false);
	assert.equal(normalizeDeviceCommand('session.interrupt', { connectorId: 'chatgpt', sessionId: 'chat-1', turnId: 'turn-1' }).ok, true);
	assert.equal(
		normalizeDeviceCommand('session.list', { connectorId: 'chatgpt', search: 'Thingtime', cursor: 'opaque/page+2==', limit: 100 }).ok,
		true
	);
	assert.equal(normalizeDeviceCommand('session.read', { connectorId: 'chatgpt', sessionId: 'chat-1', cursor: 'older', limit: 101 }).ok, false);
	assert.equal(normalizeDeviceCommand('app.launch', { appId: '/Applications/Calculator.app' }).ok, false);
	assert.equal(normalizeDeviceCommand('app.force-quit', { appId: 'com.example.App' }).ok, true);
	assert.equal(normalizeDeviceCommand('app.force-quit', { appId: 'com.example.App', force: true }).ok, false);
	assert.equal(normalizeDeviceCommand('app.hide-others', {}).ok, true);
	assert.equal(normalizeDeviceCommand('app.hide-others', { scope: 'all' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.audio.mute.set', { muted: true }).ok, true);
	assert.equal(normalizeDeviceCommand('system.audio.input.volume.set', { level: 0.4 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.audio.input.mute.set', { muted: true }).ok, true);
	assert.equal(normalizeDeviceCommand('system.audio.sound-effects.volume.set', { level: 0.4 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.audio.sound-effects.mute.set', { muted: true }).ok, true);
	assert.equal(normalizeDeviceCommand('system.audio.input.volume.set', { level: 1.2 }).ok, false);
	assert.equal(normalizeDeviceCommand('system.audio.sound-effects.mute.set', { muted: true, level: 0.4 }).ok, false);
	assert.equal(normalizeDeviceCommand('system.audio.output.set', { deviceId: 'BuiltInOutputDevice' }).ok, true);
	assert.equal(normalizeDeviceCommand('system.sleep', {}).ok, true);
	assert.equal(normalizeDeviceCommand('system.sleep', { now: true }).ok, false);
	assert.equal(normalizeDeviceCommand('system.display.mode.set', { displayId: 42, modeId: '1920x1080@60000:0' }).ok, true);
	assert.equal(normalizeDeviceCommand('system.display.mode.set', { displayId: 42, modeId: 'x', profile: 'never' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.display.mirroring.set', { displayId: 42, sourceDisplayId: null }).ok, true);
	assert.equal(normalizeDeviceCommand('system.display.origin.set', { displayId: 42, x: -200, y: 0 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.printer.default.set', { id: 'printer-1' }).ok, true);
	assert.equal(normalizeDeviceCommand('system.bluetooth.device.connection.set', { id: 'bt-abc', connected: true }).ok, true);
	assert.equal(normalizeDeviceCommand('system.power.idle-timer.set', { scope: 'display', minutes: 10 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.power.idle-timer.set', { scope: 'display', minutes: 10.5 }).ok, false);
	assert.equal(normalizeDeviceCommand('system.power.idle-timer.set', { scope: 'all', minutes: 10 }).ok, false);
	assert.equal(normalizeDeviceCommand('system.power.idle-timer.set', { scope: 'disk', minutes: 0, profile: 'never' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.policy.airdrop.profile.propose', { enabled: false }).ok, true);
	assert.equal(normalizeDeviceCommand('system.policy.camera.profile.propose', { enabled: true }).ok, true);
	assert.equal(normalizeDeviceCommand('system.policy.camera.profile.propose', { enabled: true, payload: 'untrusted' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.apple-music.playback.set', { operation: 'play' }).ok, true);
	assert.equal(normalizeDeviceCommand('system.media.apple-music.playback.set', { operation: 'toggle' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.apple-music.playback.set', { operation: 'next', script: 'do shell script' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.apple-music.volume.set', { level: 0.35 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.media.apple-music.volume.set', { level: 1.1 }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.apple-music.volume.set', { level: 0.35, script: 'do shell script' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.spotify.playback.set', { operation: 'play' }).ok, true);
	assert.equal(normalizeDeviceCommand('system.media.spotify.playback.set', { operation: 'toggle' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.spotify.playback.set', { operation: 'next', script: 'do shell script' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.spotify.volume.set', { level: 0.35 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.media.spotify.volume.set', { level: -0.1 }).ok, false);
	assert.equal(normalizeDeviceCommand('system.media.chrome-youtube.volume.set', { level: 0.35 }).ok, true);
	assert.equal(normalizeDeviceCommand('system.media.chrome-youtube.volume.set', { level: 0.35, url: 'https://private.example' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.restart', {}).ok, true);
	assert.equal(normalizeDeviceCommand('system.restart', { command: 'rm -rf /' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.wifi.connect', { ssid: 'Thingtime Guest' }).ok, true);
	assert.equal(normalizeDeviceCommand('system.wifi.connect', { ssid: 'Thingtime Guest', password: 'never' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.wifi.connect', { ssid: ' Thingtime Guest' }).ok, false);
	assert.equal(normalizeDeviceCommand('system.wifi.connect', { ssid: 'x'.repeat(33) }).ok, false);
	assert.equal(normalizeDeviceCommand('system.wifi.disconnect', {}).ok, true);
	assert.equal(normalizeDeviceCommand('system.wifi.power.set', { enabled: false }).ok, true);
	assert.equal(normalizeDeviceCommand('input.pointer.move', { displayId: 42, x: 20, y: 30 }).ok, true);
	assert.equal(normalizeDeviceCommand('input.pointer.move', { displayId: 42, x: -1, y: 30 }).ok, false);
	assert.equal(normalizeDeviceCommand('input.pointer.click', { displayId: 42, x: 20, y: 30, button: 'left' }).ok, true);
	assert.equal(normalizeDeviceCommand('input.pointer.click', { displayId: 42, x: 20, y: 30, button: 'double' }).ok, false);
	assert.equal(normalizeDeviceCommand('input.pointer.scroll', { deltaX: 0, deltaY: -180 }).ok, true);
	assert.equal(normalizeDeviceCommand('input.pointer.scroll', { deltaX: 0, deltaY: 0 }).ok, false);
	assert.equal(normalizeDeviceCommand('input.keyboard.type', { text: 'Hello\\nThingtime' }).ok, true);
	assert.equal(normalizeDeviceCommand('input.keyboard.type', { text: 'unsafe\u0000text' }).ok, false);
	assert.equal(normalizeDeviceCommand('input.keyboard.type', { text: 'hello', script: 'do shell script' }).ok, false);
	assert.equal(normalizeDeviceCommand('input.keyboard.shortcut', { key: 'tab', modifiers: ['command', 'shift'] }).ok, true);
	assert.equal(normalizeDeviceCommand('input.keyboard.shortcut', { key: 'f13', modifiers: ['command'] }).ok, false);
	assert.equal(normalizeDeviceCommand('input.keyboard.shortcut', { key: 'tab', modifiers: ['command', 'command'] }).ok, false);
	assert.equal(normalizeDeviceCommand('system.lock', { shell: 'shutdown' }).ok, false);
	assert.equal(normalizeDeviceCommand('screen.start', { screenSessionId: 'screen-1', viewOnly: true, sdp: 'secret' }).ok, false);
});

test('revision and command transitions are replay safe', () => {
	assert.equal(decideDeviceRevision(null, null, 1, 'a'), 'insert');
	assert.equal(decideDeviceRevision(2, 'a', 1, 'b'), 'stale');
	assert.equal(decideDeviceRevision(2, 'a', 2, 'a'), 'same');
	assert.equal(decideDeviceRevision(2, 'a', 2, 'b'), 'conflict');
	assert.equal(decideDeviceRevision(2, 'a', 3, 'b'), 'update');
	assert.equal(canTransitionDeviceCommand('queued', 'claimed'), true);
	assert.equal(canTransitionDeviceCommand('needs-approval', 'queued'), true);
	assert.equal(canTransitionDeviceCommand('succeeded', 'claimed'), false);
	assert.equal(canLeaseDeviceCommand(false, 'not-required'), true);
	assert.equal(canLeaseDeviceCommand(true, 'pending'), false);
	assert.equal(canLeaseDeviceCommand(true, 'approved'), true);
	assert.equal(canLeaseDeviceCommand(true, 'denied'), false);
});

test('complete snapshot hashes gate connectors at the device revision', () => {
	const state = { locked: false, volume: 0.5, muted: false, brightness: 1, battery: null, openApps: [], audioDevices: [] };
	const connector = {
		id: 'codex',
		kind: 'codex',
		label: 'Codex',
		status: 'connected' as const,
		capabilities: ['session.read'],
		projects: []
	};
	const withConnector = deviceSnapshotHash(state, [connector]);
	assert.notEqual(withConnector, deviceSnapshotHash(state, []));
	assert.notEqual(withConnector, deviceSnapshotHash(state, [{ ...connector, capabilities: ['session.read', 'session.send'] }]));
	assert.equal(decideDeviceRevision(4, withConnector, 3, deviceSnapshotHash(state, [])), 'stale');
	assert.equal(decideDeviceRevision(4, withConnector, 4, deviceSnapshotHash(state, [])), 'conflict');
});

test('paired account execution preferences default to always allow, with reversible ask and deny modes', () => {
	assert.deepEqual(DEVICE_PERMISSION_MODES, ['always-allow', 'ask-every-time', 'deny']);
	assert.equal(normalizeDevicePermissionMode(undefined), 'always-allow');
	assert.equal(normalizeDevicePermissionMode('ask-every-time'), 'ask-every-time');
	assert.equal(normalizeDevicePermissionMode('deny'), 'deny');
	for (const kind of DEVICE_COMMAND_KINDS) {
		assert.equal(deviceCommandRequiresApproval(kind, false), ['app.force-quit', 'system.restart', 'system.shutdown', 'system.logout', 'system.power.idle-timer.set', 'system.policy.airdrop.profile.propose', 'system.policy.camera.profile.propose', 'system.media.apple-music.playback.set', 'system.media.apple-music.volume.set', 'system.media.spotify.playback.set', 'system.media.spotify.volume.set', 'system.media.chrome-youtube.volume.set', 'input.pointer.move', 'input.pointer.click', 'input.pointer.scroll', 'input.keyboard.type', 'input.keyboard.shortcut'].includes(kind), kind);
		assert.equal(deviceCommandRequiresApproval(kind, true), true, kind);
	}
	const semantic = { kind: 'claude-thingtime', capabilities: ['session.send', 'explicit-approval'] };
	assert.equal(deviceConnectorCommandRequiresApproval('session.send', false, semantic), false);
	assert.equal(deviceConnectorCommandRequiresApproval('session.send', true, semantic), true);
});

test('lease authorization rejects mismatches and equality-at-expiry while retention is strictly bounded', () => {
	const now = new Date('2026-08-18T00:00:00.000Z');
	assert.equal(DEVICE_COMMAND_LEASE_MS, 30_000);
	assert.equal(DEVICE_COMMAND_HEARTBEAT_INTERVAL_MS, 10_000);
	assert.equal(decideDeviceLease('hash', 'hash', new Date(now.getTime() + 1), now), 'active');
	assert.equal(decideDeviceLease('hash', 'hash', now, now), 'expired');
	assert.equal(decideDeviceLease('other', 'hash', new Date(now.getTime() + 1), now), 'invalid');
	assert.equal(retainedDeviceControlEventCount([400, 300, 200], 2, 1_000), 2);
	assert.equal(retainedDeviceControlEventCount([700, 400, 100], 10, 1_000), 1);
	assert.ok(deviceControlEventLogicalBytes({ payload: '🙂' }) > deviceControlEventLogicalBytes({ payload: 'a' }));
	assert.equal(DEVICE_CONTROL_EVENT_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
	assert.equal(DEVICE_CONTROL_EVENT_MAX_COUNT, 4_096);
	assert.equal(DEVICE_CONTROL_EVENT_MAX_BYTES, 8 * 1024 * 1024);
	assert.equal(DEVICE_LIVE_CONTROL_EVENT_RETENTION_MS, 30 * 60 * 1000);
	assert.equal(DEVICE_LIVE_CONTROL_EVENT_MAX_COUNT, 256);
	assert.equal(DEVICE_LIVE_CONTROL_EVENT_MAX_BYTES, 1024 * 1024);
	assert.equal(deviceConnectorIsFresh({ updatedAt: new Date(now.getTime() - DEVICE_CONNECTOR_FRESHNESS_MS + 1) }, now), true);
	assert.equal(deviceConnectorIsFresh({ updatedAt: new Date(now.getTime() - DEVICE_CONNECTOR_FRESHNESS_MS) }, now), false);
});

test('approval deadlines default safely and pending slots enforce a strict device cap', () => {
	const now = new Date('2026-08-18T00:00:00.000Z');
	assert.equal(deviceApprovalExpiry(undefined, now)?.getTime(), now.getTime() + DEVICE_APPROVAL_DEFAULT_TTL_MS);
	assert.equal(
		deviceApprovalExpiry(new Date(now.getTime() + DEVICE_APPROVAL_MAX_TTL_MS).toISOString(), now)?.getTime(),
		now.getTime() + DEVICE_APPROVAL_MAX_TTL_MS
	);
	assert.equal(deviceApprovalExpiry(now.toISOString(), now), null);
	assert.equal(deviceApprovalExpiry(new Date(now.getTime() + DEVICE_APPROVAL_MAX_TTL_MS + 1).toISOString(), now), null);
	assert.equal(availableDeviceApprovalSlot([0, 1, 3]), 2);
	assert.equal(availableDeviceApprovalSlot(Array.from({ length: MAX_PENDING_APPROVALS_PER_DEVICE }, (_, index) => index)), null);
});

test('terminal command cleanup preserves a previously billed prompt hash', () => {
	const now = new Date('2026-08-18T00:00:00.000Z');
	const first = deviceSessionSendRedactionFields(
		{
			crystal: { kind: 'session.send', input: { connectorId: 'codex', sessionId: 'chat-1', text: ' exact prompt ' } }
		},
		now
	);
	assert.equal(first['crystal.input.text'], '');
	assert.equal(first['crystal.inputTextHash'], devicePayloadHash(' exact prompt '));
	const alreadyRedacted = deviceSessionSendRedactionFields(
		{
			crystal: {
				kind: 'session.send',
				input: { connectorId: 'codex', sessionId: 'chat-1', text: '' },
				inputTextHash: first['crystal.inputTextHash']
			}
		},
		now
	);
	assert.equal(Object.prototype.hasOwnProperty.call(alreadyRedacted, 'crystal.inputTextHash'), false);
});

test('event cursors round-trip and malformed cursors fail closed', () => {
	const value = { at: new Date('2026-08-18T00:00:00.000Z'), id: 'event-1' };
	assert.deepEqual(decodeDeviceEventCursor(encodeDeviceEventCursor(value)), value);
	assert.equal(decodeDeviceEventCursor('not-json'), null);
});
