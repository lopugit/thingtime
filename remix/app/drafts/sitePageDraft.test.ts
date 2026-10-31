import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreSitePageDraft } from './sitePageDraft';
test('site page recovery validates native blocks and preserves name and audience against the original save fence', () => {
 const value = { name: 'My site', acl: ['tt:user'], blocks: [{ id: 'native', type: 'native', native: 'ode-poem' }, { id: 'text', type: 'text', text: 'Two\nlines' }], baseUpdatedAt: 'v1' };
 const restored = restoreSitePageDraft(JSON.stringify(value), 'v1'); assert.equal(restored.name, 'My site'); assert.deepEqual(restored.blocks, value.blocks);
 assert.throws(() => restoreSitePageDraft(JSON.stringify(value), 'v2'), /changed/);
 assert.throws(() => restoreSitePageDraft(JSON.stringify({ ...value, blocks: [null] }), 'v1'), /invalid/);
});
