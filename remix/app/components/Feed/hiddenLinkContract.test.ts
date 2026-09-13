import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { thingEntityLink } from '../Thingtime/ContextMenu/thingEntityLink';

// The hidden-link secret is minted, projected and honoured off ONE condition
// everywhere on the server: `acl.includes('tt:hidden')` (things.ts —
// createThing mints, updateThing re-mints on re-entry, toPublicPosts projects
// to the owner, canView admits key holders). The derived circle NAME is a
// different thing: visibilityFromAcl reports 'custom' whenever tt:custom rides
// along, and the audience picker's "🕵️ + secret link" baseline composes
// exactly that acl — tt:custom AND tt:hidden together.
//
// So a post can hold a real, owner-visible linkKey while its `visibility`
// reads 'custom'. The inherited Thing copy-link menu item surfaces
// the key at all; gating it on `post.visibility === 'hidden'` silently hid the
// link for every custom audience that opted into one — the key existed, the
// owner had it in their own payload, and nothing would show it.
//
// tsc cannot see this: both spellings typecheck, and the wrong one looks more
// explicit. Pin it here, next to the onChanged contract, for the same reason.

const feedDir = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(resolve(feedDir, ...segments), 'utf8');

test('PostCard inherits a hidden link derived from the owner-projected key, not circle name', () => {
  assert.match(read('PostCard.tsx'), /<PostThingMenu/);
  assert.match(read('PostThingMenu.tsx'), /<PersistedThingMenu[^>]*initialThing=\{post\}/s);
  assert.match(read('../Thingtime/ContextMenu/PersistedThingMenu.tsx'), /thingEntityLink\(href, window.location.origin, thing, user\?\.id\)/);
  for (const visibility of ['custom', 'hidden']) {
    const thing = { visibility, author: { id: 'owner' }, linkKey: 'test & + / key' };
    const url = thingEntityLink('/post/test', 'https://thingtime.test', thing, 'owner');
    assert.equal(url.searchParams.get('key'), thing.linkKey);
    assert.equal(url.pathname, '/post/test');
    assert.ok(!url.href.includes('test & + / key'), 'secret must be URL encoded');
    assert.equal(thingEntityLink('/post/test?key=stale', url.origin, thing, 'other').searchParams.has('key'), false);
    assert.equal(thingEntityLink('/post/test', url.origin, thing).searchParams.has('key'), false);
  }
});

test('the picker baseline that promises a secret link really composes tt:hidden', () => {
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
