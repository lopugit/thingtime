import type {WebpageBlock} from '../Builder/webpageBlocks';
import {passwordBrandingMigration} from './passwordBrandingBlocks';
export const BROWSER_EXTENSION_ACCOUNT_BLOCKS=passwordBrandingMigration('ea-heading')([
 {id:'ea-root',type:'element',tag:'section',css:{'overflow-wrap':'anywhere'},children:[
  {id:'ea-heading',type:'element',tag:'h1',text:'Your Thingtime accounts',css:{'font-size':'28px','font-weight':'600'}},
  {id:'ea-intro',type:'element',tag:'p',text:'Sign in or choose an account for your browser password workspace.',css:{margin:'16px 0','line-height':'1.5'}},
  {id:'ea-session-notice',type:'element',tag:'p',text:'Switching here also switches this browser’s Thingtime web tabs. Passwords and account sessions stay in Thingtime.',css:{margin:'16px 0','line-height':'1.5'}},
 ]}
] as WebpageBlock[]);
export const BROWSER_EXTENSION_ACCOUNT_FOOTER:WebpageBlock[]=[
  {id:'ea-return-action',type:'element',tag:'button',text:'Return to Thingtime workspace',props:{type:'button','data-tt-action':'$transient','data-tt-action-inputs':{operation:'accounts.return'}},css:{padding:'12px 16px','min-height':'44px',margin:'16px 0',border:'1px solid var(--tt-border, #ddd)','border-radius':'10px',background:'var(--tt-card, white)'}},
  {id:'ea-return-status',type:'element',tag:'p',text:'{result.returnStatus}',props:{role:'status'}},
  {id:'ea-return',type:'element',tag:'p',text:'Return to the browser workspace after signing in. Your saved opening size and text size are unchanged.',css:{margin:'24px 0','line-height':'1.5'}}
];
