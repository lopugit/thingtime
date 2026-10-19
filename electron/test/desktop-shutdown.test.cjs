const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const closeServices = source.match(/async function closeDesktopServices\(\) \{[\s\S]*?\n\}/)[0];
const gate = () => { let finish; const promise = new Promise(resolve => { finish=resolve; }); return {promise, finish}; };

test('immediate service cleanup retries Quit after the native quit dispatch unwinds', async () => {
 const listener = source.match(/app\.on\('before-quit', \(event\) => \{[\s\S]*?\n\}\);/)[0];
 let beforeQuit, nativeDispatch = true, completed = 0, prevented = false;
 vm.runInNewContext(listener, {
  app: { on: (_name, fn) => { beforeQuit = fn; }, quit: () => { if (!nativeDispatch) completed++; } },
  desktopServicesClosed: false, desktopServicesClosing: false,
  localRuntime: {}, agentBrowsersPromise: undefined,
  closeDesktopServices: () => Promise.resolve(), setImmediate
 });
 beforeQuit({ preventDefault: () => { prevented = true; } });
 await Promise.resolve(); await Promise.resolve();
 assert.equal(prevented, true); assert.equal(completed, 0);
 nativeDispatch = false;
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(completed, 1);
});

test('activation during or after service shutdown cannot create another window', () => {
 const create = source.match(/function createWindow\(\) \{[\s\S]*?\n\}/)[0];
 for (const [desktopServicesClosing, desktopServicesClosed] of [[true, false], [true, true], [false, true]]) {
  assert.doesNotThrow(() => vm.runInNewContext(create + '; createWindow()', {
   desktopServicesClosing, desktopServicesClosed,
   BrowserWindow: class { constructor() { throw new Error('Unexpected window during Quit'); } }
  }));
 }
});

test('quit waits for browser cleanup, OAuth shutdown and Mongo shutdown as one barrier', async () => {
 const browser = gate(), oauth = gate(), database = gate();
 const calls=[];
 const pending=vm.runInNewContext(closeServices+'; closeDesktopServices()', {
  agentBrowsersPromise: Promise.resolve({close:async()=>{calls.push('browser'); await browser.promise;}}),
  globalThis:{[Symbol.for('thingtime.chatgpt-plan.close')]:async()=>{calls.push('oauth'); await oauth.promise;}},
  localRuntime:{stop:async()=>{calls.push('database'); await database.promise;}},
  console, Symbol
 });
 let done=false; pending.then(()=>{done=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls.sort(),['browser','oauth']);
 browser.finish(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(done,false);
 oauth.finish(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(done,false);
 assert.ok(calls.includes('database'));
 database.finish(); await pending; assert.equal(done,true);
 assert.doesNotMatch(source,/closingAgentBrowsers/);
 assert.match(source,/if \(desktopServicesClosing\) throw new Error\('Thingtime is closing/);
});

test('browser cleanup failure still waits for local database cleanup', async () => {
 const database=gate(); let warned=false;
 const pending=vm.runInNewContext(closeServices+'; closeDesktopServices()', {
  agentBrowsersPromise:Promise.resolve({close:async()=>{throw new Error('fixture');}}),
  globalThis:{},Symbol,localRuntime:{stop:()=>database.promise},console:{warn:()=>{warned=true;}}
 });
 let done=false; pending.then(()=>{done=true;});
 await new Promise(resolve=>setImmediate(resolve)); assert.equal(done,false);
 database.finish(); await pending; assert.equal(warned,true);
});


test('reported account authority uses the running runtime rather than saved pending settings', () => {
 const endpoint = source.match(/function activeAccountEndpoint\(\) \{[\s\S]*?\n\}/)[0];
 const evaluate = runningEnabled => vm.runInNewContext(endpoint + '; activeAccountEndpoint()', {
  localRuntime: { runningEnabled, state: { enabled: !runningEnabled } },
  appOrigin: 'http://127.0.0.1:28630', activeApiEndpoint: 'https://active.example.test',
  desktopSettings: { snapshot: () => ({ selectedEndpoint: { url: 'https://pending.example.test' } }) }
 });
 assert.equal(evaluate(true), 'http://127.0.0.1:28630');
 assert.equal(evaluate(false), 'https://active.example.test');
});
