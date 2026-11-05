// Synthetic, device-only data for the opt-in full-app acceptance test.
// Uses the canonical local writer/exporter; never imported by the application.
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { parseTransfer, serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';

const db = new WorkspaceDatabase(indexedDB);
const things = new LocalThings(db, { kind: 'anonymous' }, { assertCurrent() {}, onInvalidate: () => () => {} });

export async function seed() {
 const action = await things.create({ thingtime: ['action'], crystal: {
  name: 'Fixture rows', actionKey: 'fixture-editable-rows', version: 1, inputs: [], capabilities: [],
  steps: [{ op: 'return', value: { items: [{ id: 'one', name: 'First row' }, { id: 'two', name: 'Second row' }] } }]
 } });
 const component = await things.create({ thingtime: ['component'], crystal: {
  name: 'Fixture component', componentKey: 'fixture-editable-component', version: 1,
  args: [{ name: 'label', type: 'string', default: 'Default label' }],
  render: { tag: 'p', children: ['{label}'] }
 } });
 const page = await things.create({ thingtime: ['webpage'], crystal: {
  name: 'Editable offline fixture', version: 1, blocks: [{ id: 'frame', type: 'container', direction: 'column', gap: 4,
   css: { padding: '24px', 'max-width': '600px', margin: '0 auto' }, children: [
    { id: 'title', type: 'element', tag: 'h1', text: 'Editable fixture title' },
    { id: 'button', type: 'element', tag: 'button', text: 'Fixture button', props: { type: 'button' } },
    { id: 'icon', type: 'element', tag: 'span', text: '☆', props: { title: 'Fixture icon' } },
    { id: 'component', type: 'component', component: component.id, args: { label: 'Local component argument' } },
    { id: 'rows', type: 'container', source: { action: action.id }, children: [
     { id: 'list', type: 'collection', props: { itemsPath: 'result.items', hideSearch: true, hideSize: true, size: 'all' }, children: [
      { id: 'row-name', type: 'element', tag: 'p', text: 'Name: {item.name}' }
     ] }
    ] },
    { id: 'unused', type: 'element', tag: 'p', text: 'Remove this fixture block' }
   ] }]
 } });
 return { pageId: page.id, componentId: component.id, actionId: action.id };
}

export async function proof(id: string) {
 const page = await things.get(id);
 const exported = await things.export([id]);
 const json = serializeTransfer(exported.manifest);
 validateTransfer(parseTransfer(json));
 return { page, json, roots: exported.manifest.roots, kinds: exported.manifest.things.map(row => row.thingtime) };
}
