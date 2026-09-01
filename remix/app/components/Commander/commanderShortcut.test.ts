import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { isCommanderChord, shouldToggleCommanderFromKeydown, targetOwnsCommanderChord } from './commanderShortcut.ts';

/** A minimal `event.target` stand-in: only `closest` is ever consulted. */
const targetInside = (selector: string) => ({
	closest: (query: string) => (query === selector ? {} : null)
});

test('the chord is Cmd+K / Ctrl+K and nothing adjacent', () => {
	assert.equal(isCommanderChord({ code: 'KeyK', metaKey: true }), true);
	assert.equal(isCommanderChord({ code: 'KeyK', ctrlKey: true }), true);
	// events without `code` still match on `key`, case-insensitively
	assert.equal(isCommanderChord({ key: 'K', metaKey: true }), true);

	assert.equal(isCommanderChord({ code: 'KeyK' }), false, 'bare K types a letter');
	assert.equal(isCommanderChord({ code: 'KeyJ', key: 'j', metaKey: true }), false);
	assert.equal(isCommanderChord({ code: 'KeyK', metaKey: true, shiftKey: true }), false);
	assert.equal(isCommanderChord({ code: 'KeyK', metaKey: true, altKey: true }), false);
	assert.equal(isCommanderChord(null), false);
});

test('Editor.js owns CMD+K inside its own blocks; nothing else claims it', () => {
	assert.equal(targetOwnsCommanderChord(targetInside('.codex-editor')), true);
	// a plain <input>/<textarea> (login, search, the Commander itself) binds nothing
	assert.equal(targetOwnsCommanderChord(targetInside('.someOtherThing')), false);
	// window/document targets have no closest() at all — never throw on them
	assert.equal(targetOwnsCommanderChord({}), false);
	assert.equal(targetOwnsCommanderChord(null), false);
});

test('the palette takes the chord everywhere except an Editor.js block', () => {
	// the whole point: nothing focused, mid-scroll, a button focused
	assert.equal(shouldToggleCommanderFromKeydown({ code: 'KeyK', metaKey: true, target: null }), true);
	// ordinary text fields keep the muscle memory (and Cmd+K still toggles closed)
	assert.equal(shouldToggleCommanderFromKeydown({ code: 'KeyK', metaKey: true, target: targetInside('.plainInput') }), true);
	// …but the editor's link tool wins in its own blocks
	assert.equal(shouldToggleCommanderFromKeydown({ code: 'KeyK', metaKey: true, target: targetInside('.codex-editor') }), false);
	// a non-chord keydown is never ours, editor or not
	assert.equal(shouldToggleCommanderFromKeydown({ code: 'KeyK', key: 'k', target: null }), false);
});
