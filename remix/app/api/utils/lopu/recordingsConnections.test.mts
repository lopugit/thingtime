import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { DEFAULT_RECORDING_SETTINGS } from './recordingsCore';

let lookedUp: string[];
let guarded: string[];
let token: string;
let vaultReady = true;
const entries = [
	{ id: 'audio', name: 'My audio key', provider: 'openai', endpoint: 'https://private-metadata.test', token: 'must-not-project' },
	{ id: 'claude', name: 'My Claude API key', provider: 'anthropic' },
	{ id: 'unsupported', name: 'Other connection', provider: 'unknown' }
];
mock.module(new URL('./personalRecordingDevices.ts', import.meta.url).href, { namedExports: {
	listPersonalRecordingDevices: async () => [{ id: 'worker', name: 'My worker', online: false, lastSeenAt: null }],
	validatePersonalRecordingDevice: async (_owner: string, id: unknown) => { if (id && id !== 'worker') throw new TypeError('foreign worker'); }
} });
mock.module(new URL('./userVault.ts', import.meta.url).href, {
	namedExports: {
		userVaultConfigured: () => vaultReady,
		listUserVaultProviders: async (owner: string) => {
			assert.equal(owner, 'owner');
			return entries;
		},
		getUserVaultProvider: async (owner: string, id: string) => {
			assert.equal(owner, 'owner');
			lookedUp.push(id);
			const entry = entries.find((entry) => entry.id === id);
			if (!entry) throw new Error('private database detail');
			return { ...entry, token, model: null, endpoint: 'https://api.example.test/v1' };
		}
	}
});
mock.module(new URL('./vaultProviderClient.ts', import.meta.url).href, {
	namedExports: {
		assertSafeProviderEndpoint: async (endpoint: string) => {
			guarded.push(endpoint);
			return { endpoint, rewritten: false };
		}
	}
});
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, {
	namedExports: {
		getRecordingSettings: async () => DEFAULT_RECORDING_SETTINGS
	}
});
const { listRecordingConnections, validateRecordingConnections, recordingConnectionStatus, resolveRecordingConnection } = await import(
	'./recordingsConnections'
);
beforeEach(() => {
	lookedUp = [];
	guarded = [];
	token = 'synthetic-api-key';
	vaultReady = true;
});
afterEach(() => mock.restoreAll());

test('choices expose only owner-scoped metadata, never tokens or endpoints', async () => {
	const choices = await listRecordingConnections('owner');
	assert.equal(
		choices.some((choice) => choice.id === 'unsupported'),
		false
	);
	assert.equal(choices.find((choice) => choice.id === 'claude')?.transcription, false);
	assert.doesNotMatch(JSON.stringify(choices), /token|endpoint|must-not-project|private-metadata/);
	assert.deepEqual(lookedUp, []);
});

test('validation rejects another owner connection and Claude audio before decrypting', async () => {
	await assert.rejects(validateRecordingConnections('owner', { analysisProviders: ['another-owner-key'] }), TypeError);
	await assert.rejects(validateRecordingConnections('owner', { transcriptionProviders: ['claude'] }), TypeError);
	await validateRecordingConnections('owner', { transcriptionProviders: ['configured', 'audio'], analysisProviders: ['claude'] });
	assert.deepEqual(lookedUp, []);
});

test('personal keys work without platform keys, and a disabled vault is not called configured', async () => {
	const settings = { ...DEFAULT_RECORDING_SETTINGS, transcriptionProviders: ['audio'], analysisProviders: ['claude'] };
	assert.equal((await recordingConnectionStatus('owner', settings)).configured, true);
	vaultReady = false;
	assert.equal((await recordingConnectionStatus('owner', settings)).configured, false);
});

test('only the selected owner key is resolved and its endpoint is guarded', async () => {
	const connection = await resolveRecordingConnection('owner', 'claude', 'analysis');
	assert.equal(connection.token, 'synthetic-api-key');
	assert.deepEqual(lookedUp, ['claude']);
	assert.deepEqual(guarded, ['https://api.example.test/v1']);
});

test('missing keys, Claude audio and setup tokens never reach an endpoint', async () => {
	await assert.rejects(resolveRecordingConnection('owner', 'absent', 'analysis'), /credentials/);
	await assert.rejects(resolveRecordingConnection('owner', 'claude', 'transcription'), /credentials/);
	token = 'sk-ant-oat-synthetic-not-an-api-key';
	await assert.rejects(resolveRecordingConnection('owner', 'claude', 'analysis'), /credentials/);
	assert.deepEqual(guarded, []);
});

test('a selected personal device can queue while offline without requiring cloud API credentials', async () => {
	await validateRecordingConnections('owner', { runtimeDeviceId: 'worker' });
	await assert.rejects(validateRecordingConnections('owner', { runtimeDeviceId: 'foreign' }), TypeError);
	const status = await recordingConnectionStatus('owner', { ...DEFAULT_RECORDING_SETTINGS, runtimeDeviceId: 'worker' });
	assert.equal(status.configured, true);
	assert.equal(status.mode, 'personal');
	assert.equal(status.device?.online, false);
	assert.equal((await recordingConnectionStatus('owner', { ...DEFAULT_RECORDING_SETTINGS, runtimeDeviceId: 'revoked' })).configured, false);
});
