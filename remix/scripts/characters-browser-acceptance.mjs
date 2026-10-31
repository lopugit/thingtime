// Launched by characters-acceptance inside its inherited OS network sandbox.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture=JSON.parse(await readFile(process.argv[2],'utf8'));
const out=process.env.CHARACTERS_EVIDENCE_DIR;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--disable-background-networking','--disable-component-update','--no-proxy-server']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
let page;
const diagnostics=[];
await writeFile(join(out,'progress.log'),'Starting browser acceptance\n');
const note = text => appendFile(join(out,'progress.log'),text+'\n');
try {
  await note('Opening page');
  page=await context.newPage();
  await note('Page opened');
  for(const url of ['http://1.1.1.1:80/',fixture.redirect]){
    await note('Checking browser network denial');
    let rejected=false;try{await page.goto(url,{timeout:4000})}catch(error){assert(/ERR_NETWORK_ACCESS_DENIED|ERR_ACCESS_DENIED/.test(error.message),error.message);rejected=true}
    assert(rejected,'Browser network boundary must reject external traffic');
  }
  await note('Browser boundary verified');
  await note('Opening page');
  page=await context.newPage();
  await note('Page opened');
  await note('Adding isolated fixture session');
  await context.addCookies(fixture.cookie.split('; ').map(pair=>{const split=pair.indexOf('=');return {name:pair.slice(0,split),value:pair.slice(split+1),url:fixture.origin,httpOnly:true,sameSite:'Lax'}}));
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);diagnostics.push(error.message)});
  page.on('response', r => {if(r.url().includes('/api/')) { diagnostics.push(`${r.request().method()} ${new URL(r.url()).pathname}: ${r.status()}`); if(r.status()>=400)void note(`${r.request().method()} ${new URL(r.url()).pathname}: ${r.status()}`) }});
  page.on('console', message => { if(message.type()==='error'){diagnostics.push(message.text());void note(message.text())} });
  await note('Opening Settings');
  await page.goto(fixture.origin+'/settings/characters',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Create Character',exact:true}).waitFor({timeout:60000});
  await page.getByLabel('Display name',{exact:true}).fill('Browser Agent Cedar');
  await page.getByLabel('Sign-in method').selectOption('password');
  await page.getByLabel('Character password',{exact:true}).fill(fixture.password);
  const [created]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/v1/auth/characters')&&r.request().method()==='POST'),page.getByRole('button',{name:'Create Character',exact:true}).click()]);
  assert.equal(created.status(),200,JSON.stringify(await created.json()));
  await page.locator('input[value="Browser Agent Cedar"]').last().waitFor();
  const roster=await page.evaluate(async()=>await(await fetch('/api/v1/auth/characters')).json());
  const cedar=roster.characters.find(c=>c.user.displayName==='Browser Agent Cedar');assert(cedar,'UI-created Character must exist in real API');
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40))}window.scrollTo(0,0)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Settings horizontal overflow');
    await note(`Settings screenshot ${viewport.width}`);
    await page.screenshot({path:join(out,`characters-settings-${viewport.width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const row=page.locator('div').filter({has:page.locator(`input[aria-label="Display name for ${cedar.user.username}"]`)}).filter({has:page.getByRole('button',{name:'Use for this session',exact:true})}).last();
  await page.getByLabel('Character ID to inspect').fill(cedar.user.id);
  await page.getByRole('button',{name:'Look up owner',exact:true}).click();
  await page.getByText('Owner ID: '+roster.principal.id,{exact:true}).waitFor();
  await row.getByRole('button',{name:'Disable and revoke sessions',exact:true}).click();
  await row.getByRole('button',{name:'Enable',exact:true}).waitFor();
  assert.equal(await row.getByRole('button',{name:'Use for this session',exact:true}).isEnabled(),false);
  await row.getByRole('button',{name:'Enable',exact:true}).click();
  await row.getByRole('button',{name:'Disable and revoke sessions',exact:true}).waitFor();
  await Promise.all([page.waitForEvent('load'), row.getByRole('button',{name:'Use for this session',exact:true}).click()]);
  await page.getByRole('button',{name:/Return this session to/}).waitFor({timeout:30000});
  const me=await page.evaluate(async()=>await(await fetch('/api/v1/auth/me')).json());assert.equal(me.user.id,cedar.user.id);
  await Promise.all([page.waitForEvent('load'), page.getByRole('button',{name:/Return this session to/}).click()]);
  await page.getByRole('button',{name:'Create Character',exact:true}).waitFor({timeout:30000});
  await note('Settings session switched and restored');
  await page.goto(fixture.origin+'/feed',{waitUntil:'domcontentloaded'});
  await page.getByRole('combobox',{name:'Post as',exact:true}).first().waitFor({timeout:30000});
  await page.getByRole('combobox',{name:'Post as',exact:true}).first().selectOption(cedar.user.id);
  const editor=page.locator('[contenteditable="true"]').first();
  if(!await editor.isVisible()) await page.getByText(/on your mind/).first().click();
  await note('Feed editor ready');
  await editor.fill('Browser acceptance post from Cedar');
  await page.screenshot({path:join(out,'character-post-composer-desktop.png'),fullPage:true});
  const publish=page.getByRole('button',{name:/^Post(?:\s|$)/}).filter({hasNotText:'Post as'}).first();
  await publish.waitFor({state:'visible'});
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /^Post\s/.test(button.textContent) && !button.disabled));
  await note('Publishing');
  await page.evaluate(() => { window.__characterAlerts = []; new MutationObserver(() => { const text = [...document.querySelectorAll('[role=alert]')].map(e=>e.textContent).join(' | '); if(text && window.__characterAlerts.at(-1) !== text) window.__characterAlerts.push(text); }).observe(document.body,{subtree:true,childList:true}); });
  const [published] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/things' && r.request().method() === 'POST'), publish.click()]);
  const saved = await published.json();
  assert.equal(published.status(), 200, JSON.stringify(saved));
  assert.equal(saved.post.author.id, cedar.user.id, JSON.stringify(saved));
  await page.getByText('Browser acceptance post from Cedar',{exact:true}).last().waitFor({timeout:30000});
  const posts=await page.evaluate(async({id,postId})=>await(await fetch(`/api/v1/things?id=${postId}`,{headers:{'X-Thingtime-Character':id}})).json(),{id:cedar.user.id,postId:saved.post.id});
  assert(JSON.stringify(posts).includes('Browser acceptance post from Cedar'),'Rendered post must match persisted Character data');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Feed horizontal overflow');
  await page.screenshot({path:join(out,'character-feed-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(fixture.origin+'/post/'+saved.post.id,{waitUntil:'domcontentloaded'});
  const commentInput=page.getByPlaceholder('Write a comment… 💬');
  await commentInput.waitFor({timeout:30000});
  await page.getByRole('combobox',{name:'Post as',exact:true}).last().selectOption(cedar.user.id);
  await commentInput.fill('Cedar coordinating in a comment');
  const [commentResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/things/comment'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send comment',exact:true}).click()]);
  const comment=await commentResponse.json();assert.equal(commentResponse.status(),200,JSON.stringify(comment));assert.equal(comment.comment.author.id,cedar.user.id);
  await page.getByText('Cedar coordinating in a comment',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reply to Browser Agent Cedar',exact:true}).click();
  const willow=roster.characters.find(c=>c.user.displayName==='Agent Willow').user;
  const replyInput=page.getByPlaceholder('Reply to Browser Agent Cedar… 💬');
  await replyInput.locator('..').locator('..').getByRole('combobox',{name:'Post as',exact:true}).selectOption(willow.id);
  await replyInput.fill('Willow replying with a different identity');
  const [replyResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/things/comment'&&r.request().method()==='POST'),page.getByRole('button',{name:'Send reply',exact:true}).click()]);
  const reply=await replyResponse.json();assert.equal(replyResponse.status(),200,JSON.stringify(reply));assert.equal(reply.comment.author.id,willow.id);
  await page.getByText('Willow replying with a different identity',{exact:true}).waitFor();
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Comment/reply horizontal overflow');
    await page.screenshot({path:join(out,`character-comments-${viewport.width}.png`),fullPage:true});
  }
  await note('Comments and replies verified');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(fixture.origin+'/s/thingtime_agents_test',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Thingtime Agents',exact:true}).waitFor();
  const aspen=roster.characters.find(c=>c.user.displayName==='Agent Aspen').user;
  await page.getByRole('combobox',{name:'Post as',exact:true}).first().selectOption(aspen.id);
  const subEditor=page.locator('[contenteditable="true"]').first();
  if(!await subEditor.isVisible())await page.getByText(/on your mind/).first().click();
  await subEditor.fill('Aspen private subspace browser coordination');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /^Post\s/.test(button.textContent) && !button.disabled));
  const [subResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/things'&&r.request().method()==='POST'),page.getByRole('button',{name:/^Post(?:\s|$)/}).filter({hasNotText:'Post as'}).first().click()]);
  const subPost=await subResponse.json();assert.equal(subResponse.status(),200,JSON.stringify(subPost));assert.equal(subPost.post.author.id,aspen.id);
  await page.getByText('Aspen private subspace browser coordination',{exact:true}).waitFor();
  const persisted=await page.evaluate(async({id,actor})=>await(await fetch('/api/v1/things?id='+id,{headers:{'X-Thingtime-Character':actor}})).json(),{id:subPost.post.id,actor:aspen.id});
  assert(JSON.stringify(persisted).includes('Aspen private subspace browser coordination'));
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40))}});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Subspace horizontal overflow');
    await page.screenshot({path:join(out,`character-subspace-${viewport.width}.png`),fullPage:true});
  }
  assert(await page.getByTestId('post-audience').first().textContent().then(text=>text.includes('private subspace')), 'Private membership restriction must be visible');
  await note('Private subspace posting verified');
  await writeFile(join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2));
  await writeFile(join(out,'browser-result.json'),JSON.stringify({ok:true,characterId:cedar.user.id,errors},null,2));
  console.log(JSON.stringify({ok:true,desktopAndMobile:true,uiCreateAndSelect:true,realPost:true,commentsAndReplies:true,privateSubspace:true,browserNetworkDenied:true,errors}));
} catch(error) { if(page)diagnostics.push(await page.evaluate(()=>window.__characterAlerts||[]).catch(()=>[])); await writeFile(join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2)); if(page)await page.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});throw error; }
finally{await browser.close()}
