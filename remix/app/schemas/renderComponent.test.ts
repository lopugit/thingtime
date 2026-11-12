import assert from 'node:assert/strict';
import test from 'node:test';
import { validateThingtimeCrystal } from './registry';
import { renderComponentDeclaration, THING_PRESENTATION_REQUIREMENTS } from '../components/Thingtime/renderComponentDeclaration';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

const validate = (kinds: string[], input: Record<string, unknown>) => {
  const result = validateThingtimeCrystal(kinds, { type: 'text', ...input });
  if (result.ok === false) throw new Error(result.error);
  return result.crystal;
};

for (const kinds of [['post'], ['post', 'comment'], ['comment'], ['data']]) {
  test(`${kinds.join('+')} retains explicit presentation through content edits with its content allowlist intact`, () => {
    const created = validate(kinds, { text: 'original', renderComponent: { id: 'component-1', ownerId: 'not-a-grant' }, unknownContent: 'strip from typed content' });
    assert.deepEqual(created.renderComponent, { id: 'component-1' });
    if (!kinds.includes('data')) assert.equal(created.unknownContent, undefined);
    const edited = validate(kinds, { ...created, text: 'edited', richText: null });
    assert.deepEqual(edited.renderComponent, created.renderComponent);
    assert.equal(edited.text, 'edited');
    assert.equal(renderComponentDeclaration(edited)?.kind, 'reference');
    const unavailable = validate(kinds, { ...edited, renderComponent: null });
    assert.equal(unavailable.renderComponent, null);
    assert.equal(renderComponentDeclaration(unavailable)?.kind, 'invalid');
    assert.equal('renderComponent' in validate(kinds, { text: 'replacement' }), false);
  });
}

test('embedded presentation uses the canonical Component sanitizer', () => {
  const render = { tag: 'p', children: ['{text}'], onclick: 'not executable' };
  const input = { render, name: 'Inline', savedArgs: { prefix: 'hello' }, privateOwner: 'drop' };
  const expected = validate(['component'], input);
  const stored = validate(['post'], { text: 'body', renderComponent: input });
  assert.deepEqual(stored.renderComponent, expected);
  const unnamed = validate(['comment'], { text: 'body', renderComponent: { render: { tag: 'p', children: ['{text}'] } } });
  assert.equal(renderComponentDeclaration(unnamed)?.kind, 'embedded');
});

test('typed and free-form writes reject malformed explicit declarations consistently', () => {
  for (const renderComponent of ['text', [], {}, { id: '' }, { id: 'a/b' }, { id: '$owner' }, { id: 'a b' }, { id: 'a', render: {} }, { render: [] }, { render: {} }, { render: { foo: 'bar' } }]) {
    for (const kind of ['post', 'comment', 'data']) {
      const result = validateThingtimeCrystal([kind], { text: 'body', renderComponent });
      assert.equal(result.ok, false, `${kind}: ${JSON.stringify(renderComponent)}`);
    }
  }
});

test('presentation writes negotiate the additive contracts and reject older/missing/breaking origins', () => {
  for (const [feature, minimum] of Object.entries(THING_PRESENTATION_REQUIREMENTS)) {
    assert.equal(capabilitySatisfies(minimum, minimum), true, feature);
    assert.equal(capabilitySatisfies(undefined, minimum), false, feature);
    assert.equal(capabilitySatisfies('2.0.0', minimum), false, feature);
    assert.equal(capabilitySatisfies(feature === 'api.things' ? '1.41.0' : '1.12.0', minimum), false, feature);
  }
});
