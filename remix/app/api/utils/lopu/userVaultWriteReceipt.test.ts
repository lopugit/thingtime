import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { parseTimelineEvent } from '../../../timeline/contract';
import { parseUserVaultWrite, parseUserVaultWriteAcknowledgment } from './userVaultWriteContract';
import { createUserVaultWriteReceipt, readUserVaultWriteReceipt, userVaultWriteDigest, userVaultWriteEventId } from './userVaultWriteReceipt';

const version = 'vault-state-v1:' + 'a'.repeat(64), nextVersion = 'vault-state-v1:' + 'b'.repeat(64);
const secret = () => ({ action: 'save-secret', id: 'synthetic-record', writeId: 'synthetic-write', expectedVersion: null, name: 'Fixture', key: 'FIXTURE_KEY', value: '  synthetic value\n', groupId: null });
const key = randomBytes(32), owner = 'fixture-owner', plane = 'home';
const command = () => parseUserVaultWrite(secret());
function fixture() {
 const request = command(), digest = userVaultWriteDigest(key, owner, plane, request);
 const acknowledgment = { action: request.action, id: request.id, writeId: request.writeId, expectedVersion: request.expectedVersion, resultVersion: nextVersion };
 return { request, digest, acknowledgment, event: createUserVaultWriteReceipt(owner, acknowledgment, digest, '2026-10-17T00:00:00.000Z') };
}

test('closed wire commands normalize existing model fields and preserve exact credential whitespace', () => {
 const raw = { ...secret(), name: '  Fixture  ' };
 const parsed = parseUserVaultWrite(raw); assert.ok(parsed.action === 'save-secret');
 assert.equal(parsed.name, 'Fixture'); assert.equal(parsed.value, raw.value);
 raw.value = 'changed'; assert.notEqual(parsed.value, raw.value);
 for (const extra of ['ownerId','acl','authorization','encryptedValue','source','revision','__proto__'])
  assert.throws(() => parseUserVaultWrite({ ...secret(), [extra]: 'caller authority' }));
});
test('missing state preconditions cannot become create, move or delete intent', () => {
 const { expectedVersion: omitted, ...missing } = secret();
 for (const raw of [missing, { ...secret(), expectedVersion: '' }, { ...secret(), expectedVersion: 'vault-state-v2:' + 'a'.repeat(64) },
  { action: 'delete', id: 'synthetic-record', writeId: 'synthetic-write', expectedVersion: null },
  { action: 'move-entry', id: 'synthetic-record', writeId: 'synthetic-write', expectedVersion: version },
  { action: 'create-group', id: 'synthetic-record', writeId: 'synthetic-write', expectedVersion: version, name: 'Fixture' }]) assert.throws(() => parseUserVaultWrite(raw));
 const moved = parseUserVaultWrite({ action: 'move-entry', id: 'synthetic-record', writeId: 'synthetic-write', expectedVersion: version, groupId: null }); assert.ok(moved.action === 'move-entry'); assert.equal(moved.groupId, null);
});
test('reserved identities and lossy, executable or unbounded JSON are refused without evaluation', () => {
 for (const id of [' timeline-record', 'timeline-record', 'short', 'record/id']) assert.throws(() => parseUserVaultWrite({ ...secret(), id }));
 let executed = false;
 const getter = { ...secret() }; Object.defineProperty(getter, 'value', { enumerable: true, get() { executed = true; return 'value'; } });
 assert.throws(() => parseUserVaultWrite(getter)); assert.equal(executed, false);
 for (const value of ['', '🙂'.repeat(9000), new Date(), undefined]) assert.throws(() => parseUserVaultWrite({ ...secret(), value }));
 const cycle: any = secret(); cycle.value = cycle; assert.throws(() => parseUserVaultWrite(cycle));
 assert.throws(() => parseUserVaultWrite({ ...secret(), value: 'x'.repeat(300_000) }));
});
test('provider metadata changes can retain an existing token but cannot create an empty credential', () => {
 const provider = { action: 'save-provider', id: 'synthetic-record', writeId: 'synthetic-write', expectedVersion: version, name: 'Fixture', provider: 'compatible', endpoint: 'https://provider.example/v1/' };
 const parsed = parseUserVaultWrite(provider); assert.ok(parsed.action === 'save-provider');
 assert.equal(parsed.token, null); assert.equal(parsed.endpoint, 'https://provider.example/v1');
 assert.throws(() => parseUserVaultWrite({ ...provider, expectedVersion: null }));
 assert.throws(() => parseUserVaultWrite({ ...provider, model: { nested: true } }));
 assert.throws(() => parseUserVaultWrite({ ...provider, token: 42 }));
 const created = parseUserVaultWrite({ ...provider, expectedVersion: null, token: 'synthetic-token' }); assert.ok(created.action === 'save-provider'); assert.equal(created.token, 'synthetic-token');
});
test('canonical MAC binds account, selected plane, key and every operation field without disclosing credentials', () => {
 const { request, digest, event } = fixture();
 assert.equal(userVaultWriteDigest(key, owner, plane, parseUserVaultWrite(Object.fromEntries(Object.entries(secret()).reverse()))), digest);
 for (const altered of [{ ...request, value: 'other' }, { ...request, name: 'Other' }, { ...request, groupId: 'different-group' }, { ...request, expectedVersion: version }, { ...request, id: 'different-record' }, { ...request, writeId: 'different-write' }])
  assert.notEqual(userVaultWriteDigest(key, owner, plane, altered), digest);
 assert.notEqual(userVaultWriteDigest(key, 'other-owner', plane, request), digest);
 assert.notEqual(userVaultWriteDigest(key, owner, 'other-plane', request), digest);
 assert.notEqual(userVaultWriteDigest(randomBytes(32), owner, plane, request), digest);
 assert.throws(() => userVaultWriteDigest(new Uint8Array(0), owner, plane, request));
 const serialized = JSON.stringify(event);
 for (const field of ['synthetic value', 'FIXTURE_KEY', 'encryptedValue', 'cipherText', 'provider.example']) assert.equal(serialized.includes(field), false);
});
test('canonical Timeline effect returns original acknowledgment without consulting the mutable target', () => {
 const { request, digest, acknowledgment, event } = fixture();
 assert.deepEqual(parseTimelineEvent(event), event);
 assert.equal(event.id, userVaultWriteEventId(request.writeId));
 assert.equal(event.mode, 'effect'); assert.equal(event.operation, 'effect');
 assert.deepEqual(readUserVaultWriteReceipt(JSON.parse(JSON.stringify(event)), owner, request, digest), acknowledgment);
 // No target lookup is involved: later generic edits/deletion cannot turn this
 // receipt into permission to repeat the mutation or adopt old content.
 assert.equal(Object.prototype.hasOwnProperty.call(acknowledgment, 'value'), false);
});
test('client-authored lookalikes and changed receipt identities fail closed', () => {
 const { request, digest, event } = fixture();
 for (const patch of [{ source: 'client', mode: 'draft', operation: 'create', clientId: 'fixture-client' }, { actorId: 'different-owner' }, { ownerId: 'different-owner' },
  { thingId: 'different-record' }, { operationId: 'different-write' }, { id: 'different-event' }, { branchId: 'other-branch' },
  { parentIds: ['another-event'] }, { dependencies: [{ thingId: 'another-thing', eventId: 'another-event' }] }])
  assert.throws(() => readUserVaultWriteReceipt({ ...event, ...patch }, owner, request, digest));
 for (const patch of [{ adapter: 'thing-content' }, { version: 2 }, { value: { ...(event.after!.value as Record<string, any>), plaintext: 'injected' } }, { value: { ...(event.after!.value as Record<string, any>), resultVersion: null } }])
  assert.throws(() => readUserVaultWriteReceipt({ ...event, after: { ...event.after!, ...patch } }, owner, request, digest));
 assert.throws(() => readUserVaultWriteReceipt(event, owner, request, 'vault-write-mac-v1:' + '0'.repeat(64)));
 assert.throws(() => readUserVaultWriteReceipt(event, owner, { ...request, expectedVersion: version }, digest));
});
test('delete receipts require an existing version and acknowledge deletion explicitly', () => {
 const request = parseUserVaultWrite({ action: 'delete', id: 'synthetic-record', writeId: 'synthetic-delete', expectedVersion: version });
 const ack = { ...request, resultVersion: null }, digest = userVaultWriteDigest(key, owner, plane, request);
 const event = createUserVaultWriteReceipt(owner, ack, digest, '2026-10-17T00:00:00.000Z');
 assert.deepEqual(readUserVaultWriteReceipt(event, owner, request, digest), ack);
 assert.throws(() => parseUserVaultWriteAcknowledgment({ ...ack, resultVersion: nextVersion }));
 assert.throws(() => parseUserVaultWriteAcknowledgment({ ...ack, expectedVersion: null }));
});
