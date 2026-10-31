import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileRangeFrame } from './mobileRangeFrames';
const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://sync.test' };
const bytes = new Uint8Array(65539).map((_, i) => i % 256);
const payload = { ...expected, token: crypto.randomUUID(), offset: 0, length: 65536 };
const message = (patch = {}) => ({ type: 'mobile-files-range-pull', payload: { ...payload, ...patch } });
test('binary frames bind sequential bounded bytes to the native nonce and scope', () => {
 const first = mobileRangeFrame(message(), expected, bytes, 0)!;
 assert.equal(first.nextOffset, 65536);
 assert.equal(new TextDecoder().decode(first.frame.slice(0, 36)), payload.token);
 assert.deepEqual(new Uint8Array(first.frame, 36), bytes.slice(0, 65536));
 const last = mobileRangeFrame(message({ offset: 65536, length: 3 }), expected, bytes, first.nextOffset)!;
 assert.equal(last.nextOffset, bytes.length);
 assert.deepEqual(new Uint8Array(last.frame, 36), bytes.slice(65536));
 for (const key of ['requestId', 'ownerId', 'origin']) assert.equal(mobileRangeFrame(message({ [key]: 'other' }), expected, bytes, 0), null);
 for (const patch of [{ offset: 1 }, { length: 0 }, { length: 65537 }, { length: 1.5 }, { token: 'bad' }])
  assert.throws(() => mobileRangeFrame(message(patch), expected, bytes, 0));
 assert.throws(() => mobileRangeFrame(message(), expected, bytes, first.nextOffset));
 assert.throws(() => mobileRangeFrame(message({ offset: 65536, length: 4 }), expected, bytes, 65536));
});
