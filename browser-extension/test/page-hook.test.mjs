import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const code = await readFile(new URL('../page-hook.js', import.meta.url), 'utf8');
class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
function setup() {
  const document = new EventTarget(), window = new EventTarget(); window.top = window; window.window = window; window.PublicKeyCredential = class {};
  const calls = [], requests = [], cancels = [];
  const navigator = {credentials: {create: async options => { calls.push(['create', options]); return 'native'; }, get: async options => { calls.push(['get', options]); return 'native'; }}};
  const dispatch = (name, detail) => document.dispatchEvent(new CustomEvent(name, {detail: JSON.stringify(detail)}));
  document.addEventListener('thingtime:extension-state-request', () => dispatch('thingtime:extension-state', {version: 1, enabled: true}));
  document.addEventListener('thingtime:extension-request', e => requests.push(JSON.parse(e.detail)));
  document.addEventListener('thingtime:extension-cancel', e => cancels.push(JSON.parse(e.detail)));
  vm.runInNewContext(code, {window, document, navigator, CustomEvent, crypto: webcrypto, ArrayBuffer, Uint8Array, btoa, atob, DOMException, structuredClone, setTimeout, clearTimeout});
  return {navigator, dispatch, calls, requests, cancels};
}
const options = () => ({publicKey: {challenge: new Uint8Array([1, 2, 3]), rpId: 'rp.example'}});
const tick = () => new Promise(resolve => setImmediate(resolve));
test('unsupported conditional and extension flows delegate original options unchanged', async () => {
  const env = setup(), input = {...options(), mediation: 'conditional'};
  assert.equal(await env.navigator.credentials.get(input), 'native');
  assert.equal(env.calls[0][1], input); assert.equal(env.requests.length, 0);
  assert.equal(await env.navigator.credentials.get({publicKey: {...options().publicKey, extensions: {prf: {}}}}), 'native');
});
test('basic assertion reconstructs buffers, extension results and JSON without internal-slot masquerading', async () => {
  const env = setup(); const promise = env.navigator.credentials.get(options()); await tick();
  const request = env.requests[0]; assert.equal(request.publicKey.challenge, 'AQID');
  const response = {id: 'AQ', rawId: 'AQ', type: 'public-key', response: {clientDataJSON: 'Ag', authenticatorData: 'Aw', signature: 'BA', userHandle: null}, clientExtensionResults: {}};
  env.dispatch('thingtime:extension-response', {version: 1, id: request.id, response});
  const result = await promise;
  assert.deepEqual([...new Uint8Array(result.rawId)], [1]);
  assert.deepEqual([...new Uint8Array(result.response.signature)], [4]);
  assert.equal(result.response.userHandle, null); assert.deepEqual(result.toJSON(), response);
  assert.deepEqual(result.getClientExtensionResults(), {}); assert.equal(env.calls.length, 0);
});
test('abort rejects and ignores late response without replaying the native ceremony', async () => {
  const env = setup(), controller = new AbortController();
  const promise = env.navigator.credentials.get({...options(), signal: controller.signal}); await tick();
  const request = env.requests[0]; controller.abort();
  await assert.rejects(promise, error => error.name === 'AbortError');
  env.dispatch('thingtime:extension-response', {version: 1, id: request.id, fallback: true});
  assert.equal(env.cancels[0].id, request.id); assert.equal(env.calls.length, 0);
});
test('only explicit fallback delegates native and provider errors do not replay', async () => {
  const env = setup(); const first = env.navigator.credentials.get(options()); await tick();
  env.dispatch('thingtime:extension-response', {version: 1, id: env.requests[0].id, fallback: true});
  assert.equal(await first, 'native');
  const second = env.navigator.credentials.get(options()); await tick();
  env.dispatch('thingtime:extension-response', {version: 1, id: env.requests[1].id, error: {name: 'NotAllowedError', message: 'Cancelled'}});
  await assert.rejects(second, error => error.name === 'NotAllowedError'); assert.equal(env.calls.length, 1);
});

test('creation credProps true reaches Thingtime and returns registration methods', async () => {
  const env = setup();
  const promise = env.navigator.credentials.create({publicKey: {challenge: options().publicKey.challenge, pubKeyCredParams: [{type: 'public-key', alg: -7}], extensions: {credProps: true}}}); await tick();
  const request = env.requests[0]; assert.equal(request.publicKey.extensions.credProps, true);
  const response = {id: 'AQ', rawId: 'AQ', type: 'public-key', response: {clientDataJSON: 'Ag', attestationObject: 'Aw', authenticatorData: 'BA', publicKey: 'BQ', publicKeyAlgorithm: -7, transports: ['internal']}, clientExtensionResults: {credProps: {rk: true}}};
  env.dispatch('thingtime:extension-response', {version: 1, id: request.id, response});
  const result = await promise;
  assert.deepEqual(Array.from(result.response.getTransports()), ['internal']); assert.equal(result.response.getPublicKeyAlgorithm(), -7);
  assert.deepEqual([...new Uint8Array(result.response.getAuthenticatorData())], [4]);
  assert.deepEqual([...new Uint8Array(result.response.getPublicKey())], [5]);
  assert.equal(result.getClientExtensionResults().credProps.rk, true);
});

test('unsupported algorithms, attestation, attachment and hints delegate native before any bridge request', async () => {
  const base = {challenge: options().publicKey.challenge, rp: {name: 'Example'}, user: {id: new Uint8Array([1]), name: 'test', displayName: 'Test'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]};
  for (const patch of [
    {pubKeyCredParams: [{type: 'public-key', alg: -257}]},
    {pubKeyCredParams: []},
    {attestation: 'direct'}, {attestation: 'indirect'}, {attestation: 'enterprise'},
    {authenticatorSelection: {authenticatorAttachment: 'cross-platform'}},
    {hints: ['security-key']}, {attestationFormats: ['packed']},
  ]) {
    const env = setup(), input = {publicKey: {...base, ...patch}};
    assert.equal(await env.navigator.credentials.create(input), 'native');
    assert.equal(env.calls[0][1], input); assert.equal(env.requests.length, 0);
  }
});

test('a valid ES256 offer with none attestation and platform selection stays on the provider path', async () => {
  const env = setup(), controller = new AbortController();
  const promise = env.navigator.credentials.create({signal: controller.signal, publicKey: {challenge: new Uint8Array([1]), rp: {name: 'Example'}, user: {id: new Uint8Array([2]), name: 'test', displayName: 'Test'}, pubKeyCredParams: [{type: 'public-key', alg: -257}, {type: 'public-key', alg: -7}], attestation: 'none', authenticatorSelection: {authenticatorAttachment: 'platform'}, hints: []}});
  await tick(); assert.equal(env.requests.length, 1); assert.equal(env.calls.length, 0);
  controller.abort(); await assert.rejects(promise, error => error.name === 'AbortError');
});
