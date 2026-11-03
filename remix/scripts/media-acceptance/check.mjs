import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { mediaWorkerCsp, platformRuntimeCsp } from '../csp.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(appRoot, 'tmp/media-acceptance'), port = 18641;
const mime = { '.js':'text/javascript','.html':'text/html','.wasm':'application/wasm','.css':'text/css' };
const requests=[];
const server = createServer(async (req,res)=>{
 try {
  assert.equal(req.method,'GET'); // This compressor never uploads selected bytes.
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  requests.push(path);
  if(path==='/redirect'){res.writeHead(302,{location:'https://example.com'});return res.end();}
  const file=path.startsWith('/platform/') ? resolve(appRoot,'dist','.'+path) : resolve(root,'built','.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(resolve(appRoot,'dist/platform')+'/')&&!file.startsWith(root+'/built/'))throw Error('path');
  if(/^\/assets\/mediaWorker-[A-Za-z0-9_-]+\.js$/.test(path))res.setHeader('content-security-policy',mediaWorkerCsp);
  if(path==='/platform/runtime.html')res.setHeader('content-security-policy',platformRuntimeCsp);
  res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end();}
});
await new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});
let browser,context;
try {
 await new Promise((r,j)=>{const socket=createConnection({host:'1.1.1.1',port:443});socket.on('connect',()=>{socket.destroy();j(Error('Outbound boundary failed'));});socket.on('error',e=>{try{assert.ok(['EPERM','EACCES'].includes(e.code));r();}catch(e){j(e);}});socket.setTimeout(3000,()=>{socket.destroy();j(Error('Boundary unproven'));});});
 await assert.rejects(fetch(`http://127.0.0.1:${port}/redirect`,{signal:AbortSignal.timeout(5000)}));
 browser=await chromium.launch({executablePath:process.env.CHROME_FOR_TESTING_PATH||chromium.executablePath(),headless:false});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.tracing.start({screenshots:true,snapshots:true});
 const probe=await context.newPage();await assert.rejects(probe.goto('https://1.1.1.1',{timeout:7000}));await probe.close();
 console.log('ISOLATION_PASS: backend, redirects, browser; fresh profile and no account/database');
 const page=await context.newPage();page.setDefaultTimeout(25000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin=`http://127.0.0.1:${port}`;
 await page.goto(origin);
 await page.locator('input[type=file]').waitFor();
 assert.equal(await page.getByRole('button',{name:'Run example',exact:true}).count(),0);
 assert.equal(await page.getByRole('link',{name:'Download output',exact:true}).isVisible(),false);
 await page.getByText('Compression settings',{exact:true}).click();
 const status=page.locator('output');
 const link=page.getByRole('link',{name:'Download output',exact:true});
 const wait=()=>status.filter({hasText:/Complete|unsupported|not supported|damaged|cannot|failed|unavailable|requires|error/i}).waitFor({timeout:120000});
 const save=async name=>{await link.waitFor();const pending=page.waitForEvent('download');await link.click();await(await pending).saveAs(root+'/'+name);};
 await page.locator('input[type=file]').setInputFiles(root+'/source.png');
 await page.getByLabel('Maximum width',{exact:true}).fill('640');
 await page.getByLabel('Maximum height',{exact:true}).fill('480');
 await page.getByRole('button',{name:'Start',exact:true}).click();await wait();
 console.log('PNG_STATUS',await status.innerText());
 await save('image.webp');
 const image=await sharp(root+'/image.webp').metadata();assert.equal(image.width,640);assert.equal(image.height,480);assert.equal(image.hasAlpha,true);
 assert.ok((await sharp(root+'/image.webp').ensureAlpha().raw().toBuffer())[3]<255);
 console.log('IMAGE_PROBE',JSON.stringify({format:image.format,width:image.width,height:image.height,alpha:image.hasAlpha}));
 // The same chosen file survives changing settings; Start uses the new values.
 await page.getByLabel('Maximum width',{exact:true}).fill('320');
 await page.getByRole('button',{name:'Start',exact:true}).click();await wait();await save('image-small.webp');
 assert.equal((await sharp(root+'/image-small.webp').metadata()).width,320);
 await page.getByLabel('Image format',{exact:true}).selectOption('jpeg');
 await page.getByRole('button',{name:'Start',exact:true}).click();await wait();
 assert.match(await status.innerText(),/transparency/);assert.equal(await link.isVisible(),false);
 await page.getByLabel('Background for JPEG',{exact:true}).selectOption('#ffffff');
 await page.getByRole('button',{name:'Start',exact:true}).click();await wait();await save('image-flat.jpg');
 assert.equal((await sharp(root+'/image-flat.jpg').metadata()).hasAlpha,false);
 await page.getByLabel('Image format',{exact:true}).selectOption('auto');
 for(const name of ['source.jpg','source.tiff','source.gif','fixtures/colors-with-alpha.heic']){
  await page.locator('input[type=file]').setInputFiles(name.startsWith('fixtures/') ? resolve(appRoot,'scripts/media-acceptance',name) : root+'/'+name);
  await page.getByRole('button',{name:'Start',exact:true}).click();await wait();
  console.log(name,await status.innerText());await save(name.split('/').pop()+'.webp');
 }
 const animated=await sharp(root+'/source.gif.webp',{animated:true}).metadata();
 assert.equal(animated.pages,4);assert.equal(animated.loop,0);
 const videoSource=await readFile(root+'/source.mp4');
 for(const [format,audio] of [['mp4','keep'],['webm','remove']]){
  await page.getByLabel('Video format',{exact:true}).selectOption(format);
  await page.getByLabel('Video audio',{exact:true}).selectOption(audio);
  await page.getByLabel('Maximum width',{exact:true}).fill('640');
  await page.getByLabel('Maximum height',{exact:true}).fill('360');
  await page.getByLabel('Video bitrate (bits/second)',{exact:true}).fill('350000');
  await page.locator('input[type=file]').setInputFiles({name:'source.mp4',mimeType:'video/mp4',buffer:videoSource});
  await page.getByRole('button',{name:'Start',exact:true}).click();await wait();
  console.log(format,audio,await status.innerText());await save(`output-${audio}.${format}`);
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,codec_type,width,height','-of','json',root+`/output-${audio}.${format}`],{encoding:'utf8'}));
  const video=info.streams.find(s=>s.codec_type==='video'),track=info.streams.find(s=>s.codec_type==='audio');
  assert.equal(video.width,640);assert.equal(video.height,360);assert.equal(video.codec_name,format==='mp4'?'h264':'vp9');assert.equal(track?.codec_name,audio==='keep'?'aac':undefined);
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  for(let y=0;y<await page.evaluate(()=>document.body.scrollHeight);y+=650)await page.evaluate(y=>scrollTo(0,y),y);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const footer=await page.locator('p').last().boundingBox(),downloadBounds=await link.boundingBox();
  assert.ok(downloadBounds.y>=footer.y+footer.height, 'download must not overlap final instructions');
  await page.screenshot({path:root+`/layout-${width}.png`,fullPage:true});
  await page.getByText('Compression settings',{exact:true}).click();await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:root+`/collapsed-${width}.png`,fullPage:true});
  await page.getByText('Compression settings',{exact:true}).click();
 }
 await page.locator('input[type=file]').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not image')});
 await page.getByRole('button',{name:'Start',exact:true}).click();await wait();assert.equal(await link.isVisible(),false);console.log('INVALID_STATUS',await status.innerText());assert.match(await status.innerText(),/damaged|not supported/);
 await page.locator('input[type=file]').setInputFiles(root+'/source.mp4');
 await page.getByRole('button',{name:'Start',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.match(await status.innerText(),/Canceled/);assert.equal(await link.isVisible(),false);
 await page.goto(origin+'/?legacy');
 const frame=page.frameLocator('iframe');await frame.locator('#media-file').waitFor();
 assert.equal(await page.getByRole('button',{name:'Run example',exact:true}).count(),0);
 await frame.locator('#media-file').setInputFiles(root+'/source.png');
 await page.getByLabel('Maximum width',{exact:true}).fill('320');
 await page.getByLabel('Maximum height',{exact:true}).fill('240');
 await frame.getByRole('button',{name:'Start',exact:true}).click();
 await frame.locator('#media-status').filter({hasText:/Complete|failed|unavailable/i}).waitFor({timeout:120000});
 console.log('LEGACY_STATUS',await frame.locator('#media-status').innerText());
 const legacyLink=page.getByRole('link',{name:'Download output',exact:true});await legacyLink.waitFor();
 const pending=page.waitForEvent('download');await legacyLink.click();await(await pending).saveAs(root+'/legacy.webp');
 assert.equal((await sharp(root+'/legacy.webp').metadata()).width,320);
 await page.goto(origin+'/?duplicate');
 await page.locator('input[type=file]').nth(1).waitFor();
 const nativeTargets=await page.locator('label').filter({hasText:'Choose an image or video'}).evaluateAll(labels=>labels.map(label=>({for:label.htmlFor,control:label.control?.id})));
 assert.equal(nativeTargets.length,2);assert.notEqual(nativeTargets[0].for,nativeTargets[1].for);
 assert.ok(nativeTargets.every(label=>label.for===label.control));
 assert.deepEqual(errors,[]);
 await writeFile(root+'/acceptance.json',JSON.stringify({passed:true,images:['PNG','JPEG','TIFF','GIF','HEIC'],outputs:['WebP','JPEG','MP4','WebM'],layouts:[1440,390],legacyImmediate:true,noUpload:requests.every(path=>!path.startsWith('/api/'))},null,2));
 console.log('ACCEPTANCE_PASS');
}finally{await context?.tracing.stop({path:root+'/trace.zip'});await browser?.close();await new Promise(r=>server.close(r));}
