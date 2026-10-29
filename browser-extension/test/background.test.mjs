import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as protocol from '../protocol.js';
const source = (await readFile(new URL('../background.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
const tick = async () => { for (let n = 0; n < 12; n++) await new Promise(resolve => setImmediate(resolve)); };
function event() { const listeners = []; return {addListener: fn => listeners.push(fn), fire: (...args) => listeners.forEach(fn => fn(...args)), listeners}; }
function setup(options = {}) {
  const frames = new Map([[1, {documentId: 'original', url: 'https://rp.example/login'}]]), removed = [], focused = [], sent = [], timers = new Set();
  const state = {enabled: true, origin: 'https://thingtime.com'}, session = options.session || {}, alarmValues = new Map();
  let nextTab = 2, optionsOpened = 0;
  const chrome = {runtime: {openOptionsPage: async () => { optionsOpened++; }, id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: event()},
    storage: {local: {get: async () => { if (options.settingsWait) await options.settingsWait; return state; }, set: async value => Object.assign(state, value)}, session: {get: async () => session, set: async value => Object.assign(session, value), remove: async key => { delete session[key]; }}},
    tabs: {query: async () => [{id:1}], get: async id => { const frame = frames.get(id); return frame ? {id, windowId: 10, url: frame.url, ...(options.pendingUrls?.has(id) ? {pendingUrl: options.pendingUrls.get(id)} : {})} : null; }, update: async (id, value) => { focused.push(['tab', id, value]); return {id, windowId: 10}; }, create: async ({url}) => { const id = nextTab++; frames.set(id, {documentId: 'provider', url}); return {id}; }, remove: async id => { removed.push(id); frames.delete(id); }, sendMessage: async (tabId, message, opts) => { sent.push({tabId, message, opts}); return {ok: true}; }, onRemoved: event(), onUpdated: event()},
    windows: {update: async (id, value) => { focused.push(['window', id, value]); return {id}; }},
    webNavigation: {getFrame: async ({tabId}) => frames.get(tabId), onCommitted: event()},
    alarms: {create: async (name, value) => alarmValues.set(name, value), clear: async name => alarmValues.delete(name), onAlarm: event()}};
  if (options.frames) for (const [id, frame] of options.frames) frames.set(id, frame);
  vm.runInNewContext(source, {...protocol, chrome, URL, crypto: webcrypto, setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; }, clearTimeout});
  const send = (message, sender) => new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
  const sender = {frameId: 0, documentId: 'original', origin: 'https://rp.example', url: 'https://rp.example/login', tab: {id: 1, windowId: 10, url: 'https://rp.example/login'}};
  const provider = {frameId: 0, documentId: 'provider', origin: state.origin, url: `${state.origin}/passwords/provider`, tab: {id: 2, url: `${state.origin}/passwords/provider`}};
  const request = {action: 'request', version: 1, id: '2e27f3d6-1d63-439a-8719-44cbda72b6a1', type: 'get', publicKey: {challenge: 'AQ'}};
  return {chrome, frames, removed, focused, sent, session, state, optionsOpened: () => optionsOpened, send, sender, provider, request, stop: () => timers.forEach(clearTimeout)};
}
test('worker binds provider request to actual sender, ignores page origin claims and fences late documents', async () => {
  const env = setup();
  try {
    const result = env.send({...env.request, origin: 'https://bank.example'}, env.sender); await tick();
    assert.equal(env.removed.length, 0);
    await env.send({action: 'provider-ready'}, env.provider);
    const forwarded = env.sent.find(v => v.message.action === 'provider-request').message.request;
    assert.equal(forwarded.origin, 'https://rp.example'); assert.notEqual(forwarded.id, env.request.id);
    const rejected = await env.send({action: 'provider-response', version: 1, id: forwarded.id, response: {id: 'fake'}}, {...env.provider, documentId: 'impostor'});
    assert.equal(rejected.ok, false); assert.equal(env.removed.length, 0);
    await env.send({action: 'provider-response', version: 1, id: forwarded.id, response: {id: 'valid'}}, env.provider);
    assert.equal((await result).response.id, 'valid'); assert.deepEqual(env.removed, [2]);
    assert.equal(env.session.pending.length, 0);
    const late = await env.send({action: 'provider-response', version: 1, id: forwarded.id, response: {id: 'late'}}, env.provider);
    assert.equal(late.ok, false);
  } finally { env.stop(); }
});
test('top-frame and live-document checks refuse forged or stale sources before opening a provider', async () => {
  const env = setup();
  try {
    for (const patch of [{origin: 'https://bank.example'}, {frameId: 2}, {documentId: 'replaced'}]) {
      const result = await env.send(env.request, {...env.sender, ...patch});
      assert.ok(['SecurityError', 'AbortError'].includes(result.error.name));
    }
    assert.equal(env.frames.has(2), false);
  } finally { env.stop(); }
});
test('duplicate requests are rejected; navigation aborts without native replay and closes only the owned tab', async () => {
  const env = setup();
  try {
    const result = env.send(env.request, env.sender); await tick();
    assert.equal((await env.send(env.request, env.sender)).error.name, 'InvalidStateError');
    env.frames.set(1, {documentId: 'next', url: 'https://rp.example/other'});
    env.chrome.webNavigation.onCommitted.fire({tabId: 1, frameId: 0, documentId: 'next', url: 'https://rp.example/other'});
    assert.equal((await result).error.name, 'AbortError'); assert.deepEqual(env.removed, [2]);
  } finally { env.stop(); }
});
test('only extension action can request explicit native fallback', async () => {
  const env = setup();
  try {
    const result = env.send(env.request, env.sender); await tick();
    assert.equal((await env.send({action: 'native-fallback', tabId: 1}, env.sender)).ok, false);
    await env.send({action: 'native-fallback', tabId: 1}, {id: 'extension', url: 'chrome-extension://extension/popup.html'});
    assert.equal((await result).fallback, true); assert.deepEqual(env.removed, [2]);
  } finally { env.stop(); }
});
test('unmatched cancellation cannot terminate a ceremony; exact cancellation cannot later complete', async () => {
  const env = setup();
  try {
    const result = env.send(env.request, env.sender); await tick();
    await env.send({action: 'cancel', id: 'unrelated'}, env.sender); assert.equal(env.removed.length, 0);
    await env.send({action: 'cancel', id: env.request.id}, env.sender);
    assert.equal((await result).error.name, 'AbortError'); assert.deepEqual(env.removed, [2]);
  } finally { env.stop(); }
});

test('cancel during asynchronous admission prevents opening the provider', async () => {
  let release; const settingsWait = new Promise(resolve => { release = resolve; });
  const env = setup({settingsWait});
  try {
    const result = env.send(env.request, env.sender); await tick();
    await env.send({action: 'cancel', id: env.request.id}, env.sender);
    release(); assert.equal((await result).error.name, 'AbortError'); await tick();
    assert.equal(env.frames.has(2), false);
  } finally { release(); env.stop(); }
});
test('alarm timeout rejects without native fallback and cleans only the provider', async () => {
  const env = setup();
  try {
    const result = env.send(env.request, env.sender); await tick();
    const routing = env.session.pending[0];
    assert.equal('publicKey' in routing, false); assert.equal('response' in routing, false);
    env.chrome.alarms.onAlarm.fire({name: `passkey:${routing.id}`});
    assert.equal((await result).error.name, 'NotAllowedError'); assert.deepEqual(env.removed, [2]);
  } finally { env.stop(); }
});
test('independent relying-party tabs own distinct provider tabs and cancellation stays scoped', async () => {
  const env = setup();
  try {
    env.frames.set(10, {documentId: 'other-rp', url: 'https://other.example/login'});
    const other = {...env.sender, documentId: 'other-rp', origin: 'https://other.example', url: 'https://other.example/login', tab: {id: 10, url: 'https://other.example/login'}};
    const first = env.send(env.request, env.sender); await tick();
    const second = env.send(env.request, other); await tick();
    assert.equal(env.session.pending.length, 2);
    await env.send({action: 'cancel', id: env.request.id}, env.sender);
    assert.equal((await first).error.name, 'AbortError'); assert.deepEqual(env.removed, [2]); assert.equal(env.frames.has(3), true);
    await env.send({action: 'cancel', id: env.request.id}, other);
    assert.equal((await second).error.name, 'AbortError'); assert.deepEqual(env.removed, [2, 3]);
  } finally { env.stop(); }
});
test('worker recovery removes only persisted provider document still at the selected route', async () => {
  const session = {pending: [
    {id: 'first', providerTabId: 20, providerDocumentId: 'owned', providerOrigin: 'https://thingtime.com'},
    {id: 'second', providerTabId: 21, providerDocumentId: 'old', providerOrigin: 'https://thingtime.com'}
  ]};
  const env = setup({session, frames: [[20, {documentId: 'owned', url: 'https://thingtime.com/passwords/provider'}], [21, {documentId: 'new', url: 'https://unrelated.example/'}]]});
  try { await tick(); assert.deepEqual(env.removed, [20]); assert.equal(env.frames.has(21), true); assert.equal(session.pending, undefined); }
  finally { env.stop(); }
});

test('setup status and options opening require configured origin, allowed route and current document', async () => {
  const env = setup();
  try {
    assert.equal((await env.send({action: 'extension-query'}, env.sender)).available, false);
    assert.equal((await env.send({action: 'extension-configure'}, env.sender)).available, false);
    assert.equal(env.optionsOpened(), 0);
    const url = 'https://thingtime.com/passwords';
    const sender = {frameId: 0, documentId: 'settings-document', origin: 'https://thingtime.com', url, tab: {id: 7, url}};
    env.frames.set(7, {documentId: sender.documentId, url});
    const status = await env.send({action: 'extension-query'}, sender);
    assert.equal(status.available, true); assert.equal(status.origin, 'https://thingtime.com');
    await env.send({action: 'extension-configure'}, sender); assert.equal(env.optionsOpened(), 1);
    assert.equal((await env.send({action: 'extension-query'}, {...sender, documentId: 'old'})).available, false);
    const elsewhere = 'https://thingtime.com/feed';
    env.frames.set(7, {documentId: sender.documentId, url: elsewhere});
    assert.equal((await env.send({action: 'extension-query'}, {...sender, url: elsewhere, tab: {id: 7, url: elsewhere}})).available, false);
    assert.equal((await env.send({action: 'settings', enabled: false, origin: 'https://evil.test'}, sender)).ok, false);
    assert.equal(env.state.enabled, true); assert.equal(env.state.origin, 'https://thingtime.com');
  } finally { env.stop(); }
});

test('finish preserves a provider tab navigated to an unrelated site', async () => {
  const env = setup();
  try {
    const result = env.send(env.request, env.sender); await tick();
    await env.send({action: 'provider-ready'}, env.provider);
    env.frames.set(2, {documentId: 'unrelated', url: 'https://unrelated.example/'});
    env.chrome.webNavigation.onCommitted.fire({tabId: 2, frameId: 0, documentId: 'unrelated', url: 'https://unrelated.example/'});
    assert.equal((await result).error.name, 'AbortError'); assert.deepEqual(env.removed, []); assert.equal(env.frames.has(2), true);
  } finally { env.stop(); }
});
test('finish preserves replacement provider documents and same-document route changes', async () => {
  for (const frame of [{documentId: 'replacement', url: 'https://thingtime.com/passwords/provider'}, {documentId: 'provider', url: 'https://thingtime.com/feed'}]) {
    const env = setup();
    try {
      const result = env.send(env.request, env.sender); await tick(); await env.send({action: 'provider-ready'}, env.provider);
      env.frames.set(2, frame);
      await env.send({action: 'cancel', id: env.request.id}, env.sender);
      assert.equal((await result).error.name, 'AbortError'); assert.deepEqual(env.removed, []); assert.equal(env.frames.has(2), true);
    } finally { env.stop(); }
  }
});
test('finish preserves a user navigation before the replacement destination commits', async () => {
  const pendingUrls = new Map(), env = setup({pendingUrls});
  try {
    const result = env.send(env.request, env.sender); await tick(); await env.send({action: 'provider-ready'}, env.provider);
    pendingUrls.set(2, 'https://unrelated.example/');
    await env.send({action: 'cancel', id: env.request.id}, env.sender);
    assert.equal((await result).error.name, 'AbortError'); assert.deepEqual(env.removed, []); assert.equal(env.frames.has(2), true);
  } finally { env.stop(); }
});

test('the real options-tab sender can save settings without granting web senders access', async () => {
  const env = setup();
  try {
    const sender = {id: 'extension', url: 'chrome-extension://extension/popup.html', origin: 'chrome-extension://extension', tab: {id: 80, url: 'chrome-extension://extension/popup.html'}, frameId: 0, documentId: 'extension-options'};
    // Match the tab/document/origin fields Chrome supplies for an options tab.
    const result = await env.send({action: 'settings', enabled: false, origin: 'https://vault.example'}, sender);
    assert.equal(result.ok, true); assert.equal(env.state.enabled, false); assert.equal(env.state.origin, 'https://vault.example');
    const webSender = {...env.sender, id: 'extension'};
    const denied = await env.send({action: 'settings', enabled: true, origin: 'https://evil.example'}, webSender);
    assert.equal(denied.ok, false); assert.equal(env.state.enabled, false); assert.equal(env.state.origin, 'https://vault.example');
    assert.equal((await env.send({action: 'settings', enabled: true, origin: 'https://evil.example'}, {...sender, frameId: 1})).ok, false);
    assert.equal((await env.send({action: 'settings', enabled: true, origin: 'https://evil.example'}, {...sender, id: 'other-extension'})).ok, false);
  } finally { env.stop(); }
});


test('read-only diagnostics are popup-only, exact-document fenced and have no routing identity fields',async()=>{
 const env=setup(); const popup={id:'extension',url:'chrome-extension://extension/popup.html'};
 try {
  env.chrome.tabs.sendMessage=async(tabId,message,options)=>{
   assert.equal(tabId,1);assert.equal(message.action,'diagnostics-query');assert.equal(options.documentId,'original');
   return {available:true,hook:{installed:{create:true,get:true},current:{create:true,get:false},enabledSeen:true,fallbackReason:0,id:'private',publicKey:'private'}};
  };
  const result=await env.send({action:'diagnostics'},popup);
  assert.equal(result.hook.current.get,false);assert.equal(JSON.stringify(result).includes('private'),false);
  assert.equal('documentId' in result,false);assert.equal('tabId' in result,false);
  assert.equal((await env.send({action:'diagnostics'},env.sender)).ok,false);
  env.chrome.tabs.sendMessage=async()=>{env.frames.set(1,{documentId:'replacement',url:'https://rp.example/login'});return{available:true,hook:{}};};
  assert.equal((await env.send({action:'diagnostics'},popup)).available,false);
  assert.equal(env.frames.has(2),false);assert.equal(env.session.pending,undefined);
 } finally {env.stop();}
});


async function deliverSuccess(env, onResponse) {
 const result = onResponse ? new Promise(resolve=>env.chrome.runtime.onMessage.listeners[0](env.request,env.sender,value=>{onResponse(value);resolve(value);})) : env.send(env.request,env.sender);
 await tick(); await env.send({action:'provider-ready'},env.provider);
 const forwarded=env.sent.find(value=>value.message.action==='provider-request').message.request;
 await env.send({action:'provider-response',version:1,id:forwarded.id,response:{id:'synthetic-success'}},env.provider);
 return result;
}
test('successful provider return focuses exact requester before its response-triggered redirect',async()=>{
 const env=setup();
 try {
  const result=await deliverSuccess(env,()=>{
   assert.deepEqual(env.focused.map(value=>[value[0],value[1]]),[['tab',1],['window',10]]);
   env.frames.set(1,{documentId:'success-redirect',url:'https://rp.example/settings/security'});
  });
  assert.equal(result.response.id,'synthetic-success');assert.deepEqual(env.removed,[2]);
  assert.equal(env.focused[0][2].active,true);assert.equal('url' in env.focused[0][2],false);
  assert.equal(env.focused[1][2].focused,true);
 }finally{env.stop();}
});
test('closed or moved requester and focus errors do not change successful delivery or open a new tab',async()=>{
 for(const kind of ['closed','moved','focus-error']) {
  const env=setup();
  try {
   const get=env.chrome.tabs.get;
   env.chrome.tabs.get=async id=>id!==1?get(id):kind==='closed'?null:kind==='moved'?{id:1,windowId:99,url:env.sender.url}:get(id);
   if(kind==='focus-error')env.chrome.windows.update=async()=>{throw new Error('window unavailable');};
   const result=await deliverSuccess(env);
   assert.equal(result.response.id,'synthetic-success');assert.deepEqual(env.removed,[2]);
   if(kind!=='focus-error')assert.deepEqual(env.focused,[]);
  }finally{env.stop();}
 }
});
test('new requester navigation or native fallback never steals focus',async()=>{
 const env=setup();
 try {
  const pending=env.send(env.request,env.sender);await tick();
  env.chrome.tabs.get=async id=>id===1?{id:1,windowId:10,url:env.sender.url,pendingUrl:'https://rp.example/elsewhere'}:{id,url:env.provider.url};
  await env.send({action:'provider-ready'},env.provider);
  const forwarded=env.sent.find(value=>value.message.action==='provider-request').message.request;
  await env.send({action:'provider-response',version:1,id:forwarded.id,response:{id:'synthetic-success'}},env.provider);
  assert.equal((await pending).response.id,'synthetic-success');assert.deepEqual(env.focused,[]);
 }finally{env.stop();}
 const fallback=setup();try{
  const pending=fallback.send(fallback.request,fallback.sender);await tick();
  await fallback.send({action:'native-fallback',tabId:1},{id:'extension',url:'chrome-extension://extension/popup.html'});
  assert.equal((await pending).fallback,true);assert.deepEqual(fallback.focused,[]);
 }finally{fallback.stop();}
});
