import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { createRecordingTranscriptClient } from './recordingTranscriptClient';

test('coalesces duplicate mounted players into bounded batches and preserves account boundaries', async () => {
	const requests: Array<{ owner: string; ids: string[] }> = [];
	const client = createRecordingTranscriptClient(async (owner, ids) => {
		requests.push({ owner, ids }); return Object.fromEntries(ids.map((id) => [id, `${owner}:${id}`]));
	});
	const values: string[] = [];
	const stop = Array.from({ length: 23 }, (_, n) => client.subscribe('one', `id-${n}`, (text) => values.push(text!)));
	stop.push(client.subscribe('one', 'id-0', (text) => values.push(text!)));
	stop.push(client.subscribe('two', 'id-0', (text) => values.push(text!)));
	await wait(80);
	assert.deepEqual(requests.map((r) => [r.owner, r.ids.length]), [['one', 20], ['one', 3], ['two', 1]]);
	assert.equal(values.length, 25);
	stop.forEach((unsubscribe) => unsubscribe());
});
test('ignores stale responses across unmount, remount and refresh', async () => {
	const pending: Array<(value: Record<string, string>) => void> = [];
	const client = createRecordingTranscriptClient(() => new Promise((resolve) => pending.push(resolve)));
	const values: (string | null)[] = [];
	const first = client.subscribe('owner', 'audio', (text) => values.push(text));
	await wait(40); first();
	const second = client.subscribe('owner', 'audio', (text) => values.push(text));
	await wait(40); pending[0]({ audio: 'stale' }); pending[1]({ audio: 'fresh' });
	await wait(5); assert.deepEqual(values, ['fresh']);
	client.refreshAll(); await wait(40); pending[2]({});
	await wait(5); assert.deepEqual(values, ['fresh', null]); second();
});
test('a failed refresh does not erase a valid quote', async () => {
	let fail = false;
	const client = createRecordingTranscriptClient(async () => { if (fail) throw new Error('offline'); return { audio: 'saved' }; });
	const values: (string | null)[] = [];
	const stop = client.subscribe('owner', 'audio', (text) => values.push(text));
	await wait(40); fail = true; client.refreshAll(); await wait(40);
	assert.deepEqual(values, ['saved']); stop();
});
