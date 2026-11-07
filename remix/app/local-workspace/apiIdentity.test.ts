import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceApiIdentity } from './apiIdentity';
test('workspace callbacks stay stable through rerenders without retargeting retired account callbacks', () => {
 const slot = new WorkspaceApiIdentity<any>();let adapters=0;
 const adapt=(remote:any)=>{adapters++;return {things:{get:()=>remote.things.get()}}};
 const first=slot.resolve('anonymous:1',{things:{get:()=> 'original'}},adapt);
 const second=slot.resolve('anonymous:1',{things:{get:()=> 'current anonymous'}},adapt);
 assert.equal(first,second);assert.equal(first.things.get,second.things.get);assert.equal(first.things.get(),'current anonymous');assert.equal(adapters,1);
 const account=slot.resolve('account:2',{things:{get:()=> 'private account'}},adapt);
 assert.notEqual(account,first);assert.equal(account.things.get(),'private account');assert.equal(first.things.get(),'current anonymous');assert.equal(adapters,2);
 const pending=slot.resolve('account:2:pending',{things:{get:()=> 'unconfirmed'}},adapt);
 assert.notEqual(account,pending);assert.equal(account.things.get(),'private account');
});
