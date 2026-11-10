/** Real handler/API-utils + replica snapshot engine proof, isolated synthetic
 * account/bytes/local independent vault only. No direct collection access. */
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(
	directory && /^mongodb:\/\/127\.0\.0\.1:28175\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING || ''),
	'Use the isolated backup-workspace runner'
);
const base = 'http://127.0.0.1:28176';
process.env.APP_URL = base;
process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
process.env.ADMIN_USERNAMES = '';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(directory!, 'objects');
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;
const register = await import('../app/routes/api/v1/auth/register/_register');
const migrations = await import('../app/routes/api/v1/admin/migrations/run/_run');
const things = await import('../app/routes/api/v1/things/_things');
const uploadApproval = await import('../app/routes/api/v1/admin/users/public-uploads/_public-uploads');
const files = await import('../app/routes/api/v1/files/_files');
const me = await import('../app/routes/api/v1/auth/me/_me');
const uploads = await import('../app/routes/api/v1/attachments/uploads/_uploads');
const parts = await import('../app/routes/api/v1/attachments/uploads/parts/_parts');
const complete = await import('../app/routes/api/v1/attachments/uploads/complete/_complete');
const content = await import('../app/routes/api/v1/attachments/content/_content');
const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { thingtimeCapabilityManifest, capabilitySatisfies } = await import('../app/api/utils/capabilities/thingtimeCapabilities');
const { createBackupJobCoordinator } = await import('../app/api/utils/backups/backupJobs');
const { createBackupEngine } = await import('../app/api/utils/backups/backupEngine.server');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { openIndexedSealedBackup, verifyBackup } = await import('../app/api/utils/backups/portableBackup');
const { openAccountBackupFile, openAccountBackupFileVersion, openAccountBackupTimelineRecord } = await import(
	'../app/api/utils/backups/accountFileRecovery'
);
const { openBackupThingSnapshot } = await import('../app/api/utils/backups/thingSnapshots');
const { stageCloudFileBytes } = await import('../app/fileSync/cloudTransport');
const { backupJson } = await import('../app/backups/manifest');
const { fingerprintSource } = await import('../app/fileSync/contentFingerprint');
const request = (cookie: string, path = '/api/v1/things', body?: unknown) =>
	new Request(base + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
async function call(handler: any, cookie: string, path: string, body?: unknown) {
	const response: Response = await handler({ request: request(cookie, path, body) });
	const data = await response.json();
	assert.equal(response.status, 200, JSON.stringify(data));
	return { response, data };
}
const password=randomUUID()+'-Disposable!';
const username = 'workspace-http-' + randomUUID().slice(0, 8),
	created = await call(register.action, '', '/api/v1/auth/register', {
		username,
		email: username + '@example.invalid',
		password
	});
const cookie = created.response.headers
		.getSetCookie()
		.map((v) => v.split(';')[0])
		.join('; '),
	user = await getCurrentUser(request(cookie));
assert.ok(user);
assert.equal(user!.id, created.data.user.id);
process.env.ADMIN_USERNAMES = username;
await call(migrations.action, cookie, '/api/v1/admin/migrations/run', { migration: 'retire-legacy-thing-indexes', confirm: true });
await new Promise((resolve) => setTimeout(resolve, 60_100));
await call(migrations.action, cookie, '/api/v1/admin/migrations/run', { migration: 'retire-legacy-thing-indexes', confirm: true });
await ensureIndexes({ force: true });
await call(uploadApproval.action,cookie,'/api/v1/admin/users/public-uploads',{userId:user!.id,enabled:true,scope:'private'});
process.env.ADMIN_USERNAMES = '';
assert.equal((await getCurrentUser(request(cookie)))?.privateUploadsEnabled,true);
const folder = (
	await call(things.action, cookie, '/api/v1/things', { thingtime: ['folder'], acl: ['tt:user'], crystal: { name: 'Synthetic snapshot root' } })
).data.thing;
const ordinary = (
	await call(things.action, cookie, '/api/v1/things', {
		thingtime: ['data'],
		acl: ['tt:user'],
		folderId: folder.id,
		crystal: { text: 'Pinned ordinary graph 🥰' }
	})
).data.thing;
const independent = (await call(things.loader, cookie, '/api/v1/things?id=' + ordinary.id)).data.thing;
assert.equal(independent.crystal.text, 'Pinned ordinary graph 🥰');
const manifest = thingtimeCapabilityManifest(base),
	scope = { apiOrigin: base, ownerId: user!.id, dataPlane: 'home' };
const syncScope = { origin: base, ownerId: user!.id, dataPlane: 'home', rootId: folder.id, deviceId: 'isolated-snapshot-fixture' };
const fixtureFetch: typeof fetch = async (input, init) => {
	const supplied = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), base), init),
		url = new URL(supplied.url);
	assert.equal(url.origin, base);
	const headers = new Headers(supplied.headers);
	headers.set('Cookie', cookie);
	headers.set('Origin', base);
	const req = new Request(supplied, { headers });
	if (url.pathname === '/api/v1/attachments/local-object') return handleLocalAttachmentStorageRequest(req);
	const handler =
		url.pathname === '/api/v1/auth/me'
			? me.loader
			: url.pathname === '/api/v1/attachments/uploads'
			? uploads.action
			: url.pathname.endsWith('/uploads/parts')
			? parts.action
			: url.pathname.endsWith('/uploads/complete')
			? complete.action
			: url.pathname === '/api/v1/attachments/content'
			? req.method === 'POST'
				? content.action
				: content.loader
			: url.pathname === '/api/v1/files'
			? req.method === 'POST'
				? files.action
				: files.loader
			: null;
	assert.ok(handler, 'Fixed synthetic upload route');
	return handler!({ request: req } as any);
};
const uploadRuntime = {
	currentScope: () => syncScope,
	origin: () => base,
	fetch: fixtureFetch,
	requireCapability: async (feature: string, minimum: string) =>
		assert.ok(capabilitySatisfies(manifest.features[feature]?.version ?? '', minimum), feature)
};
const fileId = randomUUID(),
	oldBytes = new Uint8Array(Buffer.alloc(1024 + 17, 37)),
	newBytes = new Uint8Array(Buffer.alloc(1024 + 17, 63));
async function publish(bytes: Uint8Array, before: any = null) {
	const operationId = randomUUID(),
		fingerprint = await fingerprintSource({ size: bytes.length, read: async (o, l) => bytes.slice(o, o + l), check: () => {} });
	const staged = await stageCloudFileBytes(
		uploadRuntime,
		{
			scope: syncScope,
			folderId: folder.id,
			before: null,
			cloudRootId: folder.id,
			operation: {
				id: operationId,
				confirmed: true,
				mutation: {
					kind: 'copy',
					from: 'local',
					path: 'synthetic.txt',
					expectedTarget: null,
					source: { kind: 'file', path: 'synthetic.txt', id: fileId, version: 'fixture', size: bytes.length, sha256: null, fingerprint }
				}
			}
		},
		fileId,
		{ size: bytes.length, read: async (o, l) => bytes.slice(o, o + l), check: () => {} },
		undefined,
		{ purpose: 'file' }
	);
	return (
		await call(files.action, cookie, '/api/v1/files', {
			id: fileId,
			operationId,
			expectedRevision: before?.revision ?? null,
			name: 'synthetic.txt',
			folderId: folder.id,
			attachmentId: staged.attachmentId,
			contentVersion: staged.version,
			trashed: false
		})
	).data.file;
}
const oldFile = await publish(oldBytes),
	currentFile = await publish(newBytes, oldFile);
assert.notEqual(oldFile.revision, currentFile.revision);
// Pair only a disposable synthetic device through the normal proof ceremony.
const pairingRoute=await import('../app/routes/api/v1/devices/pairing/_pairing'),claimRoute=await import('../app/routes/api/v1/devices/pairing/claim/_claim');
const challenge=(await call(pairingRoute.action,cookie,'/api/v1/devices/pairing',{})).data;
const {generateKeyPairSync,sign}=await import('node:crypto'),keys=generateKeyPairSync('ed25519');
const publicKey=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),credential='ttnode_'+randomBytes(32).toString('base64url');
const prepared=(await call(claimRoute.action,'','/api/v1/devices/pairing/claim',{op:'prepare',pairingSecret:challenge.pairing.pairingSecret,publicKey,nonce})).data;
const {pairingId,serverNonce}=prepared.proof,device={name:'Disposable backup workspace',platform:'macos',model:'Synthetic',osVersion:'test',appVersion:'1.0.0'};
const fields=['thingtime-device-pairing-claim-v1',pairingId,challenge.pairing.pairingSecret,credential,publicKey,nonce,serverNonce,device.name,device.platform,device.model,device.osVersion,device.appVersion,'0'];
const proofBytes=Buffer.concat(fields.map(value=>{const bytes=Buffer.from(value);return Buffer.concat([Buffer.from(bytes.length+':'),bytes]);}));
const paired=(await call(claimRoute.action,'','/api/v1/devices/pairing/claim',{op:'complete',pairingSecret:challenge.pairing.pairingSecret,credential,device,capabilities:[],proof:{pairingId,publicKey,nonce,serverNonce,signature:sign(null,proofBytes,keys.privateKey).toString('base64url')}})).data;
const deviceId=paired.device.id;assert.ok(deviceId);
const { createServer }=await import('node:http');
const { readFile,mkdir }=await import('node:fs/promises');
const { fork }=await import('node:child_process');
const { once }=await import('node:events');
const { createBackupWorkspaceService }=await import('../app/api/utils/backups/backupWorkspace.server');
const { createBackupWorkspaceHandlers }=await import('../app/routes/api/v1/backups/workspace/_workspace');
const { default:apiHandler,routeModules }=await import('../server/routes/api/[...]');
const { buildBackupWorkspaceBrowser }=await import('./test-backup-workspace-ui.mjs');
const store=await openLocalBackupStore(join(directory!,'independent-workspace')),binding='a'.repeat(64),jobs=createBackupJobCoordinator();
class FixtureTransient extends Error{}
let recoveryTarget:string|null=null,gateFirstSnapshot=true,transientPending=false;
const openDestination=async(id:string,access:any,pin?:string)=>{if(transientPending){transientPending=false;await access.authorize();throw new FixtureTransient('Synthetic provider interruption');}assert.equal(id,'fixture-independent');if(pin)assert.equal(pin,binding);await access.authorize();return {store,binding};};
const engine=createBackupEngine({openDestination});
const active=new Map<string,Promise<void>>(),failures:string[]=[],jobMetrics:any[]=[];
const httpMetrics={requests:0,elapsedMs:0,maxRequestMs:0};
function kick(id:string){
 // First admission waits for the real queued Pause/Resume UI control. Only the
 // resumed engine's provider adapter throws once; saved issue/retry is canonical.
 if(gateFirstSnapshot){gateFirstSnapshot=false;recoveryTarget=id;return;}
 if(id===recoveryTarget){recoveryTarget=null;transientPending=true;}
 if(active.has(id))return;
 const started=performance.now(),metric={jobId:id,kind:'unknown',units:0,maxUnitMs:0,elapsedMs:0};
 const task=(async()=>{for(let i=0;i<10000;i++){
  const claim=await jobs.claim(id);if(!claim.lease){if(['completed','paused','cancelled','needs-attention'].includes(claim.status))return;await new Promise(r=>setTimeout(r,20));continue;}
  const unitStarted=performance.now();
  try{const outcome=await jobs.withLease(claim.lease,ctx=>{metric.kind=ctx.operation.kind;return engine(ctx);});await jobs.finish(claim.lease,outcome);metric.units++;metric.maxUnitMs=Math.max(metric.maxUnitMs,performance.now()-unitStarted);if(outcome.kind!=='continue')return;}catch(error){await jobs.finish(claim.lease,{kind:'pause',issue:'step-failed'}).catch(()=>{});const view=await jobs.current(request(cookie),id);if(['paused','cancelled','queued'].includes(view.status))return;throw error;}
 }throw Error('Fixture unit budget exhausted');})().catch(error=>{if(!(error instanceof FixtureTransient))failures.push(error instanceof Error?error.message:'engine failed');}).finally(async()=>{active.delete(id);metric.elapsedMs=performance.now()-started;jobMetrics.push(metric);const view=await jobs.current(request(cookie),id);if(view.status==='queued')kick(id);});
 active.set(id,task);
}
// The compiled handler gets an actual authenticated streamed POST first.
// Its provider/Workflow admission remains unavailable in this isolated build;
// fixed invalid/absent control identities exercise parsing without any effects.
const compiledEntry=join(import.meta.dirname,'../.output/server/index.mjs');
const compiledEntrySha256=createHash('sha256').update(await readFile(compiledEntry)).digest('hex');
const {middleware}=await import((await import('node:url')).pathToFileURL(compiledEntry).href);assert.equal(typeof middleware,'function');
const compiledServer=createServer((req,res)=>{Promise.resolve(middleware(req,res)).catch(()=>{if(!res.headersSent)res.statusCode=500;res.end();});});
await new Promise<void>((resolve,reject)=>{compiledServer.once('error',reject);compiledServer.listen(28176,'127.0.0.1',resolve);});
try{
 const post=async(body:string,type='application/json')=>fetch(base+'/api/v1/backups/workspace',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':type,'X-Thingtime-Expected-Actor':user!.id},body,signal:AbortSignal.timeout(10000)});
 const control=await post(JSON.stringify({action:'pause',jobId:randomUUID()}));assert.equal(control.status,409);assert.match(control.headers.get('cache-control')??'',/private.*no-store/);
 assert.equal((await post('{}','text/plain')).status,415);
 assert.equal((await post(JSON.stringify({extra:'x'.repeat(17*1024)}))).status,413);
}finally{compiledServer.closeAllConnections();await new Promise<void>(resolve=>compiledServer.close(()=>resolve()));}
const service=createBackupWorkspaceService({jobs,open:openDestination as any,discover:async()=>({ok:true,destinations:[{id:'fixture-independent',provider:'aws-s3-oidc',label:'Isolated independent storage',state:'configured-unverified'}],availability:'configured',reason:null,executionAvailable:false}),worker:async()=>({available:true}),kick});
routeModules['v1/backups/workspace']=async()=>createBackupWorkspaceHandlers({service});
const assetDirectory=join(directory!,'browser-assets');await mkdir(assetDirectory);await buildBackupWorkspaceBrowser(assetDirectory);
const evidence=join((await import('node:os')).tmpdir(),'thingtime-backup-workspace-http-'+randomUUID());await mkdir(evidence,{mode:0o700});
const server=createServer(async(req,res)=>{const started=performance.now();try{
 const url=new URL(req.url!,base);let response:Response;
 if(url.pathname==='/fixture.js'||url.pathname==='/')response=new Response(await readFile(join(assetDirectory,url.pathname==='/fixture.js'?'fixture.js':'index.html')),{headers:{'Content-Type':url.pathname==='/fixture.js'?'application/javascript':'text/html'}});
 else if(url.pathname==='/.well-known/thingtime-capabilities.json')response=Response.json(thingtimeCapabilityManifest(base));
 else{
  const headers=new Headers();for(const [key,value]of Object.entries(req.headers)){if(Array.isArray(value))value.forEach(v=>headers.append(key,v));else if(value!==undefined)headers.set(key,value);}
  const buffers:Buffer[]=[];for await(const chunk of req)buffers.push(Buffer.from(chunk));
  const request=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method!)?{body:Buffer.concat(buffers)}:{})});
  response=await apiHandler({req:request,context:{params:{path:url.pathname.replace(/^\/api\//,'')}}} as any) as Response;
 }
 res.statusCode=response.status;for(const [key,value]of response.headers){if(key!=='set-cookie')res.setHeader(key,value);}const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.statusCode=500;res.end('Isolated fixture request failed');}finally{const elapsed=performance.now()-started;httpMetrics.requests++;httpMetrics.elapsedMs+=elapsed;httpMetrics.maxRequestMs=Math.max(httpMetrics.maxRequestMs,elapsed);}});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(28176,'127.0.0.1',resolve);});
const browser=fork(join(import.meta.dirname,'test-backup-workspace-ui.mjs'),['--real',base],{stdio:['ignore','pipe','pipe','ipc'],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,PLAYWRIGHT_MODULE_PATH:'/tmp/thingtime-backup-ui-runner/node_modules/playwright',PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}});
let result:any,output='';browser.stdout?.on('data',b=>output+=b);browser.stderr?.on('data',b=>output+=b);
browser.on('message',async(message:any)=>{try{
 if(message.type==='backup-workspace-ready')browser.send({type:'backup-workspace-test',account:{id:user!.id,username,password},sourceRootId:folder.id,deviceId,exerciseRecovery:true,evidence});
 if(message.type==='verify-restored'){
  assert.equal((await jobs.current(request(cookie),message.jobId)).status,'completed');
  const response=await files.loader({request:request(cookie,'/api/v1/files?rootId='+message.destinationId)}as any);assert.equal(response.status,200);const value=await response.json();
  const node=value.inventory?.nodes.find((node:any)=>node.kind==='file'&&node.file.name==='synthetic.txt');assert.ok(node,'Independent Files readback must contain selected restored file');
  const restoredFile=node.file;
  const binary=await content.loader({request:request(cookie,'/api/v1/attachments/content?id='+restoredFile.content.attachmentId)}as any);assert.equal(binary.status,302);
  const bytes=await handleLocalAttachmentStorageRequest(new Request(binary.headers.get('location')!));assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()),newBytes);
  const timeline=await import('../app/routes/api/v1/timeline/_timeline');
  const history=await call(timeline.loader,cookie,'/api/v1/timeline?'+new URLSearchParams({ownerId:user!.id,dataPlane:'home',thingId:restoredFile.id}));
  const entries=history.data.entries??history.data.page?.entries??[];
  let historical=false;
  for(const row of entries){const retained=row.event?.after?.value?.content;if(!retained||retained.attachmentId===restoredFile.content.attachmentId)continue;
   await call(content.action,cookie,'/api/v1/attachments/content',{versions:[{id:retained.attachmentId,version:retained.version}]});
   const response=await content.loader({request:request(cookie,'/api/v1/attachments/content?'+new URLSearchParams({id:retained.attachmentId,version:retained.version,range:'1',retained:'1',offset:'0',length:String(retained.size)}))}as any);
   assert.equal(response.status,206);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),oldBytes);historical=true;
  }assert.ok(historical,'Independent historical bytes must be retained');
  const root=value.inventory.nodes.find((node:any)=>node.kind==='folder'&&node.path==='Synthetic snapshot root');assert.ok(root);
  const ordinaryRead=await call(things.loader,cookie,'/api/v1/things?folderId='+root.id);
  assert.ok(JSON.stringify(ordinaryRead.data).includes('Pinned ordinary graph 🥰'),'Independent ordinary content readback');
  browser.send({type:'restore-verified',requestId:message.requestId,ok:true});
 }
 if(message.type==='backup-workspace-result')result=message;
 }catch(error){failures.push(error instanceof Error?error.message:'oracle failed');browser.send({type:'restore-verified',requestId:message.requestId,ok:false});}});
const timeout=setTimeout(()=>browser.kill('SIGTERM'),480000);
const [code]=await once(browser,'exit');clearTimeout(timeout);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.all(active.values());
assert.equal(code,0,'HTTP/browser fixture failed: '+output.slice(-1800));assert.ok(result,'Browser result missing');assert.deepEqual(failures,[]);
console.log(JSON.stringify({backupWorkspaceProof:true,realHttp:true,realCanonicalHandler:true,realJobs:true,realEngine:true,independentLocalStore:true,deployedWorkflow:false,providerAcceptance:false,builtAuthenticatedBodyProof:true,compiledEntrySha256,httpMetrics,jobMetrics,result}));
process.exit(0);
