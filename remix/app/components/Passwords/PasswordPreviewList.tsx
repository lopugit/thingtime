import React from 'react';
import type {PasswordMetadata} from '~/passwords/model';
import {openPasswordIconBlob} from '~/passwords/icons.client';
import {SettingsDocumentHost} from '../Settings/SettingsDocumentHost';
import {TransientBlockHost} from '../Builder/TransientBlockHost';
import {WebpageBlocksRenderer} from '../Builder/WebpageBlocksRenderer';
import type {WebpageBlock} from '../Builder/webpageBlocks';
import {PASSWORD_BRAND_ICON, migratePasswordPreviewContrast} from './passwordBrandingBlocks';
const text=(id:string,tag:string,value:string,css:Record<string,string>={}):WebpageBlock=>({id:`pp-${id}`,type:'element',tag,text:value,css:{'min-width':'0','overflow-wrap':'anywhere','line-height':'1.5',...css}} as WebpageBlock);
export const PASSWORD_PREVIEW_BLOCKS:WebpageBlock[]=[{id:'pp-list',type:'collection',props:{itemsPath:'result.entries',size:'all',transparent:true},children:[{
 id:'pp-card',type:'element',tag:'button',props:{type:'button',disabled:'{result.disabled}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'password.open',id:'{item.id}'}},
 css:{display:'flex',gap:'12px','align-items':'center','text-align':'left',width:'100%','min-width':'0',padding:'16px',margin:'0 0 8px',border:'1px solid var(--tt-border, #ddd)','border-radius':'12px',background:'var(--tt-card, white)',color:'inherit',font:'inherit'},children:[
 {id:'pp-icon',type:'element',tag:'img',props:{src:'{item.image}',alt:'','aria-hidden':true,width:32,height:32},css:{width:'32px',height:'32px','object-fit':'contain','flex-shrink':'0'}} as WebpageBlock,
 {id:'pp-copy',type:'element',tag:'span',css:{display:'flex','flex-direction':'column','min-width':'0'},children:[text('title','strong','{item.title}'),text('username','span','{item.usernameLabel}',{'font-size':'14px',color:'inherit'}),text('type','span','{item.typeLabel}',{'font-size':'12px',color:'inherit'})]} as WebpageBlock,
 ]} as WebpageBlock]} as unknown as WebpageBlock];
/** Preview text and image are ordinary editable blocks. The adapter alone opens
 * an exact metadata ID; no secret entry or image bytes enter saved layout data. */
export function PasswordPreviewList({ownerId,entries,disabled,onOpen}:{ownerId:string;entries:PasswordMetadata[];disabled:boolean;onOpen:(entry:PasswordMetadata)=>void}){
 const [images,setImages]=React.useState<Record<string,string>>({});
 const descriptor=JSON.stringify(entries.map(({id,icon})=>({id,icon})));
 const iconEntries=React.useMemo(()=>JSON.parse(descriptor) as Pick<PasswordMetadata,'id'|'icon'>[],[descriptor]);
 React.useEffect(()=>{const controller=new AbortController(),urls:string[]=[];setImages({});
  for(const entry of iconEntries)if(entry.icon)void openPasswordIconBlob(ownerId,entry.id,entry.icon,controller.signal).then(blob=>{if(controller.signal.aborted)return;const url=URL.createObjectURL(blob);urls.push(url);setImages(current=>({...current,[entry.id]:url}));}).catch(()=>{});
  return()=>{controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
 },[ownerId,iconEntries]);
 return <SettingsDocumentHost documentKey="password-preview-cards" title="Saved password card layout" defaultDocument={PASSWORD_PREVIEW_BLOCKS} migrateBlocks={migratePasswordPreviewContrast} scopeKey={ownerId} layoutEditingDisabled={disabled}>
 {({blocks,chrome,editing})=><TransientBlockHost scopeKey={ownerId} enabled={!editing} actions={{'password.open':({inputs})=>{if(disabled)return;const entry=entries.find(value=>value.id===inputs.id);if(entry)onOpen(entry);}}} scope={{result:{disabled,entries:entries.map(entry=>({...entry,image:images[entry.id]||PASSWORD_BRAND_ICON,usernameLabel:entry.username||'No username or email saved',typeLabel:entry.passwordType.replace(/-/g,' ')}))}}}>
 <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
 </TransientBlockHost>}
 </SettingsDocumentHost>;
}
