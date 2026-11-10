import assert from 'node:assert/strict';
import test from 'node:test';
import { customisedShareLink, validShareDestination } from './sharePreviewLink';
import { sharePreviewBlocks } from './sharePreviewBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { findBlock } from '../Builder/webpageBlocks';
import { buildThingEntityMenu } from '../Thingtime/ContextMenu/thingEntityMenu';
const origin = 'https://thingtime.test';
test('customising presentation preserves exact destination and changes only design parameters', () => {
 const url = new URL(customisedShareLink('/p/public-id?key=legacy&tab=photos&previewTheme=bad&previewTheme=editorial#details', origin, { template: 'night-garden', layout: 'gallery' }));
 assert.equal(url.pathname, '/p/public-id'); assert.equal(url.searchParams.get('key'), 'legacy');
 assert.equal(url.searchParams.get('tab'), 'photos'); assert.equal(url.hash, '#details');
 assert.deepEqual(url.searchParams.getAll('previewTheme'), ['night-garden']); assert.equal(url.searchParams.get('previewLayout'), 'gallery');
 assert.equal(customisedShareLink('/invite/unique-token', origin, {}), `${origin}/invite/unique-token`);
 for (const input of ['https://elsewhere.test/p/id', 'data:text/plain,blocked', 'https://user:password@thingtime.test/']) assert.throws(() => validShareDestination(input, origin));
});
test('customiser remains an editable intrinsic document with individual choice fields and controls', () => {
 const blocks = settingsDocumentBlocks(sharePreviewBlocks);
 for (const id of ['share-heading', 'share-image', 'share-content-title', 'share-content-description', 'share-templates-name', 'share-templates-description', 'share-layouts-choice', 'share-copy', 'share-retry', 'share-custom-link-block']) assert.ok(findBlock(blocks, id), id);
 const serialized = JSON.stringify(blocks);
 assert.ok(!serialized.includes('unique-token')); assert.ok(!serialized.includes('native:'));
 assert.equal(findBlock(blocks, 'share-templates')?.type, 'collection');
});
test('share customisation is a distinct client verb alongside permissions and copying', () => {
 const menu = buildThingEntityMenu({ 'copy-link': true, 'share-preview': true, share: true });
 assert.deepEqual(menu.sections.flatMap(section => section.actions).map(action => action.command), ['copy-link', 'share-preview', 'share']);
});
