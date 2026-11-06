/** Real components; the API runner supplies only its disposable identity. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChakraProvider} from '@chakra-ui/react';
import {createMemoryRouter,RouterProvider} from 'react-router';
import {ThingtimeProvider} from '../app/Providers/ThingtimeProvider';
import {PasswordManager} from '../app/components/Passwords/PasswordManager';
import {BrowserPasswordProvider} from '../app/components/Passwords/BrowserPasswordProvider';
import {BrowserPasswordFillProvider} from '../app/components/Passwords/BrowserPasswordFillProvider';
async function start(){
 const user=await(await fetch('/__password_verification_fixture')).json();
 const data={user,dataPlane:'home'};
 const surface=new URLSearchParams(location.search).get('surface');
 const router=createMemoryRouter([{id:'root',path:'*',element:surface==='native'?<BrowserPasswordFillProvider/>:surface==='provider'?<BrowserPasswordProvider/>:<PasswordManager/>,loader:()=>data}],{hydrationData:{loaderData:{root:data}}});
 createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="isolated-password-verification" persistLocal={false} exposeGlobals={false}><RouterProvider router={router}/></ThingtimeProvider></ChakraProvider>);
}
void start();
