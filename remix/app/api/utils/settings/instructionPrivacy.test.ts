import assert from 'node:assert/strict';
import test from 'node:test';
import { canView, canViewInherited, sanitizeShareId } from '../things/things';
import { isProtectedThingtime } from '../../../schemas/registry';
import { GENERIC_SEARCH_EXCLUDED_THINGTIME } from '../things/searchGrammar';
test('private instruction generations never enter generic read, inherited sharing, search or CRUD namespaces',async()=>{
 for(const kind of ['lopu-instruction-transfer','lopu-instruction-part']) {
  const row:any={shareId:'retained',ownerId:'alice',thingtime:[kind],acl:['tt:all'],crystal:{},extended:null,tags:[],createdAt:new Date(),updatedAt:new Date()};
  assert.equal(isProtectedThingtime([kind]),true); assert.ok(GENERIC_SEARCH_EXCLUDED_THINGTIME.includes(kind as any));
  for(const viewer of [null,{id:'alice'},{id:'other'},{id:'admin',isAdmin:true}]) {
   assert.equal(canView(row,viewer as any),false);
   assert.equal(await canViewInherited(row,viewer as any,async()=>row),false);
  }
 }
 for(const id of ['instruction-transfer-reserved','instruction-part-reserved']) assert.deepEqual(sanitizeShareId(id),{ok:false,status:400,error:'shareId uses a reserved prefix'});
});
