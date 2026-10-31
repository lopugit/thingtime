// Bounded bulk upload against the production Mac reader and real HTTP bytes.
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
const root = resolve(import.meta.dirname, '..'), port = 28453, nested = process.argv.includes('--nested');
const clean = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };
const require = createRequire(import.meta.url);
const { DesktopFolderSync } = require('../lib/folder-sync.cjs');
if (!process.env.TT_NATIVE_BATCH_WORKER) {
    await verifyAccountBackupIsolation(port, clean);
    execFileSync('swift', ['build', '--package-path', resolve(root, '../macos/ThingtimeNode'), '--product', 'MacFolderSyncFixture'], { stdio: 'pipe' });
    const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-batch-'));
    try {
        const binary = join(directory, 'MacFolderSyncFixture'), entitlements = join(directory, 'fixture.entitlements');
        await copyFile(resolve(root, '../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), binary); await chmod(binary, 0o700);
        await writeFile(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.files.bookmarks.app-scope</key><true/></dict></plist>');
        const identity = process.env.THINGTIME_TEST_SIGNING_IDENTITY || execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).match(/([A-F0-9]{40}) "Apple Development:/)?.[1];
        assert.ok(identity, 'Stable Apple Development fixture identity required');
        execFileSync('codesign', ['--force', '--sign', identity, '--timestamp=none', '--identifier', 'com.thingtime.tests.native-batch', '--entitlements', entitlements, binary], { stdio: 'pipe' });
        execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'pipe' });
        const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
            { cwd: root, env: { ...clean, TT_NATIVE_BATCH_WORKER: directory }, stdio: 'inherit' }, port, true);
        const timer = setTimeout(() => child.kill('SIGTERM'), nested ? 240_000 : 120_000);
        try { const [code] = await once(child, 'exit'); assert.equal(code, 0); }
        finally { clearTimeout(timer); }
    } finally { await rm(directory, { recursive: true, force: true }); }
 } else {
    const directory = process.env.TT_NATIVE_BATCH_WORKER, origin = `http://127.0.0.1:${port}`;
    const { FolderBatchStream } = require('../lib/folder-batch-stream.cjs');
    const { batchCanonicalBytes } = require('../lib/folder-upload-batch.cjs');
    const vectors = require('../../remix/app/fileSync/fixtures/uploadBatchDigest.v1.json');
    const owner = randomUUID(), device = randomUUID(), selected = join(directory, 'selected');
    await mkdir(selected); const count = nested ? 128 : 256, payloads = Array.from({length:count}, (_, i) => Buffer.alloc(1024, i));
    let leaf = selected;
    if (nested) for (let depth=0;depth<7;depth++) {
        for (let sibling=0;sibling<32;sibling++) await mkdir(join(leaf, `sibling-${sibling}`));
        leaf=join(leaf, `level-${depth}`); await mkdir(leaf);
    }
    for (let i=0;i<count;i++) await writeFile(join(leaf, `file-${i}`), payloads[i]);
    let identities=0, accounts=0, puts=0, active=0, maximum=0; const phases=[]; let expectedByOrdinal=[];
    const features = Object.fromEntries(Object.entries({ 'api.devices-pairing-claim':'1.0.0','api.devices-node-state':'1.9.0','api.devices-node-commands':'1.9.0',
        'api.devices-node-live-sync':'1.0.0','api.devices-node-identity':'1.0.0','api.file-sync-batches':'1.0.0' }).map(([key,version])=>[key,{version}]));
    const server=createServer(async(req,res)=>{
        res.setHeader('Content-Type','application/json');
        if(req.url==='/.well-known/thingtime-capabilities.json') return res.end(JSON.stringify({schemaVersion:1,origin,features}));
        if(req.url==='/api/v1/devices/node/identity'){ assert.equal(req.headers.authorization,'Bearer disposable-fixture-credential'); identities++; return res.end(JSON.stringify({ok:true,ownerId:owner,deviceId:device})); }
        if(req.url==='/api/v1/auth/me'){ accounts++; return res.end(JSON.stringify({user:{id:owner,accountKind:'user'}})); }
        const chunks=[]; for await(const c of req)chunks.push(c); const bytes=Buffer.concat(chunks);
        if(req.url==='/api/v1/files/batches'){
            assert.equal(req.method,'POST');assert.equal(req.headers.origin,origin);assert.equal(req.headers['x-thingtime-expected-actor'],owner);
            const body=JSON.parse(bytes); phases.push(body.phase);const d=body.descriptor;
            const content=ordinal=>({ordinal,uploadId:'upload-'+ordinal,version:'c'.repeat(64),size:1024,fingerprint:d.members[ordinal].write.operation.mutation.source.fingerprint});
            const results=body.phase==='prepare'?d.members.map(({ordinal})=>{const c=body.checksums.find(c=>c.ordinal===ordinal);return c?{ordinal,status:'prepared',upload:{id:'upload-'+ordinal,partCount:1,partSizeBytes:8388608},part:{partNumber:1,expiresAt:new Date(Date.now()+600000).toISOString(),url:origin+`/part/${ordinal}?partNumber=1&uploadId=provider-${ordinal}`,headers:{'x-amz-checksum-sha256':Buffer.from(c.sha256,'hex').toString('base64')}}}:{ordinal,status:'source-required'};}):body.uploads.map(({ordinal})=>({ordinal,status:'verified',content:content(ordinal)}));
            return res.end(JSON.stringify({ok:true,version:1,batchId:d.batchId,digest:body.digest,results}));
        }
        assert.equal(req.method,'PUT'); const ordinal=Number(new URL(req.url,origin).pathname.split('/').at(-1));
        assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);assert.deepEqual(bytes,expectedByOrdinal[ordinal]);
        assert.equal(req.headers['x-amz-checksum-sha256'],createHash('sha256').update(bytes).digest('base64'));
        active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,20));active--;puts++;res.end('{}');
    });
    server.listen(port,'127.0.0.1');await once(server,'listening');
    const config=join(directory,'native.json'), bulkConfig=join(directory,'bulk.json');
    const cfg={base:origin,deviceId:device,credential:'disposable-fixture-credential',directory:pathToFileURL(directory).href};
    await writeFile(config,JSON.stringify(cfg),{mode:0o600});await writeFile(bulkConfig,JSON.stringify({...cfg,batchFixture:true}),{mode:0o600});
    const child=spawn(join(directory,'MacFolderSyncFixture'),[config]);child.stderr.resume();let pending;
    createInterface({input:child.stdout}).on('line',line=>{const p=pending;pending=null;const v=JSON.parse(line);v.ok?p.resolve(v.result):p.reject(Error('Fixture refused'));});
    const send=request=>new Promise((resolve,reject)=>{assert.ok(!pending);pending={resolve,reject};const b=Buffer.from(JSON.stringify(request)),h=Buffer.alloc(4);h.writeUInt32BE(b.length);child.stdin.write(Buffer.concat([h,b]));});
    const input=action=>({action,requestId:randomUUID(),ownerId:owner,deviceId:device,origin});
    try {
        const rootId=(await send(input('choose'))).roots[0].id, entries=(await send({...input('scan'),rootId})).entries.filter(e=>e.kind==='file');
        assert.equal(entries.length,count); expectedByOrdinal=entries.map(e=>payloads[Number(e.path.split('/').at(-1).slice(5))]); const descriptor=structuredClone(vectors.vectors[0].descriptor);
        descriptor.batchId=randomUUID();descriptor.scope={origin,ownerId:owner,dataPlane:'home',rootId:'connection',deviceId:device};
        descriptor.configuration.id='connection';descriptor.configuration.configuration.deviceId=device;descriptor.configuration.configuration.localRootId=rootId;
        descriptor.members=entries.map((entry,ordinal)=>{const member=structuredClone(vectors.vectors[0].descriptor.members[0]);member.ordinal=ordinal;member.write.scope=descriptor.scope;member.write.operation.id=randomUUID();member.write.operation.mutation.path=entry.path;member.write.operation.mutation.source={...entry,sha256:null};return member;});
        const digest=createHash('sha256').update(batchCanonicalBytes(descriptor)).digest('hex');
        let bulkLaunches=0;const frame={url:origin},sender={mainFrame:frame,session:{fetch:globalThis.fetch}},window={webContents:sender,isDestroyed:()=>false};
        const host=new DesktopFolderSync({context:()=>({enabled:true,window,appOrigin:origin,apiOrigin:origin}),fetchUpload:globalThis.fetch,
            requestNative:async(_method,request,options)=>{
                if(request.action!=='upload-batch')return send(request);bulkLaunches++;
                const proc=spawn(join(directory,'MacFolderSyncFixture'),[bulkConfig]);proc.stderr.resume();
                const stream=new FolderBatchStream({id:request.requestId,method:"folder-sync.request",parameters:request},f=>options.onBatchFrame(f,options.signal),()=>proc.kill('SIGTERM'));
                stream.connect(b=>proc.stdin.write(b));proc.stdout.on('data',b=>stream.write(b));
                const b=Buffer.from(JSON.stringify(request)),h=Buffer.alloc(4);h.writeUInt32BE(b.length);proc.stdin.write(Buffer.concat([h,b]));
                const timer=setTimeout(()=>proc.kill('SIGTERM'),nested ? 185000 : 60000);try{const[code]=await once(proc,'exit');assert.equal(code,0);return stream.finish().result;}finally{clearTimeout(timer);stream.close();proc.stdin.destroy();}
            }});
        await host.request({sender,senderFrame:frame},{...input('context'),rootId});accounts=0;identities=0;
        const began=performance.now(),result=await host.request({sender,senderFrame:frame},{...input('upload-batch'),rootId,batch:{descriptor,digest}}),elapsedMs=Math.round(performance.now()-began);
        assert.equal(result.uploadedBatch.results.length,count); if (!nested) assert.ok(result.uploadedBatch.results.every(r=>r.status==='verified'));
        if (!nested) assert.equal(puts,count);assert.equal(bulkLaunches,1);assert.equal(identities,2);assert.equal(accounts,2);assert.ok(maximum<=16);assert.deepEqual(phases,puts ? ['prepare','prepare','verify'] : ['prepare','prepare']);
        const {tsImport}=createRequire(resolve(root,'../remix/package.json'))('tsx/esm/api');
        const shared=await tsImport(resolve(root,'../remix/app/fileSync/uploadBatch.ts'),{parentURL:import.meta.url,tsconfig:resolve(root,'../remix/tsconfig.json')});
        assert.ok(shared.parseNativeUploadBatchResult(result.uploadedBatch,{descriptor,digest}));
        console.log(JSON.stringify({proof:'NATIVE_BULK_HOST_HTTP_PASS',members:count,bytes:count*1024,pathComponents:nested?8:1,ancestorSiblings:nested?32:0,counts:{accepted:result.uploadedBatch.payloads.filter(p=>p.bytes>0).length,verified:result.uploadedBatch.results.filter(r=>r.status==='verified').length,sourceFailure:result.uploadedBatch.results.filter(r=>r.code==='source-changed').length,deadline:result.uploadedBatch.results.filter(r=>r.code==='deadline').length},elapsedMs,bulkLaunches,identityHTTP:identities,accountHTTP:accounts,puts,maximum,phases,synthetic:'identity/API/provider; real native source IO, duplex and host/parser HTTP; no canonical commit or installed IPC'}));
    } finally {child.stdin.end();await once(child,'exit');server.close();}
}
