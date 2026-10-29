const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordProvider, requirePasswordSender } = require('../lib/password-provider.cjs');
test('password bridge only accepts the active main frame at the configured HTTPS origin', () => {
 const mainFrame = { url: 'https://thingtime.example/passwords' }, event = { senderFrame: mainFrame, sender: { mainFrame } };
 assert.doesNotThrow(() => requirePasswordSender(event, 'https://thingtime.example'));
 assert.throws(() => requirePasswordSender({ ...event, senderFrame: { url: mainFrame.url } }, 'https://thingtime.example'));
 assert.throws(() => requirePasswordSender(event, 'https://other.example'));
 assert.throws(() => requirePasswordSender({ ...event, senderFrame: null }, 'https://thingtime.example'));
 mainFrame.url = 'http://thingtime.example/passwords'; assert.throws(() => requirePasswordSender(event, 'http://thingtime.example'));
});

test('endpoint disconnect runs after an outstanding native connect', {skip: process.platform !== 'darwin'}, async () => {
 const calls = []; let finish;
 const mainFrame = {url:'https://thingtime.example/passwords'};
 const sender = {mainFrame, session:{cookies:{get:async()=>[{httpOnly:true, secure:true,path:'/',value:'synthetic'}]}}};
 const provider = createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async (_exe,action)=>{calls.push(action); if(action==='connect') await new Promise(resolve=>{finish=resolve;});}});
 const connected = provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'});
 await new Promise(resolve=>setImmediate(resolve)); const cleared = provider.disconnect();
 assert.deepEqual(calls,['connect']); finish(); await connected; await cleared;
 assert.deepEqual(calls,['connect','disconnect']);
});


test('local runtime cannot send a local session to native HTTPS AutoFill', {skip: process.platform !== 'darwin'}, async t => {
 const previousResourcesPath = process.resourcesPath; process.resourcesPath = '/fixture';
 t.after(() => { if (previousResourcesPath === undefined) delete process.resourcesPath; else process.resourcesPath = previousResourcesPath; });
 const mainFrame = {url:'http://127.0.0.1:28631/passwords'};
 let cookies = 0, helpers = 0;
 const sender = {mainFrame, session:{cookies:{get:async()=>{cookies++; return [];}}}};
 const provider = createPasswordProvider({app:{isPackaged:true},root:'/fixture',origin:()=> 'http://127.0.0.1:28631',endpoint:()=> 'http://127.0.0.1:28631',helper:async()=>{helpers++;}});
 await assert.rejects(provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'}), /HTTPS account endpoint/);
 assert.equal(cookies,0); assert.equal(helpers,0);
});

test('runtime restart disconnect prevents later native connections', {skip: process.platform !== 'darwin'}, async () => {
 const mainFrame = {url:'https://thingtime.example/passwords'};
 const calls = [];
 const sender = {mainFrame, session:{cookies:{get:async()=>{throw new Error('must not read cookies');}}}};
 const provider = createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async(_exe,action)=>{calls.push(action);}});
 const stopped=provider.disconnect();
 await assert.rejects(provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'}), /restarting/);
 await stopped; assert.deepEqual(calls,['disconnect']);
});

test('native provider uses the running authority and restarts await disconnect', async () => {
 const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
 const source = fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
 const endpoint = source.match(/function activeAccountEndpoint\(\) \{[\s\S]*?\n\}/)[0];
 const context = {localRuntime:{runningEnabled:false},appOrigin:'http://127.0.0.1:28631',activeApiEndpoint:'https://running.test'};
 assert.equal(vm.runInNewContext(endpoint+'; activeAccountEndpoint()',context),'https://running.test');
 context.localRuntime.runningEnabled=true;
 assert.equal(vm.runInNewContext(endpoint+'; activeAccountEndpoint()',context),'http://127.0.0.1:28631');
 assert.match(source,/endpoint: activeAccountEndpoint/);
 assert.match(source,/localRuntime\.configure\(request, \(\) => passwordProvider\.disconnect\(\)\)/);
 assert.match(source,/localRuntime\.snapshot\(\)\.enabled\) await passwordProvider\.disconnect\(\)/);
 assert.match(source,/await passwordProvider\.disconnect\(\);\n await settings\.selectEndpoint\(target\.id\)/);
 const restart = source.match(/async function restartDesktopRuntime\(\) \{[\s\S]*?\n\}/)[0];
 const calls=[]; let finish;
 const running=vm.runInNewContext(restart+'; restartDesktopRuntime()', {authorityTransition:{retainUntilRestart(){calls.push('retain');}},mainWindow:{webContents:{stop(){calls.push('stop');}}},passwordProvider:{disconnect(){calls.push('disconnect');return new Promise(resolve=>{finish=resolve;});}},parallelDevMode:false,app:{relaunch(){calls.push('relaunch');},quit(){calls.push('quit');}}});
 assert.deepEqual(calls,['stop','disconnect']); finish(); await running;
 assert.deepEqual(calls,['stop','disconnect','retain','relaunch','quit']);
 assert.match(source,/restart-runtime', async \(event\) => \{[^\n]*await restartDesktopRuntime\(\)/);
});


test('failed native credential clearing blocks authority change while allowing disconnect retry', {skip: process.platform !== 'darwin'}, async () => {
 const mainFrame = {url:'https://thingtime.example/passwords'};
 let cookies = 0; const calls = [];
 const sender = {mainFrame,session:{cookies:{get:async()=>{cookies++;throw new Error('must not read cookies');}}}};
 const provider = createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async(_exe,action)=>{
  calls.push(action); if(calls.length===1) throw new Error('Password AutoFill could not be disconnected.');
 }});
 await assert.rejects(provider.disconnect(), /could not be disconnected/);
 await assert.rejects(provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'}), /restarting/);
 assert.equal(cookies,0);
 await provider.disconnect();
 assert.deepEqual(calls,['disconnect','disconnect']);
});

test('a user disconnect never returns success after native failure and the same action is retryable', {skip: process.platform !== 'darwin'}, async () => {
 const mainFrame = {url:'https://thingtime.example/passwords'}, sender = {mainFrame};
 let attempts = 0;
 const provider = createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async()=>{
  if(++attempts===1) throw new Error('Password AutoFill could not be disconnected.');
 }});
 const event = {sender,senderFrame:mainFrame};
 await assert.rejects(provider(event,{action:'disconnect'}), /could not be disconnected/);
 assert.equal((await provider(event,{action:'disconnect'})).ok,true);
 assert.equal(attempts,2);
});

test('native helper nonzero exit rejects disconnect and a later successful exit can retry', {skip: process.platform !== 'darwin'}, async () => {
 const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), {EventEmitter} = require('node:events');
 const source = fs.readFileSync(path.join(__dirname,'../lib/password-provider.cjs'),'utf8');
 let attempts = 0;
 const context = {module:{exports:{}},process,URL,setTimeout,clearTimeout,require: name => name === 'node:child_process' ? {
  spawn: (_executable, args, options) => {
   assert.deepEqual(Array.from(args),['--disconnect']);
   assert.deepEqual(Array.from(options.stdio),['pipe','ignore','ignore']);
   const child = new EventEmitter(); child.kill = () => {};
   child.stdin = new EventEmitter(); child.stdin.end = value => {
    assert.equal(value,''); const status = ++attempts === 1 ? 1 : 0;
    setImmediate(() => child.emit('close',status));
   };
   return child;
  }
 } : require(name)};
 vm.runInNewContext(source,context);
 const mainFrame = {url:'https://thingtime.example/passwords'},sender = {mainFrame};
 const provider = context.module.exports.createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example'});
 const event = {sender,senderFrame:mainFrame};
 await assert.rejects(provider(event,{action:'disconnect'}), /Could not check or update Password AutoFill/);
 assert.equal((await provider(event,{action:'disconnect'})).ok,true);
 assert.equal(attempts,2);
});

test('status is read-only, account-scoped, closed and re-read on every request', {skip: process.platform !== 'darwin'}, async () => {
 const mainFrame = {url:'https://thingtime.example/passwords'};
 const sender = {mainFrame,session:{cookies:{get:async()=>[{httpOnly:true,secure:true,path:'/',value:'synthetic'}]}}};
 const calls=[]; let state='connected';
 const provider=createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://service.example',helper:async(_exe,action,value)=>{calls.push(action);assert.equal(value.ownerId,'fixture');assert.equal(value.origin,'https://service.example');return state;}});
 const event={sender,senderFrame:mainFrame};
 for (state of ['connected','disconnected','differentSession','unavailable','unrecognized']) {
  assert.deepEqual(await provider(event,{action:'status',ownerId:'fixture'}),{ok:true,connection:state==='unrecognized'?'unavailable':state});
 }
 assert.deepEqual(calls,Array(5).fill('status'));
 const result=await provider(event,{action:'status'});
 assert.deepEqual(result,{ok:true,connection:'unavailable'});
 assert.equal(calls.length,5,'Missing identity must never trigger disconnect');
});

test('status rejects a reply after an origin change and safely handles helper failure', {skip: process.platform !== 'darwin'}, async () => {
 const mainFrame={url:'https://thingtime.example/passwords'},sender={mainFrame,session:{cookies:{get:async()=>[{httpOnly:true,secure:true,path:'/',value:'synthetic'}]}}};
 let origin='https://thingtime.example',release;
 const provider=createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=>origin,endpoint:()=>origin,helper:async()=>new Promise(resolve=>{release=resolve;})});
 const pending=provider({sender,senderFrame:mainFrame},{action:'status',ownerId:'fixture'});
 await new Promise(resolve=>setImmediate(resolve)); origin='https://other.example'; release('connected');
 await assert.rejects(pending,/endpoint changed/);
 origin='https://thingtime.example';
 const failed=createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=>origin,endpoint:()=>origin,helper:async()=>{throw new Error('private detail must never escape');}});
 assert.deepEqual(await failed({sender,senderFrame:mainFrame},{action:'status',ownerId:'fixture'}),{ok:true,connection:'unavailable'});
});

test('status helper stdout accepts only closed JSON state and never returns additional data', async () => {
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{EventEmitter}=require('node:events');
 let output='"connected"';
 const context={module:{exports:{}},process,URL,setTimeout,clearTimeout,require:name=>name==='node:child_process'?{spawn:(_exe,args,options)=>{
  assert.deepEqual(Array.from(args),['--status']);assert.deepEqual(Array.from(options.stdio),['pipe','pipe','ignore']);
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};
  child.stdin.end=()=>setImmediate(()=>{child.stdout.emit('data',Buffer.from(output));child.emit('close',0);});return child;
 }}:require(name)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/password-provider.cjs'),'utf8')+';module.exports.runHelper=runHelper;',context);
 const run=context.module.exports.runHelper;
 assert.equal(await run('/fixture','status',{}),'connected');
 for(output of ['{"connection":"connected","unexpected":"synthetic-private"}','not JSON','"invalid"',' '.repeat(4097)]) {
  await assert.rejects(run('/fixture','status',{}),/Password AutoFill/);
 }
});


test('local endpoint status and automatic sync explain the origin without touching an existing native link', {skip: process.platform !== 'darwin'}, async t => {
 const previous=process.resourcesPath; process.resourcesPath='/fixture'; t.after(()=>{if(previous===undefined) delete process.resourcesPath; else process.resourcesPath=previous;});
 const mainFrame={url:'http://127.0.0.1:28630/passwords'}, sender={mainFrame,session:{cookies:{get:async()=>{throw new Error('must not read local credentials');}}}};
 const provider=createPasswordProvider({app:{isPackaged:true},root:'/fixture',origin:()=> 'http://127.0.0.1:28630',endpoint:()=> 'http://127.0.0.1:28630',helper:async()=>{throw new Error('must preserve existing provider');}});
 for(const action of ['status','sync']) assert.deepEqual(await provider({sender,senderFrame:mainFrame},{action,ownerId:'fixture'}),{ok:true,connection:'unsupportedOrigin'});
});

test('automatic logout and runtime retirement are distinguished from explicit user disconnect', {skip: process.platform !== 'darwin'}, async () => {
 const mainFrame={url:'https://thingtime.example/passwords'},sender={mainFrame};
 const calls=[];
 const provider=createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async(_exe,action,value)=>{calls.push([action,value]);}});
 await provider({sender,senderFrame:mainFrame},{action:'sync'});
 await provider({sender,senderFrame:mainFrame},{action:'disconnect'});
 await provider.disconnect();
 assert.deepEqual(calls,[['disconnect',{automatic:true,origin:'https://thingtime.example'}],['disconnect',undefined],['disconnect',{automatic:true,origin:'https://thingtime.example'}]]);
});
