'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FolderBatchStream, encodeBatchInput } = require('../lib/folder-batch-stream.cjs');
const { runProcess } = require('../lib/thingtime-node-bridge.cjs');
const request = { id: 'wire', method: 'folder-sync.request', parameters: { action: 'upload-batch' } };
const line = v => Buffer.from(JSON.stringify(v) + '\n');
test('batch duplex runner keeps stdin open and acknowledges only fixed indexed callbacks', async () => {
    const replies = [], stream = new FolderBatchStream(request, async frame => {
        assert.equal(frame.kind, 'put-ready'); assert.equal(frame.ordinal, 3); replies.push(frame); return { status: 'accepted', payloadBytes: 7 };
    }, error => { throw error; });
    const program = `let b=Buffer.alloc(0),header=false;process.stdin.on('data',c=>{b=Buffer.concat([b,c]);if(!header){if(b.length<4)return;let n=b.readUInt32BE();if(b.length<4+n)return;b=b.subarray(4+n);header=true;process.stdout.write(JSON.stringify({type:'batch',callbackId:1,frame:{kind:'put-ready',ordinal:3,sha256:'a'.repeat(64)}})+'\\n');}let i=b.indexOf(10);if(i>=0){let a=JSON.parse(b.subarray(0,i));if(a.callbackId!==1||a.reply.payloadBytes!==7)process.exit(2);process.stdout.write(JSON.stringify({type:'result',response:{id:'wire',ok:true,result:{}}})+'\\n');process.exit(0);}});`;
    const result = await runProcess(process.execPath, ['-e', program], { input: encodeBatchInput(request), timeoutMs: 3000,
        onInput: write => stream.connect(write), onStdout: bytes => stream.write(bytes) });
    assert.equal(result.status, 0); assert.equal(stream.finish().ok, true); assert.equal(replies.length, 1);
});
test('malformed, duplicate and late batch frames fail closed without executing arbitrary controls', async () => {
    for (const frame of [{ type: 'batch', callbackId: 2, frame: { kind: 'put-ready' } },
        { type: 'batch', callbackId: 1, frame: { kind: 'fetch', url: 'https://forbidden.test' } },
        { type: 'batch', callbackId: 1, frame: { kind: 'put-ready' }, extra: true }]) {
        let called = false; const stream = new FolderBatchStream(request, async () => { called = true; return {}; }, () => {});
        stream.connect(() => {}); assert.throws(() => stream.write(line(frame))); assert.equal(called, false);
    }
    let resolve, sent = 0;
    const stream = new FolderBatchStream(request, () => new Promise(r => { resolve = r; }), () => {});
    stream.connect(() => { sent++; }); stream.write(line({ type: 'batch', callbackId: 1, frame: { kind: 'put-ready' } }));
    await new Promise(setImmediate); stream.close(); resolve({ status: 'accepted' }); await new Promise(setImmediate); assert.equal(sent, 0);
    assert.throws(() => stream.write(line({ type: 'batch', callbackId: 2, frame: { kind: 'put-ready' } })));
});
