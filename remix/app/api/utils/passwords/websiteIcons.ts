import { passwordRasterIconFormat } from '~/passwords/icons';
import { request as httpsRequest } from 'node:https';
import { resolveMailHost } from '../mail/network';
import { parse, parseFragment, serialize } from 'parse5';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

/** Anonymous, bounded presentation probe. These budgets never constrain saved
 * vault fields or manually uploaded icons. DNS is pinned in the actual socket. */
export async function fetchPublicIconResource(input: string, signal: AbortSignal, deps = { resolve: resolveMailHost, request: httpsRequest },authorize=async()=>{}) {
  let url = new URL(input);
  const visited = new Set<string>();
  while (true) {
    signal.throwIfAborted();await authorize();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || visited.has(url.href)) throw new Error('Unavailable public icon');
    if(visited.size>=5)throw new Error('Redirect probe budget exhausted');
    visited.add(url.href);
    const selected = await deps.resolve(url.hostname.replace(/^\[|\]$/g, ''), signal);
    await authorize();signal.throwIfAborted();
    const target=url;
    const response = await new Promise<{status:number;type:string;location?:string;bytes:Buffer}>((resolve,reject)=>{
      const req = deps.request(target, { agent:false, method:'GET', signal, headers:{Accept:'text/html,image/*;q=0.9', 'Accept-Encoding':'identity'},
        lookup:((_host:string,options:any,callback:any)=>options?.all ? callback(null,[selected]) : callback(null,selected.address,selected.family)) as any }, res=>{
        const status=res.statusCode || 0,location=res.headers.location,type=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(status>=300&&status<400){res.destroy();resolve({status,type,location,bytes:Buffer.alloc(0)});return;}
        if(status!==200 || (res.headers['content-encoding'] && res.headers['content-encoding']!=='identity')){res.destroy();reject(new Error('Unavailable icon'));return;}
        const chunks:Buffer[]=[];let size=0;
        res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){res.destroy(new Error('Presentation probe budget exhausted'));return;}chunks.push(Buffer.from(chunk));});
        res.on('error',reject);res.on('end',()=>resolve({status,type,bytes:Buffer.concat(chunks)}));
      });req.on('error',reject);req.end();
    });
    if(response.status>=300&&response.status<400){if(!response.location)throw new Error('Unavailable icon');url=new URL(response.location,url);continue;}
    return {...response,url:url.href};
  }
}

type Node = {tagName?:string;nodeName?:string;value?:string;attrs?:{name:string;value:string}[];childNodes?:Node[]};
const walk=(node:Node,visit:(node:Node)=>void)=>{visit(node);for(const child of node.childNodes||[])walk(child,visit);};
export function declaredWebsiteIcons(html:string,base:string):string[]{
  const result:string[]=[];
  walk(parse(html) as Node,node=>{
    if(node.tagName!=='link')return;
    const attrs=Object.fromEntries((node.attrs||[]).map(({name,value})=>[name,value]));
    if(!String(attrs.rel||'').toLowerCase().split(/\s+/).some(rel=>['icon','apple-touch-icon','apple-touch-icon-precomposed'].includes(rel)))return;
    try{const url=new URL(attrs.href,base);if(url.protocol==='https:'&&!url.username&&!url.password)result.push(url.href);}catch{}
  });
  return [...new Set(result)];
}

/** Some product pages share the parent site's favicon but publish their own
 * mark as an image. Only the caller's pinned official asset namespace matches. */
export function declaredBrandImages(html: string, matches: (url: URL) => boolean): string[] {
  const result = new Set<string>();
  walk(parse(html) as Node, node => {
    if (node.tagName !== 'img') return;
    const src = node.attrs?.find(attr => attr.name === 'src')?.value;
    if (!src) return;
    try {
      const url = new URL(src);
      if (url.protocol === 'https:' && !url.username && !url.password && matches(url)) result.add(url.href);
    } catch { /* Ignore relative or invalid sources for a pinned namespace. */ }
  });
  return [...result];
}

/** Only self-contained vector primitives reach resvg. No scripts, foreign
 * documents, fonts, files, data images or network references are retained. */
function selfContainedSvg(bytes:Buffer){
  const fragment=parseFragment(bytes.toString('utf8')) as Node;
  const root=fragment.childNodes?.find(node=>node.tagName==='svg');if(!root)throw new Error('Invalid SVG');
  const allowed=new Set(['svg','g','defs','path','rect','circle','ellipse','line','polyline','polygon','linearGradient','radialGradient','stop','clipPath','mask','pattern','symbol','use','title','desc']);
  walk(root,node=>{
    node.childNodes=node.childNodes?.filter(child=>child.nodeName==='#text'||(!!child.tagName&&allowed.has(child.tagName)));
    node.attrs=node.attrs?.filter(attr=>{
      if(attr.name==='xmlns')return attr.value==='http://www.w3.org/2000/svg';
      if(/^on/i.test(attr.name)||['src','font-family'].includes(attr.name))return false;
      if(attr.name==='href'||attr.name==='xlink:href')return /^#[\w.-]+$/.test(attr.value);
      // Escapes/imports/external CSS URLs cannot hide resource references.
      return !/[\\@]/.test(attr.value)&&!/(?:https?:|file:|data:|\/\/)/i.test(attr.value)&&!(/url\s*\(/i.test(attr.value)&&!/^url\(\s*#[\w.-]+\s*\)$/.test(attr.value));
    });
  });
  return serialize({nodeName:'#document-fragment',childNodes:[root]} as any);
}

/** ICO directory and uncompressed 24/32-bit DIB entries, including their alpha
 * mask. PNG-compressed entries use the same raster decoder as ordinary PNGs. */
type IconCandidate={bytes:Buffer;raw?:{width:number;height:number;channels:4}};
function* icoImages(bytes:Buffer):Generator<IconCandidate>{
  if(bytes.length<6||bytes.readUInt16LE(0)!==0||bytes.readUInt16LE(2)!==1){yield {bytes};return;}
  const count=bytes.readUInt16LE(4);
  for(let i=0;i<count;i++){
    const at=6+i*16;if(at+16>bytes.length)break;
    const length=bytes.readUInt32LE(at+8),offset=bytes.readUInt32LE(at+12);if(offset<6+count*16||offset+length>bytes.length)continue;
    const dib=bytes.subarray(offset,offset+length);if(dib.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){yield {bytes:dib};continue;}
    if(dib.length<40||dib.readUInt32LE(0)!==40||dib.readUInt32LE(16)!==0)continue;
    const width=bytes[at]||256,height=bytes[at+1]||256,bits=dib.readUInt16LE(14),stride=Math.ceil(width*bits/32)*4,maskStride=Math.ceil(width/32)*4;
    if(![24,32].includes(bits)||dib.readInt32LE(4)!==width||dib.readInt32LE(8)!==height*2||40+stride*height>dib.length)continue;
    const rgba=Buffer.alloc(width*height*4);let hasAlpha=false;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const from=40+(height-y-1)*stride+x*(bits/8),to=(y*width+x)*4;
      rgba[to]=dib[from+2];rgba[to+1]=dib[from+1];rgba[to+2]=dib[from];rgba[to+3]=bits===32?dib[from+3]:255;if(bits===32&&dib[from+3])hasAlpha=true;
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const to=(y*width+x)*4+3,mask=40+stride*height+(height-y-1)*maskStride+(x>>3);
      if(bits===32&&!hasAlpha)rgba[to]=255;
      if(mask<dib.length&&(dib[mask]&(128>>(x%8))))rgba[to]=0;
    }
    // Encode a small standard BMP-free PNG through a raw descriptor below.
    yield {bytes:rgba,raw:{width,height,channels:4}};
  }
}
const rasterSignature=(bytes:Buffer)=>{const format=passwordRasterIconFormat(bytes);return format!==null&&format!=='ico';};
const icoSignature=(bytes:Buffer)=>passwordRasterIconFormat(bytes)==='ico';
export async function decodeWebsiteIcon(bytes:Buffer,_type:string,signal?:AbortSignal):Promise<Buffer>{
  signal?.throwIfAborted();
  let candidates:Iterable<IconCandidate>;
  if(!rasterSignature(bytes)&&!icoSignature(bytes)){
    const svg=selfContainedSvg(bytes),options={font:{loadSystemFonts:false},logLevel:'off' as const};
    const size=new Resvg(svg,options);
    if(!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<=0||size.height<=0)throw new Error('Invalid SVG');
    candidates=[{bytes:new Resvg(svg,{...options,fitTo:{mode:size.width>=size.height?'width':'height',value:64}}).render().asPng()}];
  }else candidates=icoImages(bytes);
  for(const candidate of candidates){signal?.throwIfAborted();try{
    let image;
    if(candidate.raw)image=sharp(candidate.bytes,{raw:candidate.raw});
    else {
      if(!rasterSignature(candidate.bytes))continue;
      image=sharp(candidate.bytes,{limitInputPixels:40_000_000,animated:false});
      if(!['png','jpeg','gif','webp'].includes((await image.metadata()).format||''))continue;
    }
    const output=await image.timeout({seconds:2}).resize({width:64,height:64,fit:'inside'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(!output.data.some((value,index)=>index%4===3&&value))continue;
    return await sharp(output.data,{raw:{width:output.info.width,height:output.info.height,channels:4}}).png().toBuffer();
  }catch{}}
  throw new Error('No usable icon');
}

type WebsiteIconDeps = { fetch: typeof fetchPublicIconResource; decode: typeof decodeWebsiteIcon };
const websiteIconDeps: WebsiteIconDeps = { fetch: fetchPublicIconResource, decode: decodeWebsiteIcon };

export async function resolvePublicPageIcon(pageUrl: string, signal: AbortSignal, {
  deps = websiteIconDeps,
  authorize = async () => {},
  discover = declaredWebsiteIcons,
  useOriginFavicon = true,
  publishedIcon,
  acceptedImageType = (_type: string) => true,
}: {
  deps?: WebsiteIconDeps;
  authorize?: () => Promise<void>;
  discover?: (html: string, base: string) => string[];
  useOriginFavicon?: boolean;
  publishedIcon?: string;
  acceptedImageType?: (type: string) => boolean;
} = {}): Promise<Buffer | null> {
  signal.throwIfAborted();
  let icons: string[] = [];
  try {
    const page = await deps.fetch(pageUrl, AbortSignal.any([signal, AbortSignal.timeout(3500)]), undefined, authorize);
    if (['text/html', 'application/xhtml+xml'].includes(page.type)) icons = discover(page.bytes.toString('utf8'), page.url);
  } catch { signal.throwIfAborted(); }
  if (publishedIcon) icons.push(publishedIcon);
  if (useOriginFavicon) icons.push(new URL('/favicon.ico', pageUrl).href);
  for (const url of new Set(icons)) {
    try {
      const resource = await deps.fetch(url, AbortSignal.any([signal, AbortSignal.timeout(3500)]), undefined, authorize);
      if (!acceptedImageType(resource.type)) continue;
      const image = await deps.decode(resource.bytes, resource.type, signal);
      signal.throwIfAborted();
      return image;
    } catch { signal.throwIfAborted(); }
  }
  return null;
}

export async function resolveWebsiteIcon(origins: string[], signal: AbortSignal, deps = websiteIconDeps, authorize = async () => {}): Promise<Buffer | null> {
  for (const origin of origins) {
    const image = await resolvePublicPageIcon(origin + '/', signal, { deps, authorize });
    if (image) return image;
  }
  return null;
}
