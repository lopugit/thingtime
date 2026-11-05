import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresCollectionPagingContract } from './savedCollectionContract';
test('new saved collection and map fields require updated capability, legacy blocks do not', () => {
 assert.equal(requiresCollectionPagingContract([{ type: 'collection', props: { itemsPath: 'items' } }]), false);
 assert.equal(requiresCollectionPagingContract([{ type: 'collection', props: { source: { action: 'read', offsetInput: 'offset' } } }]), true);
 assert.equal(requiresCollectionPagingContract([{ tag: 'tt-collection', props: { selectedKey: '{query.id}' } }]), true);
 assert.equal(requiresCollectionPagingContract([{ tag: 'tt-mapbox', props: { onSelectQueryParams: { view: 'places' } } }]), true);
 assert.equal(requiresCollectionPagingContract([{ tag: 'div', props: { total: 2 } }]), false);
});
