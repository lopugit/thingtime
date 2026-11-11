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
 let beforeQuit, nativeDispatch = true, completed = 0, prevented = false, launchClosed = false;
 vm.runInNewContext(listener, {
  app: { on: (_name, fn) => { beforeQuit = fn; }, quit: () => { if (!nativeDispatch) completed++; } },
  desktopServicesClosed: false, desktopServicesClosing: false,
  localRuntime: {}, agentBrowsersPromise: undefined, webBundleUpdates: null,
  webBundleLaunch: { close: () => { launchClosed = true; } },
  closeDesktopServices: () => Promise.resolve(), setImmediate
 });
 beforeQuit({ preventDefault: () => { prevented = true; } });
 assert.equal(launchClosed, true);
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

test('quit waits for password bridge, browser cleanup, OAuth shutdown and Mongo shutdown as one barrier', async () => {
 const passwords = gate(), browser = gate(), oauth = gate(), database = gate();
 const calls=[];
 const pending=vm.runInNewContext(closeServices+'; closeDesktopServices()', {
  process: {platform: 'linux'}, passwordProvider: {close: async()=>{calls.push('passwords'); await passwords.promise;}},
  agentBrowsersPromise: Promise.resolve({close:async()=>{calls.push('browser'); await browser.promise;}}),
  globalThis:{[Symbol.for('thingtime.chatgpt-plan.close')]:async()=>{calls.push('oauth'); await oauth.promise;}},
  localRuntime:{stop:async()=>{calls.push('database'); await database.promise;}},
  console, Symbol, webBundleUpdates: null
 });
 let done=false; pending.then(()=>{done=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls.sort(),['browser','oauth','passwords']);
 browser.finish(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(done,false);
 oauth.finish(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(done,false);
 assert.ok(calls.includes('database'));
 database.finish(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(done,false);
 passwords.finish(); await pending; assert.equal(done,true);
 assert.doesNotMatch(source,/closingAgentBrowsers/);
 assert.match(source,/if \(desktopServicesClosing\) throw new Error\('Thingtime is closing/);
});

test('browser cleanup failure still waits for local database cleanup', async () => {
 const database=gate(); let warned=false;
 const pending=vm.runInNewContext(closeServices+'; closeDesktopServices()', {
  process: {platform: 'darwin'}, webBundleUpdates: null,
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


test('failed bundle startup restarts before a page or password session exists', async () => {
 const initialize = source.match(/async function initializeWebBundleLaunch\(\) \{[\s\S]*?\n\}/)[0];
 const relaunch = source.match(/async function relaunchDesktopProcess\(\) \{[\s\S]*?\n\}/)[0];
 const calls = []; let onFailure;
 const context = {
  parallelDevMode: true, process: { env: {}, versions: {}, connected: true,
   send: (message, callback) => { calls.push(message.type); callback(); } },
  app: { getPath: () => '/isolated-profile', getVersion: () => '1.0.0', quit: () => calls.push('quit') },
  __dirname: '/shell', path: require('node:path'), fs: { readFileSync: () => '{}' },
  validateTrustPolicy: () => ({trustedKeys: [], channel: 'qa'}),
  createElectronBundleHost: () => ({nativeAbi: 'test', channel: 'qa'}),
  getShippedWebRoot: () => '/bundled', assertElectronBundleMetadata: () => {},
  readWebBuildMetadata: () => ({}), createWebBundleStore: async () => ({}),
  createWebBundleLaunch: options => { onFailure = options.onFailure; return {prepare: async () => ({directory: '/verified'})}; },
  desktopServicesClosing: false, desktopServicesClosed: false,
  webBundleLaunch: null, selectedWebBundle: null, webBuildMetadata: null,
  authorityTransition: {retainUntilRestart: () => calls.push('authority-fenced')},
  restartDesktopRuntime: async () => { throw new Error('There is no page origin or password session during failed startup'); }
 };
 await vm.runInNewContext(relaunch + '\n' + initialize + '; initializeWebBundleLaunch()', context);
 await onFailure(new Error('Nitro import failed'));
 assert.deepEqual(calls, ['authority-fenced', 'thingtime-dev-restart', 'quit']);
});

test('relaunch requires supervisor acceptance and preserves native application relaunch', async () => {
 const relaunch = source.match(/async function relaunchDesktopProcess\(\) \{[\s\S]*?\n\}/)[0];
 let quits = 0, relaunches = 0;
 const context = {parallelDevMode: true, process: {connected: true, send: (_message, callback) => callback(new Error('IPC closed'))},
  app: {quit: () => quits++, relaunch: () => relaunches++}, authorityTransition: {retainUntilRestart() {}}};
 await assert.rejects(vm.runInNewContext(relaunch + '; relaunchDesktopProcess()', context), /did not accept/);
 assert.equal(quits, 0); assert.equal(relaunches, 0);
 context.parallelDevMode = false;
 await vm.runInNewContext(relaunch + '; relaunchDesktopProcess()', context);
 assert.equal(quits, 1); assert.equal(relaunches, 1);
});
