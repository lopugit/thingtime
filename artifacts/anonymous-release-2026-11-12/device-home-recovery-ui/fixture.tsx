// Synthetic host/selection ONLY. Actual RootRecovery, router, bootstrap
// controller and shared components; no native initialization/storage claim.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { RootRecovery } from '../../../remix/app/components/Layout/RootRecovery';
import { RootDataUnavailableError } from '../../../remix/app/utils/rootDataRecovery';
import { createLocalHomeBootstrap } from '../../../remix/app/local-workspace/localHomeBootstrap';
import { registerLocalHomeBootstrap } from '../../../remix/app/local-workspace/localHomeBootstrap.client';
import { rootIdentity } from '../../../remix/app/utils/rootIdentity';
const mode=new URL(location.href).searchParams.get('mode');
let availabilitySettled=false, loaderCalls=0, selected=false, attempts=0, finish:((value:unknown)=>void)|undefined, fail:((error:Error)=>void)|undefined;
const proof={featureVersion:'1.0.0',documentId:'11111111-1111-4111-8111-111111111111',origin:location.origin,profile:'fresh-owned',canInitialize:true};
const controller=createLocalHomeBootstrap({origin:location.origin,identity:rootIdentity,
 selection:{canInitializeDeviceHome:()=>mode!=='existing'&&!selected,initializeDeviceHome:()=>{selected=true;}},
 requestHost:async action=>{
  if(action==='status')return mode==='unsupported'?{}:proof;
  attempts++;return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
 }
});
registerLocalHomeBootstrap({initialize:controller.initialize,available:async()=>{try{return await controller.available();}finally{availabilitySettled=true;}}});
(window as any).recoveryFixture={snapshot:()=>({attempts,selected,availabilitySettled,loaderCalls,revalidation:router.state.revalidation,errors:Object.keys(router.state.errors??{}),loaderData:router.state.loaderData}),reject:()=>fail?.(new Error('The device could not be initialized. Retry this action. '+ 'diagnostic'.repeat(20))),resolve:()=>finish?.(proof),invalidate:()=>rootIdentity.changed()};
const router=createBrowserRouter([{path:'*',loader:async()=>{loaderCalls++;await fetch("/fixture-root-check",{cache:"no-store"});if(!selected)throw new RootDataUnavailableError(mode!=='nonretryable');return null;},element:<main><h1>Synthetic initialization acknowledged</h1></main>,errorElement:<RootRecovery/>}]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>);
