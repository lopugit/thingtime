import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {THINGTIME_THEME,MIDNIGHT_THEME,themeToCssVars} from '../app/theme/tokens';
/** Real disposable API + actual components. Never attaches to a personal browser. */
export async function runPasswordVerificationUI({vite,load,ownerId,username,password,invoke}:any){
 if(!process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE)throw new Error('Set THINGTIME_TEST_PLAYWRIGHT_MODULE to the installed Playwright index.mjs; use PLAYWRIGHT_BROWSERS_PATH to reuse its browser binary cache.');
 const {chromium}=await import(pathToFileURL(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE).href);
 const output='/tmp/password-verification-ui-evidence';await mkdir(output,{recursive:true});
 const origin='http://127.0.0.1:18090';
 const passwords=await load('routes/api/v1/passwords/_passwords.tsx'),things=await load('routes/api/v1/things/_things.tsx'),login=await load('routes/api/v1/login/_login.tsx'),resolvePage=await load('routes/api/v1/webpages/resolve/_resolve.tsx'),capabilities=await load('api/utils/capabilities/thingtimeCapabilities.ts');
 const longUser='long-username-'.repeat(18)+'@example.invalid';
 const websiteId=crypto.randomUUID();await invoke({operation:'save',id:websiteId,writeId:crypto.randomUUID(),revision:0,entry:{title:'Website fallback fixture',passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:'website-fixture@example.invalid'},{id:'first',label:'Website',type:'url',value:'https://no-icon.example.invalid/private?token=synthetic'},{id:'second',label:'Website',type:'url',value:'https://github.com/private?token=synthetic'}]}});
 await invoke({operation:'save',id:crypto.randomUUID(),writeId:crypto.randomUUID(),revision:0,entry:{title:'Long username login',passwordType:'login',fields:[{id:'username',label:'Username',type:'text',value:longUser}]}});
 await invoke({operation:'save',id:crypto.randomUUID(),writeId:crypto.randomUUID(),revision:0,entry:{title:'No username fixture',passwordType:'secure-note',fields:[]}});
 let heldSettings:{enter:()=>void;gate:Promise<void>}|null=null,releaseHeld=()=>{};
 const holdNextSettings=()=>{let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);heldSettings={enter,gate};releaseHeld=release;return{entered,release};};
 let heldCatalog:{enter:()=>void;gate:Promise<void>}|null=null;
 const holdNextCatalog=()=>{let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);heldCatalog={enter,gate};return{entered,release};};
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/__password_verification_fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:ownerId,username,temporary:false,accountKind:'user'}));return;}
   if(req.url==='/.well-known/thingtime-capabilities.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(capabilities.thingtimeCapabilityManifest(origin)));return;}
   const path=(req.url||'').split('?')[0];
   if(path==='/scripts/password-verification.browser.html'){res.setHeader('Content-Type','text/html');res.end((await vite.transformIndexHtml(req.url,await readFile(new URL('./password-verification.browser.html',import.meta.url),'utf8'))));return;}
   if(path==='/api/v1/passwords'||path==='/api/v1/things'||path==='/api/v1/login'||path==='/api/v1/webpages/resolve'){
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);
    const headers=new Headers();for(const[name,value]of Object.entries(req.headers))if(typeof value==='string')headers.set(name,value);
    const request=new Request(origin+req.url,{method:req.method,headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:raw}:{} )});
    const handler=path==='/api/v1/passwords'?passwords:path==='/api/v1/login'?login:path==='/api/v1/webpages/resolve'?resolvePage:things;
    const response=await handler[req.method==='GET'?'loader':'action']({request});
    const body=raw.length?JSON.parse(raw.toString('utf8')):null;
    if(heldSettings&&body?.operation==='verification-settings'&&body.window===undefined&&body.reuseRecentDeviceVerification===undefined){const held=heldSettings;heldSettings=null;held.enter();await held.gate;}
    if(heldCatalog&&body?.operation==='catalog'){const held=heldCatalog;heldCatalog=null;held.enter();await held.gate;}
    res.statusCode=response.status;
    response.headers.forEach((value:string,name:string)=>{if(name!=='set-cookie')res.setHeader(name,value);});
    if(response.headers.getSetCookie().length)res.setHeader('Set-Cookie',response.headers.getSetCookie());res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   if(path.startsWith('/api/')){res.statusCode=404;res.setHeader('Content-Type','application/json');res.end('{"ok":false}');return;}
   vite.middlewares(req,res,()=>{res.statusCode=404;res.end('Not found');});
  }catch{res.statusCode=500;res.end('Isolated fixture unavailable');}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(18090,'127.0.0.1',resolve);});
 let browser:any,page:any;const issues:string[]=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});const context=await browser.newContext({viewport:{width:1280,height:900}});
  const signedIn=await context.request.post(origin+'/api/v1/login',{headers:{Origin:origin},data:{username,password}});assert.equal(signedIn.status(),200,'Fresh synthetic sign-in at the exact UI origin');
  page=await context.newPage();page.on('pageerror',(error:Error)=>issues.push(error.name+': '+error.message.slice(0,200)+' '+String(error.stack).split('\n').slice(1,3).join(' ')));
  const inspect=async(name:string)=>{await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: no horizontal overflow`);await page.screenshot({path:`${output}/${name}.png`,fullPage:true});};
  if(process.argv.includes('--native-approval-ui')){
   await(await import('./password-native-approval-ui.integration')).runNativeApprovalUI({context,page,origin,ownerId,password,inspect});
   assert.deepEqual(issues,[]);return;
  }
  await page.goto(origin+'/scripts/password-verification.browser.html');
  await page.getByText('Isolated login',{exact:true}).waitFor();
  await page.getByText(longUser,{exact:true}).waitFor();await page.getByText('No username or email saved',{exact:true}).waitFor();
  const importedCard=page.getByRole('button',{name:/^Synthetic AWS account /});
  assert.equal(await importedCard.locator('[data-block-id="pp-username"]').innerText(),'root-fixture@example.invalid');
  const manifest=await context.request.get(origin+'/.well-known/thingtime-capabilities.json');
  assert.equal((await manifest.json()).features['api.passwords'].version,'1.8.0');
  await page.getByRole('checkbox',{name:'Reuse recent device verification'}).waitFor();
  // Actual saved fields → owner API → anonymous public probe → decoded PNG →
  // editable card image. No third-party favicon lookup or personal browser.
  const websiteCard=page.getByRole('button',{name:/^Website fallback fixture /});await websiteCard.scrollIntoViewIfNeeded();
  await websiteCard.locator('img').waitFor();try{await websiteCard.locator('img[src^="data:image/png;base64,"]').waitFor();}catch(error){await page.screenshot({path:`${output}/website-icon-failure.png`,fullPage:true});console.log('Icon render diagnostic',await websiteCard.locator('img').evaluate((img:HTMLImageElement)=>({src:img.getAttribute('src'),complete:img.complete,width:img.naturalWidth})));throw error;}
  // Reconciliation may cancel a view's first request after headers. Compare the
  // displayed thumbnail with a fresh, independently completed canonical API read.
  const response=await context.request.post(origin+'/api/v1/passwords',{headers:{Origin:origin},data:{operation:'website-icon',expectedOwnerId:ownerId,id:websiteId,revision:1}});
  assert.equal(response.status(),200,'Second saved Website supplies a real public icon');
  const imageBytes=Buffer.from(await response.body());assert.ok(imageBytes.length>0,'Independent API response has image bytes');assert.equal(response.headers()['content-type'],'image/png');assert.equal(response.headers()['cache-control'],'private, no-store');
  const expectedHash=Buffer.from(await crypto.subtle.digest('SHA-256',Uint8Array.from(imageBytes))).toString('hex');
  const rendered=await websiteCard.locator('img').evaluate(async(img:HTMLImageElement)=>{await img.decode();const bytes=await(await fetch(img.src)).arrayBuffer();return{width:img.naturalWidth,height:img.naturalHeight,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('')};});
  assert.deepEqual(rendered,{width:64,height:64,hash:expectedHash},'Actual displayed bytes match owner-bound icon response');
  await writeFile(`${output}/website-icon.json`,JSON.stringify({...rendered,expectedHash,firstSiteFailed:true,secondSiteSucceeded:true}));await websiteCard.screenshot({path:`${output}/website-icon-desktop.png`});

  const contrast=async()=>{
   const values=await page.locator('[data-settings-document="password-preview-cards"] [data-block-id="pp-username"], [data-settings-document="password-preview-cards"] [data-block-id="pp-type"]').evaluateAll((elements:Element[])=>elements.map(element=>{
    const style=getComputedStyle(element);let parent:Element|null=element,background='';
    while(parent){background=getComputedStyle(parent).backgroundColor;if(background!=='rgba(0, 0, 0, 0)'&&background!=='transparent')break;parent=parent.parentElement;}
    return{foreground:style.color,background};
   }));
   const luminance=(color:string)=>{const rgb=color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
   assert.ok(values.length>=4,'Rendered account and type subtitles measured');const measured=values.map(value=>{const a=luminance(value.foreground),b=luminance(value.background);return{...value,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});for(const value of measured)assert.ok(value.ratio>=4.5,JSON.stringify(value));return measured[0];
  };
  const applyTheme=async(theme:typeof THINGTIME_THEME)=>{await page.evaluate((vars:Record<string,string>)=>{for(const[key,value]of Object.entries(vars))document.documentElement.style.setProperty(key,value);document.body.style.color='var(--tt-text)';document.body.style.background='var(--tt-page-bg)';},themeToCssVars(theme));};
  const contrastEvidence:unknown[]=[];
  for(const[name,theme]of [['light',THINGTIME_THEME],['dark',MIDNIGHT_THEME]] as const){
   await applyTheme(theme);for(const width of [1280,375]){await page.setViewportSize({width,height:812});contrastEvidence.push({theme:name,width,...await contrast()});await inspect(`manager-${name}-${width}`);}
  }
  await writeFile(`${output}/card-contrast.json`,JSON.stringify(contrastEvidence,null,2));
  await applyTheme(THINGTIME_THEME);await page.setViewportSize({width:1280,height:900});await inspect('manager-desktop');
  await page.setViewportSize({width:375,height:812});await inspect('manager-narrow');
  await page.getByRole('combobox',{name:'Password confirmation interval',exact:true}).selectOption('never');
  await page.getByRole('button',{name:'Save preference',exact:true}).click();await page.getByText('Preference saved. Only a successful current password approval can enroll this device.').waitFor();
  const stored=await invoke({operation:'verification-settings'});assert.equal(stored.body.settings.window,'never');
  // A non-abortable response snapshot from before this mutation arrives late.
  const stale=holdNextSettings();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await stale.entered;
  await page.getByRole('checkbox',{name:'Reuse recent device verification'}).uncheck();
  const offSaved=page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/v1/passwords'&&response.request().postDataJSON()?.reuseRecentDeviceVerification===false);
  await page.getByRole('button',{name:'Save preference',exact:true}).click();assert.equal((await offSaved).status(),200);
  const staleReturned=page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/v1/passwords'&&response.request().postDataJSON()?.operation==='verification-settings'&&response.request().postDataJSON()?.reuseRecentDeviceVerification===undefined);
  stale.release();await staleReturned;await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole('checkbox',{name:'Reuse recent device verification'}).isChecked(),false,'Old GET cannot overwrite the new toggle');
  assert.equal(await page.evaluate(([selectedOrigin,selectedOwner]:string[])=>JSON.parse(localStorage.getItem('tt-password-verification-settings:'+JSON.stringify([selectedOrigin,selectedOwner]))||'null')?.reuseRecentDeviceVerification,[origin,ownerId]),false,'Old GET cannot overwrite the origin/owner settings cache');
  assert.equal((await invoke({operation:'verification-settings'})).body.settings.reuseRecentDeviceVerification,false);
  await page.getByRole('checkbox',{name:'Reuse recent device verification'}).check();
  const toggled=page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/v1/passwords'&&response.request().postDataJSON()?.operation==='verification-settings'&&response.request().postDataJSON()?.reuseRecentDeviceVerification===true);
  await page.getByRole('button',{name:'Save preference',exact:true}).click();assert.equal((await toggled).status(),200);

  await page.reload();await page.getByText('Isolated login',{exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Password confirmation interval',exact:true}).inputValue(),'never');
  // Exercise the actual entry draft and durable save path, not a block gallery.
  const loginCard=page.getByRole('button',{name:/^Isolated login /});
  const editorHeading=page.getByRole('heading',{name:'Edit entry',exact:true});
  await loginCard.getByText('Isolated login',{exact:true}).click();
  await editorHeading.waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent==='Edit entry');
  assert.equal(await page.locator('#password-title').inputValue(),'Isolated login');
  assert.equal(await page.locator('#password-title').evaluate((field:HTMLElement)=>{const rect=field.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight;}),true,'Clicking a card at 375px reveals the editor below the list');
  const entryControl=page.locator('[data-settings-document="password-entry-verification"]');
  await entryControl.getByRole('combobox',{name:'Password confirmation interval',exact:true}).selectOption('always');
  await entryControl.getByRole('button',{name:'Apply to entry',exact:true}).click();
  assert.equal(await entryControl.getByRole('combobox').inputValue(),'always');
  await entryControl.screenshot({path:`${output}/entry-override-narrow.png`});
  const savedEntry=page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/v1/passwords'&&response.request().postDataJSON()?.operation==='save');
  await page.getByRole('button',{name:'Save entry',exact:true}).click();assert.equal((await savedEntry).status(),200);
  await loginCard.getByText('fixture@example.invalid',{exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:/^Isolated login /}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  await loginCard.focus();await loginCard.press('Enter');await editorHeading.waitFor();
  await page.waitForFunction(()=>document.activeElement?.textContent==='Edit entry');
  assert.equal(await page.locator('[data-settings-document="password-entry-verification"]').getByRole('combobox').inputValue(),'always');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await loginCard.evaluate((card:HTMLElement)=>document.activeElement===card),true,'Closing returns focus to the selected card');
  await page.setViewportSize({width:375,height:812});
  // Normal Builder selection exposes the repeated card's individual text block.
  const cards=page.locator('[data-settings-document="password-preview-cards"]');
  await cards.getByRole('button',{name:'Edit layout',exact:true}).click();
  await cards.locator('[data-block-id="pp-username"]').last().click();
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Account: {item.usernameLabel}');
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  await cards.locator('[data-block-id="pp-icon"]').last().click();
  await page.getByRole('textbox',{name:'Element title',exact:true}).fill('Credential icon');
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  const savedLayout=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/things'&&response.request().method()==='POST');
  await cards.getByRole('button',{name:'Save layout',exact:true}).click();assert.equal((await savedLayout).status(),200);
  // Recreate the previously shipped saved layout through the real writer.
  const savedPage=(await(await savedLayout).json()).thing;
  const previousBlocks=structuredClone(savedPage.crystal.blocks);
  const restorePreviousColor=(blocks:any[])=>{for(const block of blocks){if(block.id==='pp-username'||block.id==='pp-type')block.css={...block.css,color:'var(--tt-muted, #6b7280)'};if(block.id==='pp-icon')block.css={width:'32px',height:'32px','object-fit':'contain','flex-shrink':'0'};if(block.children)restorePreviousColor(block.children);}};
  restorePreviousColor(previousBlocks);
  const previousLayout=await context.request.patch(origin+'/api/v1/things',{headers:{Origin:origin},data:{id:savedPage.id,expectedUpdatedAt:savedPage.updatedAt,crystal:{...savedPage.crystal,blocks:previousBlocks}}});assert.equal(previousLayout.status(),200);

  await cards.getByRole('button',{name:'Done editing layout',exact:true}).click();
  await page.getByText('Account: fixture@example.invalid',{exact:true}).waitFor();
  await page.reload();await page.getByText('Account: fixture@example.invalid',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-block-id="pp-icon"]').first().getAttribute('title'),'Credential icon');
  await applyTheme(THINGTIME_THEME);await contrast();await inspect('migrated-saved-layout-narrow');
  const iconStyle=await page.locator('[data-block-id="pp-icon"]').first().evaluate((img:HTMLElement)=>({background:getComputedStyle(img).backgroundColor,padding:getComputedStyle(img).padding,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}));
  assert.deepEqual(iconStyle,{background:'rgb(255, 255, 255)',padding:'3px',width:32,height:32},'Existing default icons gain a backplate within the same footprint');
  const lastSaved=(await previousLayout.json()).thing,customBlocks=structuredClone(lastSaved.crystal.blocks);
  const customizeIcons=(blocks:any[])=>{for(const block of blocks){if(block.id==='pp-icon')block.css={...block.css,background:'#f6e6ff',padding:'5px','border-radius':'6px','box-sizing':'border-box'};if(block.children)customizeIcons(block.children);}};customizeIcons(customBlocks);
  const customSaved=await context.request.patch(origin+'/api/v1/things',{headers:{Origin:origin},data:{id:lastSaved.id,expectedUpdatedAt:lastSaved.updatedAt,crystal:{...lastSaved.crystal,blocks:customBlocks}}});assert.equal(customSaved.status(),200);
  await page.reload();await page.waitForFunction(()=>{const icon=document.querySelector('[data-settings-document="password-preview-cards"] [data-block-id="pp-icon"]');return icon&&getComputedStyle(icon).backgroundColor==='rgb(246, 230, 255)';});
  assert.equal(await page.locator('[data-block-id="pp-icon"]').first().evaluate((img:HTMLElement)=>getComputedStyle(img).padding),'5px','Saved authored icon style survives migration and reload');

  const preferences=page.locator('[data-settings-document="password-verification-default"]');
  await preferences.getByRole('button',{name:'Edit layout',exact:true}).click();
  await preferences.locator('[data-block-id="pv-reuse"]').last().click();
  await page.getByRole('textbox',{name:'Element title',exact:true}).fill('Controls repeated password verification');
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  await preferences.locator('[data-block-id="pv-reuse-text"]').last().click();
  await page.getByRole('textbox',{name:'Block text',exact:true}).fill('Reuse verified device');
  await page.getByRole('button',{name:'Close builder',exact:true}).click();
  const savedPreferences=page.waitForResponse((response:any)=>new URL(response.url()).pathname==='/api/v1/things'&&response.request().method()==='POST');
  await preferences.getByRole('button',{name:'Save layout',exact:true}).click();assert.equal((await savedPreferences).status(),200);
  await preferences.getByRole('button',{name:'Done editing layout',exact:true}).click();
  await page.reload();await page.getByText('Reuse verified device',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-block-id="pv-reuse"]').getAttribute('title'),'Controls repeated password verification');
  await inspect('customized-username-narrow');
  await page.goto(origin+'/scripts/password-verification.browser.html?surface=provider');
  await page.getByRole('heading',{name:'Thingtime passkeys',exact:true}).waitFor();
  const request=()=>({version:1,id:crypto.randomUUID(),type:'create',origin:'https://ui-fixture.test',publicKey:{challenge:'AQID',rp:{id:'ui-fixture.test',name:'Isolated UI'},user:{id:'AQID',name:'fixture@example.invalid',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}],attestation:'none'}});
  const begin=async()=>{await page.evaluate(r=>{(window as any).fixtureResult=null;document.addEventListener('thingtime:password-provider-response',event=>{(window as any).fixtureResult=JSON.parse((event as CustomEvent).detail);},{once:true});document.dispatchEvent(new CustomEvent('thingtime:password-provider-request',{detail:JSON.stringify(r)}));},request());await page.getByRole('heading',{name:'Save a passkey in Thingtime',exact:true}).waitFor();};
  await begin();await page.getByRole('textbox',{name:'Thingtime account password',exact:true}).waitFor();await inspect('approval-never-enrollment-narrow');
  await page.getByRole('textbox',{name:'Thingtime account password',exact:true}).fill(password);
  await page.getByRole('button',{name:'Verify and save passkey',exact:true}).click();await page.waitForFunction(()=>(window as any).fixtureResult?.response?.type==='public-key');
  await begin();await page.getByRole('button',{name:'Save passkey',exact:true}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0,'Remembered device does not ask again');await inspect('approval-remembered-narrow');
  await page.getByRole('button',{name:'Save passkey',exact:true}).click();await page.waitForFunction(()=>(window as any).fixtureResult?.response?.type==='public-key');
  await page.goto(origin+'/scripts/password-verification.browser.html?surface=native');
  await page.getByRole('heading',{name:'Thingtime password workspace',exact:true}).waitFor();
  const selected=(await invoke({operation:'catalog'})).body.catalog.find((item:any)=>item.title==='Isolated login');
  assert.ok(selected?.id);
  const requestBase={version:1,expectedOwnerId:ownerId,origin:'https://fixture.test',target:{tabId:1,frameId:0,documentId:'isolated-provider'}};
  const stalledId=crypto.randomUUID(),fillId=crypto.randomUUID();
  await page.emulateMedia({reducedMotion:'reduce'});
  const stalled=holdNextCatalog();
  try{
   await page.evaluate(payload=>{
    (window as any).vaultResponses=[];
    document.addEventListener('thingtime:password-vault-response',event=>{const {id,error}=JSON.parse((event as CustomEvent).detail);(window as any).vaultResponses.push({id,error});});
    document.dispatchEvent(new CustomEvent('thingtime:password-vault-request',{detail:JSON.stringify(payload)}));
   },{...requestBase,type:'catalog',id:stalledId});
   await stalled.entered;
   const indicator=page.locator('.chakra-spinner[aria-hidden="true"]');
   await indicator.waitFor();assert.equal(await indicator.count(),1);
   assert.equal(await indicator.evaluate((node:HTMLElement)=>getComputedStyle(node).animationName),'none');
   await page.screenshot({path:`${output}/catalog-loading-reduced-motion.png`});
   const cancelCatalog=(id:string)=>page.evaluate(id=>document.dispatchEvent(new CustomEvent('thingtime:password-vault-cancel',{cancelable:true,detail:JSON.stringify({version:1,id})})),id);
   assert.equal(await cancelCatalog(crypto.randomUUID()),true,'A different operation cannot cancel the catalog');
   assert.equal(await cancelCatalog(stalledId),false,'The active catalog acknowledges cancellation synchronously');
   await page.evaluate(payload=>document.dispatchEvent(new CustomEvent('thingtime:password-vault-request',{detail:JSON.stringify(payload)})),{...requestBase,type:'fill',id:fillId,entryId:selected.id});
   stalled.release();
   await page.getByRole('button',{name:'Verify and autofill',exact:true}).waitFor();
   await page.getByText('Isolated login · fixture@example.invalid',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=> (window as any).vaultResponses),[],'The cancelled catalog cannot reply or finish the active selection');
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   await page.waitForFunction(id=>(window as any).vaultResponses.some((item:any)=>item.id===id&&item.error?.name==='AbortError'),fillId);
  }finally{stalled.release();}
  assert.deepEqual(issues,[]);console.log('PASS: isolated Chrome actual manager/provider + disposable real API; desktop/narrow scrolling and focus; durable preference and per-entry override; saved Builder edits; cancelled catalog cannot end a selected fill; synthetic credentials only.');
 }catch(error){if(!await page?.getByRole('heading',{name:'Edit entry',exact:true}).count())await page?.screenshot({path:`${output}/failure.png`,fullPage:true}).catch(()=>{});console.log('UI diagnostic:',JSON.stringify({issues,headings:await page?.locator('h1,h2,[role=alert]').allTextContents().catch(()=>[])}));throw error;}finally{releaseHeld();await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
