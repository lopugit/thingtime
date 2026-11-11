import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSlot } from './contentSlots';
test('authored content slots cannot resolve prototype entries or executable names', () => {
  const authorized = () => 'authorized projection';
  const slots = Object.assign(Object.create({ inherited: authorized }), { thing: authorized });
  assert.equal(contentSlot(slots, 'thing'), authorized);
  for (const name of ['inherited', 'constructor', '__proto__', 'thing.path', 'https://foreign.test', null, { thing: true }]) assert.equal(contentSlot(slots, name), undefined);
  assert.equal(contentSlot(undefined, 'thing'), undefined);
});

test('content-slot bindings survive normal editable layout persistence', async () => {
  const { settingsDocumentBlocks } = await import('../Settings/settingsDocument');
  const saved = settingsDocumentBlocks([{ id: 'card', type: 'element', tag: 'article', children: [
    { id: 'title', type: 'element', tag: 'a', text: '{item.name}', props: { href: '{item.href}' } },
    { id: 'content', type: 'element', tag: 'div', props: { 'data-tt-content-slot': 'authorized-content' } }
  ] }]);
  assert.equal(saved[0].children?.[0].text, '{item.name}');
  assert.equal(saved[0].children?.[1].props?.['data-tt-content-slot'], 'authorized-content');
  const reload = settingsDocumentBlocks(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reload, saved);
});
