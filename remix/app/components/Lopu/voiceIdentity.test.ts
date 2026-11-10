import assert from 'node:assert/strict';
import test from 'node:test';
import { newLopuVoiceId } from './voiceIdentity';

test('voice and transcript request IDs retain their prefix and use cryptographic UUIDs', () => {
	const ids = Array.from({ length: 100 }, () => newLopuVoiceId('voice'));
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) assert.match(id, /^voice-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
	assert.match(newLopuVoiceId('lopu-native'), /^lopu-native-/);
});

test('voice IDs use the secure UUID result without timestamp or weak-random substitutions', (t) => {
	const uuid = 'c27d7512-ec68-4095-a8f8-b0684b7c0d55';
	const secure = t.mock.method(globalThis.crypto, 'randomUUID', () => uuid);
	t.mock.method(Math, 'random', () => { throw new Error('Weak randomness must not be used'); });
	assert.equal(newLopuVoiceId('lopu'), `lopu-${uuid}`);
	assert.equal(secure.mock.callCount(), 1);
});

test('voice IDs fail closed when secure randomness fails', (t) => {
	t.mock.method(globalThis.crypto, 'randomUUID', () => { throw new Error('Secure randomness unavailable'); });
	assert.throws(() => newLopuVoiceId('voice'), /Secure randomness unavailable/);
});
