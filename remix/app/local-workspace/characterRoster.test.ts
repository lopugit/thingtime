import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { readCharacterRoster,retainCharacterRoster } from './characterRoster.client';
import { WorkspaceDatabase } from './storage';

test('retained Character choices preserve labels without retaining profile or authorization fields',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory()),scope={kind:'account',origin:'https://roster.example',ownerId:'owner',dataPlane:'home'} as const;
 let current=true;const lease={assertCurrent(){if(!current)throw Error('Workspace retired');},onInvalidate:()=>()=>{}};
 const user=(id:string)=>({id,username:id,displayName:id,isCharacter:id!=='owner',email:'private@example.test',birthday:'2000-01-01',isAdmin:true,publicUploadsEnabled:true,password:'must-not-retain'});
 const roster={principal:user('owner'),activeCharacterId:null,canManage:true,characters:[{user:user('actor'),disabled:false,loginMode:'password' as const}],nextCursor:null};
 try{
  await retainCharacterRoster(db,scope,lease,roster as any);
  const raw=await db.transaction(scope,'readonly',lease,tx=>tx.get('character-roster','choices'));
  for(const field of ['email','birthday','isAdmin','publicUploadsEnabled','password','canManage'])assert.equal(JSON.stringify(raw).includes(`"${field}":`),false,field);
  const retained=await readCharacterRoster(db,scope,lease);assert.equal(retained?.principal.id,'owner');assert.equal(retained?.characters[0].user.displayName,'actor');
  assert.equal(retained?.canManage,false);assert.equal(retained?.characters[0].user.email,'');assert.equal(retained?.characters[0].user.isAdmin,false);assert.equal(retained?.characters[0].user.publicUploadsEnabled,false);
  assert.equal(await readCharacterRoster(db,{...scope,ownerId:'other'},lease),null);
  assert.equal(await readCharacterRoster(db,{...scope,dataPlane:'other'},lease),null);
  assert.equal(await readCharacterRoster(db,{...scope,origin:'https://other.example'},lease),null);
  assert.throws(()=>retainCharacterRoster(db,scope,lease,{...roster,nextCursor:'next'} as any),/could not be verified/);
 }finally{current=false;await assert.rejects(readCharacterRoster(db,scope,lease),/retired/);await db.close();}
});
