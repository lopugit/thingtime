const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const providerSource = fs.readFileSync(path.join(__dirname, '../lib/password-provider.cjs'), 'utf8');
// Exercise the real bridge on every CI host with synthetic helpers only. The
// process stand-in is confined to this module's VM; product platform checks and
// the host process remain unchanged. This does not exercise macOS AutoFill.
function loadPasswordProvider(platform = 'darwin', childProcess) {
 const context = {module: {exports: {}}, process: {platform, resourcesPath: '/fixture'}, URL, setTimeout, clearTimeout,
  require: name => name === 'node:child_process' && childProcess ? childProcess : require(name)};
 vm.runInNewContext(providerSource, context, {filename: 'password-provider.cjs'});
 return context.module.exports;
}
const { createPasswordProvider, requirePasswordSender } = loadPasswordProvider();
test('password bridge only accepts the active main frame at the configured HTTPS origin', () => {
 const mainFrame = { url: 'https://thingtime.example/passwords' }, event = { senderFrame: mainFrame, sender: { mainFrame } };
 assert.doesNotThrow(() => requirePasswordSender(event, 'https://thingtime.example'));
 assert.throws(() => requirePasswordSender({ ...event, senderFrame: { url: mainFrame.url } }, 'https://thingtime.example'));
 assert.throws(() => requirePasswordSender(event, 'https://other.example'));
 assert.throws(() => requirePasswordSender({ ...event, senderFrame: null }, 'https://thingtime.example'));
 mainFrame.url = 'http://thingtime.example/passwords'; assert.throws(() => requirePasswordSender(event, 'http://thingtime.example'));
});

test('endpoint disconnect runs after an outstanding native connect', async () => {
 const calls = []; let finish;
 const mainFrame = {url:'https://thingtime.example/passwords'};
 const sender = {mainFrame, session:{cookies:{get:async()=>[{httpOnly:true, secure:true,path:'/',value:'synthetic'}]}}};
 const provider = createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example',helper:async (_exe,action)=>{calls.push(action); if(action==='connect') await new Promise(resolve=>{finish=resolve;});}});
 const connected = provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'});
 await new Promise(resolve=>setImmediate(resolve)); const cleared = provider.disconnect();
 assert.deepEqual(calls,['connect']); finish(); await connected; await cleared;
 assert.deepEqual(calls,['connect','disconnect']);
});


test('local runtime cannot send a local session to native HTTPS AutoFill', async () => {
 const mainFrame = {url:'http://127.0.0.1:28631/passwords'};
 let cookies = 0, helpers = 0;
 const sender = {mainFrame, session:{cookies:{get:async()=>{cookies++; return [];}}}};
 const provider = createPasswordProvider({app:{isPackaged:true},root:'/fixture',origin:()=> 'http://127.0.0.1:28631',endpoint:()=> 'http://127.0.0.1:28631',helper:async()=>{helpers++;}});
 await assert.rejects(provider({sender,senderFrame:mainFrame},{action:'connect',ownerId:'fixture'}), /HTTPS account endpoint/);
 assert.equal(cookies,0); assert.equal(helpers,0);
});

test('runtime restart disconnect prevents later native connections', async () => {
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


test('failed native credential clearing blocks authority change while allowing disconnect retry', async () => {
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

test('a user disconnect never returns success after native failure and the same action is retryable', async () => {
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

test('native helper nonzero exit rejects disconnect and a later successful exit can retry', async () => {
 const {EventEmitter} = require('node:events');
 let attempts = 0;
 const fakeChildProcess = {
  spawn: (_executable, args, options) => {
   assert.deepEqual(Array.from(args),['--disconnect']);
   assert.deepEqual(Array.from(options.stdio),['pipe','ignore','ignore']);
   const child = new EventEmitter(); child.kill = () => {};
   child.stdin = new EventEmitter(); child.stdin.end = value => {
    assert.equal(value,''); const status = ++attempts === 1 ? 1 : 0;
    setImmediate(() => child.emit('exit',status));
   };
   return child;
  }
 };
 const isolated = loadPasswordProvider('darwin', fakeChildProcess);
 const mainFrame = {url:'https://thingtime.example/passwords'},sender = {mainFrame};
 const provider = isolated.createPasswordProvider({app:{isPackaged:false},root:'/fixture',origin:()=> 'https://thingtime.example',endpoint:()=> 'https://thingtime.example'});
 const event = {sender,senderFrame:mainFrame};
 await assert.rejects(provider(event,{action:'disconnect'}), /Could not connect Password AutoFill/);
 assert.equal((await provider(event,{action:'disconnect'})).ok,true);
 assert.equal(attempts,2);
});


test('unsupported platforms refuse native connections without reading credentials', async () => {
 const {createPasswordProvider: createUnsupportedProvider} = loadPasswordProvider('linux');
 const mainFrame = {url: 'https://thingtime.example/passwords'};
 const sender = {mainFrame, session: {cookies: {get: async () => assert.fail('must not read cookies')}}};
 const provider = createUnsupportedProvider({app: {isPackaged: false}, root: '/fixture', origin: () => 'https://thingtime.example', endpoint: () => 'https://thingtime.example', helper: async () => assert.fail('must not launch a helper')});
 await assert.rejects(provider({sender, senderFrame: mainFrame}, {action: 'connect', ownerId: 'fixture'}), /Unsupported Password AutoFill/);
 await provider.disconnect();
});
