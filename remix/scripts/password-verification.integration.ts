import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
/** Disposable API-only fixture. No production config, browser profile or vault. */
export async function runPasswordVerificationIntegration({load,vite,origin,ownerId,cookie,password,username}:any){
  const passwords=await load('routes/api/v1/passwords/_passwords.tsx');
  const optionsRoute=await load('routes/api/v1/auth/passkeys/register-options/_register-options.tsx');
  const registerRoute=await load('routes/api/v1/auth/passkeys/register/_register.tsx');
  const material=await load('passwords/browserPasskey.ts');
  const login=await load('routes/api/v1/login/_login.tsx');
  const logout=await load('routes/api/v1/auth/logout/_logout.tsx');
  const things=await load('routes/api/v1/things/_things.tsx');
  const jar=new Map<string,string>(cookie.split('; ').map((value:string)=>{const at=value.indexOf('=');return[value.slice(0,at),value.slice(at+1)];}));
  const cookies=()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; ');
  const collect=(response:Response)=>{for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('=');if(/Max-Age=0(?:;|$)/i.test(value))jar.delete(pair.slice(0,at));else jar.set(pair.slice(0,at),pair.slice(at+1));}};
  const invoke=async(body:any,options:{owner?:string;cookie?:string;origin?:string}={})=>{
    const response=await passwords.action({request:new Request(origin+'/api/v1/passwords',{method:'POST',headers:{Origin:options.origin||origin,Cookie:options.cookie??cookies(),'Content-Type':'application/json'},body:JSON.stringify({...body,expectedOwnerId:options.owner||ownerId})})});
    collect(response);return{status:response.status,body:await response.json(),headers:response.headers};
  };
  const context=(purpose='create',entryId=randomUUID())=>({purpose,rp:'fixture.test',entryId});
  const verify=async(selected:any,fresh=false)=>{const requestId=randomUUID();const result=await invoke({operation:'verify-passkey',context:selected,requestId,...(fresh?{password}:{})});return{...result,passkeySession:{requestId,binding:result.body.sessionBinding,context:selected}};};
  const initial=await invoke({operation:'verification-settings'});assert.equal(initial.body.settings.window,'5m');
  let settings=(await invoke({operation:'verification-settings',window:'never',revision:initial.body.settings.revision})).body.settings;
  assert.equal((await invoke({operation:'verification-status',context:context()})).body.required,true,'Settings alone do not enroll a device');
  assert.equal((await verify(context())).status,403,'No initial device trust');
  const enrolled=await verify(context(),true);assert.equal(enrolled.status,200);
  const deviceCookie=enrolled.headers.getSetCookie().find(value=>value.startsWith('tt_password_device_'));
  assert.ok(deviceCookie&&/HttpOnly/.test(deviceCookie)&&/SameSite=Strict/i.test(deviceCookie)&&!/Domain=/.test(deviceCookie));
  const otherSite={...context(),rp:'another.test'};
  assert.equal((await verify(otherSite)).status,200,'Global window covers a new explicit website request');
  const liveRequest=await verify(context());assert.equal(liveRequest.status,200);
  assert.equal((await invoke({operation:'read',id:randomUUID(),passkeySession:liveRequest.passkeySession})).status,403,'Exact selected entry cannot be replaced');
  for(const operation of ['export','delete'])assert.equal((await invoke({operation,passkeySession:liveRequest.passkeySession})).status,403,'A ceremony is not export/delete authority');
  // An ordinary login record, independently generated for this fixture only.
  const id=randomUUID(),syntheticSecret=randomBytes(32).toString('base64url');
  const entry={title:'Isolated login',passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:'fixture@example.invalid'},{id:'password',label:'Password',type:'password',value:syntheticSecret},{id:'website',label:'Website',type:'url',value:'https://fixture.test/path'}]};
  assert.equal((await invoke({operation:'save',id,writeId:randomUUID(),revision:0,entry})).status,200);
  const fill={purpose:'fill',rp:'fixture.test',origin:'https://fixture.test',entryId:id};
  const fillApproval=await verify(fill);assert.equal(fillApproval.status,200);
  const delivered=await invoke({operation:'fill',id,passkeySession:fillApproval.passkeySession});assert.equal(delivered.status,200);assert.ok(delivered.body.password===syntheticSecret);assert.equal(delivered.body.username,'fixture@example.invalid');
  assert.deepEqual(Object.keys(delivered.body).sort(),['ok','ownerId','password','username']);
  const {importOnePasswordItem}=await load('passwords/onePassword.ts');
  const importedId=randomUUID(),importedEmail='root-fixture@example.invalid';
  const imported=importOnePasswordItem({categoryUuid:'001',overview:{title:'Synthetic AWS account',subtitle:'Imported account description',url:'https://aws.amazon.com/path'},details:{loginFields:[
    {designation:'username',name:'appAction',fieldType:'H',value:'awsWeb'},
    {name:'Root user email address',fieldType:'T',value:importedEmail},
    {designation:'password',fieldType:'P',value:syntheticSecret}
  ]}});
  // Simulate a previously saved import whose parser did not conceal H fields.
  imported.fields[0].concealed=false;
  assert.equal((await invoke({operation:'save',id:importedId,writeId:randomUUID(),revision:0,entry:imported})).status,200);
  const importedCatalog=(await invoke({operation:'catalog'})).body.catalog.find((item:any)=>item.id===importedId);
  assert.deepEqual(importedCatalog,{id:importedId,title:'Synthetic AWS account',username:importedEmail,domains:['aws.amazon.com','signin.aws.amazon.com'],origins:['https://aws.amazon.com','https://signin.aws.amazon.com'],fillEligible:true,hasPassword:true,hasTotp:false});
  const importedApproval=await verify({purpose:'fill',rp:'signin.aws.amazon.com',origin:'https://signin.aws.amazon.com',entryId:importedId});
  assert.equal(importedApproval.status,200);
  const importedFill=await invoke({operation:'fill',id:importedId,passkeySession:importedApproval.passkeySession});
  assert.equal(importedFill.status,200);assert.equal(importedFill.body.username,importedEmail);
  for(const target of ['https://signin.aws.amazon.com:8443','https://signin.aws.amazon.com.evil.test','https://other.aws.amazon.com','https://amazon.com']){
    const context={purpose:'fill',rp:new URL(target).hostname,origin:target,entryId:importedId};
    assert.equal((await invoke({operation:'verification-status',context})).status,403,'Other origins do not inherit the AWS match');
    assert.equal((await invoke({operation:'fill',id:importedId,passkeySession:{...importedApproval.passkeySession,context}})).status,403,'Changing destination cannot reuse the approval');
  }
  assert.equal((await verify({...fill,origin:'https://other.test',rp:'other.test'})).status,403,'No origin fallback');
  await invoke({operation:'verification-settings',id,window:'always'});
  assert.equal((await invoke({operation:'verification-status',context:fill})).body.required,true,'Entry Always wins over global Never');
  assert.equal((await verify(fill)).status,403);
  assert.equal((await invoke({operation:'read',id})).status,200,'Legacy ordinary read remains session-authorized');
  // Returning to global does not revive a pre-change global approval for this entry.
  await invoke({operation:'verification-settings',id,window:'global'});
  assert.equal((await verify(fill)).status,403);
  assert.equal((await verify(fill,true)).status,200);
  // Full account registration through actual server options, synthetic WebAuthn
  // cryptography and final API durable registration (not an OS/device proof).
  const startAccount=async()=>{const response=await optionsRoute.action({request:new Request(origin+'/api/v1/auth/passkeys/register-options',{method:'POST',headers:{Origin:origin,Cookie:cookies(),'Content-Type':'application/json'},body:JSON.stringify({verificationRequestId:randomUUID()})})});collect(response);assert.equal(response.status,200);return(await response.json()).options;};
  const options=await startAccount();assert.equal(options.authenticatorSelection.userVerification,'required');
  const prepared=await material.prepareBrowserPasskeyRegistration({type:'create',origin,publicKey:options},true);
  const accountResult=await registerRoute.action({request:new Request(origin+'/api/v1/auth/passkeys/register',{method:'POST',headers:{Origin:origin,Cookie:cookies(),'Content-Type':'application/json'},body:JSON.stringify({response:prepared.response,nickname:'Isolated device policy'})})});assert.equal(accountResult.status,200);collect(accountResult);
  const revokedOptions=await startAccount();
  const revokedPrepared=await material.prepareBrowserPasskeyRegistration({type:'create',origin,publicKey:revokedOptions},true);
  await invoke({operation:'verification-lock'});
  const refusedAccount=await registerRoute.action({request:new Request(origin+'/api/v1/auth/passkeys/register',{method:'POST',headers:{Origin:origin,Cookie:cookies(),'Content-Type':'application/json'},body:JSON.stringify({response:revokedPrepared.response})})});assert.equal(refusedAccount.status,403,'Lock during account ceremony prevents durable registration');
  const pending=await verify(context());assert.equal(pending.status,200);
  assert.equal((await invoke({operation:'verification-lock'})).status,200);
  assert.equal((await invoke({operation:'catalog',passkeySession:pending.passkeySession})).status,403,'Lock ends the pending ceremony');
  assert.equal((await verify(context())).status,200,'Lock preserves Never enrollment');
  const signedOut=await logout.action({request:new Request(origin+'/api/v1/auth/logout',{method:'POST',headers:{Origin:origin,Cookie:cookies()}})});collect(signedOut);
  assert.equal((await verify(context())).status,401,'Sign-out ends account access');
  const signIn=await login.action({request:new Request(origin+'/api/v1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password})})});assert.equal(signIn.status,200);collect(signIn);
  assert.equal((await verify(context())).status,200,'Never survives a future authenticated session on this device');
  assert.equal((await invoke({operation:'verification-forget'})).status,200);
  assert.equal((await verify(context())).status,403,'Forget requires a new current password');
  assert.equal((await verify(context(),true)).status,200,'Explicit current verification can enroll the device again');
  settings=(await invoke({operation:'verification-settings',window:'5m',revision:settings.revision})).body.settings;
  assert.equal((await verify(context())).status,403,'Preference change never extends/mints trust');
  assert.equal((await verify(context(),true)).status,200);
  assert.equal((await verify(context())).status,200);
  settings=(await invoke({operation:'verification-settings',reuseRecentDeviceVerification:false,revision:settings.revision})).body.settings;
  assert.equal(settings.window,'5m');assert.equal(settings.reuseRecentDeviceVerification,false);
  assert.equal((await verify(context())).status,403,'Master off requires fresh confirmation');
  settings=(await invoke({operation:'verification-settings',reuseRecentDeviceVerification:true,revision:settings.revision})).body.settings;
  assert.equal((await verify(context())).status,403,'Re-enabling cannot revive old approvals');
  assert.equal((await invoke({operation:'verification-status',context:context()},{origin:'https://foreign.test'})).status,403);
  const forbidden=await things.action({request:new Request(origin+'/api/v1/things',{method:'POST',headers:{Origin:origin,Cookie:cookies(),'Content-Type':'application/json'},body:JSON.stringify({id:randomUUID(),thingtime:['password-verification-device'],crystal:{verified:true}})})});
  assert.ok(forbidden.status>=400,'Generic Things cannot mint device authority');
  const previews=await passwords.loader({request:new Request(origin+'/api/v1/passwords?previews=1',{headers:{Cookie:cookies()}})});assert.equal(previews.status,200);
  const previewsBody=await previews.json();
  const preview=previewsBody.entries.find((value:any)=>value.id===id);assert.equal(preview.username,'fixture@example.invalid');assert.deepEqual(Object.keys(preview).sort(),['id','passwordType','revision','title','updatedAt','username','websiteIcon']);
  assert.equal(previewsBody.entries.find((value:any)=>value.id===importedId).username,importedEmail);
  if(process.env.THINGTIME_EXTENSION_ACCOUNTS_UI==='1')await(await import('./password-extension-accounts.integration')).runExtensionAccountsUI({vite,load,ownerId,username,password,invoke});
  if(process.argv.includes('--verification-ui'))await(await import('./password-verification-ui.integration')).runPasswordVerificationUI({vite,load,ownerId,username,password,invoke});
  console.log('PASS: real disposable API verification; settings alone refuse; explicit Never enrollment; cross-site global reuse; exact-entry/purpose/origin fencing; entry Always; Lock; logout/new login durable trust; Forget/re-enroll; timed approval; protected generic writes; allowlisted usernames.');
}
