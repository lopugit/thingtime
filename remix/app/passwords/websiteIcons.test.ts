import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import sharp from 'sharp';
import { passwordWebsiteOrigins } from './icons';
import { resolveMailHost } from '../api/utils/mail/network';
import { declaredWebsiteIcons,decodeWebsiteIcon,fetchPublicIconResource,resolveWebsiteIcon } from '../api/utils/passwords/websiteIcons';

test('automatic Website projection preserves saved order and excludes concealed/secret/structured fields and credentials',()=>{
 const field=(value:string,extra:Record<string,unknown>={})=>({type:'url',value,...extra});
 assert.deepEqual(passwordWebsiteOrigins({fields:[field('https://first.example/account?token=private#secret'),field('https://hidden.example',{concealed:true}),field('https://password.example',{type:'password'}),field('https://structured.example',{structured:true}),field('https://user:secret@credentials.example'),field('http://plain.example'),field('https://first.example/again'),field('https://second.example:443/path')]}),['https://first.example','https://second.example']);
});
const png=()=>sharp({create:{width:8,height:4,channels:4,background:{r:120,g:40,b:200,alpha:1}}}).png().toBuffer();
test('ordered sites continue after corrupt icon bytes and a failing favicon; declared CDN icons and SVG decode to safe PNG',async()=>{
 const seen:string[]=[],good=await png();
 const icon=await resolveWebsiteIcon(['https://first.example','https://second.example'],new AbortController().signal,{decode:decodeWebsiteIcon,fetch:async(url)=>{
  seen.push(url);
  if(url==='https://first.example/')return{status:200,type:'text/html',url,bytes:Buffer.from('<link rel="icon" href="/bad.png">')};
  if(url==='https://first.example/bad.png')return{status:200,type:'image/png',url,bytes:Buffer.from('not an image')};
  if(url==='https://second.example/')return{status:200,type:'text/html',url,bytes:Buffer.from('<link href="https://cdn.example/icon.png" rel="shortcut icon">')};
  if(url==='https://cdn.example/icon.png')return{status:200,type:'image/png',url,bytes:good};
  throw new Error('No favicon');
 }});
 assert.deepEqual(seen,['https://first.example/','https://first.example/bad.png','https://first.example/favicon.ico','https://second.example/','https://cdn.example/icon.png']);
 assert.equal((await sharp(icon!).metadata()).format,'png');
 const svg=await decodeWebsiteIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 4"><script>alert(1)</script><image href="file:///etc/passwd"/><path fill="#7040ba" d="M0 0h8v4H0z"/></svg>'),'image/svg+xml');
 const info=await sharp(svg).metadata();assert.equal(info.width,64);assert.equal(info.height,32);assert.equal(info.format,'png');
 const padded=await decodeWebsiteIcon(Buffer.from(' '.repeat(512)+'<?xml version="1.0"?><!-- prolog --><svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><image href="file:///etc/passwd"/><use href="https://127.0.0.1/private.svg#x"/><rect width="8" height="4" fill="#7040ba"/></svg>'),'application/octet-stream');assert.deepEqual(padded,svg,'Mislabelled/padded SVG is sanitized identically; no raw SVG goes to raster decoder');
 await assert.rejects(decodeWebsiteIcon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://private.example/image"/></svg>'),'image/svg+xml'));
 assert.deepEqual(declaredWebsiteIcons('<base href="https://evil.example"><link rel="icon" href="/safe.svg"><link rel="icon" href="http://bad.example/x">','https://site.example/'),['https://site.example/safe.svg']);
});

test('ICO accepts PNG-compressed and 32-bit DIB resources but rejects malformed image bytes',async()=>{
 const image=await png(),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header[6]=8;header[7]=4;header.writeUInt32LE(image.length,14);header.writeUInt32LE(22,18);
 assert.equal((await sharp(await decodeWebsiteIcon(Buffer.concat([header,image]),'image/x-icon')).metadata()).format,'png');
 const dib=Buffer.alloc(48);dib.writeUInt32LE(40,0);dib.writeInt32LE(1,4);dib.writeInt32LE(2,8);dib.writeUInt16LE(1,12);dib.writeUInt16LE(32,14);dib[42]=200;dib[43]=255;
 header[6]=1;header[7]=1;header.writeUInt32LE(dib.length,14);
 assert.equal((await sharp(await decodeWebsiteIcon(Buffer.concat([header,dib]),'image/x-icon')).metadata()).format,'png');
 await assert.rejects(decodeWebsiteIcon(Buffer.from('Not an icon'),'image/png'));
});

test('pinned HTTPS validates every redirect/DNS answer and sends no cookies, auth or referrer',async()=>{
 const calls:any[]=[];
 const resolve=async(host:string,signal:AbortSignal)=>resolveMailHost(host,signal,(async()=>[{address:host==='private.example'?'127.0.0.1':'93.184.216.34',family:4}]) as any);
 const request=((url:URL,options:any,receive:any)=>{
  const req=new EventEmitter() as any;
  req.end=()=>queueMicrotask(()=>{
   const response=new PassThrough() as any;response.statusCode=url.pathname==='/'?302:200;response.headers=url.pathname==='/'?{location:'/icon.png'}:{'content-type':'image/png'};
   calls.push({url:url.href,options});receive(response);response.end('bytes');
  });return req;
 }) as any;
 const result=await fetchPublicIconResource('https://public.example/',new AbortController().signal,{resolve,request});assert.equal(result.url,'https://public.example/icon.png');
 assert.equal(calls.length,2);
 for(const call of calls){assert.deepEqual(Object.keys(call.options.headers).sort(),['Accept','Accept-Encoding']);assert.equal(call.options.agent,false);assert.equal(call.options.rejectUnauthorized,undefined);let address='';call.options.lookup('public.example',{},(_error:any,value:string)=>address=value);assert.equal(address,'93.184.216.34');assert.equal(new URL(call.url).hostname,'public.example');}
 await assert.rejects(fetchPublicIconResource('https://private.example/',new AbortController().signal,{resolve,request}),/public internet/);
 await assert.rejects(resolveMailHost('mixed.example',new AbortController().signal,(async()=>[{address:'93.184.216.34',family:4},{address:'::1',family:6}]) as any),/public internet/);
 await assert.rejects(resolveMailHost('no-dns.example',new AbortController().signal,(async()=>{throw new Error('DNS failed');}) as any),/DNS failed/);
 const redirect=((_url:URL,_options:any,receive:any)=>{const req=new EventEmitter() as any;req.end=()=>queueMicrotask(()=>{const response=new PassThrough() as any;response.statusCode=302;response.headers={location:'https://private.example/'};receive(response);});return req;}) as any;
 await assert.rejects(fetchPublicIconResource('https://public.example/',new AbortController().signal,{resolve,request:redirect}),/public internet/);
});
