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
 const running=vm.runInNewContext(restart+'; restartDesktopRuntime()', {mainWindow:{webContents:{stop(){calls.push('stop');}}},passwordProvider:{disconnect(){calls.push('disconnect');return new Promise(resolve=>{finish=resolve;});}},parallelDevMode:false,app:{relaunch(){calls.push('relaunch');},quit(){calls.push('quit');}}});
 assert.deepEqual(calls,['stop','disconnect']); finish(); await running;
 assert.deepEqual(calls,['stop','disconnect','relaunch','quit']);
 assert.match(source,/restart-runtime', async \(event\) => \{[^\n]*await restartDesktopRuntime\(\)/);
});
