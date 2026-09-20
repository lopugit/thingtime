import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { thingEntityLink } from '../Thingtime/ContextMenu/thingEntityLink';

// Mixed audiences can include tt:hidden. Every allowed viewer copies the same
// canonical URL, without requiring an owner-projected legacy link key.

const feedDir = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(resolve(feedDir, ...segments), 'utf8');

test('PostCard shares canonical URLs for hidden and mixed audiences', () => {
  assert.match(read('PostCard.tsx'), /<PostThingMenu/);
  assert.match(read('PostThingMenu.tsx'), /<PersistedThingMenu[^>]*initialThing=\{post\}/s);
  assert.match(read('../Thingtime/ContextMenu/PersistedThingMenu.tsx'), /thingEntityLink\(href, window.location.origin, thing, user\?\.id, sharedAccess.key\)/);
  for (const visibility of ['custom', 'hidden']) {
    const thing = { visibility, author: { id: 'owner' }, linkKey: 'test & + / key' };
    const url = thingEntityLink('/post/test', 'https://thingtime.test', thing, 'owner');
    assert.equal(url.searchParams.has('key'), false);
    assert.equal(url.pathname, '/post/test');
    assert.ok(!url.href.includes('test & + / key'), 'legacy secret must not be shared');
    assert.equal(thingEntityLink('/post/test?key=stale', url.origin, thing, 'other').searchParams.has('key'), false);
    assert.equal(thingEntityLink('/post/test', url.origin, thing).searchParams.has('key'), false);
  }
});

test('the anyone-with-the-link baseline composes tt:hidden', () => {
  const modal = read('CustomAudienceModal.tsx');
  const composed = modal.match(/export const composeCustomAcl = [\s\S]*?\n\];/);
  assert.ok(composed, 'CustomAudienceModal must still expose composeCustomAcl');
  assert.match(composed[0], /baseline === 'hidden' \? \['tt:hidden'\]/, 'the 🕵️ baseline must emit tt:hidden');
  assert.match(composed[0], /'tt:custom'/, 'a composed custom audience always carries the tt:custom marker');
});

test('visibilityFromAcl reports custom ahead of hidden — the reason the name gate was wrong', () => {
  const registry = read('..', '..', 'schemas', 'registry.ts');
  const body = registry.match(/export const visibilityFromAcl = [\s\S]*?\n\};/);
  assert.ok(body, 'registry must still expose visibilityFromAcl');
  const customAt = body[0].indexOf('ACL_CUSTOM');
  const hiddenAt = body[0].indexOf('ACL_HIDDEN');
  assert.ok(customAt >= 0 && hiddenAt >= 0, 'visibilityFromAcl must still rank both tt:custom and tt:hidden');
  assert.ok(
    customAt < hiddenAt,
    'custom outranks hidden, so an acl carrying both never reports visibility "hidden" — any UI keyed on that name misses it'
  );
});

test('guest menu shares omit both presented and stale secret keys', () => {
  const url = thingEntityLink('/media/video?key=stale', 'https://thingtime.test', undefined, undefined, 'current-root-key');
  assert.equal(url.searchParams.has('key'), false);
  assert.equal(thingEntityLink('/media/video?key=stale', url.origin, undefined).searchParams.has('key'), false);
});
