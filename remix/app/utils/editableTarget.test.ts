import assert from 'node:assert/strict';
import test from 'node:test';

import { isEditableTarget, shouldIgnoreGlobalKeydown } from './editableTarget';

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable });

test('form controls that accept typing are editable targets', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(isEditableTarget(el(tag)), true, `${tag} should be editable`);
  }
});

test('ordinary elements are not editable targets', () => {
  for (const tag of ['DIV', 'BODY', 'BUTTON', 'A', 'SPAN']) {
    assert.equal(isEditableTarget(el(tag)), false, `${tag} should not be editable`);
  }
});

test('contentEditable wins regardless of tag — Editor.js blocks are DIVs', () => {
  assert.equal(isEditableTarget(el('DIV', true)), true);
  // isContentEditable is reported on descendants too, so a caret nested deep
  // inside a block still guards.
  assert.equal(isEditableTarget(el('SPAN', true)), true);
});

test('tagName matching is exact and case-sensitive — DOM reports uppercase', () => {
  // A stray lowercase `tagName` must not be coerced into a match; real DOM
  // elements always report uppercase for HTML documents.
  assert.equal(isEditableTarget(el('input')), false);
});

test('non-element targets never crash the guard', () => {
  // window-level listeners see `document`, `window`, and detached targets.
  for (const target of [null, undefined, 'INPUT', 42, {}, { tagName: undefined }]) {
    assert.equal(isEditableTarget(target), false);
  }
});

test('a truthy-but-not-true isContentEditable does not count', () => {
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: 'yes' }), false);
});

test('global keydown is ignored inside editable targets', () => {
  assert.equal(shouldIgnoreGlobalKeydown({ target: el('TEXTAREA') }), true);
  assert.equal(shouldIgnoreGlobalKeydown({ target: el('DIV', true) }), true);
});

test('global keydown is ignored mid-IME-composition even outside a field', () => {
  assert.equal(shouldIgnoreGlobalKeydown({ target: el('DIV'), isComposing: true }), true);
});

test('global keydown runs on the page background', () => {
  assert.equal(shouldIgnoreGlobalKeydown({ target: el('DIV'), isComposing: false }), false);
  assert.equal(shouldIgnoreGlobalKeydown({ target: null }), false);
});

test('a missing event is not treated as a reason to bail', () => {
  assert.equal(shouldIgnoreGlobalKeydown(null), false);
  assert.equal(shouldIgnoreGlobalKeydown(undefined), false);
});
