import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalMediaRegistry, localMediaId } from './media';
const flush = async () => { for (let n=0; n<12; n++) await Promise.resolve(); };
const setup = () => {
 let current = true, reads = 0; const revoked: string[] = [], created: string[] = [], listeners = new Set<() => void>();
 const registry = new LocalMediaRegistry({ lease: () => ({ assertCurrent() { if (!current) throw new Error('retired'); }, onInvalidate(cb) { listeners.add(cb); return () => listeners.delete(cb); } }),
  read: async () => { reads++; return { bytes: new Uint8Array([1,2,3]), contentType: 'text/html' }; },
  create: (_bytes, type) => { created.push(type); return `blob:fixture-${created.length}`; }, revoke: url => revoked.push(url) });
 return { registry, revoked, created, reads: () => reads, retire() { current = false; listeners.forEach(cb => cb()); } };
};
test('local media accepts canonical device references without capturing remote or account IDs', () => {
 assert.equal(localMediaId('/api/v1/attachments/content?id=local-file-123&width=320'), 'local-file-123');
 for (const url of ['https://elsewhere.test/api/v1/attachments/content?id=local-123', '/api/v1/attachments/content?id=server-123', '/api/v1/attachments/content?id=local-123&id=local-456', '/other?id=local-123']) assert.equal(localMediaId(url),null);
});
test('preview bytes are loaded once, unsafe MIME becomes opaque, and references revoke on final release', async () => {
 const f=setup(); const first=f.registry.retain('local-a'), second=f.registry.retain('local-a');
 assert.equal(f.registry.url('local-a'),''); await flush();
 assert.equal(f.reads(),1); assert.equal(f.registry.url('local-a'),'blob:fixture-1'); assert.deepEqual(f.created,['application/octet-stream']);
 first(); assert.deepEqual(f.revoked,[]); second(); assert.deepEqual(f.revoked,['blob:fixture-1']); assert.equal(f.registry.url('local-a'),'');
});
test('workspace retirement and deletion revoke existing URLs and discard late byte reads', async () => {
 const f=setup(); const release=f.registry.retain('local-a'); await flush(); f.retire();
 assert.equal(f.registry.url('local-a'),''); assert.deepEqual(f.revoked,['blob:fixture-1']); release();
 const late=setup(); const releaseLate=late.registry.retain('local-a'); late.retire(); await flush(); assert.deepEqual(late.created,[]); releaseLate();
 const deleted=setup(); const releaseDeleted=deleted.registry.retain('local-a'); await flush(); deleted.registry.removed(['local-a']); assert.equal(deleted.registry.url('local-a'),''); assert.match(deleted.registry.errors()[0],/deleted/); releaseDeleted();
});
test('more than 64 active references use bounded concurrent reads', async () => {
 let running=0,max=0;const complete: (()=>void)[]=[];
 const registry=new LocalMediaRegistry({lease:()=>({assertCurrent(){},onInvalidate(){return()=>{}}}), read:async()=>{running++;max=Math.max(max,running);await new Promise<void>(resolve=>complete.push(resolve));running--;return {bytes:new Uint8Array(1),contentType:'image/png'}},create:()=> 'blob:fixture',revoke(){}});
 const release=Array.from({length:100},(_,n)=>registry.retain(`local-${n}`)); await flush(); assert.equal(max,3);
 assert.deepEqual(registry.errors(), []);
 release.forEach(fn=>fn()); complete.forEach(fn=>fn()); await flush(); assert.equal(running,0);
});

test('shared access and caller-selected scope never select device bytes', () => {
 for (const suffix of ['&key=secret','&sharedRoot=page','&ownerId=someone','&origin=https://other.test','&dataPlane=other']) {
  assert.equal(localMediaId('/api/v1/attachments/content?id=local-file-123' + suffix), null);
 }
 assert.equal(localMediaId('/api/v1/attachments/content?id=local-file-123&download=1'), 'local-file-123');
});
test('scope-only invalidation clears deleted bytes and allows a retained file to be restored', async () => {
 let missing = false, count = 0; const revoked: string[] = [];
 const registry = new LocalMediaRegistry({ lease: () => ({ assertCurrent() {}, onInvalidate() { return () => {}; } }),
  read: async () => { if (missing) throw Error('File no longer exists'); return {bytes: new Uint8Array([1]),contentType:'image/png'}; },
  create: () => `blob:${++count}`, revoke: url => revoked.push(url) });
 const release = registry.retain('local-file'); await flush(); assert.equal(registry.url('local-file'),'blob:1');
 missing = true; registry.refresh(); await flush();
 assert.equal(registry.url('local-file'),''); assert.deepEqual(revoked,['blob:1']); assert.match(registry.errors()[0],/no longer exists/);
 registry.removed(['local-file']); missing = false; registry.refresh(); await flush();
 assert.equal(registry.url('local-file'),'blob:2'); assert.deepEqual(registry.errors(),[]);
 release(); assert.deepEqual(revoked,['blob:1','blob:2']);
});
test('invalidation coalesces reads and cannot expose a stale completion after deletion', async () => {
 const reads: ((bytes: {bytes:Uint8Array;contentType:string}) => void)[] = [], created: string[] = [];
 const registry = new LocalMediaRegistry({ lease: () => ({ assertCurrent() {}, onInvalidate() { return () => {}; } }),
  read: () => new Promise(resolve => reads.push(resolve)), create: bytes => { const url = `blob:${(bytes as Uint8Array)[0]}`; created.push(url); return url; }, revoke() {} });
 const release = registry.retain('local-file'); await flush();
 for (let n=0;n<100;n++) registry.refresh();
 registry.removed(['local-file']); assert.equal(reads.length,1);
 reads[0]({bytes:new Uint8Array([1]),contentType:'image/png'}); await flush();
 assert.deepEqual(created,[]); assert.equal(reads.length,2);
 reads[1]({bytes:new Uint8Array([2]),contentType:'image/png'}); await flush();
 assert.equal(registry.url('local-file'),'blob:2'); assert.deepEqual(created,['blob:2']); release();
});
test('disposing a scope revokes loaded URLs and discards queued and late reads', async () => {
 const completions: (() => void)[] = [], created: string[] = [], revoked: string[] = [];
 let reads = 0, listeners = 0;
 const registry = new LocalMediaRegistry({ lease: () => ({assertCurrent(){},onInvalidate(){listeners++;return()=>{listeners--;};}}),
  read: async () => { reads++; if (reads > 1) await new Promise<void>(resolve=>completions.push(resolve)); return {bytes:new Uint8Array(1),contentType:'image/png'}; },
  create: () => {const url=`blob:${created.length}`;created.push(url);return url;}, revoke: url=>revoked.push(url) });
 const releases=[registry.retain('local-first')];await flush();
 for(let n=0;n<10;n++) releases.push(registry.retain(`local-${n}`)); await flush();
 assert.equal(reads,4); registry.dispose(); assert.equal(listeners,0);
 assert.deepEqual(revoked,['blob:0']); assert.equal(registry.url('local-first'),'');
 completions.forEach(resolve=>resolve()); await flush();
 assert.equal(reads,4); assert.deepEqual(created,['blob:0']); releases.forEach(release=>release());
});


test('large Blob previews retain native handles and abort released reads', async () => {
 const chunk = new Uint8Array(1024 * 1024), blob = new Blob(Array.from({length:70}, () => chunk));
 let received: Blob | Uint8Array | undefined, active: AbortSignal | undefined;
 const registry = new LocalMediaRegistry({lease:()=>({assertCurrent(){},onInvalidate(){return()=>{}}}),
  read: async (_id, signal) => { active = signal; return {bytes: blob, contentType: 'image/png'}; },
  create: value => { received=value; return 'blob:large'; }, revoke() {}});
 const release = registry.retain('local-large'); await flush();
 assert.equal(received, blob); assert.equal(registry.url('local-large'), 'blob:large'); assert.deepEqual(registry.errors(), []);
 release();
 let released = false;
 const waiting = new LocalMediaRegistry({lease:()=>({assertCurrent(){},onInvalidate(){return()=>{}}}),
  read: async (_id, signal) => { active=signal; await new Promise<void>(resolve => signal.addEventListener('abort', () => { released=true;resolve(); }, {once:true})); return {bytes:blob,contentType:'image/png'}; }, create: () => { throw Error('Cancelled preview must not create a URL'); }, revoke() {}});
 const stop=waiting.retain('local-waiting'); await flush(); stop(); await flush();
 assert.equal(active?.aborted,true); assert.equal(released,true); assert.deepEqual(waiting.errors(),[]);
});
