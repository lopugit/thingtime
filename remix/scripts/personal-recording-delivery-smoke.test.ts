import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverySmokeOptions, syntheticRecordingWav } from './personal-recording-delivery-fixture';

test('recording delivery smoke refuses remote origins and non-disposable accounts', () => {
	for (const origin of ['https://thingtime.com', 'https://dev.thingtime.com', 'http://127.0.0.1:18000/path',
		'http://localhost.example.com', 'http://user:secret@localhost:18000', 'http://127.0.0.1:18000#fragment'])
		assert.throws(() => deliverySmokeOptions(origin, 'recqa-fixture', 'synthetic-password'));
	for (const username of ['lopu', 'admin', '', undefined])
		assert.throws(() => deliverySmokeOptions('http://127.0.0.1:18000', username, 'synthetic-password'));
	assert.throws(() => deliverySmokeOptions('http://127.0.0.1:18000', 'recqa-fixture', undefined));
	assert.equal(deliverySmokeOptions('http://127.0.0.1:18000', 'recqa-fixture', 'synthetic-password').username, 'recqa-fixture');
});

test('recording fixture is deterministic one-second PCM silence with an exact WAV header', () => {
	const audio = syntheticRecordingWav();
	assert.equal(audio.length, 32044);
	assert.equal(audio.subarray(0, 4).toString(), 'RIFF');
	assert.equal(audio.subarray(8, 16).toString(), 'WAVEfmt ');
	assert.equal(audio.readUInt32LE(4), audio.length - 8);
	assert.equal(audio.readUInt16LE(20), 1);
	assert.equal(audio.readUInt16LE(22), 1);
	assert.equal(audio.readUInt32LE(24), 16000);
	assert.equal(audio.readUInt16LE(34), 16);
	assert.equal(audio.readUInt32LE(40), 32000);
	assert.ok(audio.subarray(44).every(byte => byte === 0));
	assert.deepEqual(audio, syntheticRecordingWav());
});
