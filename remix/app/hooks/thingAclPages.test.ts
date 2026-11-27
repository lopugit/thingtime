import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCompleteThingAcl } from './thingAclPages';
test('owner audience load traverses all pages beyond the former ACL limit', async () => {
  const seen: Array<string | undefined> = [];
  const acl = await readCompleteThingAcl(async ({ cursor }) => {
    seen.push(cursor);
    return { ok: true, entries: Array.from({ length: 50 }, (_, n) => `tt:user/person-${(cursor ? 50 : 0) + n}`), nextCursor: cursor ? null : 'second', revision: 'generation-a' };
  }, 'thing');
  assert.equal(acl.entries.length, 100); assert.equal(acl.revision, 'generation-a'); assert.deepEqual(seen, [undefined, 'second']);
});
test('audience load refuses a changed generation, repeated cursor or failed page', async () => {
  for (const failure of ['revision', 'cursor', 'error']) {
    let calls = 0;
    await assert.rejects(readCompleteThingAcl(async () => {
      calls++;
      if (calls === 2 && failure === 'error') return { ok: false, error: 'Revoked' };
      return { ok: true, entries: ['tt:user'], nextCursor: calls === 1 || failure === 'cursor' ? 'second' : null,
        revision: calls === 2 && failure === 'revision' ? 'changed' : 'original' };
    }, 'thing'));
    assert.equal(calls, 2);
  }
});
test('an identity change abort clears an incomplete owner audience read', async () => {
  const controller = new AbortController();
  await assert.rejects(readCompleteThingAcl(async () => {
    controller.abort(); return { ok: true, entries: ['tt:user'], nextCursor: null, revision: null };
  }, 'thing', { signal: controller.signal }), { name: 'AbortError' });
});
