import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleFromValue, readValueTransferFile, snapshotTransferValue, valueFromBundle } from './value';
import { encodeTransferArchive } from './archive';
import { parseTransfer, serializeTransfer } from './format';
import { buildThingContextMenuModel } from '../../components/Thingtime/ContextMenu/contextMenuModel';

test('nested values retain types through portable JSON and ZIP, including numeric strings', async () => {
  for (const value of ['42', 'null', '', null, false, 42, ['🥰', { nested: true }]]) {
    const bundle = bundleFromValue(value, 'My value');
    const json = serializeTransfer(bundle.manifest);
    assert.deepEqual(valueFromBundle({ manifest: parseTransfer(json), files: new Map() }), value);
    assert.deepEqual(await readValueTransferFile(new Blob([json])), value);
    assert.deepEqual(await readValueTransferFile(new Blob([(await encodeTransferArchive(bundle)).slice().buffer as ArrayBuffer])), value);
  }
});

test('ordinary JSON import validates values without invoking executable object hooks', async () => {
  assert.deepEqual(await readValueTransferFile(new Blob(['{"a":[1,"2"]}'])), { a: [1, '2'] });
  let called = false;
  assert.throws(() => snapshotTransferValue({ get value() { called = true; return 1; } }), /accessors/);
  assert.equal(called, false);
  for (const value of [undefined, NaN, Infinity, -0, () => 1, Symbol(), BigInt(2), new Date(), new Map(), new Array(2)]) assert.throws(() => bundleFromValue(value, 'bad'));
  const cycle: any = {}; cycle.self = cycle;
  assert.throws(() => bundleFromValue(cycle, 'bad'), /Circular/);
  const shared = { a: true };
  assert.deepEqual(snapshotTransferValue([shared, shared]), [{ a: true }, { a: true }]);
  await assert.rejects(readValueTransferFile(new Blob(['{"__proto__":{"polluted":true}}'])), /Unsafe/);
  const array: any = [1]; array.extra = 2;
  assert.throws(() => snapshotTransferValue(array), /extra array/);
});

test('saved Things are not silently mistaken for nested values and cancellation is respected', async () => {
  const bundle = bundleFromValue(true, 'value');
  delete bundle.manifest.things[0].crystal.transferValue;
  assert.throws(() => valueFromBundle(bundle), /saved Thing/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readValueTransferFile(new Blob(['1']), controller.signal), /abort/i);
});

test('read-only nested menus offer download but never import, paste or cut', () => {
  const commands = (readonly: boolean) => buildThingContextMenuModel({ readonly }).sections.flatMap(section => section.actions.map(action => action.command));
  assert.ok(commands(true).includes('download-value'));
  assert.ok(commands(true).includes('copy'));
  for (const command of ['import-value', 'cut', 'paste']) {
    assert.ok(!commands(true).includes(command));
    assert.ok(commands(false).includes(command));
  }
});
