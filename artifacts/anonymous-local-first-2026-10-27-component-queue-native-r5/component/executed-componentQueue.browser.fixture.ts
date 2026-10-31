// Opt-in browser acceptance only; normal app worker performs every remote write.
import { WorkspaceDatabase } from './storage';
import { AccountThingSync } from './accountSync';
let db: WorkspaceDatabase, sync: AccountThingSync;
export function open(ownerId: string, dataPlane: string) {
 if(sync)return;
 db = new WorkspaceDatabase(indexedDB);
 sync = new AccountThingSync(db, {kind:'account', origin:location.origin, ownerId, dataPlane}, {assertCurrent(){},onInvalidate:()=>()=>{}});
}
const component = (name: string) => ({thingtime:['component'],crystal:{name,componentKey:'queue-'+crypto.randomUUID(),version:1,render:{tag:'p',children:name}}});
const blocks = (id: string, text: string) => [{id:'outer',type:'container',children:[{id:'inner',type:'container',children:[{id:'control',type:'component',component:id},{id:'text',type:'element',tag:'p',text}]}]}];
export async function seed() {
 const control = await sync.things.create(component('Acknowledged component control'));
 const page = await sync.things.create({thingtime:['webpage'],crystal:{name:'Dependency queue page',version:1,blocks:blocks(control.id,'Original frozen content')}});
 const data = await sync.things.create({thingtime:['data'],crystal:{name:'Independent queue data'}});
 return {control,page,data};
}
export async function newer(pageId: string) {
 const control=await sync.things.create(component('Second dependency control'));
 const page=await sync.things.update({id:pageId,crystal:{name:'Newer local page',blocks:blocks(control.id,'Newer pending content')}});
 return {control,page};
}
export async function retry(id: string) {await sync.retry(id);}
export async function proof(ids: string[]) {
 return {status:await sync.status(),things:await Promise.all(ids.map(id=>sync.things.get(id))), records:await db.transaction(sync.scope,'readonly',{assertCurrent(){},onInvalidate:()=>()=>{}},async tx=>Promise.all(ids.map(async id=>({id,row:await tx.get('thing-sync',id)}))))};
}
