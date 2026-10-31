import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecordingSettingsPatch, recordingSettingsOf, recordingFailureMessage } from './recordingsCore';
import { canFallbackRecordingProvider, recordingProviderSupports, runRecordingWaterfall } from './recordingsWaterfall';

test('waterfalls preserve explicit order, reject duplicates and bound connection counts', () => {
	assert.deepEqual(parseRecordingSettingsPatch({ analysisProviders: ['second', 'first'] }), { analysisProviders: ['second', 'first'] });
	for (const ids of [[], ['a', 'a'], ['a', 'b', 'c', 'd', 'e'], ['https://secret.test'], [7]]) {
		assert.throws(() => parseRecordingSettingsPatch({ analysisProviders: ids }));
	}
	assert.deepEqual(recordingSettingsOf({}).transcriptionProviders, ['configured']);
	assert.equal(recordingProviderSupports('anthropic', 'transcription'), false);
	assert.equal(recordingProviderSupports('anthropic', 'analysis'), true);
	assert.equal(recordingProviderSupports('openai', 'transcription'), true);
	assert.equal(recordingProviderSupports('unknown', 'analysis'), false);
});

test('a limited credential advances in order and stops at the first success', async () => {
	const calls: string[] = [];
	const value = await runRecordingWaterfall({
		ids: ['limited', 'working', 'unused'],
		stage: 'analysis',
		beforeAttempt: async (id) => {
			calls.push(`consent:${id}`);
		},
		attempt: async (id, signal) => {
			assert.equal(signal.aborted, false);
			calls.push(id);
			if (id === 'limited') throw { status: 429, message: 'secret' };
			return 'ok';
		}
	});
	assert.equal(value, 'ok');
	assert.deepEqual(calls, ['consent:limited', 'limited', 'consent:working', 'working']);
});

test('consent revocation stops before the next credential receives private content', async () => {
	let attempts = 0;
	const revoked = new Error('consent revoked');
	await assert.rejects(
		runRecordingWaterfall({
			ids: ['first', 'second'],
			stage: 'transcription',
			beforeAttempt: async () => {
				if (attempts) throw revoked;
			},
			attempt: async () => {
				attempts++;
				throw { status: 429 };
			}
		}),
		(error) => error === revoked
	);
	assert.equal(attempts, 1);
});

test('non-retryable failures stop the waterfall and cannot expose raw errors', async () => {
	let attempts = 0;
	await assert.rejects(
		runRecordingWaterfall({
			ids: ['first', 'second'],
			stage: 'analysis',
			beforeAttempt: async () => {},
			attempt: async () => {
				attempts++;
				throw { status: 400, message: 'private transcript and credential' };
			}
		}),
		(error) => {
			assert.doesNotMatch(recordingFailureMessage(error), /private transcript|credential/);
			return true;
		}
	);
	assert.equal(attempts, 1);
});

test('only recognized transient failures advance, and every connection is tried at most once', async () => {
	for (const status of [401, 403, 408, 429, 500, 502, 503, 504, 529]) assert.equal(canFallbackRecordingProvider({ status }), true);
	for (const status of [400, 404, 409, 422]) assert.equal(canFallbackRecordingProvider({ status }), false);
	assert.equal(canFallbackRecordingProvider(new DOMException('timed out', 'TimeoutError')), true);
	assert.equal(canFallbackRecordingProvider(new Error('unsafe endpoint')), false);
	const calls: string[] = [];
	await assert.rejects(
		runRecordingWaterfall({
			ids: ['a', 'a', 'b', 'c', 'd', 'e'],
			stage: 'transcription',
			beforeAttempt: async () => {},
			attempt: async (id) => {
				calls.push(id);
				throw { status: 429, message: 'secret' };
			}
		}),
		/rate-limited or out of quota/
	);
	assert.deepEqual(calls, ['a', 'b', 'c', 'd']);
});
