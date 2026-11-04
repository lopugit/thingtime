import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';

/** Real editable React UI and production API handlers in an isolated database.
 * Only the Electron proof IPC is represented by an explicit fixture adapter. */
export async function runNativeApprovalUI({context,page,origin,ownerId,password,inspect}:any){
 const request=async(body:any)=>{
  const response=await context.request.post(origin+'/api/v1/passwords',{headers:{Origin:origin},data:{...body,expectedOwnerId:ownerId}});
  return{status:response.status(),body:await response.json()};
 };
 const secret=randomBytes(32).toString('base64url'),entryId=randomUUID();
 assert.equal((await request({operation:'save',id:entryId,writeId:randomUUID(),revision:0,entry:{title:'Native approval fixture',passwordType:'login',fields:[
  {id:'username',label:'Username',type:'text',value:'native-fixture@example.invalid'},
  {id:'password',label:'Password',type:'password',value:secret},
  {id:'website',label:'Website',type:'url',value:'https://native-fixture.example'},
 ]}})).status,200);
 const settings=await request({operation:'verification-settings'});assert.equal(settings.status,200);
 assert.equal((await request({operation:'verification-settings',window:'always',reuseRecentDeviceVerification:false,revision:settings.body.settings.revision})).status,200);
 const make=()=>({version:1,id:randomUUID(),expectedOwnerId:ownerId,apiOrigin:origin,entryId,requestHash:randomBytes(32).toString('base64url'),type:'fill',origin:'https://native-fixture.example'});
 const begin=async(pending:any)=>{
  await page.addInitScript({content:`(() => {
   if(new URLSearchParams(location.search).get('surface')!=='native')return;
   window.fixtureApproval=null;
   window.thingtimeDesktop={passwordApprovalReady:async()=>(${JSON.stringify(pending)}),passwordApprovalRespond:async(response)=>{window.fixtureApproval=response;}};
  })();`});
  await page.goto(origin+'/scripts/password-verification.browser.html?surface=native');
  await page.getByRole('heading',{name:'Autofill with Thingtime',exact:true}).waitFor();
  await page.getByText(/native-fixture@example.invalid/).waitFor();
  await page.getByRole('textbox',{name:'Thingtime account password',exact:true}).waitFor();
 };
 const pending=make();await begin(pending);await inspect('native-approval-desktop');
 await page.setViewportSize({width:390,height:844});await inspect('native-approval-narrow');
 await page.getByRole('textbox',{name:'Thingtime account password',exact:true}).fill('wrong-synthetic-password');
 await page.getByRole('button',{name:'Verify and autofill',exact:true}).click();
 await page.getByText('Verification did not complete. Check your account password and try again.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>(window as any).fixtureApproval),null);await inspect('native-approval-error-narrow');
 await page.getByRole('textbox',{name:'Thingtime account password',exact:true}).fill(password);
 await page.getByRole('button',{name:'Verify and autofill',exact:true}).click();
 await page.waitForFunction(()=>(window as any).fixtureApproval?.proof);
 const proof=await page.evaluate(()=>(window as any).fixtureApproval.proof);
 assert.equal(proof.requestId,pending.id);assert.equal(proof.context.origin,pending.origin);
 assert.equal(proof.context.entryId,entryId);assert.equal(proof.context.requestHash,pending.requestHash);
 assert.equal(await page.locator('input[type=password]').inputValue(),'');
 assert.notEqual((await request({operation:'fill',id:randomUUID(),passkeySession:proof})).status,200);
 assert.notEqual((await request({operation:'fill',id:entryId,passkeySession:{...proof,context:{...proof.context,origin:'https://another-fixture.example'}}})).status,200);
 const fill=await request({operation:'fill',id:entryId,passkeySession:proof});
 assert.equal(fill.status,200);assert.ok(fill.body.password===secret,'Delivered value matches the isolated vault');assert.equal(fill.body.username,'native-fixture@example.invalid');
 // The existing API permits retries within a ceremony; an explicit lock ends
 // that authority. Native IPC resolves once and never accepts caller proofs.
 assert.equal((await request({operation:'verification-lock'})).status,200);
 assert.notEqual((await request({operation:'fill',id:entryId,passkeySession:proof})).status,200);
 await page.evaluate(()=>{(window as any).fixtureApproval=null;});
 console.log('PASS: native approval React UI with real disposable vault/API; exact account/origin/entry proof; wrong-password and revoked-proof refusal; protected fill; desktop/narrow/error scrolling and no overflow. Electron IPC is a fixture adapter in this UI check.');
}
