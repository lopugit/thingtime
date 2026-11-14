import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyThingCollModAuthority as classify } from './aclWriteFenceAuthority';

const response = (privileges: unknown, users: unknown = [{ user: 'private', db: 'admin' }]) => ({
  ok: 1, authInfo: { authenticatedUsers: users, authenticatedUserRoles: [], authenticatedUserPrivileges: privileges }
});
const privilege = (resource: unknown, actions: unknown) => ({ resource, actions });
const db = 'thingtime', collection = 'things_v2';

test('effective collection, database, and documented wildcard authority', () => {
  for (const resource of [{ db, collection }, { db, collection: '' }, { db: '', collection: '' }, { anyResource: true }])
    for (const action of ['collMod', 'anyAction'])
      assert.equal(classify(response([privilege(resource, [action])]), db, collection), 'granted');
  assert.equal(classify(response([privilege({ cluster: true }, ['anyAction'])]), db, collection), 'absent');
  assert.equal(classify(response([privilege({ db, system_buckets: '' }, ['anyAction'])]), db, collection), 'absent');
  assert.equal(classify(response([privilege({ db: 'other', collection: '' }, ['collMod'])]), db, collection), 'absent');
  assert.equal(classify(response([privilege({ db: '', collection }, ['collMod'])]), db, collection), 'granted');
  assert.equal(classify(response([privilege({ db: '', collection: 'other' }, ['collMod'])]), db, collection), 'absent');
  for (const targetDb of ['local', 'config'])
    assert.equal(classify(response([privilege({ db: '', collection: '' }, ['collMod'])]), targetDb, collection), 'absent');
  for (const resource of [{ db, collection: '' }, { db: '', collection: '' }])
    assert.equal(classify(response([privilege(resource, ['collMod'])]), db, 'system.profile'), 'absent');
  assert.equal(classify(response([privilege({ db, collection: 'system.profile' }, ['collMod'])]), db, 'system.profile'), 'granted');
  assert.equal(classify(response([privilege({ db, collection }, ['find'])]), db, collection), 'absent');
});

test('absence requires a complete authenticated response; malformed entries poison even a grant', () => {
  for (const value of [null, {}, { ok: 0 }, response([], []), { ok: 1, authInfo: { authenticatedUsers: [{ user: 'x', db: 'admin' }] } },
    response([privilege({ db, collection }, 'collMod')]), response([privilege({ db, collection, unexpected: true }, ['collMod'])]),
    response([privilege({ db, collection }, ['collMod']), privilege({ db, collection: 3 }, ['find'])])])
    assert.equal(classify(value, db, collection), 'unknown');
});
