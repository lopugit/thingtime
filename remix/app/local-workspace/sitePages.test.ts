import assert from 'node:assert/strict';
import test from 'node:test';
import { SITE_PAGE_SEEDS, sitePageCrystal, siteBlocksExcluded } from '../schemas/sitePages';
import { validateThingtimeCrystal } from '../schemas/registry';
test('shared site definitions remain canonical editable content without persisted identity', () => {
 for (const seed of SITE_PAGE_SEEDS) {
  const value = sitePageCrystal(seed), checked = validateThingtimeCrystal(['webpage'], value);
  assert.equal(checked.ok, true, seed.path); assert.equal(value.siteRoute, seed.path); assert.equal('ownerId' in value, false); assert.equal('id' in value, false);
  assert.deepEqual(value.blocks.map(block => block.native), seed.sections || [seed.key]);
 }
 assert.equal(siteBlocksExcluded('/builder'), true); assert.equal(siteBlocksExcluded('/p/private'), true); assert.equal(siteBlocksExcluded('/ode'), false);
});
