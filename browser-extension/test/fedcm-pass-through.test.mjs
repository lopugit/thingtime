import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const code = await readFile(new URL('../page-hook.js', import.meta.url), 'utf8');
class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
function setup(options = {}) {
  const document = new EventTarget(), window = new EventTarget();
  window.top = window; window.PublicKeyCredential = class {};
  const calls = [], requests = [], cancels = [];
  const navigator = {credentials: {async create() {}, async get(input) { calls.push(['get', input]); return options.nativeGet.call(this, input); }}};
  const dispatch = (name, detail) => document.dispatchEvent(new CustomEvent(name, {detail: JSON.stringify(detail)}));
  document.addEventListener('thingtime:extension-state-request', () => { if (options.state !== false) dispatch('thingtime:extension-state', {version: 1, enabled: options.enabled !== false}); });
  document.addEventListener('thingtime:extension-request', event => requests.push(JSON.parse(event.detail)));
  document.addEventListener('thingtime:extension-cancel', event => cancels.push(JSON.parse(event.detail)));
  vm.runInNewContext(code, {window, document, navigator, CustomEvent, crypto: webcrypto, ArrayBuffer, Uint8Array, btoa, atob, DOMException, structuredClone, setTimeout, clearTimeout});
  return {navigator, document, dispatch, calls, requests, cancels};
}
function diagnostics(env) {
  let value;
  env.document.addEventListener('thingtime:extension-diagnostics', event => { value = JSON.parse(event.detail); }, {once: true});
  env.dispatch('thingtime:extension-diagnostics-query', {version: 1});
  return value;
}

test('FedCM identity requests pass through to the browser unchanged without entering the passkey bridge', async () => {
  const credential = {type: 'identity', token: 'synthetic-fedcm-token'};
  for (const state of [{}, {enabled: false}, {state: false}]) {
    const env = setup({...state, nativeGet(input) { assert.equal(this, env.navigator.credentials); return credential; }});
    const input = {identity: {providers: [{configURL: 'https://dev.thingtime.com/api/v1/fedcm/config', clientId: 'thingtime-self', nonce: 'synthetic-nonce'}]}, signal: new AbortController().signal};
    assert.equal(await env.navigator.credentials.get(input), credential);
    assert.equal(env.calls.length, 1); assert.equal(env.calls[0][1], input);
    assert.equal(env.requests.length, 0); assert.equal(env.cancels.length, 0);
    assert.equal(JSON.stringify(diagnostics(env)).includes('synthetic'), false);
  }
});
test('a browser FedCM rejection passes through once without retrying or converting it into a passkey request', async () => {
  const error = new DOMException('Synthetic browser FedCM refusal', 'NetworkError');
  const env = setup({nativeGet() { throw error; }});
  const input = {identity: {providers: [{configURL: 'https://dev.thingtime.com/api/v1/fedcm/config', clientId: 'thingtime-self'}]}};
  await assert.rejects(env.navigator.credentials.get(input), actual => actual === error);
  assert.equal(env.calls.length, 1); assert.equal(env.calls[0][1], input);
  assert.equal(env.requests.length, 0); assert.equal(env.cancels.length, 0);
});
