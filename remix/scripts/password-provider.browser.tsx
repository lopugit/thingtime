/** Actual provider component + ceremony + transport, with an in-memory API fixture.
 * No real account/password, stored key, authentication or server request is used. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChakraProvider} from '@chakra-ui/react';
import {createMemoryRouter,RouterProvider} from 'react-router';
import {ThingtimeProvider} from '../app/Providers/ThingtimeProvider';
import {BrowserPasswordProvider} from '../app/components/Passwords/BrowserPasswordProvider';
import {prepareBrowserPasskeyRegistration} from '../app/passwords/browserPasskey';
const ownerId='synthetic-provider-branding';
const windows=new Map<string,string>();const granted=new Set<string>();let reuseRecentDeviceVerification=true;
const assertionMode=new URLSearchParams(location.search).has('assertion');
const assertionRecord=assertionMode?prepareBrowserPasskeyRegistration({type:'create',origin:'https://workspace-fixture.test',publicKey:{challenge:'AQID',rp:{id:'workspace-fixture.test',name:'Synthetic site'},user:{id:'BAUG',name:'fixture@example.test',displayName:'Synthetic account'},pubKeyCredParams:[{type:'public-key',alg:-7}]}},true):null;
const fixture={holdFill:false,fillHeld:false,releaseFill:null as null|(()=>void),holdApproval:false,approvalHeld:false,approvalAborted:false,releaseApproval:null as null|(()=>void),rateLimitApproval:false,operations:[] as string[],request:null as null|{id:string;type:string;origin:string}};
Object.assign(window,{passwordProviderFixture:fixture});
document.addEventListener('thingtime:password-provider-request',event=>{const r=JSON.parse((event as CustomEvent).detail);fixture.request={id:r.id,type:r.type,origin:r.origin};});
window.fetch=async(input,init)=>{
 init?.signal?.throwIfAborted();const url=new URL(input instanceof Request?input.url:String(input),location.origin);
 if(url.origin!==location.origin)return Response.json({ok:false},{status:403});
 if(url.pathname==='/.well-known/thingtime-capabilities.json')return Response.json({schemaVersion:1,origin:location.origin,features:Object.fromEntries(['api.passwords','api.things','api.webpages-resolve','api.actions-run','api.mongodb-endpoint'].map(feature=>[feature,{version:feature==='api.passwords'?'1.6.1':'1.99.0'}]))});
 if(url.pathname==='/api/v1/webpages/resolve')return Response.json({ok:false},{status:404});
 if(url.pathname==='/api/v1/passwords'&&init?.body){
  const body=JSON.parse(String(init.body));if(body.expectedOwnerId!==ownerId)return Response.json({ok:false},{status:403});fixture.operations.push(body.operation);
  const result=(values:Record<string,unknown>)=>Response.json({ok:true,ownerId,...values});
  if(assertionRecord){
   const id='synthetic-assertion',record=await assertionRecord;
   if(body.operation==='catalog')return body.cursor==='later'?result({catalog:[{id,title:'Synthetic site passkey',username:'fixture',relyingParty:'workspace-fixture.test',credentialId:record.response.id}],nextCursor:null}):result({catalog:[],nextCursor:'later'});
   if(body.operation==='verification-status')return result({window:'never',entryWindow:'global',required:false,settings:{window:'never',revision:'fixture-revision',reuseRecentDeviceVerification:true}});
   if(body.operation==='verify-passkey'){
    if(body.password!==''||body.context?.entryId!==id||body.context?.purpose!=='get'||body.context?.rp!=='workspace-fixture.test')return Response.json({ok:false},{status:403});
    if(fixture.holdApproval){
     fixture.approvalHeld=true;
     try{await new Promise<void>((resolve,reject)=>{
      const abort=()=>{fixture.approvalAborted=true;reject(init?.signal?.reason);};
      fixture.releaseApproval=()=>{init?.signal?.removeEventListener('abort',abort);resolve();};
      init?.signal?.addEventListener('abort',abort,{once:true});
      if(init?.signal?.aborted)abort();
     });}finally{fixture.approvalHeld=false;fixture.releaseApproval=null;}
    }
    if(fixture.rateLimitApproval)return Response.json({ok:false,error:'Please wait before verifying again.'},{status:429,headers:{'Retry-After':'120'}});
    return result({verified:true,requestId:body.requestId,sessionBinding:'A'.repeat(43)});
   }
   if(body.operation==='read'){
    if(body.id!==id||body.passkeySession?.context?.entryId!==id||body.passkeySession?.binding!=='A'.repeat(43))return Response.json({ok:false},{status:403});
    return result({id,entry:record.entry,revision:1});
   }
  }
  const policy=(id?:string)=>windows.get(id||'global')||'5m';
  const settings=()=>({window:policy(),revision:'fixture-revision',reuseRecentDeviceVerification});
  if(body.operation==='verification-settings'){if(body.window)windows.set(body.id||'global',body.window);if(typeof body.reuseRecentDeviceVerification==='boolean')reuseRecentDeviceVerification=body.reuseRecentDeviceVerification;return result({settings:settings()});}
  if(body.operation==='verification-status'){const id=body.context?.entryId;return result({window:policy(id),entryWindow:windows.get(id)||'global',required:!reuseRecentDeviceVerification||policy(id)==='always'||!granted.has(id||'global'),settings:settings()});}
  if(body.operation==='verification-lock'||body.operation==='verification-forget'){granted.clear();return result({});}
  if(body.operation==='verify-passkey'){if(body.password!=='synthetic-fixture-only'&&!granted.has(body.context?.entryId||'global'))return Response.json({ok:false},{status:403});granted.add(body.context?.entryId||'global');return result({verified:true,requestId:body.requestId,sessionBinding:'A'.repeat(43)});}
  if(body.operation==='catalog')return new URLSearchParams(location.search).get('view')==='vault'?result({catalog:[{id:'synthetic-login',title:'Fixture website',username:'fixture@example.test',domains:['workspace-fixture.test'],hasPassword:true,fillEligible:true},{id:'synthetic-foreign',title:'Another website',username:'other@example.test',domains:['foreign.example.test'],hasPassword:true,fillEligible:true}],nextCursor:null}):result({catalog:[{id:'synthetic-existing',title:'Synthetic site passkey',username:'fixture',relyingParty:'workspace-fixture.test',credentialId:'AQID'}],nextCursor:null});
  if(body.operation==='fill'){if(fixture.holdFill){fixture.fillHeld=true;await new Promise<void>(resolve=>{fixture.releaseFill=resolve;});fixture.holdFill=false;fixture.fillHeld=false;}if(body.id!=='synthetic-login'||body.passkeySession?.context?.origin!=='https://workspace-fixture.test'||body.passkeySession?.context?.entryId!==body.id||body.passkeySession?.binding!=='A'.repeat(43)||!granted.has(body.id))return Response.json({ok:false},{status:403});return result({username:'fixture@example.test',password:'synthetic-filled-password'});}
  if(body.operation==='save')return result({record:{id:body.id,revision:1}});
 }
 return Response.json({ok:false,error:'Unsupported synthetic request'},{status:403});
};
const user=new URLSearchParams(location.search).has('signed-out')?null:{id:ownerId,username:'synthetic-provider',temporary:false,accountKind:'user'};
const data={user,dataPlane:'home'};const router=createMemoryRouter([{id:'root',path:'*',element:<BrowserPasswordProvider/>,loader:()=>data}],{hydrationData:{loaderData:{root:data}}});
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="synthetic-real-password-provider" persistLocal={false} exposeGlobals={false}><RouterProvider router={router}/></ThingtimeProvider></ChakraProvider>);
