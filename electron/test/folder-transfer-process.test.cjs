'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const { mock, test } = require('node:test');

const workers = [];
class Worker extends EventEmitter {
    connected = true;
    killed = false;
    sent = [];
    send(message, callback) {
        assert.equal(typeof callback, 'function');
        this.sent.push({ message, callback });
    }
    kill() { this.killed = true; }
    reply() {
        const { message } = this.sent.find(({ message }) => message.kind === 'hash');
        this.emit('message', { kind: 'reply', id: message.id, digest: 'synthetic-digest' });
    }
}

mock.method(childProcess, 'fork', () => {
    const worker = new Worker();
    workers.push(worker);
    return worker;
});
const { governedHash, TransferWorkerDisconnected } = require('../lib/folder-transfer-process.cjs');

function setup() {
    const governor = { policy: {}, clearTransport() {}, observeTransport() {} };
    const start = async () => {
        const pending = governedHash(governor, Buffer.from('immutable'), new AbortController().signal);
        await Promise.resolve();
        return { pending, worker: workers.at(-1) };
    };
    return { start, governor };
}

test('idle worker is removed before its delayed exit and cannot unset its replacement', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { start, governor } = setup();
    const first = await start();
    first.worker.reply();
    assert.equal(await first.pending, 'synthetic-digest');
    t.mock.timers.tick(1000);
    assert.equal(first.worker.killed, true);

    const next = await start();
    assert.notEqual(next.worker, first.worker);
    first.worker.emit('exit', null, 'SIGTERM');
    governor.onPolicyChange();
    assert.equal(next.worker.sent.at(-1).message.kind, 'policy');
    next.worker.reply();
    assert.equal(await next.pending, 'synthetic-digest');
    assert.equal(governor.pending, 0);
    t.mock.timers.tick(1000);
});

test('an uncertain send rejects in-flight work once and never redispatches it', async () => {
    const { start, governor } = setup();
    const { pending, worker } = await start();
    const other = await start();
    assert.equal(other.worker, worker);
    const rejection = Promise.all([
        assert.rejects(pending, TransferWorkerDisconnected),
        assert.rejects(other.pending, TransferWorkerDisconnected)
    ]);
    const before = workers.length;
    const { callback } = worker.sent.find(({ message }) => message.kind === 'hash');
    worker.connected = false;
    callback(Object.assign(new Error('Channel closed'), { code: 'ERR_IPC_CHANNEL_CLOSED' }));
    worker.emit('disconnect');
    worker.emit('error', new Error('Late child error'));
    await rejection;
    assert.equal(governor.pending, 0);
    assert.equal(workers.length, before);
    assert.equal(worker.sent.filter(({ message }) => message.kind === 'hash').length, 2);

    const next = await start();
    assert.notEqual(next.worker, worker);
    next.worker.reply();
    assert.equal(await next.pending, 'synthetic-digest');
});

test('child disconnect without a send failure still settles its pending operation', async () => {
    const { start, governor } = setup();
    const { pending, worker } = await start();
    const rejection = assert.rejects(pending, TransferWorkerDisconnected);
    worker.connected = false;
    worker.emit('disconnect');
    await rejection;
    assert.equal(governor.pending, 0);
});

test('a synchronous failure while updating reused-worker policy prevents request dispatch', async () => {
    const { start, governor } = setup();
    const first = await start();
    first.worker.reply();
    await first.pending;
    first.worker.send = () => { throw Object.assign(new Error('Channel closed'), { code: 'ERR_IPC_CHANNEL_CLOSED' }); };

    const next = await start();
    assert.equal(next.worker, first.worker);
    await assert.rejects(next.pending, TransferWorkerDisconnected);
    assert.equal(first.worker.sent.filter(({ message }) => message.kind === 'hash').length, 1);
    assert.equal(governor.pending, 0);
});
