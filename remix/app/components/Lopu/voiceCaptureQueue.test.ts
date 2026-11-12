import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceCaptureQueue, type CaptureStore, type PendingVoiceCapture } from './voiceCaptureQueue';
const row = (eventId = 'event'): PendingVoiceCapture => ({ ownerId: 'owner', sessionId: 'session', eventId, chatId: null, role: 'user', text: 'A voice note', localId: eventId, capturedAt: 1 });
const store = (): CaptureStore => {
	const map = new Map<string, string>();
	return { keys: () => [...map.keys()], read: key => map.get(key) ?? null, write: (key, value) => { map.set(key, value); }, remove: key => { map.delete(key); } };
};
const ack = { ok: true, ownerId: 'owner', chatId: 'chat', messages: [{ id: 'saved' }] };
test('pending events survive a new queue instance and disappear only after a confirmed save', async () => {
	const disk = store(); const first = new VoiceCaptureQueue('owner', disk); first.add(row());
	const queue = new VoiceCaptureQueue('owner', disk); assert.equal(queue.list().length, 1);
	await assert.rejects(queue.flush(() => 'owner', async () => { throw new Error('offline'); }, async () => {}), /offline/);
	assert.equal(queue.list().length, 1);
	await queue.flush(() => 'owner', async item => { assert.deepEqual(item, row()); return ack; }, async () => {});
	assert.equal(new VoiceCaptureQueue('owner', disk).list().length, 0);
});
test('account changes never send old captures as the new account or reconcile into its UI', async () => {
	const queue = new VoiceCaptureQueue('owner', store()); queue.add(row()); let owner = 'other', calls = 0;
	await queue.flush(() => owner, async () => { calls++; return ack; }, async () => { throw new Error('Wrong UI'); }); assert.equal(calls, 0);
	owner = 'owner';
	await queue.flush(() => owner, async () => { calls++; owner = 'other'; return ack; }, async () => { throw new Error('Wrong UI'); }); assert.equal(calls, 1);
});
test('new events queued during an in-flight save are drained without duplicate parallel sends', async () => {
	const queue = new VoiceCaptureQueue('owner', store()); queue.add(row('one')); const sent: string[] = [];
	await queue.flush(() => 'owner', async item => { sent.push(item.eventId); if (item.eventId === 'one') queue.add(row('two')); return ack; }, async () => {});
	assert.deepEqual(sent, ['one', 'two']); assert.equal(queue.list().length, 0);
});
test('separate event records preserve another tab additions; malformed acknowledgments retain recovery data', async () => {
	const disk = store(), first = new VoiceCaptureQueue('owner', disk), second = new VoiceCaptureQueue('owner', disk);
	first.add(row('one')); second.add(row('two')); assert.equal(first.list().length, 2);
	await assert.rejects(first.flush(() => 'owner', async () => ({ ...ack, ownerId: 'other' }), async () => {})); assert.equal(first.list().length, 2);
	assert.throws(() => first.add({ ...row('one'), text: 'Changed text' }), /changed/);
	await assert.rejects(first.flush(() => 'owner', async () => ({ ...ack, messages: [] }), async () => {})); assert.equal(first.list().length, 2);
});
test('reload order is chronological and delimiter-containing IDs cannot collide', () => {
	const disk = store(), queue = new VoiceCaptureQueue('owner', disk);
	queue.add({ ...row('b'), sessionId: 'a:user', capturedAt: 2 });
	queue.add({ ...row('user:b'), sessionId: 'a', capturedAt: 1 });
	const restored = new VoiceCaptureQueue('owner', disk).list();
	assert.equal(restored.length, 2); assert.deepEqual(restored.map(item => item.capturedAt), [1, 2]);
});
test('storage failure retains an in-memory copy and bounded queues refuse overflow instead of dropping old items', () => {
	const disk = store(); disk.write = () => { throw new Error('storage denied'); };
	const queue = new VoiceCaptureQueue('owner', disk); assert.equal(queue.add(row()), false); assert.equal(queue.list().length, 1);
	for (let index = 1; index < 50; index++) queue.add(row(String(index)));
	assert.throws(() => queue.add(row('overflow')), /full/); assert.equal(queue.list().length, 50);
});
