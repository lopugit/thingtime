import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { createHash } from 'node:crypto';
let doc: any; const events: any[] = [], queries: any[] = [];
const at = (o: any, key: string) => key.split('.').reduce((v, k) => v?.[k], o);
const matches = (o: any, q: any): boolean => Object.entries(q).every(([key, value]: any) => {
  if (key === '$or') return value.some((clause: any) => matches(o, clause));
  const actual = at(o, key);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, expected]: any) =>
    op === '$gt' ? actual > expected : op === '$lte' ? actual != null && actual <= expected : op === '$in' ? expected.includes(actual) : op === '$ne' ? actual !== expected : false);
  return actual === value || (actual == null && value == null);
});
const collection = {
  findOne: async (q: any) => { queries.push(q); return matches(doc, q) ? structuredClone(doc) : null; },
  find: (q: any, options?: any) => { queries.push({filter:q, options}); const chain = {sort:()=>chain, limit:()=>chain, toArray:async()=>matches(doc,q)?[structuredClone(doc)]:[]}; return chain; },
  findOneAndUpdate: async(q: any, update: any) => {
    if (!matches(doc,q)) return null;
    for (const [key,value] of Object.entries(update.$set || {})) { const parts=key.split('.'); const last=parts.pop()!; let object=doc; for(const part of parts)object=object[part]??={}; object[last]=value; }
    return structuredClone(doc);
  },
  updateOne: async () => ({modifiedCount:0})
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {namedExports:{getHomeThingsCollection:async()=>collection, withHomeMongoTransaction:async(fn:any)=>fn({})}});
mock.module(new URL('./devices.ts', import.meta.url).href, {namedExports:{DEVICE_CONNECTOR_FRESHNESS_MS:30_000, appendDeviceEvent:async(event:any)=>events.push(event), deviceConnectorIsFresh:()=>true, deviceExistsForOwner:async(owner:string,id:string)=>owner==='owner'&&id==='mac'?{shareId:id}:null, newDeviceThing:()=>{throw Error('Not part of this test');}}});
const {claimNextDeviceCommand, reportDeviceCommand, readDeviceCommand, listDeviceCommands}=await import('./deviceCommands');
beforeEach(()=>{events.length=0; queries.length=0;doc={_id:'db-command',shareId:'cmd',thingtime:'device-command',ownerId:'owner',targetId:'mac',createdAt:new Date(),updatedAt:new Date(),crystal:{requestId:'write-1',kind:'filesystem',status:'queued',requiresApproval:false,approvalState:'not-required',lastReportKey:null,input:{op:'write',path:'sample.txt',transferId:'c510aa35-af02-46ad-a597-d786942fe4f1',offset:0,total:3,data:'YWJj',sha256:createHash('sha256').update('abc').digest('hex')}}};});

test('leased upload bytes reach only the node; validated replies are scoped, short-lived and redacted from history/events',async()=>{
  const claimed=await claimNextDeviceCommand('owner','mac',0); assert.equal(claimed.ok,true);if(!claimed.ok||!claimed.command)throw Error('not claimed');
  assert.equal(claimed.command.input.data,'YWJj');
  const report={commandId:'cmd',leaseId:claimed.command.leaseId,eventId:'finished',status:'succeeded',result:{path:'sample.txt',offset:3,complete:true}};
  const saved=await reportDeviceCommand('owner','mac',report);assert.equal(saved.ok,true);assert.equal(doc.crystal.input.data,'');
  assert.equal((await reportDeviceCommand('owner','mac',report) as any).idempotent,true);
  const read=await readDeviceCommand('owner','mac','cmd');assert.equal(read.ok,true);if(read.ok)assert.deepEqual(read.command.result,report.result);
  const history=await listDeviceCommands('owner','mac');assert.equal(history.ok,true);if(history.ok)assert.equal(history.commands[0].result,undefined);
  assert.ok(queries.some(q=>q.options?.projection?.['crystal.result']===0));
  assert.equal(JSON.stringify(events).includes('YWJj'),false);assert.equal(JSON.stringify(events).includes('sample.txt'),false);
  assert.ok(doc.crystal.deviceTtlAt.getTime()-Date.now()<=600_000);
  doc.crystal.resultExpiresAt=new Date(0);assert.equal((await readDeviceCommand('owner','mac','cmd') as any).command.result,undefined);
});
test('wrong owner/device/lease and mismatched result cannot write or retrieve another command',async()=>{
  assert.equal((await readDeviceCommand('other','mac','cmd')).ok,false);
  assert.equal((await readDeviceCommand('owner','other','cmd')).ok,false);
  assert.equal((await readDeviceCommand('owner','mac','other')).ok,false);
  const claimed=await claimNextDeviceCommand('owner','mac',0);if(!claimed.ok||!claimed.command)throw Error('not claimed');
  for(const patch of [{leaseId:'wrong'},{result:{path:'elsewhere',offset:3,complete:true}},{result:{path:'sample.txt',offset:2,complete:true}},{result:undefined}]){
    const result=await reportDeviceCommand('owner','mac',{commandId:'cmd',leaseId:claimed.command.leaseId,eventId:'bad',status:'succeeded',result:{path:'sample.txt',offset:3,complete:true},...patch});assert.equal(result.ok,false);
  }
  assert.equal(doc.crystal.status,'claimed');assert.equal(doc.crystal.result,undefined);
});
