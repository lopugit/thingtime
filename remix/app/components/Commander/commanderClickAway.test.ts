import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMANDER_CLICK_AWAY_EVENTS, shouldCloseCommanderForTarget } from './commanderClickAway';

test('waits for click instead of mutating the React tree during Safari touchend', () => {
	assert.deepEqual(COMMANDER_CLICK_AWAY_EVENTS, ['click', 'focusin']);
	assert.equal(COMMANDER_CLICK_AWAY_EVENTS.includes('touchend' as never), false);
});

test('closes only for a connected target outside the commander host', () => {
	const inside = { nodeType: 1 } as Node;
	const outside = { nodeType: 1 } as Node;
	const detached = { nodeType: 1 } as Node;
	const ownerDocument = {
		contains: (target: Node) => target !== detached
	};
	const root = {
		ownerDocument,
		contains: (target: Node) => target === inside
	} as unknown as HTMLElement;

	assert.equal(shouldCloseCommanderForTarget(root, inside), false);
	assert.equal(shouldCloseCommanderForTarget(root, outside), true);
	assert.equal(shouldCloseCommanderForTarget(root, detached), false);
	assert.equal(shouldCloseCommanderForTarget(root, null), false);
});
