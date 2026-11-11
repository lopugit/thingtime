import assert from 'node:assert/strict';
import test from 'node:test';

import { expandedActionGroup, isExpandedPageAction, isExpandedPageControl } from './PageActionSurface';

const target = (matches: string[]) => ({
	closest: (selector: string) => selector.split(', ').some((part) => matches.includes(part)) ? {} as Element : null
});

test('a row button outside a fieldset cannot collect unrelated named fields', () => {
	const group = {} as HTMLElement;
	const boundary = { contains: (element: Element) => element === group } as HTMLElement;
	const plain = { closest: () => null } as unknown as HTMLElement;
	const grouped = { closest: () => group } as unknown as HTMLElement;
	assert.equal(expandedActionGroup(plain, boundary), plain);
	assert.equal(expandedActionGroup(grouped, boundary), group);
});

test('expanded page actions use one handler outside nested Component boundaries', () => {
	assert.equal(isExpandedPageAction(target(['[data-tt-action]'])), true);
	assert.equal(isExpandedPageAction(target(['[data-tt-action]', '[data-live]'])), false);
	assert.equal(isExpandedPageAction(target(['[data-tt-action]', '[data-tt-native-upload]'])), false);
	assert.equal(isExpandedPageAction(target(['[data-tt-action]', '[data-tt-discussion]'])), false);
	assert.equal(isExpandedPageAction(target([])), false);
	assert.equal(isExpandedPageAction(null), false);
	assert.equal(isExpandedPageControl(target([])), true, 'expanded form inputs can use Enter');
	assert.equal(isExpandedPageControl(target(['[data-live]'])), false, 'a nested Component owns its Enter key');
});
