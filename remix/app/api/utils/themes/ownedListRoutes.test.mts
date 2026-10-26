import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { OwnedListCursorError } from '../ownedListPage';
let user: any = { id: 'owner', activeFeedAlgorithmId: 'active' };
const calls: any[] = [];
const page = async (ownerId: string, cursor: string | null, key: string, signal: AbortSignal) => {
  calls.push({ ownerId, cursor, key });
  assert.ok(signal instanceof AbortSignal);
  if (cursor === 'bad') throw new OwnedListCursorError();
  return { [key]: [{ id: 'fixture' }], nextCursor: 'opaque-next' };
};
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('./themes.ts', import.meta.url).href, { namedExports: {
  listThemesForUser: async () => [{ id: 'legacy-window' }],
  listThemesPageForUser: (owner: string, cursor: string | null, signal: AbortSignal) => page(owner, cursor, 'themes', signal), saveTheme: async () => {}
} });
mock.module(new URL('../algorithms/algorithms.ts', import.meta.url).href, { namedExports: {
  listAlgorithmsForUser: async () => [{ id: 'legacy-window' }],
  listAlgorithmsPageForUser: (owner: string, cursor: string | null, signal: AbortSignal) => page(owner, cursor, 'algorithms', signal), createAlgorithm: async () => {}
} });
const { loader: themes } = await import('../../../routes/api/v1/themes/_themes');
const { loader: algorithms } = await import('../../../routes/api/v1/algorithms/_algorithms');
([['themes', themes], ['algorithms', algorithms]] as const).forEach(([key, loader]) => test(`${key}: paging opt-in, authentication, validation and legacy response`, async () => {
  user = { id: 'owner', activeFeedAlgorithmId: 'active' }; calls.length = 0;
  const request = (query: string) => loader({ request: new Request('https://fixture.test/api/v1/' + key + query) });
  const legacy = await (await request('')).json();
  assert.deepEqual(legacy[key], [{ id: 'legacy-window' }]); assert.equal('nextCursor' in legacy, false); assert.equal(calls.length, 0);
  for (const query of ['?page=1', '?page=1&cursor=opaque-current']) {
    const response = await request(query); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const body = await response.json(); assert.deepEqual(body[key], [{ id: 'fixture' }]); assert.equal(body.nextCursor, 'opaque-next'); assert.equal('complete' in body, false);
    if (key === 'algorithms') assert.equal(body.activeAlgorithmId, 'active');
  }
  assert.deepEqual(calls.map(call => call.ownerId), ['owner', 'owner']);
  assert.deepEqual(calls.map(call => call.cursor), [null, 'opaque-current']);
  for (const query of ['?page=0', '?page=2', '?cursor=opaque-current', '?page=1&page=1', '?page=1&cursor=a&cursor=b', '?page=1&cursor=bad'])
    assert.equal((await request(query)).status, 400, query);
  user = null;
  assert.equal((await request('?page=1')).status, 401);
}));
