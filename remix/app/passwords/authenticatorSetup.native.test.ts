import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Execute the actual shipped native JS, including its last-moment guard. This
// tests delayed dispatch even when a page records every raw setup event.
const source = readFileSync(new URL('../../../apple/Passwords/Host/AuthenticatorSetupBridge.swift', import.meta.url), 'utf8');
const bootstrap = source.match(/static let script = WKUserScript\(source: """([\s\S]*?)"""/)![1];
const dispatch = source.slice(source.indexOf('private func emit(')).match(/callAsyncJavaScript\("""([\s\S]*?)"""/)![1];
function document() {
  const events = new EventTarget(), sent: any[] = [], received: any[] = [];
  const location = { origin: 'https://thingtime.example', pathname: '/passwords', search: '', hash: '' };
  const window: any = { dispatchEvent: events.dispatchEvent.bind(events), webkit: { messageHandlers: { thingtimeAuthenticatorSetup: { postMessage: (message: unknown) => sent.push(message) } } } };
  for (const property of ['localStorage', 'sessionStorage', 'history']) Object.defineProperty(window, property, { get() { throw new Error('Persistence is forbidden in setup transport'); } });
  events.addEventListener('thingtime:authenticator-setup', event => received.push((event as CustomEvent).detail));
  const context = vm.createContext({ window, location, crypto: { randomUUID }, Event, CustomEvent });
  vm.runInContext(bootstrap, context);
  const bridge = window.thingtimeAuthenticatorSetup, nonce = randomUUID();
  bridge.postMessage({ operation: 'ready', ownerId: 'owner', nonce, dataPlane: 'home' });
  const deliver = (documentNonce = bridge.documentNonce) => {
    context.detail = { kind: 'setup', nonce, ownerId: 'owner', requestId: randomUUID(), setup: 'synthetic-payload' };
    context.expectedOrigin = 'https://thingtime.example'; context.expectedDocument = documentNonce;
    vm.runInContext(dispatch, context);
  };
  return { bridge, nonce, deliver, location, received, sent };
}
test('native bootstrap makes a unique immutable document identity and dispatches only inside bound scope', () => {
  const doc = document(); assert.ok(Object.isFrozen(doc.bridge));
  assert.equal(doc.sent[0].documentNonce, doc.bridge.documentNonce);
  doc.deliver(); assert.equal(doc.received.length, 1);
  doc.bridge.postMessage({ operation: 'cancel', nonce: doc.nonce });
  doc.deliver(); assert.equal(doc.received.length, 1);
});
test('delayed native delivery cannot reach a navigated/new document or newly selected owner', () => {
  for (const patch of [{ origin: 'https://other.example' }, { pathname: '/login' }, { search: '?anything' }, { hash: '#anything' }]) {
    const doc = document(); Object.assign(doc.location, patch); doc.deliver(); assert.equal(doc.received.length, 0);
  }
  const old = document(), next = document(); next.deliver(old.bridge.documentNonce); assert.equal(next.received.length, 0);
  const doc = document(); doc.bridge.postMessage({ operation: 'ready', ownerId: 'other', nonce: randomUUID(), dataPlane: 'home' });
  doc.deliver(); assert.equal(doc.received.length, 0);
});
test('host transport has no seed URL/log/persistence path and targets captured frames', () => {
  assert.ok(source.includes('in: frame, in: .page'));
  assert.ok(!source.includes('PasswordSessionStore.load'));
  assert.ok(!/UserDefaults|print\(|NSLog\(|console\./.test(source));
  assert.ok(source.includes('URLSessionConfiguration.ephemeral'));
  assert.ok(source.includes('completionHandler(nil)'));
});
