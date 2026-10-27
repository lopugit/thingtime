const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'artifacts/anonymous-vault-status-2026-10-27/plan');
const image='sha256:5c17ff3d0158b726b014ea37d18286ed6bf9187db9f650ff51e17b35f4a315be',dockerSocket='/Users/lopu/.colima/thingtime-agents/docker.sock';
const cli='/Users/lopu/Applications/Thingtime.app/Contents/Resources/agent-browser.mjs';
const {DockerEngine,verifyContainerBoundary}=require('../../electron/lib/agent-browsers/containers.cjs');
(async()=>{
 await fs.mkdir(output,{recursive:true}); const state=await fs.mkdtemp('/tmp/tt-plan-review-');await fs.chmod(state,0o700);
 const socket=path.join(state,'control.sock'),lease=path.join(state,'lease.json');
 const host=spawn(process.execPath,[path.join(root,'electron/scripts/test-agent-browser-host.cjs'),state,socket,dockerSocket,image,'2048'],{stdio:['ignore','pipe','pipe']});
 const ready=new Promise((resolve,reject)=>{host.stdout.on('data',b=>{if(b.toString().includes('"ready":true'))resolve()});host.once('exit',c=>reject(Error('Fixture manager exited '+c)));host.stderr.on('data',b=>process.stderr.write(b));});
 const call=(command,input={},claimed=true)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,command,'--socket',socket,...claimed?['--lease-file',lease]:[]],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('exit',c=>{if(c)return reject(Error(command+': '+err));try{resolve(JSON.parse(out))}catch{reject(Error('Invalid manager response'))}});child.stdin.end(JSON.stringify(input));});
 let claimed=false,engine,session,id;
 try{
  await ready; const manifest=await call('manifest',{},false);for(const feature of ['agent.browsers','agent.network-policy'])if(!/^1\./.test(manifest.features?.[feature]||''))throw Error('Incompatible '+feature);
  await call('status',{},false);const assignments=JSON.parse(await fs.readFile(path.join(state,'assignments.json'),'utf8'));await call('claim',assignments.assignments[0]);claimed=true;session=(await call('launch')).sessionId;
  engine=await new DockerEngine({executable:'/opt/homebrew/bin/docker',socketPath:dockerSocket,stateRoot:state}).initialize();
  const ids=(await engine.run(['ps','-q','--filter',`label=com.thingtime.agent.session=${session}`])).trim().split(/\s+/).filter(Boolean);if(ids.length!==1)throw Error('Expected one runtime');id=ids[0];
  const inspect=JSON.parse(await engine.run(['inspect',id]))[0];verifyContainerBoundary(inspect,session);
  const browser=JSON.parse(await engine.run(['exec',id,'cat','/opt/thingtime-browser/browser.json']));
  const source=await fs.readFile(path.join(root,'docs/progress/anonymous-local-first.html'));
  const original=await fs.readFile(path.join(root,'artifacts/anonymous-local-first-2026-10-23/plan/thingtime-plan-acceptance.mjs'),'utf8');
  let test=original.replace("'/workspace/thingtime/MCP/node_modules/playwright/index.mjs'","'/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs'").replace("'/usr/lib/chromium/chromium'",JSON.stringify(browser.executable));
  test=test.replace("active === 'p0' ? task.dataset.priority === 'P0' : task.dataset.status === active", "active === 'p0' ? task.dataset.priority === 'P0' : active === 'todo' ? task.dataset.status !== 'done' : task.dataset.status === active");
  test=test.replace("filters.push({ filter, count: result.visible });", "assert.equal(await page.locator('#current26').isVisible(), true, 'Current verification stays visible while filtering'); filters.push({ filter, count: result.visible });");
  test=test.replace("section.hidden === !section.querySelector('.task:not([hidden])')", "section.hidden === (Boolean(section.querySelector('.task')) && !section.querySelector('.task:not([hidden])'))");
  // Add a bounded complete scroll traversal, retaining the reusable filter/search checks.
  test=test.replace("await page.screenshot({ path: resolve(artifactDir, `plan-${width}-top.png`) });",`await page.screenshot({ path: resolve(artifactDir, \`plan-\${width}-top.png\`) });
    const traversal = await page.evaluate(async () => { let steps=0; for(let y=0;y<document.documentElement.scrollHeight;y+=Math.max(1,innerHeight-120)){ if(++steps>100)throw Error('Unbounded page');scrollTo(0,y);await new Promise(r=>requestAnimationFrame(r));if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Scroll overflow');}scrollTo(0,0);return steps; });`);
  test=test.replace('report.viewports.push({ width, counts,','report.viewports.push({ width, traversal, counts,');
  await fs.writeFile(path.join(output,'thingtime-plan-acceptance.mjs'),test);
  console.log('Preparing plan payload'); const payload={html:source.toString('base64'),test:Buffer.from(test).toString('base64')};
  await engine.run(['exec','-i',id,'node','-e',"let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const fs=require('fs'),v=JSON.parse(s);fs.mkdirSync('/tmp/plan',{recursive:true});fs.writeFileSync('/tmp/plan/anonymous-local-first.html',Buffer.from(v.html,'base64'));fs.writeFileSync('/tmp/plan/acceptance.mjs',Buffer.from(v.test,'base64'));});"],{input:JSON.stringify(payload),timeoutMs:60000});
  console.log('Checking enforced network boundary'); const network=await engine.run(['exec',id,'node','-e',`(async()=>{const assert=require('assert/strict'),net=require('net'),os=require('os'),http=require('http');assert.ok(Object.values(os.networkInterfaces()).flat().every(a=>a.internal));const denied=[];for(const host of ['203.0.113.1','::ffff:203.0.113.1','2001:db8::1']){const result=await new Promise(resolve=>{const s=net.connect({host,port:443});const t=setTimeout(()=>{s.destroy();resolve('TIMEOUT')},1500);s.once('connect',()=>{clearTimeout(t);s.destroy();resolve('CONNECTED')});s.once('error',e=>{clearTimeout(t);resolve(e.code)})});assert.ok(['ENETUNREACH','EHOSTUNREACH','EPERM','EACCES','EAFNOSUPPORT'].includes(result));denied.push({host,result});}const server=http.createServer((q,r)=>{r.writeHead(302,{Location:'http://203.0.113.1/'});r.end()});await new Promise(r=>server.listen(18725,'127.0.0.1',r));try{await assert.rejects(fetch('http://127.0.0.1:18725/',{signal:AbortSignal.timeout(2500)}));const {chromium}=await import('/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs');const b=await chromium.launch({executablePath:${JSON.stringify(browser.executable)},headless:true,chromiumSandbox:true});try{const page=await b.newPage();await assert.rejects(page.goto('http://127.0.0.1:18725/',{timeout:4000}));}finally{await b.close();}console.log(JSON.stringify({denied,backendRedirectDenied:true,browserRedirectDenied:true,sandbox:true}));}finally{server.close();}})().catch(e=>{console.error(e.message);process.exitCode=1})`],{timeoutMs:45000});
  await fs.writeFile(path.join(output,'network.json'),network);
  await fs.writeFile(path.join(output,'security-package-source.json'),JSON.stringify({capturedAt:new Date().toISOString(),sourcePath:'docs/progress/anonymous-local-first.html',sourceSha256:createHash('sha256').update(source).digest('hex'),acceptanceSourceSha256:createHash('sha256').update(test).digest('hex'),runtimeImage:image,scope:'Copied static HTML only; no application package or account state',session,browser,network:inspect.HostConfig.NetworkMode,mounts:inspect.Mounts,ports:inspect.HostConfig.PortBindings,readOnly:inspect.HostConfig.ReadonlyRootfs,capDrop:inspect.HostConfig.CapDrop,securityOpt:inspect.HostConfig.SecurityOpt},null,2));
  await fs.writeFile(path.join(output,'anonymous-local-first.html'),source);
  console.log('Running page validation'); let failure;
  try{await engine.run(['exec',id,'node','/tmp/plan/acceptance.mjs','/tmp/plan'],{timeoutMs:90000,progress:s=>process.stdout.write(s)});}catch(e){failure=e;}
  const packed=JSON.parse(await engine.run(['exec',id,'node','-e',"const fs=require('fs'),p='/tmp/plan';console.log(JSON.stringify(Object.fromEntries(fs.readdirSync(p).filter(n=>n.endsWith('.png')||n==='verification.json').map(n=>[n,fs.readFileSync(p+'/'+n).toString('base64')]))));"]));
  for(const[name,data]of Object.entries(packed)){if(path.basename(name)!==name)throw Error('Unsafe filename');await fs.writeFile(path.join(output,name),Buffer.from(data,'base64'));}
  verifyContainerBoundary(JSON.parse(await engine.run(['inspect',id]))[0],session);if(failure)throw failure;
 }finally{
  if(claimed)await call('release');if(engine&&session){const remaining=(await engine.run(['ps','-aq','--filter',`label=com.thingtime.agent.session=${session}`])).trim();await fs.writeFile(path.join(output,'cleanup.json'),JSON.stringify({session,remaining},null,2));if(remaining)throw Error('Owned runtime remains');}
  host.kill('SIGTERM');await new Promise(r=>host.once('exit',r));await fs.rm(state,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
