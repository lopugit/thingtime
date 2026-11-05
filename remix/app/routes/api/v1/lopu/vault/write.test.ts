import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultWriteResponse } from './write';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const origin = 'https://thingtime.example', account = { user: { id: 'owner', temporary: false, accountKind: 'full' }, claims: { jti: 'fixture-session' } };
const request = (headers = {}) => new Request(origin+'/api/v1/lopu/vault', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Data-Plane': 'home', ...headers } });
const body = { action: 'sync-write', expectedOwnerId: 'owner', command: { action: 'create-group', id: 'fixture-group', writeId: 'fixture-write', expectedVersion: null, name: 'Fixture' } };
const receipt = { action: 'create-group', id: 'fixture-group', writeId: 'fixture-write', expectedVersion: null, resultVersion: 'vault-state-v1:'+'a'.repeat(64) };
function fixture(overrides: any = {}) {
 let mutations = 0;
 return { mutations: () => mutations, run: createVaultWriteResponse({ getAuthToken: async () => 'session', resolveTokenUser: async () => account as any, mongoDataPlane: () => 'home',
  synchronizeUserVaultWrite: async (owner, command, admit) => { assert.equal(owner,'owner'); assert.deepEqual(command,body.command); await admit(); mutations++; return receipt as any; }, ...overrides }) };
}
test('account sync binds a full session, same origin, owner and explicit selected plane', async () => {
 const f = fixture(), response = await f.run(request(), 'owner', body);
 assert.equal(response.status,200); assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(await response.json(),{ok:true,ownerId:'owner',acknowledgment:receipt}); assert.equal(f.mutations(),1);
 for (const [req,owner,payload,overrides,status] of [
  [request({Origin:''}),'owner',body,{},403], [request({Origin:'https://elsewhere.example'}),'owner',body,{},403],
  [request({'Sec-Fetch-Site':'cross-site'}),'owner',body,{},403], [request(),'different',body,{},409],
  [request(),'owner',{...body,expectedOwnerId:'different'}, {},409], [request(),'owner',{...body,ownerId:'forged'}, {},400],
  [request({'X-Thingtime-Expected-Data-Plane':''}),'owner',body,{},400],
  [request(),'owner',body,{mongoDataPlane:()=> 'custom-'+'a'.repeat(64)},409],
  [request(),'owner',body,{getAuthToken:async()=> null},401],
  [request(),'owner',body,{resolveTokenUser:async()=>({...account,user:{...account.user,temporary:true}})},401],
  [request(),'owner',body,{resolveTokenUser:async()=>({...account,user:{...account.user,accountKind:'service'}})},401]
 ] as any[]) {
  const blocked = fixture(overrides), result = await blocked.run(req,owner,payload); assert.equal(result.status,status); assert.equal(blocked.mutations(),0);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');
 }
});
test('internal Action identities cannot authorize account synchronization', async () => {
 const f = fixture(), req = request(); const result = await withInternalRequestActor(req,async()=>account.user as any,()=>f.run(req,'owner',body));
 assert.equal(result.status,403); assert.equal(f.mutations(),0);
});
test('revocation before mutation and before receipt disclosure are rechecked', async () => {
 for (const expiresAt of [2,3]) {
  let resolutions = 0; const f = fixture({resolveTokenUser:async()=>++resolutions >= expiresAt ? null : account});
  const result = await f.run(request(),'owner',body); assert.equal(result.status,401); assert.equal(f.mutations(),expiresAt===2?0:1);
  assert.ok(!(await result.text()).includes('resultVersion'));
 }
});
test('server exceptions are redacted and keep ambiguous writes retryable', async () => {
 const f = fixture({synchronizeUserVaultWrite:async()=>{throw Error('synthetic secret and database URI');}});
 const result = await f.run(request(),'owner',body); assert.equal(result.status,503); assert.ok(!(await result.text()).includes('synthetic secret'));
});
