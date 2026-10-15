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
test('concurrent reads and active media references are bounded', async () => {
 let running=0,max=0;const complete: (()=>void)[]=[];
 const registry=new LocalMediaRegistry({lease:()=>({assertCurrent(){},onInvalidate(){return()=>{}}}), read:async()=>{running++;max=Math.max(max,running);await new Promise<void>(resolve=>complete.push(resolve));running--;return {bytes:new Uint8Array(1),contentType:'image/png'}},create:()=> 'blob:fixture',revoke(){}});
 const release=Array.from({length:64},(_,n)=>registry.retain(`local-${n}`)); await flush(); assert.equal(max,3);
 assert.throws(()=>registry.retain('local-overflow'),/Too many/);
 release.forEach(fn=>fn()); complete.forEach(fn=>fn()); await flush(); assert.equal(running,0);
});
