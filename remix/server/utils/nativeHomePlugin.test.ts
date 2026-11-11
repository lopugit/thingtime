import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import install from '../plugins/native-home-runtime';
import { NATIVE_HOME_HOST_KEY } from '../../app/api/utils/documentStore/nativeHomeSelection';

test('native shutdown ownership is private, exclusive and retired by the canonical Nitro close hook', async () => {
 const key = Symbol.for('thingtime.native-home.close'); let onClose: (() => Promise<void>) | undefined;
 const nitro = { hooks: { hook(name: string, fn: () => Promise<void>) { assert.equal(name, 'close'); onClose = fn; } } };
 (install as any)(nitro); assert.equal(onClose, undefined); assert.equal(Reflect.has(globalThis, key), false);
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 try {
  (install as any)(nitro); assert.equal(typeof Reflect.get(globalThis, key), 'function');
  assert.equal(Object.getOwnPropertyDescriptor(globalThis, key)!.enumerable, false);
  assert.equal(Object.getOwnPropertyDescriptor(globalThis, key)!.writable, false);
  assert.throws(() => (install as any)(nitro), /already installed/);
  await Reflect.get(globalThis, key)(); await onClose!(); assert.equal(Reflect.has(globalThis, key), false);
 } finally { Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY); Reflect.deleteProperty(globalThis, key); }
});

test('Nitro auto-scanned plugin directory contains no executable test modules', async () => {
 const entries = await readdir(new URL('../plugins/', import.meta.url), { recursive: true });
 assert.deepEqual(entries.filter(name => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)), [],
  'Plugin tests belong outside server/plugins: Nitro imports every module there into production');
});
