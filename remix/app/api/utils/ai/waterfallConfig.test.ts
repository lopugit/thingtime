import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiWaterfallConfig, validateAiWaterfallSelection, moveAiWaterfallEntry } from './waterfallConfig';
import { executeAiWaterfall } from './waterfallExecution';
import { AiTransportFailure, AiWaterfallFailure } from './providerWaterfall';
const entries = [
	{ endpointId: 'server:openai', modelId: 'gpt-5.6-sol', effort: 'high', speed: 'normal' as const },
	{ endpointId: 'vault:custom', modelId: 'vendor/model', effort: null, speed: 'normal' as const },
	{ endpointId: 'server:anthropic', modelId: 'claude-opus-5', effort: 'max', speed: 'fast' as const }
];
test('portable config retains mixed endpoints, model variants and order without credentials', () => {
	assert.deepEqual(parseAiWaterfallConfig({ version: 1, entries }).entries, entries);
	assert.deepEqual(moveAiWaterfallEntry(entries, 2, 0), [entries[2], entries[0], entries[1]]);
	for (const patch of [{ token: 'secret' }, { endpoint: 'https://example.test' }, { ownerId: 'other' }])
		assert.throws(() => parseAiWaterfallConfig({ version: 1, entries, ...patch }));
	assert.throws(() => parseAiWaterfallConfig({ version: 1, entries: [entries[0], entries[0]] }));
	assert.throws(() => parseAiWaterfallConfig({ version: 1, entries: [{ ...entries[0], modelId: '--inject' }] }));
	assert.throws(() => validateAiWaterfallSelection({ version: 1, entries }, []));
});
test('endpoint-specific catalogs validate effort and custom model choices', () => {
	const endpoint = { id: 'vault:custom', label: 'Custom', models: [], allowCustomModel: true };
	assert.deepEqual(validateAiWaterfallSelection({ version: 1, entries: [entries[1]] }, [endpoint]).entries, [entries[1]]);
	assert.throws(() => validateAiWaterfallSelection({ version: 1, entries: [entries[1]] }, [{ ...endpoint, allowCustomModel: false }]));
});
test('mixed-provider runtime falls through only availability failures in exact order', async () => {
	const calls: string[] = [];
	const result = await executeAiWaterfall({
		config: { version: 1, entries },
		authorize: async () => {},
		attempt: async (entry) => {
			calls.push(entry.endpointId);
			if (calls.length < 3) throw new AiTransportFailure(calls.length === 1 ? 429 : 503);
			return 'resolved';
		}
	});
	assert.equal(result.value, 'resolved');
	assert.equal(result.index, 2);
	assert.deepEqual(
		calls,
		entries.map((entry) => entry.endpointId)
	);
});
test('foreign connection, malformed model output and cancellation never advance', async () => {
	let calls = 0;
	await assert.rejects(
		executeAiWaterfall({
			config: { version: 1, entries },
			authorize: async (entry) => {
				if (entry.endpointId.startsWith('vault:')) throw new TypeError('foreign');
			},
			attempt: async () => {
				calls++;
			}
		}),
		/foreign/
	);
	assert.equal(calls, 0);
	await assert.rejects(
		executeAiWaterfall({
			config: { version: 1, entries },
			authorize: async () => {},
			attempt: async () => {
				calls++;
				throw new Error('malformed result');
			}
		}),
		/malformed/
	);
	assert.equal(calls, 1);
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(
		executeAiWaterfall({
			config: { version: 1, entries },
			signal: abort.signal,
			authorize: async () => {},
			attempt: async () => {
				calls++;
			}
		})
	);
	assert.equal(calls, 1);
});
test('exhaustion returns only redacted availability receipts', async () => {
	await assert.rejects(
		executeAiWaterfall({
			config: { version: 1, entries },
			authorize: async () => {},
			attempt: async () => {
				throw new AiTransportFailure(401);
			}
		}),
		(error: unknown) => error instanceof AiWaterfallFailure && error.attempts.length === 3
	);
});
