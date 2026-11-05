import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstructionTransferHandler } from './instructionTransferHandler';
const fixture = () => {
 let account: any = { user: { id: 'alice', accountKind: 'user' } }, plane: any = 'home', reads = 0, writes = 0, limit = true;
 const handler = createInstructionTransferHandler({ getAuthToken: async () => 'test-token', resolveTokenUser: async () => { reads++; return account; }, mongoDataPlane: () => plane, enforceRateLimit: async () => ({ allowed: limit, retryAfterSeconds: 60 } as any), getLopuBasePrompt: async () => ({ revision: null, basePrompt: 'base' }), executeInstructionTransfer: async (_owner, _scope, _command, admit) => { writes++; await admit(); return { personal: { revision: null, instructions: [] } }; } } as any);
 const request = (headers: Record<string,string> = {}, body: any = { operation: 'instruction-transfer', expectedOwnerId: 'alice', command: { action: 'snapshot' } }) => new Request('https://thingtime.com/api/v1/settings/lopu-prompt', { method: 'POST', headers: { Origin:'https://thingtime.com','Content-Type':'application/json','X-Thingtime-Expected-Data-Plane':'home', ...headers }, body: JSON.stringify(body) });
 return { call: (headers?:Record<string,string>,body?:any) => handler(request(headers,body)), reads:()=>reads,writes:()=>writes,setAccount:(value:any)=>{account=value;},setPlane:(value:any)=>{plane=value;},setLimit:(value:boolean)=>{limit=value;} };
};
test('resumable instructions authenticate full selected Character and repeatedly fence account and home storage context', async () => {
 const f = fixture(), response = await f.call(); assert.equal(response.status,200); const body:any=await response.json(); assert.equal(body.storagePlane,'home'); assert.equal(body.ownerId,'alice'); assert.equal(body.base.basePrompt,'base'); assert.ok(f.reads()>=3); assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.equal((await f.call({Origin:'https://other.example'})).status,403);
 f.setAccount({user:{id:'bob',accountKind:'user'}}); assert.equal((await f.call()).status,409);
 f.setAccount({user:{id:'alice',accountKind:'service'}}); assert.equal((await f.call()).status,401);
 f.setAccount({user:{id:'alice',accountKind:'user',temporary:true}}); assert.equal((await f.call()).status,401);
 f.setAccount({user:{id:'alice',accountKind:'user'}}); f.setPlane('custom:other'); assert.equal((await f.call()).status,409);
});
test('existing settings rate limit applies before every resumable operation',async()=>{
 const f=fixture(); f.setLimit(false); assert.equal((await f.call()).status,429); assert.equal(f.writes(),0);
});


test('terminal aborted receipts are scoped and explicit so a device can retire only the matching never-committed attempt', async () => {
 const handler=createInstructionTransferHandler({getAuthToken:async()=>'test',resolveTokenUser:async()=>({user:{id:'alice',accountKind:'user'}}),mongoDataPlane:()=> 'home',enforceRateLimit:async()=>({allowed:true}),executeInstructionTransfer:async()=>({transfer:{attemptId:'frozen',status:'aborted'},terminalCode:'INSTRUCTION_TRANSFER_ABORTED'})} as any);
 const request=new Request('https://thingtime.com/api/v1/settings/lopu-prompt',{method:'POST',headers:{Origin:'https://thingtime.com','Content-Type':'application/json','X-Thingtime-Expected-Data-Plane':'home'},body:JSON.stringify({operation:'instruction-transfer',expectedOwnerId:'alice',command:{action:'begin',attemptId:'frozen'}})});
 const response=await handler(request);assert.equal(response.status,409);const body:any=await response.json();assert.equal(body.code,'INSTRUCTION_TRANSFER_ABORTED');assert.equal(body.attemptId,'frozen');
});
