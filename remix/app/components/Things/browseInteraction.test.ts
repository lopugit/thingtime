import assert from 'node:assert/strict';
import test from 'node:test';
import { browseClickIntent, browseMenuPosition } from './browseInteraction';

const click = { button: 0, detail: 1, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

test('Things, file and device activation opens on the first ordinary click or keyboard activation', () => {
  assert.equal(browseClickIntent(click), 'open');
  assert.equal(browseClickIntent({ ...click, detail: 0 }), 'open');
});

test('selection modifiers reserve the gesture for selection', () => {
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey']) {
    assert.equal(browseClickIntent({ ...click, [modifier]: true }), 'select');
  }
});

test('a second click cannot repeat navigation, a file download or a selection toggle', () => {
  assert.equal(browseClickIntent({ ...click, detail: 2 }), 'ignore');
  assert.equal(browseClickIntent({ ...click, detail: 2, metaKey: true }), 'ignore');
});

test('middle, secondary and alternate clicks retain native link behavior', () => {
  for (const event of [{ button: 1 }, { button: 2 }, { altKey: true }]) {
    assert.equal(browseClickIntent({ ...click, ...event }), 'native');
  }
});

test('device action buttons anchor keyboard and pointer activation to the trigger', () => {
  const event = { type: 'click', clientX: 0, clientY: 0,
    currentTarget: { getBoundingClientRect: () => ({ left: 140, bottom: 96 }) } };
  assert.deepEqual(browseMenuPosition(event), { clientX: 140, clientY: 96 });
  assert.deepEqual(browseMenuPosition({ ...event, clientX: 155, clientY: 82 }), { clientX: 140, clientY: 96 });
  assert.deepEqual(browseMenuPosition({ ...event, type: 'contextmenu', clientX: 311, clientY: 208 }), { clientX: 311, clientY: 208 });
});
