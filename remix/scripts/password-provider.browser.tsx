/** Actual provider component + ceremony + transport, with an in-memory API fixture.
 * No real account/password, stored key, authentication or server request is used. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChakraProvider} from '@chakra-ui/react';
import {createMemoryRouter,RouterProvider} from 'react-router';
import {ThingtimeProvider} from '../app/Providers/ThingtimeProvider';
import {BrowserPasswordProvider} from '../app/components/Passwords/BrowserPasswordProvider';
const ownerId='synthetic-provider-branding';
const fixture={operations:[] as string[],request:null as null|{id:string;type:string;origin:string}};
Object.assign(window,{passwordProviderFixture:fixture});
document.addEventListener('thingtime:password-provider-request',event=>{const r=JSON.parse((event as CustomEvent).detail);fixture.request={id:r.id,type:r.type,origin:r.origin};});
window.fetch=async(input,init)=>{
 init?.signal?.throwIfAborted();const url=new URL(input instanceof Request?input.url:String(input),location.origin);
 if(url.origin!==location.origin)return Response.json({ok:false},{status:403});
 if(url.pathname==='/.well-known/thingtime-capabilities.json')return Response.json({schemaVersion:1,origin:location.origin,features:Object.fromEntries(['api.passwords','api.things','api.webpages-resolve','api.actions-run'].map(feature=>[feature,{version:feature==='api.passwords'?'1.4.0':'1.99.0'}]))});
 if(url.pathname==='/api/v1/webpages/resolve')return Response.json({ok:false},{status:404});
 if(url.pathname==='/api/v1/passwords'&&init?.body){
  const body=JSON.parse(String(init.body));if(body.expectedOwnerId!==ownerId)return Response.json({ok:false},{status:403});fixture.operations.push(body.operation);
  const result=(values:Record<string,unknown>)=>Response.json({ok:true,ownerId,...values});
  if(body.operation==='verify-passkey')return result({verified:true,requestId:body.requestId,sessionBinding:'A'.repeat(43)});
  if(body.operation==='catalog')return result({catalog:[{id:'synthetic-existing',title:'Synthetic site passkey',username:'fixture',relyingParty:'workspace-fixture.test',credentialId:'AQID'}],nextCursor:null});
 }
 return Response.json({ok:false,error:'Unsupported synthetic request'},{status:403});
};
const user=new URLSearchParams(location.search).has('signed-out')?null:{id:ownerId,username:'synthetic-provider',temporary:false,accountKind:'user'};
const data={user,dataPlane:'home'};const router=createMemoryRouter([{id:'root',path:'*',element:<BrowserPasswordProvider/>,loader:()=>data}],{hydrationData:{loaderData:{root:data}}});
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="synthetic-real-password-provider" persistLocal={false} exposeGlobals={false}><RouterProvider router={router}/></ThingtimeProvider></ChakraProvider>);
