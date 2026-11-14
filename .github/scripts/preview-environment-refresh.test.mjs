import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshRequest, validateRefreshIncumbent, validateRefreshArtifacts, validateRefreshReceipt, refreshAutomationCredential, executeRefreshPublisher, refreshRetentionCanBeSkipped, reconcilePublicationRetention } from './preview-environment-refresh.mjs';
const env = { PREVIEW_REFRESH_DEPLOYMENT_ID:'dpl_old', PREVIEW_REFRESH_RUN_ID:'12' };
const scope = { eventName:'workflow_dispatch',ref:'refs/heads/main',prNumber:7 };
const config = {projectId:'prj_expected',repository:'lopugit/thingtime'};
const pr = {number:7,state:'open',head:{sha:'a'.repeat(40),ref:'codex/example',repo:{full_name:config.repository}},base:{repo:{full_name:config.repository}}};
const deployment = {id:'dpl_old',projectId:config.projectId,readyState:'READY',prebuilt:true,meta:{githubCommitSha:pr.head.sha,githubCommitRef:pr.head.ref,githubPrId:'7',thingtimeGatewayOwner:'false',thingtimeGatewayOrigin:'https://master.previews.thingtime.com',thingtimePrPreviewAttempt:'12-1'}};
const binding = () => ({deploymentId:'dpl_old',deployment:structuredClone(deployment)});
const intent = () => validateRefreshIncumbent(refreshRequest(env,scope),binding(),pr,config);
test('refresh is explicit manual-main only and does not become a generic redeploy',()=>{
 assert.equal(refreshRequest({},scope),null);
 for(const changed of [{eventName:'repository_dispatch'},{ref:'refs/heads/feature'},{prNumber:0}]) assert.throws(()=>refreshRequest(env,{...scope,...changed}));
 assert.equal(refreshRequest({...env,PREVIEW_REFRESH_RUN_ID:''},scope).runId,null);
});
test('exact active same-source incumbent is mandatory; owners/maintenance/closed or changed heads cannot refresh',()=>{
 assert.equal(intent().attempt,'12-1');
 for(const change of [{id:'dpl_other'},{projectId:'prj_other'},{prebuilt:false},{target:'production'},{readyState:'BUILDING'},{meta:{...deployment.meta,thingtimePreviewRole:'maintenance'}},{meta:{...deployment.meta,githubCommitSha:'b'.repeat(40)}}]) assert.throws(()=>validateRefreshIncumbent(refreshRequest(env,scope),{deploymentId:'dpl_old',deployment:{...deployment,...change}},pr,config));
 assert.throws(()=>validateRefreshIncumbent(refreshRequest(env,scope),binding(),{...pr,state:'closed'},config));
});
test('bundle and protected receipt must come from the successful original controller run',()=>{
 const run={id:12,repository:{full_name:config.repository},path:'.github/workflows/develop-pr-preview.yml',status:'completed',conclusion:'success',head_branch:'main'};
 const artifacts=['develop-preview-12-7','pr-preview-receipt-12-1'].map(name=>({name,expired:false,workflow_run:{id:12}}));
 assert.equal(validateRefreshArtifacts(intent(),run,artifacts,config.repository).runId,12);
 for(const change of [{conclusion:'failure'},{repository:{full_name:'other/repo'}},{path:'untrusted.yml'},{head_branch:'feature'}]) assert.throws(()=>validateRefreshArtifacts(intent(),{...run,...change},artifacts,config.repository));
 assert.throws(()=>validateRefreshArtifacts(intent(),run,[{...artifacts[0],expired:true},artifacts[1]],config.repository));
 const receipt={deploymentId:'dpl_old',state:'aliases-restored',attempt:'12-1',prNumber:7,sha:pr.head.sha,authorizationHead:pr.head.sha,ref:pr.head.ref};
 validateRefreshReceipt(intent(),receipt);
 for(const change of [{deploymentId:'dpl_other'},{sha:'b'.repeat(40)},{state:'uploading'},{maintenance:{}}]) assert.throws(()=>validateRefreshReceipt(intent(),{...receipt,...change}));
});

test('fresh runtime override selects one scoped platform default and fails closed on ambiguity',()=>{
 const project={id:config.projectId,protectionBypass:{'synthetic-old':{scope:'automation-bypass',isEnvVar:false},'synthetic-new':{scope:'automation-bypass',isEnvVar:true}}};
 assert.equal(refreshAutomationCredential(project,config.projectId),'synthetic-new');
 assert.throws(()=>refreshAutomationCredential(project,'prj_other'));
 assert.throws(()=>refreshAutomationCredential({...project,protectionBypass:{}},config.projectId));
 assert.throws(()=>refreshAutomationCredential({...project,protectionBypass:{...project.protectionBypass,'another':{scope:'automation-bypass',isEnvVar:true}}},config.projectId));
});

test('retained maintenance refresh keeps canonical tree and original authorization distinct from source',()=>{
 const maintenance={retainedSourceSha:'b'.repeat(40),expectedHeadSha:pr.head.sha,retainedDeploymentId:'dpl_baseline',sourceTree:'c'.repeat(40),patchSha256:'d'.repeat(64),artifact:{commit:'e'.repeat(40),path:'ops/preview-maintenance/example/manifest.json',digest:'f'.repeat(64)}};
 const meta={thingtimePreviewRole:'maintenance',thingtimeMaintenanceCommit:maintenance.artifact.commit,thingtimeMaintenancePath:maintenance.artifact.path,thingtimeMaintenanceDigest:maintenance.artifact.digest,thingtimeMaintenanceTree:maintenance.sourceTree,thingtimeMaintenancePatch:maintenance.patchSha256,thingtimeMaintenanceAuthorizedHead:maintenance.expectedHeadSha,thingtimeMaintenanceRetainedDeployment:maintenance.retainedDeploymentId};
 const b=binding();b.deployment.meta={...deployment.meta,...meta,githubCommitSha:maintenance.retainedSourceSha};
 const i=validateRefreshIncumbent(refreshRequest(env,{...scope,maintenance:true}),b,pr,{...config,maintenance});
 const receipt={deploymentId:i.deploymentId,state:'aliases-restored',attempt:i.attempt,prNumber:7,sha:maintenance.retainedSourceSha,authorizationHead:pr.head.sha,ref:pr.head.ref,maintenance:meta};
 validateRefreshReceipt(i,receipt);
 assert.throws(()=>validateRefreshReceipt(i,{...receipt,maintenance:{...meta,thingtimeMaintenanceTree:'0'.repeat(40)}}));
 assert.throws(()=>validateRefreshIncumbent(refreshRequest(env,scope),b,pr,{...config,maintenance:{...maintenance,sourceTree:'0'.repeat(40)}}));
});

test('publisher delivers replacement only in child env and redacts credential-bearing execution failures',async()=>{
 const credential='synthetic-replacement-secret';let calls=0;
 const params={command:'/trusted/vercel',args:['deploy','--prebuilt','--env','THINGTIME_GATEWAY_SECRET'],options:{env:{CI:'true',VERCEL_AUTOMATION_BYPASS_SECRET:'synthetic-old'},timeout:100},credential};
 const result=await executeRefreshPublisher({...params,execute:async(command,args,options)=>{
  calls++;assert.equal(command,params.command);assert.equal(options.env.VERCEL_AUTOMATION_BYPASS_SECRET,credential);assert.equal(options.env.CI,'true');assert.equal(options.timeout,100);
  assert.deepEqual(args.slice(-2),['--env','VERCEL_AUTOMATION_BYPASS_SECRET']);assert.ok(!JSON.stringify(args).includes(credential));return {stdout:'https://synthetic.vercel.app',stderr:''};
 }});
 assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(credential));assert.equal(params.options.env.VERCEL_AUTOMATION_BYPASS_SECRET,'synthetic-old');
 await assert.rejects(executeRefreshPublisher({...params,execute:async()=>{throw Object.assign(new Error('provider leaked '+credential),{stdout:credential,stderr:credential,cmd:credential});}}),error=>{
  assert.equal(error.message,'Vercel fresh publication failed; protected diagnostics withheld');assert.ok(!JSON.stringify(error).includes(credential));assert.equal(error.cause,undefined);assert.equal(error.stdout,undefined);assert.equal(error.stderr,undefined);return true;
 });
});

test('legacy ordinary receipts infer only the absent same-source authorization head',()=>{
 const i=intent(),receipt={deploymentId:i.deploymentId,state:'aliases-restored',attempt:i.attempt,prNumber:i.prNumber,sha:i.sha,ref:i.ref};
 validateRefreshReceipt(i,receipt);
 for(const changed of [{authorizationHead:null},{authorizationHead:'b'.repeat(40)},{sha:'b'.repeat(40)},{deploymentId:'dpl_other'}]) assert.throws(()=>validateRefreshReceipt(i,{...receipt,...changed}));
 assert.throws(()=>validateRefreshReceipt({...i,maintenance:{tree:'canonical'}},receipt));
 assert.throws(()=>validateRefreshReceipt({...i,authorizationHead:'b'.repeat(40)},receipt));
});
test('retention no-op requires fresh complete policy and canonical current open non-draft same-repository liveness',()=>{
 const current={refresh:intent(),repository:config.repository,currentHeadVerified:true,pullRequest:{...pr,draft:false},policy:{enabled:true,pruneSupersededOpenPr:false,inactivePullRequestDays:null}};
 assert.equal(refreshRetentionCanBeSkipped(current),true);
 for(const change of [{refresh:null},{currentHeadVerified:false},{currentHeadVerified:undefined},{policy:undefined},{policy:{...current.policy,enabled:false}},{policy:{...current.policy,pruneSupersededOpenPr:true}},{policy:{...current.policy,pruneSupersededOpenPr:undefined}},{policy:{...current.policy,inactivePullRequestDays:undefined}},{policy:{...current.policy,inactivePullRequestDays:1}},{pullRequest:{...current.pullRequest,state:'closed'}},{pullRequest:{...current.pullRequest,draft:true}},{pullRequest:{...current.pullRequest,draft:undefined}},{pullRequest:{...current.pullRequest,head:{...pr.head,repo:{full_name:'fork/repo'}}}}]) assert.equal(refreshRetentionCanBeSkipped({...current,...change}),false);
});
test('only a proven no-op avoids sweep; normal publication, policy/PR transitions and uncertain reads run full cleanup',async()=>{
 const current={currentHeadVerified:true,pullRequest:{...pr,draft:false},policy:{enabled:true,pruneSupersededOpenPr:false,inactivePullRequestDays:null}};let sweeps=0,reads=0;
 const options={refresh:intent(),repository:config.repository,readCurrent:async()=>{reads++;return current;},cleanup:async()=>{sweeps++;}};
 assert.deepEqual(await reconcilePublicationRetention(options),{skipped:true});assert.equal(reads,1);assert.equal(sweeps,0);
 await reconcilePublicationRetention({...options,refresh:null});assert.equal(reads,1);assert.equal(sweeps,1);
 await reconcilePublicationRetention({...options,readCurrent:async()=>({...current,policy:{...current.policy,pruneSupersededOpenPr:true}})});assert.equal(sweeps,2);
 await reconcilePublicationRetention({...options,readCurrent:async()=>({...current,pullRequest:{...current.pullRequest,state:'closed'}})});assert.equal(sweeps,3);
 await reconcilePublicationRetention({...options,readCurrent:async()=>{throw Error('current head/draft/fork identity changed');}});assert.equal(sweeps,4);
});
