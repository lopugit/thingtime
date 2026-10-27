const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),scenario=process.argv[2]||'small-note-file';
const output=path.join(root,process.env.TT_NATIVE_ARTIFACT_ROOT||'artifacts/anonymous-local-first-2026-10-27-vault-memory',scenario);
const image='sha256:5c17ff3d0158b726b014ea37d18286ed6bf9187db9f650ff51e17b35f4a315be';
const cli='/Users/lopu/Applications/Thingtime.app/Contents/Resources/agent-browser.mjs',dockerSocket='/Users/lopu/.colima/thingtime-agents/docker.sock';
const {DockerEngine,verifyContainerBoundary}=require('../../electron/lib/agent-browsers/containers.cjs');
(async()=>{
 await fs.mkdir(output,{recursive:true});const state=await fs.mkdtemp('/tmp/tt-continuation-native-');await fs.chmod(state,0o700);
 const socket=path.join(state,'control.sock'),lease=path.join(state,'lease.json');
 const host=spawn(process.execPath,[path.join(root,'electron/scripts/test-agent-browser-host.cjs'),state,socket,dockerSocket,image,'4096'],{stdio:['ignore','pipe','pipe']});
 const ready=new Promise((resolve,reject)=>{host.stdout.on('data',b=>{if(b.toString().includes('"ready":true'))resolve()});host.once('exit',code=>reject(Error('Fixture manager exited '+code)));host.stderr.on('data',b=>process.stderr.write(b));});
 const call=(command,input={},claimed=true)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,command,'--socket',socket,...claimed?['--lease-file',lease]:[]],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('exit',code=>{if(code)return reject(Error(command+': '+err));try{resolve(JSON.parse(out))}catch{reject(Error('Invalid manager response'))}});child.stdin.end(JSON.stringify(input));});
 let claimed=false,engine,session,id,failed;
 try{
  await ready;const manifest=await call('manifest',{},false);for(const f of ['agent.browsers','agent.network-policy'])if(!/^1\./.test(manifest.features?.[f]||''))throw Error('Incompatible '+f);
  await call('status',{},false);const assignments=JSON.parse(await fs.readFile(path.join(state,'assignments.json'),'utf8'));
  await call('claim',assignments.assignments[0]);claimed=true;const launched=await call('launch');session=launched.sessionId;
  engine=await new DockerEngine({executable:'/opt/homebrew/bin/docker',socketPath:dockerSocket,stateRoot:state}).initialize();
  const ids=(await engine.run(['ps','-q','--filter',`label=com.thingtime.agent.session=${session}`])).trim().split(/\s+/).filter(Boolean);if(ids.length!==1)throw Error('Expected exactly one runtime');id=ids[0];
  const inspect=JSON.parse(await engine.run(['inspect',id]))[0];verifyContainerBoundary(inspect,session);
  const boundary={session,image,network:inspect.HostConfig.NetworkMode,mounts:inspect.Mounts,ports:inspect.HostConfig.PortBindings,readOnly:inspect.HostConfig.ReadonlyRootfs,memoryBytes:inspect.HostConfig.Memory,cpu:inspect.HostConfig.NanoCpus};
  await fs.writeFile(path.join(output,'boundary.json'),JSON.stringify(boundary,null,2));
  const tabs=await call('browser',{operation:'tabs'});for(const tab of tabs.tabs||tabs)await call('browser',{operation:'closePage',args:{pageId:tab.id||tab.pageId}});
  const archive=await fs.readFile(path.join(__dirname,'vault-file-app.tar.gz'));
  await engine.run(['exec','-i',id,'tar','-xzf','-','-C','/tmp'],{input:archive});
  await engine.run(['exec',id,'node','-e',"(async()=>{const fs=require('fs');await require('/opt/thingtime-browser/prepare-native.cjs').prepareNative('/tmp/app','/opt/thingtime-browser');fs.symlinkSync('/opt/thingtime-mcp/MCP/node_modules','/tmp/check/MCP/node_modules');fs.mkdirSync('/tmp/check/remix/dist',{recursive:true});fs.symlinkSync('/tmp/app/public/draft-preview','/tmp/check/remix/dist/draft-preview');fs.mkdirSync('/tmp/native-artifacts',{recursive:true});})().catch(e=>{console.error(e.message);process.exitCode=1})"]);
  const origin='http://127.0.0.1:18724';
  const serverScript=`
   const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),fs=require('node:fs/promises');
   const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/pwuser',TMPDIR:'/tmp',NODE_OPTIONS:'--max-old-space-size=256',NODE_ENV:'production',HOST:'127.0.0.1',NITRO_HOST:'127.0.0.1',PORT:'18724',NITRO_PORT:'18724',APP_URL:'${origin}',JWT_ISSUER:'${origin}',JWT_SECRET:randomBytes(48).toString('base64url'),THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR:'/home/pwuser/continuation-attachments',THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN:'${origin}',THINGTIME_AGENT_TEST_MODE:'1',THINGTIME_AGENT_TEST_SESSION:'${session}',MONGODB_CONNECTION_STRING:'mongodb://127.0.0.1:27017/thingtime?replicaSet=tt-agent-${session}'};
   const start=()=>{const log=require('node:fs').openSync('/tmp/server-private.log','a',0o600);const value=spawn(process.execPath,['/tmp/app/server/index.mjs'],{detached:true,stdio:['ignore',log,log],env});require('node:fs').closeSync(log);value.once('exit',(code,signal)=>require('node:fs').appendFileSync('/tmp/server-exits.jsonl',JSON.stringify({pid:value.pid,code,signal})+'\\n'));return value;};let child=start();
   const ready=async()=>{for(let n=0;n<180;n++){try{const h=await fetch('${origin}/api/v1/health/nitro',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(h.state==='ready'&&h.storageAccounting?.state==='ready'&&h.testEnvironment?.sessionId==='${session}')return;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Current package startup failed');};
   (async()=>{await ready();if(${JSON.stringify(scenario)}==='shared'){
    const username='tt-fixture-admin-'+randomBytes(6).toString('hex'),password='Task-'+randomBytes(32).toString('base64url')+'-9a!';
    const request=(pathname,body)=>fetch('${origin}'+pathname,{method:'POST',redirect:'error',headers:{Origin:'${origin}','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const response=await request('/api/v1/auth/register',{username,password,email:username+'@example.test'}),registered=await response.json();
    if(!response.ok||!registered.user?.id||registered.user.isAdmin!==false)throw Error('Synthetic administrator registration failed');
    env.ADMIN_USERNAMES=username;
    await new Promise(resolve=>{const force=setTimeout(()=>child.kill('SIGKILL'),10000);child.once('exit',()=>{clearTimeout(force);resolve()});child.kill('SIGTERM')});child=start();await ready();
    const login=await request('/api/v1/login',{username,password}),authenticated=await login.json();
    if(!login.ok||authenticated.user?.id!==registered.user.id||authenticated.user.isAdmin!==true)throw Error('Synthetic administrator verification failed');
    await fs.writeFile('/home/pwuser/continuation-admin-fixture.json',JSON.stringify({base:'${origin}',sessionId:'${session}',username,password,ownerId:registered.user.id}),{mode:0o600});
   }await fs.writeFile('/tmp/server-ready.json',JSON.stringify({ok:true,pid:child.pid}));})().catch(async e=>{await fs.writeFile('/tmp/server-start-failure.json',JSON.stringify({error:e.message}));child.kill('SIGTERM');process.exitCode=1});
  `;
  await engine.run(['exec','-i',id,'node','-e',"const fs=require('fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>fs.writeFileSync('/tmp/server-supervisor.cjs',input,{mode:0o600}));"],{input:serverScript});
  await engine.run(['exec','-d',id,'node','/tmp/server-supervisor.cjs']);
  await engine.run(['exec',id,'node','-e',"(async()=>{const fs=require('fs');for(let n=0;n<240;n++){if(fs.existsSync('/tmp/server-start-failure.json'))throw Error('Isolated server bootstrap failed');if(fs.existsSync('/tmp/server-ready.json'))return;await new Promise(r=>setTimeout(r,500));}throw Error('Isolated server bootstrap timed out')})().catch(e=>{console.error(e.message);process.exitCode=1});"],{timeoutMs:125000});

  console.log('Current package ready; running '+scenario);
  await fs.writeFile(path.join(output,'package.json'),JSON.stringify({applicationTarSha256:createHash('sha256').update(archive).digest('hex'),session,origin,source:'current sanitized package in task tmpfs'},null,2));
  const browser=JSON.parse(await engine.run(['exec',id,'cat','/opt/thingtime-browser/browser.json']));
  const puppeteerPath=(await engine.run(['exec',id,'node','-p',"require.resolve('puppeteer-core',{paths:['/opt/thingtime-browser']})"])).trim();
  let networkOutput='';
  const network=await engine.run(['exec',id,'node','-e',`
   (async()=>{const assert=require('node:assert/strict'),net=require('node:net'),http=require('node:http'),os=require('node:os');
   assert.ok(Object.values(os.networkInterfaces()).flat().every(a=>a.internal));
   const hosts=['203.0.113.1','::ffff:203.0.113.1','2001:db8::1','blocked.invalid'],denied=[];
   for(const host of hosts){const code=await new Promise(resolve=>{const s=net.connect({host,port:443});const timer=setTimeout(()=>{s.destroy();resolve('BOUNDED_TIMEOUT')},1500);s.once('connect',()=>{clearTimeout(timer);s.destroy();resolve('CONNECTED')});s.once('error',e=>{clearTimeout(timer);resolve(e.code)})});assert.ok(['ENETUNREACH','EHOSTUNREACH','EACCES','EPERM','EAFNOSUPPORT','ENOTFOUND','EAI_AGAIN',...(host==='blocked.invalid'?['BOUNDED_TIMEOUT']:[])].includes(code),host+':'+code);denied.push({host,code});console.error('Egress check '+host+': '+code);}
   const server=http.createServer((q,r)=>{r.writeHead(302,{Location:'http://203.0.113.1/'});r.end()});await new Promise(r=>server.listen(18725,'127.0.0.1',r));
   console.error('Checking backend redirect');await assert.rejects(fetch('http://127.0.0.1:18725/',{signal:AbortSignal.timeout(3000)}));
   const {default:puppeteer}=await import(${JSON.stringify(puppeteerPath)});
   console.error('Launching isolated browser');const browser=await puppeteer.launch({executablePath:${JSON.stringify(browser.executable)},headless:true,pipe:true,protocolTimeout:15000,args:['--no-proxy-server','--disable-background-networking']});
   assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));const page=await browser.newPage(),browserDenied=[];console.error('Browser ready');
   try{for(const url of ['http://203.0.113.1/','http://[::ffff:203.0.113.1]/','http://[2001:db8::1]/','http://blocked.invalid/','http://127.0.0.1:18725/']){await assert.rejects(page.goto(url,{timeout:5000}),e=>/ERR_|net::/.test(e.message));browserDenied.push(url);console.error('Browser egress denied '+url);}}finally{console.error('Closing network-proof browser');await browser.close();console.error('Closing network-proof server');server.closeAllConnections();await new Promise(r=>server.close(r));}
   console.log(JSON.stringify({interfaces:['loopback'],denied,browserDenied,backendRedirectDenied:true,chromiumSandbox:true}));process.exit(0);})().catch(e=>{console.error(e.message);process.exit(1)});
  `],{timeoutMs:60000,progress:s=>{networkOutput+=s;process.stdout.write(s)}});
  await fs.writeFile(path.join(output,'network-proof.json'),networkOutput.split('\n').find(line=>line.startsWith('{'))||network);
  const common=['PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',`TT_DRAFT_TEST_SESSION=${session}`,`TT_DRAFT_TEST_BASE=${origin}`,`TT_DRAFT_WEB_BASE=${origin}`,'TT_DRAFT_ARTIFACT_DIR=/tmp/native-artifacts'];
  const invoke=(args,env=[])=>engine.run(['exec',...env.flatMap(v=>['-e',v]),'-w','/tmp/check/MCP',id,'node',...args],{timeoutMs:490000,progress:s=>process.stdout.write(s)});
  const serverCheck=await engine.run(['exec',id,'node','-e',"(async()=>{try{const r=await fetch('http://127.0.0.1:18724/api/v1/health/nitro');console.log('Server before test: '+r.status)}catch{const fs=require('fs');console.log('Server exited: '+(fs.existsSync('/tmp/server-exits.jsonl')?fs.readFileSync('/tmp/server-exits.jsonl','utf8'):'unknown'));const text=fs.readFileSync('/tmp/server-private.log','utf8');console.log(text.split('\\n').filter(line=>/fatal|out of memory|heap limit|FATAL|Error:|SIG|address already|EADDR|uncaught/i.test(line)).map(line=>line.slice(0,200)).slice(-10).join('\\n'));process.exitCode=1}})()"],{progress:s=>process.stdout.write(s)});console.log(serverCheck);
  await engine.run(['exec','-d',id,'node','/tmp/check/memory-observer.cjs']);
  const before=await engine.run(['exec',id,'cat','/sys/fs/cgroup/memory.events']);
  const beforeCpu=await engine.run(['exec',id,'cat','/sys/fs/cgroup/cpu.stat']);
  try{
   if(scenario==='small-note-file'||scenario==='large-note'){
    await invoke(['--test','/tmp/check/memory.test.mjs'],[`TT_PASSWORD_NATIVE_URL=${origin}`,`TT_VAULT_MEMORY_SCENARIO=${scenario}`,'TT_SHARED_PLAYWRIGHT_PATH=/tmp/check/MCP/node_modules/playwright/index.mjs',`TT_SHARED_CHROME_PATH=${browser.executable}`]);
   }else if(scenario==='render'){
    await invoke(['--test','test/render-export.integration.test.mjs'],[...common,'TT_DRAFT_BROWSER_TEST=1']);
    await invoke(['/tmp/check/roundtrip.mjs'],common);
   }else if(scenario==='builder'){
    await invoke(['--test','/tmp/check/blocks.test.mjs'],[`TT_BLOCKS_TEST_ORIGIN=${origin}`,`TT_BLOCKS_TEST_SESSION=${session}`,'TT_BLOCKS_TEST_ARTIFACTS=/tmp/native-artifacts','TT_BLOCKS_TEST_FIXTURE=/tmp/check/blocks.fixture.js',`TT_BLOCKS_PUPPETEER=${puppeteerPath}`,`TT_BLOCKS_CHROME=${browser.executable}`]);
   }else if(scenario==='shared'){
    await invoke(['--test','/tmp/check/shared.test.mjs'],[`TT_SHARED_COPY_ORIGIN=${origin}`,`TT_SHARED_COPY_SESSION=${session}`,'TT_SHARED_COPY_ARTIFACTS=/tmp/native-artifacts','TT_SHARED_COPY_LARGE_FILE=1','TT_SHARED_COPY_ADMIN_FIXTURE=/home/pwuser/continuation-admin-fixture.json','TT_SHARED_COPY_FIXTURE=/tmp/check/shared.fixture.js',`TT_SHARED_COPY_PUPPETEER=${puppeteerPath}`,`TT_SHARED_COPY_CHROME=${browser.executable}`]);
   }else if(scenario==='instructions'||scenario==='paste-compare'){
    await invoke(['--test',scenario==='instructions'?'/tmp/check/instructions.test.mjs':'/tmp/check/paste-compare.test.mjs'],[`TT_LOCAL_INSTRUCTIONS_URL=${origin}`,`TT_RENDER_SESSION=${session}`,'TT_LOCAL_INSTRUCTIONS_ARTIFACTS=/tmp/native-artifacts','TT_SHARED_PLAYWRIGHT_PATH=/tmp/check/MCP/node_modules/playwright/index.mjs',`TT_SHARED_CHROME_PATH=${browser.executable}`]);
   }else if(scenario==='protected'){
    await invoke(['--test','/tmp/check/protected.test.mjs'],[`TT_PROTECTED_RECOVERY_ORIGIN=${origin}`,`TT_PROTECTED_RECOVERY_SESSION=${session}`,'TT_PROTECTED_RECOVERY_ARTIFACTS=/tmp/native-artifacts','TT_PROTECTED_RECOVERY_FIXTURE=/tmp/check/protected.fixture.js',`TT_PROTECTED_RECOVERY_PUPPETEER=${puppeteerPath}`,`TT_PROTECTED_RECOVERY_CHROME=${browser.executable}`]);
   }else throw Error('Unknown native scenario');
  }catch(e){failed=e;}
  const after=await engine.run(['exec',id,'cat','/sys/fs/cgroup/memory.events']);await fs.writeFile(path.join(output,'resources.json'),JSON.stringify({before,after,beforeCpu,afterCpu:await engine.run(['exec',id,'cat','/sys/fs/cgroup/cpu.stat']),memoryCurrent:await engine.run(['exec',id,'cat','/sys/fs/cgroup/memory.current'])},null,2));
  const packed=JSON.parse(await engine.run(['exec',id,'node','-e',"const fs=require('fs'),p='/tmp/native-artifacts';console.log(JSON.stringify(Object.fromEntries(fs.readdirSync(p).map(n=>[n,fs.readFileSync(p+'/'+n).toString('base64')]))));"]));
  for(const[name,data]of Object.entries(packed)){if(path.basename(name)!==name)throw Error('Invalid artifact name');await fs.writeFile(path.join(output,name),Buffer.from(data,'base64'));}
  verifyContainerBoundary(JSON.parse(await engine.run(['inspect',id]))[0],session);
  if(!/oom_kill 0(?:\n|$)/.test(after))throw Error('OOM invalidates acceptance');if(failed)throw failed;
 }finally{
  if(claimed)await call('release');
  if(engine&&session){const remaining=(await engine.run(['ps','-aq','--filter',`label=com.thingtime.agent.session=${session}`])).trim();await fs.writeFile(path.join(output,'cleanup.json'),JSON.stringify({session,remaining},null,2));if(remaining)throw Error('Owned runtime remains');}
  host.kill('SIGTERM');await new Promise(resolve=>host.once('exit',resolve));await fs.rm(state,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
