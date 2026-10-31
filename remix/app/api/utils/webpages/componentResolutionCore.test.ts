import assert from 'node:assert/strict';
import test from 'node:test';
import { selectComponent } from './componentResolutionCore';

const author = { shareId: 'author-card', ownerId: 'author', crystal: { componentKey: 'card', version: 1 } };
const visitor = { shareId: 'visitor-card', ownerId: 'visitor', crystal: { componentKey: 'card', version: 99 } };

test('shared component keys stay bound to the composition author, not its visitor', () => {
	assert.equal(selectComponent('card', [visitor, author], 'author'), author);
	assert.equal(selectComponent('card', [author], 'author'), author);
});

test('missing author bindings never resolve a stranger component', () => {
	assert.equal(selectComponent('card', [visitor], 'author'), null);
	assert.equal(selectComponent('card', [author], null), null);
});

test('explicit ids and platform bindings retain their precedence', () => {
	const seeded = { ...author, shareId: 'component-card', ownerId: 'system' };
	assert.equal(selectComponent('author-card', [seeded, author], 'author'), author);
	assert.equal(selectComponent('card', [author, seeded], 'author'), seeded);
});

test('selects the highest author version, independently of query ordering', () => {
	const newer = { ...author, shareId: 'author-card-2', crystal: { ...author.crystal, version: 2 } };
	assert.equal(selectComponent('card', [author, newer, visitor], 'author'), newer);
});
