import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';

let stored = ''; let denied = false; let dropWrite = false; let dropDelete = false;
const invocations: { executable: string; args: string[]; input: string | undefined }[] = [];
mock.module('node:child_process', { namedExports: { spawn(executable: string, args: string[]) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.kill = () => {};
  child.stdin.end = (input?: string) => queueMicrotask(() => {
    invocations.push({ executable, args, input });
    if (denied) { child.stderr.emit('data', Buffer.from('Private diagnostic must not escape')); child.emit('close', 36); return; }
    if (args[0] === 'delete-generic-password') {
      if (!dropDelete) stored = '';
      child.emit('close', 0);
    } else if (args[0] === '-i') {
      if (!dropWrite) stored = input!.match(/ -w ([A-Za-z0-9_-]+)\n$/)![1];
      child.emit('close', 0);
    } else if (stored) { child.stdout.emit('data', Buffer.from(`${stored}\n`)); child.emit('close', 0); }
    else child.emit('close', 44);
  });
  return child;
} } });
const { createPersonalRecordingKeychain } = await import('./personal-recording-keychain.ts');
const origin = 'https://keychain.example.invalid';
const state = { version: 1 as const, origin, credential: `ttnode_${'a'.repeat(43)}`, deviceId: 'test-computer' };

test('Keychain writes use stdin only and verify a private read-back', { skip: process.platform !== 'darwin' }, async () => {
  stored = ''; denied = false; dropWrite = false; invocations.length = 0;
  const store = createPersonalRecordingKeychain(origin);
  assert.equal(await store.read(), null);
  await store.write(state);
  assert.deepEqual(await store.read(), state);
  for (const invocation of invocations) {
    assert.equal(invocation.executable, '/usr/bin/security');
    assert.equal(JSON.stringify(invocation.args).includes(state.credential), false);
    assert.equal(invocation.args.includes(stored), false);
  }
  assert.deepEqual(invocations.find((call) => call.input)?.args, ['-i']);
});

test('denied and corrupt vault reads are not treated as absent or printed', { skip: process.platform !== 'darwin' }, async () => {
  const store = createPersonalRecordingKeychain(origin);
  denied = true;
  await assert.rejects(store.read(), /Unlock or allow access/);
  denied = false; stored = 'not-valid-json';
  await assert.rejects(store.read(), /item is invalid/);
});

test('failed write read-back and wrong-origin writes fail closed', { skip: process.platform !== 'darwin' }, async () => {
  stored = ''; denied = false; dropWrite = true;
  const store = createPersonalRecordingKeychain(origin);
  await assert.rejects(store.write(state), /Could not verify/);
  await assert.rejects(store.write({ ...state, origin: 'https://foreign.invalid' }), /origin mismatch/);
});

test('discarding pending recovery is origin-bound, checked and never removes a completed pairing', { skip: process.platform !== 'darwin' }, async () => {
  stored = ''; denied = false; dropWrite = dropDelete = false; invocations.length = 0;
  const store = createPersonalRecordingKeychain(origin);
  const pending = { version: 1 as const, origin, credential: state.credential,
    pending: { secret: 'synthetic', publicKey: 'synthetic', privateKey: 'synthetic', nonce: 'synthetic' } };
  await store.write(pending);
  await assert.rejects(store.discardPending({ ...pending, origin: 'https://other.invalid' }), /unfinished/);
  await assert.rejects(store.discardPending({ ...pending, credential: `ttnode_${'b'.repeat(43)}` }), /changed/);
  assert.equal(invocations.some(call => call.args[0] === 'delete-generic-password'), false);
  await store.discardPending(pending);
  assert.equal(await store.read(), null);
  await store.write(state);
  await assert.rejects(store.discardPending(state), /unfinished/);
  assert.deepEqual(await store.read(), state);
  assert.equal(invocations.filter(call => call.args[0] === 'delete-generic-password').length, 1);
});

test('pending recovery removal fails closed when denied or not actually deleted', { skip: process.platform !== 'darwin' }, async () => {
  stored = ''; denied = false; dropWrite = false; dropDelete = true;
  const store = createPersonalRecordingKeychain(origin);
  const pending = { version: 1 as const, origin, credential: state.credential,
    pending: { secret: 'synthetic', publicKey: 'synthetic', privateKey: 'synthetic', nonce: 'synthetic' } };
  await store.write(pending);
  await assert.rejects(store.discardPending(pending), /verify removal/);
  assert.deepEqual(await store.read(), pending);
  denied = true;
  await assert.rejects(store.discardPending(pending), /Unlock or allow/);
  denied = false; dropDelete = false;
});
