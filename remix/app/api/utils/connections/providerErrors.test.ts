import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authedJson, connectionProviderById } from './providers';
import { safeProviderError } from './providerErrors';
const youtube = 'https://www.googleapis.com/youtube/v3/subscriptions';
const facebook = 'https://graph.facebook.com/v23.0/me/posts';
const privateText = 'synthetic-token https://private.example/account';

test('provider reasons select only fixed copy from verified hosts and typed codes', () => {
  for (const reason of ['SERVICE_DISABLED', 'accessNotConfigured'])
    assert.match(safeProviderError(youtube, 403, { error: { message: privateText, errors: [{ reason }], details: [{ reason }] } })!, /Enable YouTube Data API/);
  assert.match(safeProviderError(youtube, 403, { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } })!, /permission/);
  assert.match(safeProviderError(youtube, 403, { error: { errors: [{ reason: 'quotaExceeded' }] } })!, /quota/);
  assert.match(safeProviderError(youtube, 401, { error: {} })!, /invalid or expired/);
  for (const [code, pattern] of [[190, /authorization/], [10, /permission/], [200, /permission/], [100, /requested field/]] as const) {
    const text = safeProviderError(facebook, 400, { error: { code, error_subcode: privateText, message: privateText, fbtrace_id: privateText } })!;
    assert.match(text, pattern);
    assert.ok(!text.includes(privateText));
  }
  for (const data of [null, {}, { error: { code: '100', message: privateText } }, { error: { code: 999, message: privateText } }])
    assert.equal(safeProviderError(facebook, 400, data), null);
  for (const url of ['https://www.googleapis.com.attacker.test/youtube/v3/subscriptions', 'https://www.googleapis.com/other'])
    assert.equal(safeProviderError(url, 403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }), null);
});

test('authenticated fetch bounds error parsing and keeps unknown/malformed errors generic', async t => {
  let body = '';
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 400 }));
  for (const value of [privateText, JSON.stringify({ error: { code: 999, message: privateText } }), JSON.stringify({ error: { code: 100, message: 'x'.repeat(17000) } })]) {
    body = value;
    assert.deepEqual(await authedJson(facebook), { ok: false, status: 502, error: 'The provider answered 400.' });
  }
  body = JSON.stringify({ error: { code: 100, message: privateText } });
  const result = await authedJson(facebook);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /requested field/);
});

test('YouTube total playlist failure fails while empty success and partial content remain usable', async t => {
  let mode = 'failed';
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/subscriptions')) return Response.json({ items: ['a', 'b'].map(id => ({ snippet: { resourceId: { channelId: id } } })) });
    if (url.pathname.endsWith('/channels')) return Response.json({ items: ['a', 'b'].map(id => ({ id, snippet: { title: id }, contentDetails: { relatedPlaylists: { uploads: id } } })) });
    assert.ok(url.pathname.endsWith('/playlistItems'));
    if (mode === 'failed' || url.searchParams.get('playlistId') === 'a') return Response.json({ error: { message: privateText } }, { status: 500 });
    return Response.json({ items: mode === 'empty' ? [] : [{ contentDetails: { videoId: 'synthetic-video' }, snippet: { title: 'Synthetic upload' } }] });
  });
  const provider = connectionProviderById('youtube-account')!;
  const fetchFeed = () => provider.fetchFeed({ providerAccountId: 'synthetic', config: {} }, { limit: 20, tokens: { accessToken: 'synthetic' }, pages: 1 });
  assert.deepEqual(await fetchFeed(), { ok: false, status: 502, error: 'The provider answered 500.' });
  mode = 'empty';
  assert.deepEqual(await fetchFeed(), { ok: true, items: [] });
  mode = 'partial';
  const result = await fetchFeed();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.items.length, 1);
});
