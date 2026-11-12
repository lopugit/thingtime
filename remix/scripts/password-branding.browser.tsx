/** Actual editable password documents, synthetic display bindings only; no credentials or API. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { TransientBlockHost } from '../app/components/Builder/TransientBlockHost';
import { BROWSER_PROVIDER_BLOCKS } from '../app/components/Passwords/browserProviderBlocks';
import { PASSWORD_GENERATOR_BLOCKS } from '../app/components/Passwords/passwordGeneratorDocument';
import { PASSWORD_PASSKEY_BLOCKS } from '../app/components/Passwords/passwordPasskeyBlocks';
import { NATIVE_PASSWORD_CONNECTION_BLOCKS } from '../app/components/Passwords/nativePasswordConnectionBlocks';
import { PASSWORD_MANAGER_SETTINGS_BLOCKS } from '../app/components/Settings/passwordManagerSettingsBlocks';
import { passwordIconBlocks } from '../app/components/Passwords/passwordIconBlocks';
window.fetch=async()=>Response.json({ok:false,error:'Read-only synthetic branding fixture.'},{status:403});
const documents={approval:BROWSER_PROVIDER_BLOCKS,settings:PASSWORD_MANAGER_SETTINGS_BLOCKS,connection:NATIVE_PASSWORD_CONNECTION_BLOCKS,passkeys:PASSWORD_PASSKEY_BLOCKS,generator:PASSWORD_GENERATOR_BLOCKS,entryIcon:passwordIconBlocks};
const excluded=new URLSearchParams(location.search).has('excluded');
const result={canRefresh:!excluded,refreshDisabled:excluded,canChooseProvider:!excluded,cancelLabel:excluded?'Return to website':'Cancel',title:excluded?'Save a passkey in Thingtime':'Sign in with Thingtime',origin:'https://website.example.test',rp:'example.test',busy:false,choosing:false,canApprove:false,creating:excluded,account:excluded?'Synthetic website account':'',empty:!excluded,hasError:excluded,error:excluded?'This website already has a passkey. Return to the website to continue.':'',status:'This synthetic account is connected on this device',label:'Disconnect AutoFill',disabled:false,hasNotice:false,open:true,nativeAvailable:true,extensionAvailable:true,extensionStatus:'Thingtime browser extension is available',extensionMissing:false,webOnly:false,length:24,uppercase:true,lowercase:true,digits:true,symbols:true,allowedSymbols:'!@#',excludedCharacters:'',preset:'general',targetId:'password',targets:[{id:'password',label:'Password'}],buttonLabel:'Generate password',sources:[],guidance:'Synthetic preview only.'};
function Gallery(){return <main style={{maxWidth:1120,margin:'auto',padding:24,fontFamily:'system-ui',color:'#242130'}}><h1>Password branding · synthetic fixture</h1><p>No account, vault, credential or registration operation runs here.</p>{Object.entries(documents).map(([name,blocks])=><section key={name} data-brand-surface={name} style={{borderTop:'1px solid #dedbe8',padding:'24px 0',minWidth:0}}><TransientBlockHost scopeKey={name} scope={{result,icon:{busy:false,unsaved:true,showUrl:false,cannotUpload:true,cannotWebsite:true,cannotRemove:true,error:''}}} actions={{}} enabled={false}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive={false} bare /></TransientBlockHost></section>)}</main>}
const data={user:null,dataPlane:null};const router=createMemoryRouter([{id:'root',path:'*',element:<Gallery/>,loader:()=>data}],{hydrationData:{loaderData:{root:data}}});
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="synthetic-password-branding" persistLocal={false} exposeGlobals={false}><RouterProvider router={router}/></ThingtimeProvider></ChakraProvider>);
