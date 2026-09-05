import assert from 'node:assert/strict';
import test from 'node:test';
import { isManagedPreviewComment, upsertPreviewComment } from './preview-comments.mjs';

for (const marker of ['<!-- thingtime-develop-pr-preview -->', '<!-- thingtime-admin-pr-previews -->']) {
  const options = { repository: 'example/project', number: 624, marker, body: 'Ready' };
  const owner = { id: 42, user: { login: 'owner', type: 'User' }, author_association: 'OWNER', body: `${marker}\nReady` };
  function fake(pages) {
    const calls = [];
    return { calls, request: async (path, init = {}) => { calls.push({ path, ...init }); return init.method ? {} : pages[Number(path.match(/page=(\d+)$/u)[1]) - 1]; } };
  }
  test(`${marker}: repeated status is a read-only no-op for PAT and bot writers`, async () => {
    for (const comment of [owner, { ...owner, user: { login: 'github-actions[bot]', type: 'Bot' } }]) {
      const api = fake([[comment]]);
      assert.deepEqual(await upsertPreviewComment({ ...options, request: api.request }), { changed: false });
      assert.equal(api.calls.length, 1);
    }
  });
  test(`${marker}: changed status patches the existing id and preserves its marker`, async () => {
    const api = fake([[{ ...owner, body: `${marker}\nBuilding` }]]);
    await upsertPreviewComment({ ...options, request: api.request });
    assert.deepEqual(api.calls[1], { path: '/repos/example/project/issues/comments/42', method: 'PATCH', body: { body: `${marker}\nReady` }, retries: 0 });
  });
  test(`${marker}: human quote is never mistaken for a managed status`, async () => {
    const quote = { ...owner, body: `> ${marker}\nPlease help` };
    assert.equal(isManagedPreviewComment(quote, marker), false);
    const api = fake([[quote]]);
    await upsertPreviewComment({ ...options, request: api.request });
    assert.equal(api.calls[1].method, 'POST');
  });
  test(`${marker}: untrusted authors and other marker families are preserved`, async () => {
    const comments = [{ ...owner, author_association: 'COLLABORATOR' }, { ...owner, body: '<!-- thingtime-unrelated -->\nReady' }];
    const api = fake([comments]);
    await upsertPreviewComment({ ...options, request: api.request });
    assert.equal(api.calls[1].method, 'POST');
  });
  test(`${marker}: scan paginates and cleanup never creates a new comment`, async () => {
    const api = fake([Array.from({ length: 100 }, () => ({ body: 'Human' })), [owner]]);
    await upsertPreviewComment({ ...options, request: api.request });
    assert.equal(api.calls.length, 2);
    const empty = fake([[]]);
    await upsertPreviewComment({ ...options, createIfMissing: false, request: empty.request });
    assert.equal(empty.calls.length, 1);
  });
  test(`${marker}: failed or incomplete scans never create duplicate status comments`, async () => {
    const endless = fake(Array.from({ length: 10 }, () => Array.from({ length: 100 }, () => ({ body: 'Human' }))));
    await assert.rejects(upsertPreviewComment({ ...options, request: endless.request }), /safety bound/u);
    assert.equal(endless.calls.length, 10);
    for (const request of [async () => ({}), async () => { throw new Error('transport'); }]) await assert.rejects(upsertPreviewComment({ ...options, request }));
  });
  test(`${marker}: accepted POST with a lost response is reconciled without a duplicate`, async () => {
    let current = null, posts = 0;
    const request = async (path, init = {}) => {
      if (!init.method) return current ? [current] : [];
      posts++;
      current = { ...owner, body: init.body.body };
      throw Object.assign(new Error('transient'), { status: 502 });
    };
    assert.deepEqual(await upsertPreviewComment({ ...options, request, pause: async () => {} }), { changed: false });
    assert.equal(posts, 1);
  });
  test(`${marker}: transient reads retry, permanent permission denials do not`, async () => {
    for (const [status, expected] of [[503, 3], [403, 1]]) {
      let calls = 0;
      await assert.rejects(upsertPreviewComment({ ...options, pause: async () => {},
        request: async () => { calls++; throw Object.assign(new Error('unavailable'), { status }); } }));
      assert.equal(calls, expected);
    }
  });
}
