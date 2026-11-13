// Reuses agent-reporting-acceptance's isolated server and synthetic identities.
// All application fixtures and verification use public HTTP APIs.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export async function runRelationalCollectionsAcceptance({request,owner,stranger,origin,checks,evidenceDir:providedEvidence,targetedUi=false}) {
  assert(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Use only the task-owned isolated loopback backend');
  const evidenceDir=providedEvidence||await mkdtemp(join(tmpdir(),'thingtime-relational-qa-'));
  const call=async(path,options={})=>{
    // Honor the real API's window. An uncertain failed write is never retried.
    for(let attempt=0;attempt<5;attempt++){
      const result=await request(path,{...options,status:null});
      if(result.response.status===429){
        const seconds=Number(result.response.headers.get('Retry-After'));
        assert(Number.isFinite(seconds)&&seconds>0&&seconds<=120,'Rate-limit response has a bounded retry delay');
        await new Promise(resolve=>setTimeout(resolve,Math.ceil(seconds*1000)+100)); continue;
      }
      assert.equal(result.response.status,options.status??200,`Collection acceptance ${path.split('?')[0]} returned ${result.response.status}`);
      assert(result.data?.ok!==false,`Collection acceptance ${path.split('?')[0]} succeeded`);
      return result;
    }
    throw Error('Collection acceptance exhausted its bounded rate-limit retries');
  };
  const suffix=randomBytes(5).toString('hex');let slug=`relational-${suffix}`;
  const definitions={
    rules:Array.from({length:16},(_,i)=>({title:`Rule ${i} ${'title '.repeat(i===15?30:1)}`.trim(),text:`Rule detail ${i} ${'detail '.repeat(i===15?12000:1)}`.trim()})),
    flairs:Array.from({length:51},(_,i)=>({id:`flair-${i}`,label:`Post flair ${i}`,emoji:null,color:null,modOnly:false})),
    userFlairs:Array.from({length:51},(_,i)=>({id:`user-${i}`,label:`User flair ${i}`,emoji:null,color:null,modOnly:false})),
    removalReasons:Array.from({length:21},(_,i)=>({id:`reason-${i}`,title:`Reason ${i}`,message:`Message ${i} ${'detail '.repeat(i===20?150:1)}`.trim()}))
  };
  const created=(await call('/api/v1/subspaces',{cookie:owner.cookie,body:{slug,name:'Relational collection acceptance',access:'public',...definitions},status:201})).data.subspace;
  assert(created?.id,'Subspace creation returns identity');
  assert.equal(created.slug,slug.replace(/-/g,'_'),'Subspace uses its canonical slug grammar');
  slug=created.slug;
  // Founding accepts rules/post flairs; user flairs and removal reasons use
  // the documented moderator update contract.
  await call('/api/v1/subspaces/update',{cookie:owner.cookie,body:{id:created.id,userFlairs:definitions.userFlairs,removalReasons:definitions.removalReasons,allowCustomUserFlair:true}});
  const read=async()=> (await call(`/api/v1/subspaces/get?id=${encodeURIComponent(created.id)}`,{cookie:owner.cookie})).data.subspace;
  if(targetedUi){
    const owned=[];
    for(let index=0;index<26;index++)owned.push((await call('/api/v1/subspaces',{cookie:owner.cookie,body:{slug:`scale_${suffix}_${index}`,name:`Ownership scale ${index}`,access:'public'},status:201})).data.subspace);
    const transferSource=(await call('/api/v1/subspaces',{cookie:stranger.cookie,body:{slug:`handover_${suffix}`,name:'Ownership handover',access:'public'},status:201})).data.subspace;
    await call('/api/v1/subspaces/join',{cookie:owner.cookie,body:{id:transferSource.id}});
    await call('/api/v1/subspaces/transfer',{cookie:stranger.cookie,body:{id:transferSource.id,userId:owner.data.user.id}});
    assert.equal((await call(`/api/v1/subspaces/get?id=${encodeURIComponent(transferSource.id)}`,{cookie:owner.cookie})).data.subspace.viewer.role,'owner','Transfer remains valid beyond25 owned subspaces');
    assert.equal(owned.length,26);
    checks.push('real API creates26additional owned subspaces and transfersanother beyondtheformer25cap');
  }

  const full=await read();
  assert.equal(full.slug,slug,'Subspace returned slug matches requested permalink');
  const bySlug=await request(`/api/v1/subspaces/get?slug=${encodeURIComponent(slug)}`,{cookie:owner.cookie,status:null});
  console.log(JSON.stringify({event:'subspace-slug-read',status:bySlug.response.status,slugMatches:bySlug.data?.subspace?.slug===slug}));
  assert.equal(bySlug.response.status,200,'New subspace resolves by its exact slug');
  for(const field of Object.keys(definitions))assert.deepEqual(full[field],definitions[field],`Complete ${field} survives real write/read`);
  await call('/api/v1/subspaces/update',{cookie:owner.cookie,body:{id:created.id,rules:[]}});
  const empty=await read(); assert.deepEqual(empty.rules,[]);assert.equal(empty.flairs.length,51);
  await call('/api/v1/subspaces/update',{cookie:owner.cookie,body:{id:created.id,rules:definitions.rules}});
  const denied=await request('/api/v1/subspaces/update',{cookie:stranger.cookie,body:{id:created.id,rules:[]},status:null});
  assert.equal(denied.response.status,403,'An unrelated user cannot change definitions');
  const posts=[];
  for(let i=0;i<(targetedUi?1:101);i++){
    const result=(await call('/api/v1/things',{cookie:owner.cookie,body:{thingtime:['post'],acl:['tt:user'],crystal:{type:'text',text:`Synthetic relational sharing choice ${suffix} ${i}`,subspaceId:created.id,...(i===0?{flairId:'flair-50'}:{})}}})).data;
    const post=result.post||result.thing;assert(post?.id,'Post fixture returns identity');
    if(i===0)assert.equal(result.post?.flair?.id,'flair-50','Posting resolves an exact relational flair beyond50');
    posts.push(post.id);
    if(i<12)await call('/api/v1/subspaces/moderate',{cookie:owner.cookie,body:{id:post.id,action:'pin'}});
  }
  let cursor=null;const feed=[];let pages=0;
  do{
    const result=(await call(`/api/v1/subspaces/feed?id=${encodeURIComponent(created.id)}&sort=new&limit=5${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{cookie:owner.cookie})).data;
    feed.push(...result.posts.map(post=>post.id));cursor=result.nextCursor;assert(++pages<40,'Subspace paging terminates');
  }while(cursor);
  assert.equal(feed.length,posts.length);assert.equal(new Set(feed).size,posts.length);assert.deepEqual(new Set(feed.slice(0,12)),new Set(posts.slice(0,12)));
  const clientOrigin='https://relational-client.example.invalid';
  let app;
  if(!targetedUi){
  const origins=[clientOrigin,...Array.from({length:20},(_,i)=>`https://relational-${suffix}-${i}.example.invalid`)];
  const nativeRedirectUris=Array.from({length:21},(_,i)=>`com.example.relational${i}://oauth/callback`);
  app=(await call('/api/v1/apps',{cookie:owner.cookie,body:{name:`Relational acceptance ${suffix}`,origins,nativeRedirectUris}})).data.app;
  assert.deepEqual(app.origins,origins);assert.deepEqual(app.nativeRedirectUris,nativeRedirectUris);
  const revokedOrigin=origins.at(-1);
  const laterRevoked=(await call('/api/v1/oauth/authorize',{cookie:owner.cookie,body:{clientId:app.clientId,origin:revokedOrigin,scope:'things',scopes:['things'],sharedThings:[]}})).data;
  const nextOrigins=[...origins.slice(0,-1),`https://updated-${suffix}.example.invalid`];
  const nextNative=[...nativeRedirectUris].reverse();
  const updated=(await call('/api/v1/apps/update',{cookie:owner.cookie,body:{clientId:app.clientId,origins:nextOrigins,nativeRedirectUris:nextNative}})).data.app;
  assert.deepEqual(updated.origins,nextOrigins);assert.deepEqual(updated.nativeRedirectUris,nextNative);
  const revoked=(await request('/api/v1/oauth/userinfo',{token:laterRevoked.token,requestOrigin:revokedOrigin,status:null})).response;
  assert.equal(revoked.status,401,'Removing an allowed origin invalidates its existing app credential');
  const spoofed=await request('/api/v1/oauth/authorize',{cookie:owner.cookie,body:{clientId:app.clientId,origin:clientOrigin+'.evil',scope:'things',scopes:['things'],sharedThings:[]},status:null});
  assert.equal(spoofed.response.status,403,'Origin lookalikes are refused');
  assert(app?.clientId,'OAuth app returns client identity');
  const grant=(await call('/api/v1/oauth/authorize',{cookie:owner.cookie,body:{clientId:app.clientId,origin:clientOrigin,scope:'things',scopes:['things'],sharedThings:posts}})).data;
  assert.equal(grant.sharedThings,101,'Public selection count retains its existing numeric shape');assert(typeof grant.token==='string','OAuth issue returns a credential');
  const info=(await call('/api/v1/oauth/userinfo',{token:grant.token,requestOrigin:clientOrigin})).data;
  assert.equal(info.sharedThings,101);
  const shared=[];cursor=null;pages=0;
  do{
    const result=(await call(`/api/v1/oauth/shared?limit=37${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{token:grant.token,requestOrigin:clientOrigin})).data;
    shared.push(...result.things.map(thing=>thing.shareId));cursor=result.nextCursor;assert(++pages<10,'Grant paging terminates');
  }while(cursor);
  assert.equal(shared.length,101);assert.deepEqual(new Set(shared),new Set(posts));
  const exact=(await call(`/api/v1/oauth/shared?id=${encodeURIComponent(posts[100])}`,{token:grant.token,requestOrigin:clientOrigin})).data;
  assert.equal(exact.things.length,1);
  const foreign=(await request('/api/v1/things',{cookie:stranger.cookie,body:{thingtime:['data'],acl:['tt:user'],crystal:{text:'Synthetic foreign resource'}}})).data;
  const foreignId=foreign.thing?.id||foreign.id;assert(foreignId,'Foreign fixture returns identity');
  const noGrant=(await call(`/api/v1/oauth/shared?id=${encodeURIComponent(foreignId)}`,{token:grant.token,requestOrigin:clientOrigin})).data;
  assert.equal(noGrant.things.length,0);
  checks.push('real HTTP:101 selected OAuth Things across paginated grants, exact session membership and foreign refusal;16 rules/51 post flairs/51 user flairs/21 removal reasons exact readback, empty replacement, moderator refusal;12 pins+89 ordinary posts paginated once');
  const createAuthored=async(kind,crystal)=>{
    const result=(await call('/api/v1/things',{cookie:owner.cookie,body:{thingtime:[kind],acl:['tt:user'],crystal}})).data;
    const thing=result.thing||result.post;assert(thing?.id,'Authored fixture returns identity');return thing;
  };
  const fields=[...Array.from({length:101},(_,i)=>({name:`field_${i}`,type:'string'})),
    {name:'nested',type:'object',children:Array.from({length:101},(_,i)=>({name:`child_${i}`,type:'string'}))},
    {name:'items',type:'array',minItems:10001,maxItems:10001,items:{type:'number'}}];
  const largeSchema=await createAuthored('schema',{name:`Large authored schema ${suffix}`,fields});
  const schemaRead=(await call(`/api/v1/things?id=${encodeURIComponent(largeSchema.id)}`,{cookie:owner.cookie})).data;
  assert.deepEqual((schemaRead.thing||schemaRead.post).crystal.fields,fields,'HTTP schema descriptor is complete beyond80fields and1000item constraints');
  const args=Array.from({length:41},(_,i)=>({name:`arg_${i}`,type:'string',default:`default-${i}`}));
  const savedArgs=Object.fromEntries(args.map((arg,i)=>[arg.name,`saved-${i}`]));
  const component=await createAuthored('component',{name:`Large component ${suffix}`,args,savedArgs,render:{tag:'div',children:'{arg_40}'}});
  const componentRead=(await call(`/api/v1/things?id=${encodeURIComponent(component.id)}`,{cookie:owner.cookie})).data;
  assert.deepEqual((componentRead.thing||componentRead.post).crystal.args,args);
  assert.deepEqual((componentRead.thing||componentRead.post).crystal.savedArgs,savedArgs);
  const authoredPage=await createAuthored('webpage',{name:`Large bindings ${suffix}`,blocks:[{id:'large',type:'component',component:component.id,args:savedArgs,argBindings:savedArgs}]});
  const pageRead=(await call(`/api/v1/things?id=${encodeURIComponent(authoredPage.id)}`,{cookie:owner.cookie})).data;
  assert.deepEqual((pageRead.thing||pageRead.post).crystal.blocks[0].argBindings,savedArgs);
  const schemaData=await createAuthored('data',{schemaId:largeSchema.id,items:Array(10001).fill(1)});
  assert.equal(schemaData.crystal.items.length,10001,'Existing schema provenance path retains the full valid data array');
  checks.push('real HTTP:21 app origins+21native callbacks create/update/readback, removed-origin credential revoked and lookalike refused;202 nested/top-level schema fields+10001item constraint descriptor,41component descriptors/savedArgs/page bindings and10001schema-tagged data items roundtrip; explicit min/max enforcement verified by existing validator unit test, generic HTTP data schema enforcement remains preexisting separate gap');
  }
  const modulePath=process.env.AGENT_REPORTING_PLAYWRIGHT_MODULE,executablePath=process.env.AGENT_REPORTING_CHROMIUM_EXECUTABLE;
  assert(modulePath&&executablePath,'Rendered collection QA requires the isolated browser paths');
  const {chromium}=await import(modulePath);const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true});
  let activePage;
  const browserDiagnostics=[];
  try{
    const context=await browser.newContext();
    await context.addCookies(owner.cookie.split('; ').filter(Boolean).map(pair=>{const at=pair.indexOf('=');return{name:pair.slice(0,at),value:pair.slice(at+1),url:origin,httpOnly:true,sameSite:'Lax'};}));
    const page=await context.newPage(); activePage=page;
    page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&response.status()>=400)browserDiagnostics.push({path:url.pathname,status:response.status(),...(url.pathname==='/api/v1/subspaces/get'?{slug:url.searchParams.get('slug'),id:url.searchParams.get('id')}:{} )});});
    page.on('pageerror',error=>browserDiagnostics.push({pageError:error.name}));
    const inspect=async(name)=>{
      await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=Math.max(200,innerHeight-80)){scrollTo(0,y);await new Promise(resolve=>setTimeout(resolve,15));}scrollTo(0,document.documentElement.scrollHeight);});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} has no horizontal overflow`);
      await page.screenshot({path:join(evidenceDir,name+'.png'),fullPage:true,mask:[page.locator('input[type="password"]')]});
      for (const [position,fraction] of [['top',0],['middle',0.5],['bottom',1]]) {
        await page.evaluate(value=>scrollTo(0,Math.max(0,document.documentElement.scrollHeight-innerHeight)*value),fraction);
        await page.screenshot({path:join(evidenceDir,`${name}-${position}.png`),fullPage:false,mask:[page.locator('input[type="password"]')]});
      }
    };
    for(const [name,width,height]of [['desktop',1280,900],['mobile',390,844]]){
      await page.setViewportSize({width,height});
      if(app){
      const consent=new URL('/authorize',origin);consent.search=new URLSearchParams({client_id:app.clientId,origin:clientOrigin,scope:'things',extra:'0'}).toString();
      await page.goto(consent.href);
      const picker=page.getByRole('group',{name:'Pick things to share'});
      await picker.locator('input[type="checkbox"]').first().waitFor({state:'visible'});
      for(let count=0;count<4;count++){
        const choices=picker.locator('input[type="checkbox"]');for(const choice of await choices.all())await choice.check();
        const more=picker.getByRole('button',{name:'Load more',exact:true});if(!await more.count())break;
        const before=await choices.count();await more.click();await page.waitForFunction(previous=>document.querySelectorAll('[aria-label="Pick things to share"] input[type="checkbox"]').length>previous,before);
      }
      assert(await picker.locator('input[type="checkbox"]:checked').count()>=101,'Consent can select more than100 choices');
      await inspect('relational-consent-'+name);
      }
      await page.goto(`${origin}/s/${slug}/mod?tab=rules`);
      await page.getByTestId('mod-save-rules').waitFor({state:'visible'});
      const title=page.getByPlaceholder('Rule title').last();await title.fill('Edited nested rule title '+name);
      const rulesSaved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/subspaces/update'&&response.request().method()==='POST');
      await page.getByTestId('mod-save-rules').click();
      assert.equal((await rulesSaved).status(),200,'Rule UI save completes through the actual API');
      assert.equal((await read()).rules.at(-1).title,'Edited nested rule title '+name);
      await page.getByTestId('mod-removal-reason-message').last().fill('Edited removal detail '+name);
      const reasonsSaved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/subspaces/update'&&response.request().method()==='POST');
      await page.getByTestId('mod-save-removal-reasons').click();
      assert.equal((await reasonsSaved).status(),200,'Removal reason UI save completes through the actual API');
      assert.equal((await read()).removalReasons.at(-1).message,'Edited removal detail '+name);
      await inspect('relational-subspace-rules-'+name);
      await page.goto(`${origin}/s/${slug}/mod?tab=flairs`);
      await page.getByPlaceholder('Label').first().waitFor({state:'visible'});
      assert(await page.getByPlaceholder('Label').count()>=102,'Post and user flair fields remain individually editable beyond former caps');
      await inspect('relational-subspace-flairs-'+name);
      await page.goto(`${origin}/s/${slug}`);
      await page.getByText(`Synthetic relational sharing choice ${suffix}`,{exact:false}).first().waitFor({state:'visible'});
      const flairText=`Custom ${name} ${'complete flair '.repeat(60)}`.trim();
      await page.getByTestId('user-flair-custom').fill(flairText);
      const flairSaved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/subspaces/members'&&response.request().method()==='POST');
      await page.getByTestId('user-flair-custom-save').click();
      assert.equal((await flairSaved).status(),200,'Custom flair UI saves beyond former40/64character limits');
      assert.equal((await read()).viewer.userFlair.label,flairText,'Full custom flair survives independent readback');
      await page.reload();
      await page.getByTestId('user-flair-custom').waitFor({state:'visible'});
      assert.equal(await page.getByTestId('user-flair-custom').inputValue(),flairText,'Custom flair survives reload');
      await inspect('relational-subspace-feed-'+name);
    }
    await context.close();
  }catch(error){
    if(activePage){
      await activePage.screenshot({path:join(evidenceDir,'relational-collections-failure.png'),fullPage:true,mask:[activePage.locator('input[type="password"]')]}).catch(()=>{});
      console.log(JSON.stringify({event:'collections-browser-failure',path:new URL(activePage.url()).pathname,diagnostics:browserDiagnostics.slice(-12)}));
    }
    throw error;
  }finally{await browser.close();}
  checks.push(`isolated Chromium: ${targetedUi?'targeted moderation/feed fixture;':'>100 consent selections;'} individual rule/removal fields saved via actual UI; all mod/feed desktop/mobile pages scrolled without overflow; screenshots ${evidenceDir}`);
  return {subspaceId:created.id,slug,clientId:app?.clientId,evidenceDir};
}
