import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareDraft } from './prepare';
import { validateTransfer } from '../utils/thingTransfer/format';
const fixture = () => JSON.parse(readFileSync(new URL('../../../MCP/test/fixtures/affirmation.transfer.json', import.meta.url), 'utf8'));
test('canonical round trip preserves editable component, exact text and dependency closure', async () => {
  const input = fixture();
  const prepared = await prepareDraft(input);
  validateTransfer(JSON.parse(prepared.json));
  assert.deepEqual(prepared.manifest.things.map(t => t.id), ['affirmation-page','affirmation-card']);
  assert.equal(prepared.manifest.things[1].crystal.args[0].default, input.things[1].crystal.args[0].default);
  assert.equal((await prepareDraft(prepared.json)).hash, prepared.hash);
  assert.equal((await prepareDraft(input.things[1])).manifest.things.length, 1);
});
test('private/account/action/assets are rejected in all template branches', async () => {
  for (const patch of [{ source: { action: 'secret' } }, { render: { tag: 'tt-web-platform' } }, { render: { tag: 'div', ttIf: { then: { tag: 'img', props: { src: '/api/private' } } } } }, { savedArgs: { src: 'private' } }]) {
    const input = fixture(); Object.assign(input.things[1].crystal, patch);
    await assert.rejects(() => prepareDraft(input), /Unsupported/);
  }
  const input = fixture(); input.things[1].ownerId = 'secret';
  await assert.rejects(() => prepareDraft(input), /Unsupported transfer field/);
});
test('missing and ambiguous dependencies, invalid schema, CSS escapes and partial expansion fail', async () => {
  const missing = fixture(); missing.things.pop();
  await assert.rejects(() => prepareDraft(missing), /Missing in-bundle/);
  const alias = fixture(); alias.things.push({ ...structuredClone(alias.things[1]), id: 'other' });
  await assert.rejects(() => prepareDraft(alias), /Ambiguous/);
  const schema = fixture(); schema.things[1].crystal.name = '';
  await assert.rejects(() => prepareDraft(schema), /name/);
  const css = fixture(); css.things[1].crystal.render.props.style.background = 'u\\72l(https://example.com)';
  await assert.rejects(() => prepareDraft(css), /CSS/);
  const expansion = fixture(); expansion.things[1].crystal.render = { tag: 'div', children: [{ ttRepeat: { count: 24, node: { ttRepeat: { count: 24, node: { tag: 'span', children: ['x'] } } } } }] };
  await assert.rejects(() => prepareDraft(expansion), /limit/);
});
test('bounded input and explicit root validation', async () => {
  await assert.rejects(() => prepareDraft(' '.repeat(262145)), /256 KiB/);
  await assert.rejects(() => prepareDraft('{'), /valid JSON/);
  await assert.rejects(() => prepareDraft(fixture(), 'account-thing'), /not in the supplied/);
});
