import test from 'node:test';
import assert from 'node:assert/strict';
import { stdioFrames } from './helpers/stdio-frames.mjs';

test('lifecycle reader preserves trailing fragmented JSON and UTF-8 until newline', () => {
  const first = { jsonrpc:'2.0',id:1,result:{name:'é preview'} };
  const second = { jsonrpc:'2.0',id:2,result:{tools:[]} };
  const one = Buffer.from(JSON.stringify(first)+'\n'), two = Buffer.from(JSON.stringify(second)+'\n');
  const utf8Split=one.indexOf(Buffer.from('é'))+1;
  const read=stdioFrames();
  assert.deepEqual(read(one.subarray(0,utf8Split)),[]);
  assert.deepEqual(read(Buffer.concat([one.subarray(utf8Split),two.subarray(0,19)])),[first]);
  assert.deepEqual(read(two.subarray(19,-1)),[],'complete JSON without newline remains buffered');
  assert.deepEqual(read(two.subarray(-1)),[second]);
});

test('lifecycle reader rejects malformed complete frames and bounded output overflow', () => {
  assert.throws(()=>stdioFrames()(Buffer.from('{invalid\n')));
  const read=stdioFrames(20);
  assert.deepEqual(read(Buffer.from('{"jsonrpc":"2.0"')),[]);
  assert.throws(()=>read(Buffer.from('0123456789')),/limit exceeded/);
});
