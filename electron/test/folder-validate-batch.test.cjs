'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { folderBatchCanonicalBytes, validateFolderBatchInput, validateFolderBatchReply } = require('../lib/folder-validate-batch.cjs');
const { DesktopFolderSync } = require('../lib/folder-sync.cjs');
const vectors = require('../../remix/app/fileSync/fixtures/folderBatchDigest.v1.json').vectors;
const hash = d => createHash('sha256').update(folderBatchCanonicalBytes(d)).digest('hex');
function fixture() {
    const d = structuredClone(vectors[0].descriptor), origin = d.scope.origin;
    const input = { action:'validate-folder-batch', requestId:randomUUID(), ownerId:d.scope.ownerId, deviceId:d.scope.deviceId, origin,
        rootId:d.configuration.configuration.localRootId, batch:{descriptor:d,digest:hash(d),ordinals:[0,2]},remainingMs:180000 };
    const response = request => ({ ...request, roots:[], validatedFolderBatch:{ok:true,version:1,batchId:d.batchId,digest:input.batch.digest,
        results:request.batch.ordinals.map(ordinal => ({ordinal,status:'validated'}))} });
    const webContents = {mainFrame:{url:origin+'/settings/things'}}, window = {webContents,isDestroyed:()=>false};
    const event = {sender:webContents,senderFrame:webContents.mainFrame}; let accounts=0, native=0, postRefuse=false;
    const host = new DesktopFolderSync({context:()=>({enabled:true,window,appOrigin:origin,apiOrigin:origin}),
        verifyAccount:async()=>{accounts++;if(postRefuse && accounts>1) throw Error('refused');},
        requestNative:async(_method,request)=>{native++;return response(request);} });
    const context=host.capture(event,input);
    host.rememberPageCapability(context,input,{capabilities:{fileAccessVersion:'1.14.0',fileFolderBatchVersion:'1.0.0'},apiCapabilities:{features:{'api.file-sync-batches':{version:'1.1.0'}}}});
    return {d,input,response,host,event,context,counts:()=>({accounts,native}),refuse:()=>{postRefuse=true;}};
}
test('folder canonical bytes match shared ASCII, Unicode and V1 vectors',()=>{
    for(const v of vectors){assert.equal(folderBatchCanonicalBytes(v.descriptor).toString(),v.canonicalUtf8);assert.equal(hash(v.descriptor),v.sha256);}
});
test('exact missing subset stays metadata-only with two fresh host account checks',async()=>{
    const f=fixture();const result=await f.host.request(f.event,f.input);
    assert.deepEqual(result.validatedFolderBatch.results.map(x=>x.ordinal),[0,2]);assert.deepEqual(f.counts(),{accounts:2,native:1});
});
test('malformed bindings, aliases, parent closure and stale digests fail closed',()=>{
    const f=fixture();
    for(const mutate of [x=>x.batch.ordinals.reverse(),x=>x.batch.ordinals.push(2),x=>x.remainingMs=180001,
        x=>x.batch.descriptor.members[0].write.operation.mutation.source.fingerprint=null,x=>x.ownerId='other',x=>x.rootId='other']){
        const input=structuredClone(f.input);mutate(input);assert.throws(()=>validateFolderBatchInput(input,f.context));
    }
    const d=structuredClone(f.d);d.members[1].parent={kind:'existing',id:d.members[0].write.operation.id};assert.throws(()=>folderBatchCanonicalBytes(d));
});
test('reply subset/status drift and final fresh account refusal reject validated metadata',async()=>{
    const f=fixture();
    for(const mutate of [x=>x.validatedFolderBatch.results.reverse(),x=>x.validatedFolderBatch.results.pop(),
        x=>x.validatedFolderBatch.results[0].status='confirmed',x=>delete x.roots]){
        const reply=f.response(f.input);mutate(reply);assert.throws(()=>validateFolderBatchReply(f.input,reply));
    }
    f.refuse();await assert.rejects(f.host.request(f.event,f.input));
});
test('queued folder budget expires without dispatch and abort removes queued request',async()=>{
    const f=fixture();let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r);
    f.host.requestNative=async(_method,r)=>{if(r.action==='inspect'){entered();await gate;}return {...r,roots:[]};};
    const held=f.host.request(f.event,{...f.input,action:'inspect',batch:undefined,remainingMs:undefined});await start;
    const pending=assert.rejects(f.host.request(f.event,{...f.input,requestId:randomUUID(),remainingMs:15}));
    // Hold the event loop until timer deadline, then yield to ordinary cancellation.
    await new Promise(r=>setTimeout(r,25));await pending;release();await held;
    assert.equal(f.host.ordinaryQueue.length,0);
});
test('missing optional host/API capability refuses before native validation',async()=>{
    for(const capabilities of [{fileAccessVersion:'1.14.0'}, {fileAccessVersion:'1.14.0',fileFolderBatchVersion:'2.0.0'}]){
        const f=fixture();f.host.rememberPageCapability(f.context,f.input,{capabilities,apiCapabilities:{features:{'api.file-sync-batches':{version:'1.1.0'}}}});
        await assert.rejects(f.host.request(f.event,f.input));assert.equal(f.counts().native,0);
    }
    const f=fixture();f.host.nativePageCapability.apiCapabilities.features['api.file-sync-batches'].version='1.0.0';
    await assert.rejects(f.host.request(f.event,f.input));assert.equal(f.counts().native,0);
});
test('local envelope byte cap and unknown/canonical statuses are not native validation',()=>{
    const f=fixture(), oversize=structuredClone(f.input);oversize.batch.descriptor.configuration.configuration.name='x'.repeat(330000);
    assert.throws(()=>validateFolderBatchInput(oversize,f.context));
    for(const row of [{ordinal:0,status:'failed',code:'temporarily-unavailable',retryable:true},{ordinal:0,status:'confirmed'},{ordinal:0,status:'validated',file:{id:'private'}}]){
        const reply=f.response(f.input);reply.validatedFolderBatch.results[0]=row;assert.throws(()=>validateFolderBatchReply(f.input,reply));
    }
});
