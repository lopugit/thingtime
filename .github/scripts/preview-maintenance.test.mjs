import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { maintenanceRequest, parseMaintenanceManifest, loadMaintenance, assertMaintenanceHead, assertMaintenanceIncumbent, maintenanceMetadata, maintenanceMetadataIssue, maintenancePinFromDeployment, preserveMaintenanceAlias, reconstructMaintenance, maintenanceReceipt, assertMaintenanceReceipt, sha256 } from './preview-maintenance.mjs';
import { gatewaySourcePaths } from './preview-gateway-source.mjs';
const run = promisify(execFile), a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const manifest = () => ({ schemaVersion:1,purpose:'preview-protection',repository:'lopugit/thingtime',prNumber:123,expectedHeadSha:a,headRef:'codex/example',retainedDeploymentId:'dpl_old',retainedSourceSha:b,sourceTree:c,patchPath:'ops/preview-maintenance/example/protection.patch',patchSha256:sha256('patch'),implementationCommit:b });
const setup = () => { const value=manifest(), bytes=Buffer.from(JSON.stringify(value)), request={commit:a,path:'ops/preview-maintenance/example/manifest.json',digest:sha256(bytes)};return {value,bytes,request,intent:{...value,artifact:request,patch:Buffer.from('patch')}}; };
const env = request => ({PREVIEW_MAINTENANCE_ARTIFACT_COMMIT:request.commit,PREVIEW_MAINTENANCE_MANIFEST_PATH:request.path,PREVIEW_MAINTENANCE_MANIFEST_SHA256:request.digest});
const scope={eventName:'workflow_dispatch',ref:'refs/heads/main',prNumber:123};
const pr = () => ({number:123,state:'open',head:{sha:a,ref:'codex/example',repo:{full_name:'lopugit/thingtime'}},base:{repo:{full_name:'lopugit/thingtime'}}});
const blob = bytes => ({type:'file',encoding:'base64',content:Buffer.from(bytes).toString('base64'),sha:createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex')});
function githubFor({value,bytes,request}, mutate = () => {}) {
 return async path => {
  let result;
  if(path.includes('/git/ref/heads/main')) result={object:{sha:c}};
  else if(path.includes('/compare/')) result={status:'ahead',merge_base_commit:{sha:path.split('/compare/')[1].split('...')[0]}};
  else if(path.includes('/manifest.json?')) result=blob(bytes);
  else if(path.includes('/protection.patch?')) result=blob('patch');
  else throw new Error(`unexpected fixture path ${path}`);
  mutate(path,result);return result;
 };
}
test('ordinary mode has no maintenance request; exact manual-main pins are required',()=>{
 assert.equal(maintenanceRequest({},scope),null);const {request}=setup();assert.deepEqual(maintenanceRequest(env(request),scope),request);
 for(const changed of [{eventName:'repository_dispatch'},{eventName:'schedule'},{ref:'refs/heads/feature'},{prNumber:0}]) assert.throws(()=>maintenanceRequest(env(request),{...scope,...changed}),/manual-main-only/);
 for(const field of ['commit','path','digest']) { const bad={...request,[field]:field==='path'?'https://attacker/manifest.json':'bad'};assert.throws(()=>maintenanceRequest(env(bad),scope),/artifact-pin/); }
});
test('manifest refuses tamper, unknown fields, unsafe scope and non-sibling patch',()=>{
 const {value,bytes,request}=setup();assert.equal(parseMaintenanceManifest(bytes,request,value.repository,123).sourceTree,c);
 assert.throws(()=>parseMaintenanceManifest(Buffer.from('{}'),request,value.repository,123),/digest/);
 for(const change of [{url:'https://attacker'},{purpose:'arbitrary-code'},{repository:'attacker/fork'},{prNumber:124},{headRef:'main'},{headRef:'../escape'},{patchPath:'../protection.patch'},{sourceTree:'fake'},{retainedDeploymentId:'wrong'}]) {
  const data=Buffer.from(JSON.stringify({...value,...change}));assert.throws(()=>parseMaintenanceManifest(data,{...request,digest:sha256(data)},value.repository,123),/manifest-|patch-path/);
 }
});
test('loads only canonical-main ancestor blobs and verifies patch and Git blob integrity',async()=>{
 const fixture=setup();assert.equal((await loadMaintenance(fixture.request,{github:githubFor(fixture),repository:fixture.value.repository,prNumber:123})).patch.toString(),'patch');
 for(const mutate of [
  (path,result)=>{if(path.includes('/compare/'))result.status='diverged';},
  (path,result)=>{if(path.includes('/compare/'))result.merge_base_commit.sha=c;},
  (path,result)=>{if(path.includes('/manifest.json?'))result.sha=b;},
  (path,result)=>{if(path.includes('/protection.patch?'))Object.assign(result,blob('changed'));}
 ])await assert.rejects(loadMaintenance(fixture.request,{github:githubFor(fixture,mutate),repository:fixture.value.repository,prNumber:123}),/main-provenance|blob-integrity|patch-digest/);
});
test('current-head fence refuses fork, close, changed ref or SHA independently of baseline',()=>{
 const {intent}=setup();assert.doesNotThrow(()=>assertMaintenanceHead(intent,pr()));
 for(const changed of [{...pr(),state:'closed'},{...pr(),head:{...pr().head,sha:b}},{...pr(),head:{...pr().head,ref:'codex/new'}},{...pr(),head:{...pr().head,repo:{full_name:'attacker/fork'}}}])assert.throws(()=>assertMaintenanceHead(intent,changed),/current-head/);
});
test('incumbent must remain the exact READY retained deployment and source',()=>{
 const {intent}=setup();const binding={deployment:{id:intent.retainedDeploymentId,readyState:'READY',meta:{githubCommitSha:b,githubCommitRef:intent.headRef}}};assert.doesNotThrow(()=>assertMaintenanceIncumbent(intent,binding));
 for(const changed of [null,{deployment:{...binding.deployment,id:'dpl_other'}},{deployment:{...binding.deployment,readyState:'BUILDING'}},{deployment:{...binding.deployment,meta:{...binding.deployment.meta,githubCommitSha:a}}}])assert.throws(()=>assertMaintenanceIncumbent(intent,changed),/incumbent/);
});
test('honest metadata and receipt bind baseline/tree/overlay separately from authorization head',()=>{
 const {intent}=setup();const deployment={meta:{githubCommitSha:b,githubPrId:'123',...maintenanceMetadata(intent)}};
 assert.equal(maintenanceMetadataIssue(deployment,intent),null);assert.equal(maintenancePinFromDeployment(deployment).commit,a);
 for(const key of Object.keys(maintenanceMetadata(intent))) assert.equal(maintenanceMetadataIssue({meta:{...deployment.meta,[key]:'changed'}},intent),'maintenance-identity');
 assert.equal(maintenanceMetadataIssue({meta:{...deployment.meta,githubCommitSha:a}},intent),'maintenance-identity');
 assert.doesNotThrow(()=>assertMaintenanceReceipt(maintenanceReceipt(intent),intent));assert.throws(()=>assertMaintenanceReceipt({...maintenanceReceipt(intent),authorizationHead:b},intent),/receipt/);
});
const sourceFixtures = [
 "import { requireGatewayDatabaseAccess } from '../deployment/environmentGateway'; class GatewayMongoClient extends mod.MongoClient { override async connect() { await requireGatewayDatabaseAccess(); await super.connect(); } }",
 "import { environmentGatewayIngress } from '../utils/environmentGateway'; await environmentGatewayIngress(event.req); runAdmittedGatewayWork(() => next());",
 'export const requireGatewayDatabaseAccess = async () => { await gatewayAuthority.requireDatabase(); };',
 "export const mongoConnectionPolicy = 'proxy';"
];
async function fixtureRepo(work) {
 const directory=await mkdtemp(join(tmpdir(),'preview-maintenance-test-'));const git=async args=>(await run('git',args,{cwd:directory})).stdout.trim();
 try {await git(['init','-q']);await git(['config','user.name','Synthetic fixture']);await git(['config','user.email','fixture@example.invalid']);await git(['config','core.hooksPath','/dev/null']);
  for(let i=0;i<gatewaySourcePaths.length;i++){const path=join(directory,gatewaySourcePaths[i]);await mkdir(dirname(path),{recursive:true});await writeFile(path,sourceFixtures[i]);}
  await git(['add','.']);await git(['commit','-qm','synthetic base']);const base=await git(['rev-parse','HEAD']);
  await writeFile(join(directory,gatewaySourcePaths[2]),sourceFixtures[2]+'\n// reviewed protection overlay\n');await git(['add','.']);const tree=await git(['write-tree']);const patch=(await run('git',['diff','--cached','--binary'],{cwd:directory})).stdout;await git(['reset','--hard','-q','HEAD']);
  await work({directory,git,base,tree,patch:Buffer.from(patch)});
 }finally{await rm(directory,{recursive:true,force:true});}
}
test('real Git reconstruction applies exact reviewed patch and verifies full resulting tree',async()=>fixtureRepo(async ({directory,git,base,tree,patch})=>{
 const {intent}=setup();const value={...intent,retainedSourceSha:base,sourceTree:tree,patch,patchSha256:sha256(patch)};await reconstructMaintenance(value,directory);assert.equal(await git(['write-tree']),tree);assert.match(await readFile(join(directory,gatewaySourcePaths[2]),'utf8'),/reviewed protection overlay/);
}));
test('real Git reconstruction refuses dirty baseline and tampered expected tree',async()=>fixtureRepo(async ({directory,base,patch})=>{
 const {intent}=setup();await assert.rejects(reconstructMaintenance({...intent,retainedSourceSha:base,sourceTree:a,patch,patchSha256:sha256(patch)},directory),/build-tree/);
 await assert.rejects(reconstructMaintenance({...intent,retainedSourceSha:base,patch},directory),/build-base/);
}));

test('reconciliation preserves honest maintained aliases across newer heads and refuses corrupt provenance',()=>{
 const {intent}=setup();const binding={deployment:{meta:{githubCommitSha:b,...maintenanceMetadata(intent)}}};
 assert.equal(preserveMaintenanceAlias(binding,pr(),intent),true);
 assert.equal(preserveMaintenanceAlias(binding,{...pr(),head:{...pr().head,sha:c}},intent),true);
 assert.equal(preserveMaintenanceAlias(binding,{...pr(),state:'closed'},intent),false);
 assert.equal(preserveMaintenanceAlias({deployment:{meta:{}}},pr(),intent),false);
 assert.throws(()=>preserveMaintenanceAlias({deployment:{meta:{...binding.deployment.meta,thingtimeMaintenanceTree:a}}},pr(),intent),/provenance/);
 assert.throws(()=>preserveMaintenanceAlias(binding,{...pr(),head:{...pr().head,ref:'other'}},intent),/provenance/);
});
