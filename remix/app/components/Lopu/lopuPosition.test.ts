import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_LOPU_POSITION,
	LOPU_POSITIONS,
	LOPU_POSITION_LABELS,
	isLopuPosition,
	lopuContainerStyle,
	lopuToastPlacement,
	normalizeLopuPosition
} from './lopuPosition';

test('bottom-left is the default and every unknown value falls back to it', () => {
	assert.equal(DEFAULT_LOPU_POSITION, 'bottom-left');
	for (const junk of [undefined, null, '', 'middle', 'TOP', 42, {}, ['top']]) {
		assert.equal(normalizeLopuPosition(junk), 'bottom-left');
		assert.equal(isLopuPosition(junk), false);
	}
});

test('every Chakra corner is accepted verbatim and has a dropdown label', () => {
	assert.deepEqual([...LOPU_POSITIONS].sort(), ['bottom', 'bottom-left', 'bottom-right', 'top', 'top-left', 'top-right']);
	for (const position of LOPU_POSITIONS) {
		assert.equal(normalizeLopuPosition(position), position);
		assert.equal(isLopuPosition(position), true);
		assert.equal(typeof LOPU_POSITION_LABELS[position], 'string');
		assert.ok(LOPU_POSITION_LABELS[position].trim().length > 0, `${position} needs a label`);
	}
	assert.equal(new Set(Object.values(LOPU_POSITION_LABELS)).size, LOPU_POSITIONS.length, 'labels must be distinct');
});

test('only the top row clears the fixed nav, all positions fit the available content width', () => {
	for (const position of LOPU_POSITIONS) {
		const style = lopuContainerStyle(position);
		assert.equal(style.pointerEvents, 'none', `${position} container must not eat clicks`);
		assert.equal(style.display, 'flex');
		assert.equal(style.transform, position.startsWith('top') ? 'translateY(70px)' : undefined, position);
		assert.equal(style.width, 'calc(100% - 16px)', position);
		assert.equal(style.maxWidth, '100%', position);
		assert.equal(style.minWidth, 0, position);
		if (position === 'top' || position === 'bottom') {
			assert.equal(style.justifyContent, 'center', position);
		} else {
			assert.equal(style.justifyContent, position.endsWith('-left') ? 'flex-start' : 'flex-end', position);
		}
	}
});

test('a toast placement pairs the Chakra position with its container style', () => {
	// No window here (node:test), so the cache read yields the default.
	assert.deepEqual(lopuToastPlacement(), { position: 'bottom-left', containerStyle: lopuContainerStyle('bottom-left') });
	assert.deepEqual(lopuToastPlacement('top-right'), { position: 'top-right', containerStyle: lopuContainerStyle('top-right') });
});
