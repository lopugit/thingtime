/** Disposable real-API account fixture; no injected production session. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChakraProvider} from '@chakra-ui/react';
import {createBrowserRouter,RouterProvider,Outlet,useRevalidator} from 'react-router';
import {ThingtimeProvider} from '../app/Providers/ThingtimeProvider';
import {BrowserExtensionAccountBridge} from '../app/components/Passwords/BrowserExtensionAccountBridge';
import {BrowserExtensionAccounts} from '../app/components/Passwords/BrowserExtensionAccounts';
function Root(){const revalidator=useRevalidator();React.useEffect(()=>{const refresh=()=>revalidator.revalidate();window.addEventListener('thingtime:root-data-refresh',refresh);return()=>window.removeEventListener('thingtime:root-data-refresh',refresh);},[revalidator]);return <><BrowserExtensionAccountBridge/><Outlet/></>;}
const router=createBrowserRouter([{id:'root',path:'/',loader:async()=>({user:await(await fetch('/__accounts_fixture',{cache:'no-store'})).json(),dataPlane:'home'}),element:<Root/>,children:[{path:'*',element:<BrowserExtensionAccounts/>}]}]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="isolated-extension-accounts" persistLocal={false} exposeGlobals={false}><RouterProvider router={router}/></ThingtimeProvider></ChakraProvider>);
