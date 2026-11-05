import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationHistoryAccess, notificationHistoryRefusalKey, subscribeNotificationHistoryAccess } from './notificationHistoryAccess';
const scope = { kind: 'account', origin: 'https://access.test', ownerId: 'owner', dataPlane: 'home' } as const;
const fixture = () => {
 const values = new Map<string, string>();
 return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } };
};
test('persisted refusal gates a fresh scope without blocking other owners, origins or planes', () => {
 const { values, storage } = fixture(); values.set(notificationHistoryRefusalKey(scope), 'opaque-refusal');
 const access = notificationHistoryAccess(scope, () => storage);
 assert.equal(access.canReadCached(), false);
 for (const other of [{ ...scope, ownerId: 'other' }, { ...scope, origin: 'https://other.test' }, { ...scope, dataPlane: 'other' }]) assert.equal(notificationHistoryAccess(other, () => storage).canReadCached(), true);
 assert.equal(access.authorize(access.beginRead()), true); assert.equal(access.canReadCached(), true); assert.equal(values.size, 0);
});
test('new refusals in this context or another tab fence previously started responses', () => {
 const { values, storage } = fixture(), access = notificationHistoryAccess(scope, () => storage);
 access.authorize(access.beginRead());
 const first = access.beginRead(); access.refuse();
 assert.equal(access.authorize(first), false); assert.equal(access.canReadCached(), false);
 assert.equal(access.authorize(access.beginRead()), true);
 const second = access.beginRead(); values.set(notificationHistoryRefusalKey(scope), 'newer-other-tab-refusal');
 assert.equal(access.authorize(second), false); assert.equal(access.canReadCached(), false);
 assert.equal(access.authorize(access.beginRead()), true);
});
test('unavailable, blocked and silently failing marker storage fail closed', () => {
 for (const storage of [() => undefined, () => { throw new Error('Blocked'); }, () => ({ getItem() { return null; }, setItem() { throw new Error('Read-only storage'); }, removeItem() {} }), () => ({ getItem() { return null; }, setItem() {}, removeItem() {} }), () => ({ getItem() { return 'refused'; }, setItem() {}, removeItem() {} })]) {
  const access = notificationHistoryAccess(scope, storage);
  assert.equal(access.canReadCached(), false); assert.equal(access.authorize(access.beginRead()), false);
  access.refuse(); assert.equal(access.canReadCached(), false);
 }
});


test('same-context stale refusals notify only their scope and tolerate failed listeners and cleanup', () => {
 const { storage } = fixture(), access = notificationHistoryAccess(scope, () => storage);
 const other = { ...scope, ownerId: 'unrelated' };
 let retired = 0, unrelated = 0;
 const broken = subscribeNotificationHistoryAccess(scope, () => { throw new Error('Observer failed'); });
 const stop = subscribeNotificationHistoryAccess(scope, () => { retired++; assert.equal(access.canReadCached(), false); });
 const stopOther = subscribeNotificationHistoryAccess(other, () => { unrelated++; });
 try {
  access.authorize(access.beginRead());
  const oldRead = access.beginRead();
  assert.equal(access.authorize(access.beginRead()), true, 'A newer query succeeds before the old refusal arrives');
  access.refuse();
  assert.equal(retired, 1, 'Late403 retires same-context presentation even when its promise result is stale');
  assert.equal(unrelated, 0); assert.equal(access.authorize(oldRead), false);
  stop(); access.refuse();
  assert.equal(retired, 1, 'Unsubscribed observers receive no later refusal');
  assert.equal(unrelated, 0);
 } finally { broken(); stop(); stopOther(); }
});
