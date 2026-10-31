import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeOrigin, providerOrigin, senderOrigin, matchesDocument, validRequest} from '../protocol.js';
const sender = {frameId: 0, documentId: 'rp-document', origin: 'https://rp.example', url: 'https://rp.example/login', tab: {id: 2, url: 'https://rp.example/login'}};
test('accept only secure or explicit loopback origins', () => {
  for (const value of ['http://evil.test', 'https://u:p@thingtime.com', 'file:///tmp/x', 'javascript:alert(1)', 'null', 'https://thingtime.com.evil.test@evil.test']) assert.equal(safeOrigin(value), null);
  assert.equal(providerOrigin('https://thingtime.com/'), 'https://thingtime.com');
  assert.equal(providerOrigin('http://127.0.0.1:18234'), 'http://127.0.0.1:18234');
  assert.throws(() => providerOrigin('https://thingtime.com/passwords'));
  assert.throws(() => providerOrigin('https://thingtime.com?x=1'));
});
test('browser origin, tab, top frame and document all contribute to trust', () => {
  assert.equal(senderOrigin(sender), 'https://rp.example');
  for (const patch of [{frameId: 2}, {origin: 'https://bank.example'}, {url: 'https://bank.example'}, {documentId: undefined}, {tab: {id: 2, url: 'https://bank.example'}}]) assert.equal(senderOrigin({...sender, ...patch}), null);
  const request = {tabId: 2, documentId: 'rp-document', origin: 'https://rp.example', providerTabId: 4, providerDocumentId: 'provider-document', providerOrigin: 'https://thingtime.com'};
  assert.equal(matchesDocument(request, sender), true);
  assert.equal(matchesDocument(request, {...sender, documentId: 'replaced'}), false);
  assert.equal(matchesDocument(request, sender, true), false);
});
test('accept only typed versioned requests with unpredictable-looking IDs and JSON challenges', () => {
  const request = {version: 1, id: '2e27f3d6-1d63-439a-8719-44cbda72b6a1', type: 'get', publicKey: {challenge: 'abc'}};
  assert.equal(validRequest(request), true);
  for (const patch of [{version: 2}, {id: 'chosen'}, {type: 'delete'}, {publicKey: {challenge: {}}}]) assert.equal(!!validRequest({...request, ...patch}), false);
});
