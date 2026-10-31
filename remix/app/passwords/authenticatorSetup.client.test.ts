import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthenticatorSetupSession, authenticatorSetupEvent, supportsAuthenticatorSetup } from './authenticatorSetup.client';
// RFC 6238 published fixture, not an account secret.
const uri = `otpauth://totp/Example:synthetic?secret=${['GEZD', 'GNBV', 'GY3T', 'QOJQ', 'GEZD', 'GNBV', 'GY3T', 'QOJQ'].join('')}`;
const requestId = 'a0000000-0000-4000-8000-000000000001', nonce = 'b0000000-0000-4000-8000-000000000001';
function fixture(dataPlane: string | null = 'home') {
  const events = new EventTarget(), sent: Record<string, string>[] = [], notices: unknown[] = [];
  let current = true, errors = 0;
  const session = new AuthenticatorSetupSession({ ownerId: 'synthetic-owner', dataPlane, events, nonce, bridge: { version: '1.0.0', postMessage: message => sent.push(message) }, current: () => current, onNotice: value => notices.push(value), onError: () => errors++ });
  const emit = (detail: Record<string, unknown>) => events.dispatchEvent(new CustomEvent(authenticatorSetupEvent, { detail: { nonce, ownerId: 'synthetic-owner', requestId, ...detail } }));
  return { session, sent, notices, emit, retire: () => { current = false; }, errors: () => errors };
}
test('independent setup capability accepts compatible version only', () => {
  for (const version of ['1.0.0', '1.2.0']) assert.equal(supportsAuthenticatorSetup({ version, postMessage() {} }), true);
  for (const version of ['2.0.0', '1.00.0', '1.0.0-beta', '1']) assert.equal(supportsAuthenticatorSetup({ version, postMessage() {} }), false);
});
test('cold/warm notifications never deliver or persist a seed until explicit consume', async () => {
  const f = fixture(); assert.equal(f.sent[0].operation, 'ready');
  f.emit({ kind: 'available' }); f.emit({ kind: 'available' });
  assert.equal(f.notices.length, 1); assert.ok(!JSON.stringify([f.notices, f.sent]).includes('otpauth'));
  const pending = f.session.consume(requestId);
  assert.equal(f.sent.at(-1)?.operation, 'consume');
  f.emit({ kind: 'setup', setup: uri }); assert.equal(await pending, uri);
  await assert.rejects(f.session.consume(requestId));
  f.emit({ kind: 'setup', setup: uri }); assert.equal(f.errors(), 0);
  f.session.dispose();
});
test('wrong owner/document/request and retired document cannot receive setup', async () => {
  const f = fixture(); f.emit({ kind: 'available', ownerId: 'other' }); f.emit({ kind: 'available', nonce: 'other' });
  assert.equal(f.notices.length, 0); f.emit({ kind: 'available' });
  const pending = f.session.consume(requestId);
  f.emit({ kind: 'setup', setup: uri, requestId: 'other' }); f.emit({ kind: 'setup', setup: uri, nonce: 'other' });
  f.retire(); f.emit({ kind: 'setup', setup: uri });
  f.session.dispose(); await assert.rejects(pending);
});
test('cancel rejects in-flight setup without draft/save side effects; later replay ignored', async () => {
  const f = fixture(); f.emit({ kind: 'available' }); const pending = f.session.consume(requestId);
  f.session.cancel(); await assert.rejects(pending); f.emit({ kind: 'setup', setup: uri });
  assert.equal(f.sent.at(-1)?.operation, 'cancel'); assert.equal(f.notices.at(-1), null); f.session.dispose();
});
test('non-home/unknown plane cannot advertise or receive a setup', () => {
  for (const plane of [null, 'custom-unknown', 'local']) {
    const f = fixture(plane); f.emit({ kind: 'available' }); assert.equal(f.sent.length, 0); assert.equal(f.notices.length, 0); f.session.dispose();
  }
});
test('malformed/HOTP/migration delivery fails closed with generic errors', async () => {
  for (const input of ['invalid', uri.replace('/totp/', '/hotp/'), uri.replace('otpauth:', 'otpauth-migration:'), uri + '&secret=duplicate']) {
    const f = fixture(); f.emit({ kind: 'available' }); const pending = f.session.consume(requestId); f.emit({ kind: 'setup', setup: input });
    await assert.rejects(pending, error => error instanceof Error && !error.message.includes(input)); assert.equal(f.errors(), 1); f.session.dispose();
  }
});

test('expiry retires only its scoped request, preserves a newer notice, and rejects a pending consume immediately', async () => {
  const f = fixture(); f.emit({ kind: 'available' });
  f.emit({ kind: 'expired' }); assert.equal(f.notices.at(-1), null);
  f.emit({ kind: 'available' }); assert.equal(f.notices.at(-1), null);
  const nextId = 'a0000000-0000-4000-8000-000000000002';
  f.emit({ kind: 'available', requestId: nextId });
  f.emit({ kind: 'expired' }); assert.deepEqual(f.notices.at(-1), { requestId: nextId });
  const pending = f.session.consume(nextId);
  f.emit({ kind: 'unavailable', requestId: nextId }); await assert.rejects(pending);
  assert.equal(f.notices.at(-1), null); f.session.dispose();
});
