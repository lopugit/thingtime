import assert from 'node:assert/strict';
import test from 'node:test';
import type { UseToastOptions } from '@chakra-ui/react';
import { deliverLopuToast } from './lopuToastDelivery';

function notifications() {
  const visible = new Map<string | number, UseToastOptions>();
  let next = 0, updates = 0;
  const toast = Object.assign((options: UseToastOptions = {}) => {
    const id = options.id ?? ++next;
    visible.set(id, options);
    return id;
  }, {
    isActive: (id: string | number) => visible.has(id),
    update: (id: string | number, options: UseToastOptions) => {
      assert.ok(visible.has(id), 'only an active notification can be updated');
      visible.set(id, options); updates++;
    },
  });
  return { toast, visible, updates: () => updates };
}

test('repeated editor saves replace their visible feedback while unrelated messages stay intact', () => {
  const state = notifications();
  const unrelated = deliverLopuToast(state.toast, { title: 'Upload complete' });
  const first = deliverLopuToast(state.toast, { title: 'First save' }, 'instructions-editor', 'account-a');
  const second = deliverLopuToast(state.toast, { title: 'Second save' }, 'instructions-editor', 'account-a');
  const third = deliverLopuToast(state.toast, { title: 'Third save' }, 'instructions-editor', 'account-a');
  assert.equal(first, second); assert.equal(second, third);
  assert.equal(state.updates(), 2); assert.equal(state.visible.size, 2);
  assert.equal(state.visible.get(first)?.title, 'Third save');
  assert.equal(state.visible.get(unrelated)?.title, 'Upload complete');
});

test('editor and account boundaries stay distinct and a dismissed message can be shown again', () => {
  const state = notifications();
  const first = deliverLopuToast(state.toast, {}, 'editor-a', 'account-a');
  const otherEditor = deliverLopuToast(state.toast, {}, 'editor-b', 'account-a');
  const otherAccount = deliverLopuToast(state.toast, {}, 'editor-a', 'account-b');
  const anonymous = deliverLopuToast(state.toast, {}, 'editor-a');
  assert.equal(new Set([first, otherEditor, otherAccount, anonymous]).size, 4);
  state.visible.delete(first);
  assert.equal(deliverLopuToast(state.toast, { title: 'Saved again' }, 'editor-a', 'account-a'), first);
  assert.equal(state.visible.size, 4); assert.equal(state.updates(), 0);
  assert.equal(state.visible.get(first)?.title, 'Saved again');
});

test('unkeyed messages remain separate events even when their content is identical', () => {
  const state = notifications();
  const first = deliverLopuToast(state.toast, { title: 'Saved' });
  const second = deliverLopuToast(state.toast, { title: 'Saved' });
  assert.notEqual(first, second); assert.equal(state.visible.size, 2); assert.equal(state.updates(), 0);
});
