import { isPngThumbnail } from '~/utils/pngThumbnail';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import type { PasswordMetadata } from './model';
import { PASSWORD_ICON_MIME_TYPES, passwordIconUrl, passwordRasterIconFormat, validatePasswordIcon, type PasswordIcon } from './icons';
import { openPasswordFile } from './files.client';
const iconMime = (value: string) => value.toLowerCase().split(';')[0].trim();
export async function fetchPasswordIcon(url: string, signal?: AbortSignal): Promise<Blob> {
  // A deliberate icon load is always anonymous and never follows redirects.
  const response = await fetch(passwordIconUrl(url), { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', mode: 'cors', signal });
  if (!response.ok || !PASSWORD_ICON_MIME_TYPES.includes(iconMime(response.headers.get('content-type') || ''))) throw new Error('This URL did not provide a supported icon. Upload the image instead.');
  return response.blob();
}
export async function openPasswordIconBlob(ownerId: string, entryId: string, value: PasswordIcon, signal?: AbortSignal): Promise<Blob> {
  const icon = validatePasswordIcon(value);
  if (icon.kind === 'url') return fetchPasswordIcon(icon.url, signal);
  const opened = await openPasswordFile(ownerId, entryId, icon.fileId, signal);
  const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' } as Record<string, string>)[opened.metadata.name.split('.').at(-1)?.toLowerCase() || ''];
  if (!mime) { await opened.stream.cancel(); throw new Error('Choose a PNG, JPEG, WebP, GIF, or ICO image.'); }
  const blob = await new Response(opened.stream).blob(); signal?.throwIfAborted();
  return new Blob([blob], { type: mime });
}

// Presentation only; no URLs from vault fields enter this cache or transport.
const previewCache=new Map<string,{blob:Blob|null;expires:number}>();
const previewPending=new Map<string,{controller:AbortController;users:number;promise:Promise<Blob|null>}>();
let activePreviews=0;
const previewWaiters:(()=>void)[]=[];
async function queuedPreview(signal:AbortSignal,work:()=>Promise<Blob|null>){
  while(activePreviews>=4){await new Promise<void>((resolve,reject)=>{
    const ready=()=>{signal.removeEventListener('abort',abort);resolve();};
    const abort=()=>{const i=previewWaiters.indexOf(ready);if(i>=0)previewWaiters.splice(i,1);reject(new DOMException('Cancelled','AbortError'));};
    previewWaiters.push(ready);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });}
  if(signal.aborted){previewWaiters.shift()?.();signal.throwIfAborted();}activePreviews++;
  try{return await work();}finally{activePreviews--;previewWaiters.shift()?.();}
}
export function clearPasswordPreviewIcons(ownerId:string,origin=location.origin){
  const scope=JSON.stringify([origin,ownerId]);
  for(const key of previewCache.keys())if(key.startsWith(scope+':'))previewCache.delete(key);
  for(const[key,value]of previewPending)if(key.startsWith(scope+':')){value.controller.abort();previewPending.delete(key);}
}
export async function openPasswordPreviewIcon(ownerId:string,entry:Pick<PasswordMetadata,'id'|'revision'|'icon'|'websiteIcon'>,signal:AbortSignal):Promise<Blob|null>{
  const origin=location.origin,key=JSON.stringify([origin,ownerId])+':'+JSON.stringify([entry.id,entry.revision,entry.icon,entry.websiteIcon]);
  signal.throwIfAborted();const cached=previewCache.get(key);if(cached&&cached.expires>Date.now())return cached.blob;
  let pending=previewPending.get(key);
  if(!pending){
    const controller=new AbortController();
    const job={controller,users:0,promise:null as unknown as Promise<Blob|null>};
    job.promise=queuedPreview(controller.signal,async()=>{
      if(entry.icon)return openPasswordIconBlob(ownerId,entry.id,entry.icon,controller.signal);
      if(!entry.websiteIcon)return null;
      await requireThingtimeCapability('api.passwords','1.6.0');controller.signal.throwIfAborted();
      const response=await fetch('/api/v1/passwords',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'website-icon',expectedOwnerId:ownerId,id:entry.id,revision:entry.revision})});
      if(location.origin!==origin||response.headers.get('X-Thingtime-Owner-Id')!==ownerId)throw new Error('This preview account changed.');
      if(response.status===204)return null;
      if(!response.ok||response.headers.get('Content-Type')!=='image/png')throw new Error('Website icon unavailable.');
      return response.blob();
    }).then(blob=>{
      controller.signal.throwIfAborted();if(location.origin!==origin)throw new Error('This preview origin changed.');
      previewCache.set(key,{blob,expires:Date.now()+120_000});
      // A transient thumbnail working-set budget, never a vault item limit.
      while(previewCache.size>64)previewCache.delete(previewCache.keys().next().value!);
      return blob;
    }).finally(()=>{if(previewPending.get(key)===job)previewPending.delete(key);});
    pending=job;previewPending.set(key,job);
  }
  const current=pending;current.users++;
  return new Promise<Blob|null>((resolve,reject)=>{
    let done=false;
    const finish=(error:unknown,blob?:Blob|null)=>{
      if(done)return;done=true;signal.removeEventListener('abort',abort);current.users--;
      if(current.users===0&&previewPending.get(key)===current)current.controller.abort();
      if(error)reject(error);else resolve(blob??null);
    };
    const abort=()=>finish(new DOMException('Cancelled','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    current.promise.then(blob=>finish(null,blob),error=>finish(error));if(signal.aborted)abort();
  });
}

/** Reuse the renderer's existing bounded PNG image wire format. Validate with
 * the browser decoder before publishing; never widen untrusted URL protocols. */
export async function passwordPreviewThumbnail(blob:Blob,signal:AbortSignal):Promise<string>{
  signal.throwIfAborted();if(!passwordRasterIconFormat(new Uint8Array(await blob.slice(0,16).arrayBuffer())))throw new Error('Invalid raster icon.');
  signal.throwIfAborted();const image=await createImageBitmap(blob);
  try{
    signal.throwIfAborted();
    if(blob.type==='image/png'&&blob.size<=24_576){
      const bytes=new Uint8Array(await blob.arrayBuffer());signal.throwIfAborted();
      const source='data:image/png;base64,'+btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
      if(isPngThumbnail(source))return source;
    }
    const scale=Math.min(64/image.width,64/image.height,1),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Image decoder unavailable.');
    context.drawImage(image,0,0,canvas.width,canvas.height);const source=canvas.toDataURL('image/png');signal.throwIfAborted();
    if(!isPngThumbnail(source))throw new Error('Invalid image thumbnail.');return source;
  }finally{image.close();}
}
