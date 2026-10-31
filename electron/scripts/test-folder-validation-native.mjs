// Real Commander folder observations through the production native/host metadata boundary.
// The disposable native fixture never accesses installed grants or credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, mkdir, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from '../../remix/scripts/account-backup-isolation.mjs';
const root = resolve(import.meta.dirname, '..'), port = 28454, nested = false;
const clean = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };
const require = createRequire(import.meta.url);
const { DesktopFolderSync } = require('../lib/folder-sync.cjs');
if (!process.env.TT_NATIVE_BATCH_WORKER) {
    await verifyAccountBackupIsolation(port, clean);
    execFileSync('swift', ['build', '--package-path', resolve(root, '../macos/ThingtimeNode'), '--product', 'MacFolderSyncFixture'], { stdio: 'pipe' });
    const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-folders-'));
    try {
        const binary = join(directory, 'MacFolderSyncFixture'), entitlements = join(directory, 'fixture.entitlements');
        await copyFile(resolve(root, '../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), binary); await chmod(binary, 0o700);
        await writeFile(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.files.bookmarks.app-scope</key><true/></dict></plist>');
        const identity = process.env.THINGTIME_TEST_SIGNING_IDENTITY || execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).match(/([A-F0-9]{40}) "Apple Development:/)?.[1];
        assert.ok(identity, 'Stable Apple Development fixture identity required');
        execFileSync('codesign', ['--force', '--sign', identity, '--timestamp=none', '--identifier', 'com.thingtime.tests.native-folders', '--entitlements', entitlements, binary], { stdio: 'pipe' });
        execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'pipe' });
        const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
            { cwd: root, env: { ...clean, TT_NATIVE_BATCH_WORKER: directory }, stdio: 'inherit' }, port, true);
        const timer = setTimeout(() => child.kill('SIGTERM'), nested ? 240_000 : 120_000);
        try { const [code] = await once(child, 'exit'); assert.equal(code, 0); }
        finally { clearTimeout(timer); }
    } finally { await rm(directory, { recursive: true, force: true }); }
 } else {
    const directory=process.env.TT_NATIVE_BATCH_WORKER,origin=`http://127.0.0.1:${port}`;
    const {folderBatchCanonicalBytes}=require('../lib/folder-validate-batch.cjs');
    const owner=randomUUID(),device=randomUUID(),selected=join(directory,'selected');await mkdir(selected);
    let leaf=selected;
    for(let depth=0;depth<8;depth++){
        for(let sibling=0;sibling<16;sibling++)await mkdir(join(leaf,`sibling-${sibling}`));
        leaf=join(leaf,`level-${depth}`);await mkdir(leaf);
    }
    let identities=0,accounts=0;const features=Object.fromEntries(Object.entries({'api.devices-pairing-claim':'1.0.0','api.devices-node-state':'1.9.0','api.devices-node-commands':'1.9.0','api.devices-node-live-sync':'1.0.0','api.devices-node-identity':'1.0.0','api.file-sync-batches':'1.1.0'}).map(([k,version])=>[k,{version}]));
    const server=createServer((req,res)=>{
        res.setHeader('Content-Type','application/json');
        if(req.url==='/.well-known/thingtime-capabilities.json')return res.end(JSON.stringify({schemaVersion:1,origin,features}));
        if(req.url==='/api/v1/devices/node/identity'){assert.equal(req.headers.authorization,'Bearer disposable-fixture-credential');identities++;return res.end(JSON.stringify({ok:true,ownerId:owner,deviceId:device}));}
        if(req.url==='/api/v1/auth/me'){accounts++;return res.end(JSON.stringify({user:{id:owner,accountKind:'user'}}));}
        res.statusCode=404;res.end('{}');
    });server.listen(port,'127.0.0.1');await once(server,'listening');
    const config=join(directory,'native.json');
    await writeFile(config,JSON.stringify({base:origin,deviceId:device,credential:'disposable-fixture-credential',directory:pathToFileURL(directory).href,
        commanderIndexer:pathToFileURL(resolve(root,'../Commander/crates/commander-indexer/target/debug/commander-indexer')).href}),{mode:0o600});
    const child=spawn(join(directory,'MacFolderSyncFixture'),[config]);child.stderr.resume();let pending;
    createInterface({input:child.stdout}).on('line',line=>{const p=pending;pending=null;const v=JSON.parse(line);v.ok?p.resolve(v.result):p.reject(Error('Fixture refused'));});
    const send=request=>new Promise((resolve,reject)=>{assert.ok(!pending);pending={resolve,reject};const b=Buffer.from(JSON.stringify(request)),h=Buffer.alloc(4);h.writeUInt32BE(b.length);child.stdin.write(Buffer.concat([h,b]));});
    const input=action=>({action,requestId:randomUUID(),ownerId:owner,deviceId:device,origin});
    try{
        const rootId=(await send(input('choose'))).roots[0].id,captureId=randomUUID();
        const fields={rootId,inventoryDeviceId:device,captureId,capturePolicy:'one-way-supported',excludedPaths:[]};
        let page=(await send({...input('scan-stream'),...fields})).changesPage,entries=[];
        const scanDeadline=performance.now()+30000;let cursor=0;
        for(;;){
            assert.ok(performance.now()<scanDeadline,'bounded real index deadline');
            entries.push(...page.changes.map(c=>c.entry));cursor=page.nextSequence;
            if(page.state==='indexed'&&!page.hasMore)break;
            page=(await send({...input('scan-changes'),...fields,afterSequence:cursor,waitMilliseconds:25000})).changesPage;
        }
        page=(await send({...input('scan-stream-finish'),...fields,afterSequence:cursor})).changesPage;
        // Finish is asynchronous. Drain its terminal authorization before
        // measuring the independent folder operation's fresh HTTP boundaries.
        while(page.state!=='complete'){
            assert.ok(performance.now()<scanDeadline,'bounded capture stop deadline');
            page=(await send({...input('scan-changes'),...fields,afterSequence:cursor,waitMilliseconds:25000})).changesPage;
            cursor=page.nextSequence;
            if(page.state==='indexed'&&!page.hasMore)await send({...input('scan-stream-finish'),...fields,afterSequence:cursor});
        }
        const folders=entries.filter(e=>e.kind==='folder').sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path)).slice(0,128);
        assert.equal(folders.length,128);assert.ok(folders.some(e=>e.path.split('/').length>=8));
        const scope={origin,ownerId:owner,dataPlane:'home',rootId:'connection',deviceId:device},byPath=new Map();
        const descriptor={version:1,kind:'folders',batchId:randomUUID(),scope,configuration:{id:'connection',updatedAt:'2026-10-21T00:00:00.000Z',configuration:{configurationVersion:1,name:'Backup',deviceId:device,localRootId:rootId,remoteFolderId:'cloud-root',mode:'backup',paused:false,propagateDeletes:false,network:'wifi',chargingOnly:false,excludedPaths:[]}},members:[]};
        for(const [ordinal,e]of folders.entries()){
            const parentPath=e.path.split('/').slice(0,-1).join('/'),parentOrdinal=byPath.get(parentPath),id=randomUUID();
            assert.ok(!parentPath||parentOrdinal!==undefined);
            descriptor.members.push({ordinal,parent:parentPath?{kind:'member',ordinal:parentOrdinal}:{kind:'root'},write:{scope,folderId:parentPath?descriptor.members[parentOrdinal].write.operation.id:'cloud-root',cloudRootId:'cloud-root',before:null,operation:{id,confirmed:false,mutation:{kind:'copy',from:'local',path:e.path,source:{...e,sha256:null},expectedTarget:null}}}});byPath.set(e.path,ordinal);
        }
        const digest=createHash('sha256').update(folderBatchCanonicalBytes(descriptor)).digest('hex'),frame={url:origin},sender={mainFrame:frame,session:{fetch:globalThis.fetch}},window={webContents:sender,isDestroyed:()=>false};let launches=0;
        const host=new DesktopFolderSync({context:()=>({enabled:true,window,appOrigin:origin,apiOrigin:origin}),requestNative:async(_m,r)=>{if(r.action==='validate-folder-batch')launches++;return send(r);}});
        const event={sender,senderFrame:frame};await host.request(event,input('context'));accounts=0;identities=0;
        const began=performance.now(),batch={descriptor,digest,ordinals:folders.map((_,i)=>i)};
        const result=await host.request(event,{...input('validate-folder-batch'),rootId,batch,remainingMs:180000}),elapsedMs=Math.round(performance.now()-began);
        assert.equal(result.validatedFolderBatch.results.length,128);assert.ok(result.validatedFolderBatch.results.every(r=>r.status==='validated'));assert.equal(accounts,2);assert.equal(identities,2);assert.equal(launches,1);
        const {tsImport}=createRequire(resolve(root,'../remix/package.json'))('tsx/esm/api');
        const shared=await tsImport(resolve(root,'../remix/app/fileSync/folderBatch.ts'),{parentURL:import.meta.url,tsconfig:resolve(root,'../remix/tsconfig.json')});
        assert.ok(shared.parseNativeFolderBatchResult(result.validatedFolderBatch,{...batch,remainingMs:180000}));
        console.log(JSON.stringify({proof:'NATIVE_FOLDER_HOST_HTTP_PASS',members:128,indexed:entries.length,maxPathComponents:Math.max(...folders.map(e=>e.path.split('/').length)),ancestorSiblings:16,elapsedMs,launches,identityHTTP:identities,accountHTTP:accounts,validated:128,synthetic:'auth/identity HTTP only; actual Commander observations, native folder IO and production DesktopFolderSync/shared parser; no canonical server commit or installed XPC'}));
    }finally{child.stdin.end();await once(child,'exit');server.close();}
}
