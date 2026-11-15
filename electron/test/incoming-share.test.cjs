'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { incomingShareId, IncomingShareSession, NativeShareProcess } = require('../lib/incoming-share.cjs');
const id = '473d88da-4811-4c55-a882-884c91f547ad';
const origin = 'http://127.0.0.1:12345', endpoint = 'https://thingtime.com';
function fixture() {
 const frame = { url: origin + '/share?requestId=' + id }, sender = { mainFrame: frame };
 const window = { webContents: sender, isDestroyed: () => false };
 const current = { origin, endpoint }; let verified = 0; const bodies = [];
 const native = { request: async body => { bodies.push(body); return { ok: true }; }, close() { this.closed = true; } };
 const session = new IncomingShareSession({ requestId: id, window, origin, endpoint, context: () => current, verifyAccount: async () => { verified++; }, native });
 return { session, native, bodies, current, frame, sender, event: { sender, senderFrame: frame }, verified: () => verified };
}
const body = method => ({ method, requestId: id, accountId: 'owner' });
test('deep link accepts only exact UUID incoming path without extra authority or payload', () => {
 assert.equal(incomingShareId('thingtime-share://incoming/' + id), id);
 for (const url of ['https://incoming/' + id, 'thingtime-share://incoming/' + id + '?path=/etc/passwd', 'thingtime-share://incoming/' + id + '#x', 'thingtime-share://evil@incoming/' + id, 'thingtime-share://incoming:80/' + id, 'thingtime-share://incoming/../' + id, 'thingtime-share://incoming/%34' + id.slice(1), 'thingtime-share://incoming/not-a-uuid']) assert.equal(incomingShareId(url), null);
});
test('requires exact window, main frame, composer path and request ID', async () => {
 const f = fixture();
 for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { ...f.frame } }]) await assert.rejects(f.session.request(event, body('getIncomingShare')));
 f.frame.url = origin + '/things?requestId=' + id; await assert.rejects(f.session.request(f.event, body('getIncomingShare')));
 assert.equal(f.bodies.length, 0);
});
test('binds verified account and endpoint; rechecks mutation authority', async () => {
 const f = fixture(); await f.session.request(f.event, { method: 'manifest' }); assert.equal(f.verified(), 0);
 await f.session.request(f.event, body('getIncomingShare')); assert.equal(f.verified(), 1);
 await assert.rejects(f.session.request(f.event, { ...body('read'), accountId: 'other', fileId: 'a', offset: 0, length: 1 }));
 await f.session.request(f.event, body('beginSubmission')); assert.equal(f.verified(), 2);
 f.current.endpoint = 'https://other.example'; await assert.rejects(f.session.request(f.event, body('recordOutcome')));
});
test('bounds native range requests and fences async identity changes', async () => {
 const f = fixture(); await f.session.request(f.event, body('getIncomingShare'));
 for (const range of [{ offset: -1, length: 1 }, { offset: 0, length: 262145 }, { offset: 0, length: 1.5 }]) await assert.rejects(f.session.request(f.event, { ...body('read'), fileId: 'x', ...range }));
 f.native.request = async () => { f.current.endpoint = 'https://other.example'; return 'private'; };
 await assert.rejects(f.session.request(f.event, { ...body('read'), fileId: 'x', offset: 0, length: 1 }));
 f.session.close(); assert.equal(f.native.closed, true);
});
test('native helper serializes requests; close rejects pending and queued work', async () => {
 const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => {};
 let args; const native = new NativeShareProcess({ executable: '/helper', appGroup: 'group.test', requestId: id, origin, endpoint,
  spawnProcess: (_exe, values) => { args = values; return child; } });
 const lines = []; child.stdin.on('data', value => lines.push(String(value)));
 const first = native.request({ method: 'manifest' }), second = native.request(body('getIncomingShare'));
 await new Promise(resolve => setImmediate(resolve)); assert.equal(lines.length, 1); assert.deepEqual(args.slice(-2), ['--endpoint', endpoint]);
 child.stdout.write(JSON.stringify({ ok: true, result: { version: '1.0.0' } }) + '\n'); assert.deepEqual(await first, { version: '1.0.0' });
 await new Promise(resolve => setImmediate(resolve)); assert.equal(lines.length, 2);
 native.close(); await assert.rejects(second); await assert.rejects(native.request(body('read')));
});
test('recovery persists every UUID once, orders oldest, and refuses endpoint rebinding', () => {
 const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
 const { PendingShareStore } = require('../lib/incoming-share.cjs');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thingtime-share-recovery-'));
 try {
  const file = path.join(root, 'pending.json'), store = new PendingShareStore(file);
  store.add(id, endpoint); store.add(id, endpoint);
  const other = '473d88da-4811-4c55-a882-884c91f547ae'; store.add(other, 'https://other.example');
  assert.equal(store.list(endpoint).length, 1); assert.equal(new PendingShareStore(file).list(endpoint)[0].id, id);
  assert.throws(() => store.add(id, 'https://other.example'));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  store.remove(id, 'https://other.example'); assert.equal(store.list(endpoint).length, 1);
  store.remove(id, endpoint); assert.equal(store.list(endpoint).length, 0); assert.equal(store.list('https://other.example').length, 1);
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('claim begins before async account check so account changes can invalidate before disclosure', async () => {
 const f = fixture(); let release;
 f.session.verifyAccount = () => new Promise(resolve => { release = resolve; });
 const request = f.session.request(f.event, body('getIncomingShare'));
 assert.equal(f.session.accountId, 'owner'); f.session.close(); release(); await assert.rejects(request); assert.equal(f.bodies.length, 0);
});
test('an unverified preclaim never authorizes concurrent disclosure or retry after verification fails', async () => {
 const f = fixture(), attempts = [];
 f.session.verifyAccount = () => new Promise((resolve, reject) => attempts.push({ resolve, reject }));
 const first = f.session.request(f.event, body('getIncomingShare'));
 const second = f.session.request(f.event, body('getIncomingShare'));
 assert.equal(attempts.length, 2); assert.equal(f.bodies.length, 0);
 attempts[0].reject(Error('Not authenticated')); attempts[1].reject(Error('Not authenticated'));
 await assert.rejects(first); await assert.rejects(second);
 const retry = f.session.request(f.event, body('getIncomingShare'));
 assert.equal(attempts.length, 3); assert.equal(f.bodies.length, 0);
 attempts[2].resolve(); await retry; assert.equal(f.bodies.length, 1);
});
