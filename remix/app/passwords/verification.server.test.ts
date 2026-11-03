import assert from 'node:assert/strict';
import { mock,test,before } from 'node:test';
let sessions=new Map<string,any>();
let transactionGate:Promise<void>|null=null,transactionEntered:(()=>void)|null=null;
mock.module(new URL('../api/utils/auth/jwt.ts',import.meta.url).href,{namedExports:{verifyJwt:async(token:string)=>({sub:'owner',jti:token})}});
mock.module(new URL('../api/utils/auth/sessions.ts',import.meta.url).href,{namedExports:{getLiveSession:async(jti:string)=>sessions.get(jti)||null}});
mock.module(new URL('../api/utils/auth/users.ts',import.meta.url).href,{namedExports:{findUserById:async()=>null,getUserPasswordVerification:async()=>({window:'always',revision:null}),setUserPasswordVerification:async()=>{}}});
mock.module(new URL('../api/utils/mongodb/collections.ts',import.meta.url).href,{namedExports:{getHomeThingsCollection:async()=>({findOne:async(filter:any)=>filter.thingtime==='user'?{shareId:'owner'}:null}),getAuthOtpsCollection:async()=>({}),withHomeMongoTransaction:async(work:any)=>{transactionEntered?.();await transactionGate;return work({});},getUsersCollection:async()=>({}),getSessionsCollection:async()=>({findOne:async(filter:any)=>sessions.get(filter.jti)||null,updateOne:async(filter:any,update:any)=>{if(update.$set)sessions.get(filter.jti).meta.passwordVerificationLock=update.$set['meta.passwordVerificationLock'];return{matchedCount:1};}})}});
mock.module(new URL('../api/utils/storage/accountedThings.ts',import.meta.url).href,{namedExports:{insertAccountedThing:async()=>{},updateAccountedThing:async()=>({matchedCount:1}),HOME_ACCOUNTED_STORAGE_OPTIONS:{}}});
class ManagerError extends Error{constructor(public status:number,message:string){super(message);}}
mock.module(new URL('../api/utils/passwords/passwords.ts',import.meta.url).href,{namedExports:{readPassword:async()=>{},savePassword:async()=>{},PasswordManagerError:ManagerError}});
let createPasswordVerificationService:any;
before(async()=>{({createPasswordVerificationService}=await import('../api/utils/passwords/verification'));});
const make=()=>{
  sessions=new Map([['A',{userId:'owner',purpose:'browser',meta:{}}],['B',{userId:'owner',purpose:'browser',meta:{}}]]);
  const ownSessions=sessions;
  let now=1000,passwordHash='hash-v1', settings:any={window:'never',revision:'one',changedAt:0},entry:any={passwordType:'passkey',fields:[{id:'relyingParty',value:'example.test'}]},afterRead:(()=>void)|null=null;
  let pause:(()=>Promise<void>)|null=null;
  const records=new Map<string,any>(),ceremonies=new Map<string,any>();
  const deps:any={now:()=>now,findUserById:async()=>({passwordHash}),getUserPasswordVerification:async()=>settings,setUserPasswordVerification:async()=>{},readPassword:async()=>({entry}),savePassword:async()=>{},store:{
    read:async(id:string)=>{const result=records.get(id)||null;afterRead?.();return result;},
    write:async(id:string,_who:any,_proof:any,value:any)=>{records.set(id,value);},
    ceremony:async(id:string)=>{const result=ceremonies.get(id)||null;await pause?.();return result;},
    authorize:async(id:string,value:any)=>ceremonies.set(id,value),
    lock:async()=>ceremonies.clear(),forget:async()=>records.clear(),
  }};
  const service=createPasswordVerificationService(deps);
  const request=(cookie='')=>new Request('https://thingtime.example/api/v1/passwords',{headers:{Cookie:cookie}});
  return{service,request,records,ceremonies,pause:(callback:()=>Promise<void>)=>pause=callback,changePassword:()=>passwordHash='changed',revoke:()=>sessions.delete('A'),changeLock:()=>ownSessions.get('A').meta.passwordVerificationLock='lock',setAfterRead:(callback:()=>void)=>afterRead=callback,clock:(value:number)=>now=value,settings:(value:any)=>settings=value,entry:(value:any)=>entry=value};
};
const context={purpose:'create',rp:'example.test',entryId:'95af3e96-59f9-42d0-b72a-46e74e3b3194'};
test('bare saved website approval remains bound to its exact HTTPS origin, entry and current session',async()=>{
 const f=make(),who=await f.service.identity('owner','https://thingtime.example','A');
 const selected={purpose:'fill',rp:'thingtime.com',origin:'https://thingtime.com',entryId:crypto.randomUUID()};
 const entry=(website:string)=>({passwordType:'login',fields:[{id:'password',type:'password',value:'synthetic-only'},{id:'website',type:'url',value:website}]});
 f.entry(entry('thingtime.com'));
 const id=crypto.randomUUID(),cookie=(await f.service.verify(f.request(),who,selected,id,true))!.split(';')[0];
 await f.service.require(f.request(cookie),who,selected,id);
 for(const other of [{...selected,rp:'sub.thingtime.com',origin:'https://sub.thingtime.com'}, {...selected,origin:'https://thingtime.com:8443'}, {...selected,entryId:crypto.randomUUID()}])await assert.rejects(f.service.require(f.request(cookie),who,other,id));
 for(const website of ['*.thingtime.com','https://user:secret@thingtime.com','https://sub.thingtime.com','https://thingtime.com:8443','http://thingtime.com']){
  f.entry(entry(website));await assert.rejects(f.service.status(f.request(cookie),who,selected));
 }
 f.entry(entry('thingtime.com'));f.revoke();await assert.rejects(f.service.require(f.request(cookie),who,selected,id));
});
test('status never writes authority; Never reuse needs exact device/account/origin and current session',async()=>{
 const f=make(),who=await f.service.identity('owner','https://thingtime.example','A');
 assert.equal((await f.service.status(f.request(),who,context)).required,true);assert.equal(f.records.size,0);assert.equal(f.ceremonies.size,0);
 const cookie=(await f.service.verify(f.request(),who,context,crypto.randomUUID(),true))!.split(';')[0];
 assert.equal((await f.service.status(f.request(cookie),who,context)).required,false);
 assert.equal((await f.service.status(f.request(),who,context)).required,true);
 const otherOrigin=await f.service.identity('owner','https://other.example','A');
 assert.equal((await f.service.status(f.request(cookie),otherOrigin,context)).required,true);
 const future=await f.service.identity('owner','https://thingtime.example','B');assert.equal((await f.service.status(f.request(cookie),future,context)).required,false);
 await assert.rejects(f.service.identity('other','https://thingtime.example','A'));
 f.revoke();await assert.rejects(f.service.status(f.request(cookie),who,context));
});
test('password change and lock during an awaited trust read cannot release remembered approval',async()=>{
 for(const action of ['password','lock','revoke']){
  const f=make(),who=await f.service.identity('owner','https://thingtime.example','A');
  const cookie=(await f.service.verify(f.request(),who,context,crypto.randomUUID(),true))!.split(';')[0];
  f.setAfterRead(()=>{if(action==='password')f.changePassword();if(action==='revoke')f.revoke();if(action==='lock')f.changeLock();});
  await assert.rejects(f.service.verify(f.request(cookie),who,context,crypto.randomUUID(),false));
 }
});
test('ceremony cannot change selected entry, RP, purpose or request; expiry and per-entry Always win',async()=>{
 const f=make(),who=await f.service.identity('owner','https://thingtime.example','A'),id=crypto.randomUUID();
 const cookie=(await f.service.verify(f.request(),who,context,id,true))!.split(';')[0],req=f.request(cookie);
 await f.service.require(req,who,context,id);
 for(const changed of [{...context,rp:'other.test'},{...context,entryId:crypto.randomUUID()},{...context,purpose:'get'}])await assert.rejects(f.service.require(req,who,changed,id));
 await assert.rejects(f.service.require(req,who,context,crypto.randomUUID()));
 f.clock(601000);await assert.rejects(f.service.require(req,who,context,id));
 f.entry({passwordType:'passkey',verificationWindow:'always',fields:[{id:'relyingParty',value:'example.test'}]});
 assert.equal((await f.service.status(req,who,{purpose:'get',rp:'example.test',entryId:crypto.randomUUID()})).required,true);
});

test('Forget in session A wins over session B already holding old device trust',async()=>{
 const f=make(),a=await f.service.identity('owner','https://thingtime.example','A');
 const cookie=(await f.service.verify(f.request(),a,context,crypto.randomUUID(),true))!.split(';')[0];
 const req=f.request(cookie),b=await f.service.identity('owner','https://thingtime.example','B'),id=crypto.randomUUID();
 await f.service.verify(req,b,context,id,false);
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
 f.pause(async()=>{enter();await gate;});
 const pending=f.service.require(req,b,context,id);await entered;
 await f.service.forget(req,a);release();
 await assert.rejects(pending,'Forget completed before the final device read');
});

test('account-key commit rechecks after an initial approval and paused pre-insert boundary',async()=>{
 for(const action of ['lock','forget-other-session','revoke','password-change']){
  const f=make(),a=await f.service.identity('owner','https://thingtime.example','A');
  const account={purpose:'account-create',rp:'thingtime.example'},id=crypto.randomUUID();
  const cookie=(await f.service.verify(f.request(),a,account,id,true))!.split(';')[0],req=f.request(cookie);
  const who=action==='forget-other-session'?await f.service.identity('owner','https://thingtime.example','B'):a;
  if(who!==a)await f.service.verify(req,who,account,id,false);
  await f.service.require(req,who,account,id);
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve);
  transactionGate=new Promise<void>(resolve=>release=resolve);transactionEntered=enter;
  let writes=0;const commit=f.service.commitAccountRegistration(req,who,account,id,async()=>{writes++;return true;});
  await entered;
  if(action==='lock')await f.service.lock(a);
  if(action==='forget-other-session')await f.service.forget(req,a);
  if(action==='revoke')f.revoke();
  if(action==='password-change')f.changePassword();
  release();await assert.rejects(commit,action);assert.equal(writes,0,action);
  transactionGate=null;transactionEntered=null;
 }
});

test('expiry and same-window revision changes during final awaits are enforced at return',async()=>{
 for(const kind of ['timed','ceremony','revision','entry-epoch']){
  const f=make();if(kind==='timed')f.settings({window:'5m',revision:'one',changedAt:0});
  const who=await f.service.identity('owner','https://thingtime.example','A');
  const cookie=(await f.service.verify(f.request(),who,context,crypto.randomUUID(),true))!.split(';')[0],req=f.request(cookie),id=crypto.randomUUID();
  await f.service.verify(req,who,context,id,false);
  let reads=0;f.setAfterRead(()=>{reads++;if(reads===3&&kind==='timed')f.clock(301000);if(reads===3&&kind==='ceremony')f.clock(601000);if(reads===2&&kind==='revision')f.settings({window:'never',revision:'changed',changedAt:0});if(reads===2&&kind==='entry-epoch')f.settings({window:'never',revision:'one',epoch:'changed',changedAt:0});});
  await assert.rejects(f.service.require(req,who,context,id),kind);
 }
});

test('production device proof is opaque HttpOnly Secure host-only SameSite cookie',async()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{
  const f=make(),who=await f.service.identity('owner','https://thingtime.example','A');
  const cookie=await f.service.verify(f.request(),who,context,crypto.randomUUID(),true);
  assert.ok(cookie&&/; HttpOnly(?:;|$)/i.test(cookie)&&/; Secure(?:;|$)/i.test(cookie)&&/; SameSite=Strict(?:;|$)/i.test(cookie)&&!/; Domain=/i.test(cookie));
 }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});
