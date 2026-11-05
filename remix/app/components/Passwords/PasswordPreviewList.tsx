import React from 'react';
import type {PasswordStorage} from '~/passwords/storage';
import {openStoredPasswordIconBlob} from './PasswordIcon';
import type {PasswordMetadata} from '~/passwords/model';
import {openPasswordPreviewIcon, clearPasswordPreviewIcons, passwordPreviewThumbnail} from '~/passwords/icons.client';
import {SettingsDocumentHost} from '../Settings/SettingsDocumentHost';
import {TransientBlockHost} from '../Builder/TransientBlockHost';
import {WebpageBlocksRenderer} from '../Builder/WebpageBlocksRenderer';
import type {WebpageBlock} from '../Builder/webpageBlocks';
import {PASSWORD_BRAND_ICON, PASSWORD_PREVIEW_ICON_CSS, migratePasswordPreviewContrast} from './passwordBrandingBlocks';
const text=(id:string,tag:string,value:string,css:Record<string,string>={}):WebpageBlock=>({id:`pp-${id}`,type:'element',tag,text:value,css:{'min-width':'0','overflow-wrap':'anywhere','line-height':'1.5',...css}} as WebpageBlock);
export const PASSWORD_PREVIEW_BLOCKS:WebpageBlock[]=[{id:'pp-list',type:'collection',props:{itemsPath:'result.entries',size:'all',transparent:true},children:[{
 id:'pp-card',type:'element',tag:'button',props:{type:'button',disabled:'{result.disabled}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'password.open',id:'{item.id}'}},
 css:{display:'flex',gap:'12px','align-items':'center','text-align':'left',width:'100%','min-width':'0',padding:'16px',margin:'0 0 8px',border:'1px solid var(--tt-border, #ddd)','border-radius':'12px',background:'var(--tt-card, white)',color:'inherit',font:'inherit'},children:[
 {id:'pp-icon',type:'element',tag:'img',props:{src:'{item.image}',alt:'','aria-hidden':true,width:32,height:32},css:PASSWORD_PREVIEW_ICON_CSS} as WebpageBlock,
 {id:'pp-copy',type:'element',tag:'span',css:{display:'flex','flex-direction':'column','min-width':'0'},children:[text('title','strong','{item.title}'),text('username','span','{item.usernameLabel}',{'font-size':'14px',color:'inherit'}),text('type','span','{item.typeLabel}',{'font-size':'12px',color:'inherit'})]} as WebpageBlock,
 ]} as WebpageBlock]} as unknown as WebpageBlock];
/** Preview text and image are ordinary editable blocks. The adapter alone opens
 * an exact metadata ID; no secret entry or image bytes enter saved layout data. */
export function PasswordPreviewList({storage,ownerId,entries,disabled,onOpen}:{storage?:PasswordStorage;ownerId:string;entries:PasswordMetadata[];disabled:boolean;onOpen:(entry:PasswordMetadata,trigger:HTMLElement|null)=>void}){
 const root=React.useRef<HTMLDivElement>(null);
 const origin=location.origin,scope=JSON.stringify([origin,ownerId]);
 const [images,setImages]=React.useState<{scope:string;urls:Record<string,string>}>({scope,urls:{}});
 const descriptor=JSON.stringify(entries.map(({id,revision,icon,websiteIcon})=>({id,revision,icon,websiteIcon})));
 const iconEntries=React.useMemo(()=>JSON.parse(descriptor) as Pick<PasswordMetadata,'id'|'revision'|'icon'|'websiteIcon'>[],[descriptor]);
 React.useEffect(()=>()=>clearPasswordPreviewIcons(ownerId,origin),[ownerId,origin]);
 React.useEffect(()=>{
  const controller=new AbortController(),requested=new Set<string>();setImages({scope,urls:{}});
  const load=(id:string)=>{
   const entry=iconEntries.find(item=>item.id===id);if(!entry||requested.has(id)||(!entry.icon&&!entry.websiteIcon))return;requested.add(id);
   void (storage ? entry.icon?.kind==='attachment' ? openStoredPasswordIconBlob(storage,entry.id,entry.icon,controller.signal) : Promise.resolve(null) : openPasswordPreviewIcon(ownerId,entry,controller.signal)).then(async blob=>{if(controller.signal.aborted||!blob)return;const source=await passwordPreviewThumbnail(blob,controller.signal);if(controller.signal.aborted)return;setImages(current=>current.scope===scope?{scope,urls:{...current.urls,[id]:source}}:current);}).catch(()=>{});
  };
  // Observe the existing editable card's exact Action input, rather than guess
  // identities from titles or array positions. Custom layouts keep their data.
  const observer=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){try{load(JSON.parse(item.target.getAttribute('data-tt-action-inputs')||'{}').id);}catch{}}},{rootMargin:'128px'});
  const observed=new WeakSet<Element>();
  const observe=()=>{for(const card of root.current?.querySelectorAll('[data-tt-action-inputs]')||[])if(!observed.has(card)&&card.querySelector('[data-block-id="pp-icon"]')){observed.add(card);observer.observe(card);}};
  const changes=new MutationObserver(observe);if(root.current)changes.observe(root.current,{childList:true,subtree:true});observe();
  return()=>{controller.abort();observer.disconnect();changes.disconnect();};
 },[ownerId,scope,iconEntries,storage]);
 return <div ref={root} className="tt-password-preview-list"><style>{`
  .tt-password-preview-list button[data-tt-action="$transient"]:enabled { cursor: pointer; }
  .tt-password-preview-list button[data-tt-action="$transient"]:focus-visible { outline: 2px solid var(--tt-accent, currentColor); outline-offset: 2px; }
 `}</style><SettingsDocumentHost documentKey="password-preview-cards" title="Saved password card layout" defaultDocument={PASSWORD_PREVIEW_BLOCKS} migrateBlocks={migratePasswordPreviewContrast} scopeKey={ownerId} layoutEditingDisabled={disabled}>
 {({blocks,chrome,editing})=><TransientBlockHost scopeKey={ownerId} enabled={!editing} actions={{'password.open':({inputs})=>{if(disabled)return;const entry=entries.find(value=>value.id===inputs.id);const active=document.activeElement;const trigger=active instanceof HTMLElement&&root.current?.contains(active)?active:null;if(entry)onOpen(entry,trigger);}}} scope={{result:{disabled,entries:entries.map(entry=>({...entry,image:(images.scope===scope?images.urls[entry.id]:undefined)||PASSWORD_BRAND_ICON,usernameLabel:entry.username||'No username or email saved',typeLabel:entry.passwordType.replace(/-/g,' ')}))}}}>
 <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
 </TransientBlockHost>}
 </SettingsDocumentHost></div>;
}
