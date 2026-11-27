import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceMongoOptions, pauseDevicePolling, retryDeviceSnapshot } from './devicePolling';

test('poll cancellation releases an idle wait and database budgets retain its signal', async () => {
	const controller = new AbortController();
	const options = { signal: controller.signal, deadlineAt: Date.now() + 1000 };
	const mongo = deviceMongoOptions(options);
	assert.equal(mongo.signal, controller.signal);
	assert.ok(mongo.timeoutMS > 0 && mongo.timeoutMS <= 1000);
	const waiting = pauseDevicePolling(20_000, options);
	controller.abort();
	await assert.rejects(waiting, { name: 'AbortError' });
	assert.throws(() => deviceMongoOptions(options), { name: 'AbortError' });
	assert.throws(() => deviceMongoOptions({ deadlineAt: Date.now() - 1 }), { name: 'TimeoutError' });
});

test('persistent snapshot collision exhausts bounded retries; unrelated failures are not retried', async () => {
	let attempts = 0;
	assert.equal(await retryDeviceSnapshot(async () => { attempts++; throw Object.assign(new Error('collision'), { code: 11000 }); }), null);
	assert.equal(attempts, 3);
	attempts = 0;
	await assert.rejects(retryDeviceSnapshot(async () => { attempts++; throw new Error('storage unavailable'); }), /storage unavailable/);
	assert.equal(attempts, 1);
});
