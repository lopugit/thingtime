import { serializeTransfer, TRANSFER_FORMAT, TRANSFER_LIMITS, TransferFormatError, validateTransfer, type JsonValue } from './format';
import type { TransferBundle } from './archive';
import { readTransferFile } from './readFile';

const fail = (message: string): never => { throw new TransferFormatError(message); };

/** Snapshot JSON values without invoking getters/toJSON or silently losing
 * functions, array holes, non-finite numbers, symbols or class instances. */
export const snapshotTransferValue = (value: unknown): JsonValue => {
  const ancestors = new Set<object>();
  let budget = TRANSFER_LIMITS.manifestBytes as number;
  const visit = (input: unknown, depth: number): JsonValue => {
    if (depth > TRANSFER_LIMITS.depth || --budget < 0) return fail('Value is too large or deeply nested');
    if (input === null) return null;
    if (typeof input === 'boolean') return input;
    if (typeof input === 'string') { budget -= input.length; if (budget < 0) return fail('Value is too large'); return input; }
    if (typeof input === 'number' && Number.isFinite(input) && !Object.is(input, -0)) return input;
    if (!input || typeof input !== 'object') return fail('This value cannot be transferred losslessly as JSON');
    if (ancestors.has(input)) return fail('Circular values cannot be transferred');
    if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return fail('Only plain objects and arrays can be transferred');
    if (Object.getOwnPropertySymbols(input).length) return fail('Symbol properties cannot be transferred');
    ancestors.add(input);
    const properties = Object.getOwnPropertyDescriptors(input);
    let output: JsonValue;
    if (Array.isArray(input)) {
      if (Object.keys(properties).length !== input.length + 1) return fail('Sparse arrays and extra array properties cannot be transferred');
      const array: JsonValue[] = [];
      for (let index = 0; index < input.length; index++) {
        const property = properties[index];
        if (!property || !('value' in property)) return fail('Sparse arrays and accessors cannot be transferred');
        array.push(visit(property.value, depth + 1));
      }
      output = array;
    } else {
      const object: Record<string, JsonValue> = {};
      for (const [key, property] of Object.entries(properties)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) return fail('Unsafe property in transferred value');
        if (!property.enumerable || !('value' in property)) return fail('Hidden properties and accessors cannot be transferred');
        budget -= key.length;
        object[key] = visit(property.value, depth + 1);
      }
      output = object;
    }
    ancestors.delete(input);
    return output;
  };
  return visit(value, 0);
};

/** Also imports through the ordinary Things importer as one private data Thing.
 * The marker describes content only; it grants no authority or move intent. */
export const bundleFromValue = (value: unknown, name: string): TransferBundle => {
  const manifest = validateTransfer({ format: TRANSFER_FORMAT, version: 1, roots: ['value'], files: [], things: [
    { id: 'value', thingtime: ['data'], crystal: { name: name.slice(0, 500), transferValue: 1, value: snapshotTransferValue(value) } }
  ] });
  serializeTransfer(manifest);
  return { manifest, files: new Map() };
};

export const valueFromBundle = (bundle: TransferBundle): JsonValue => {
  const manifest = validateTransfer(bundle.manifest);
  if (manifest.files.length || bundle.files.size || manifest.things.length !== 1 || manifest.roots.length !== 1) return fail('Use Import in My Things for apps, folders or attached files');
  const thing = manifest.things[0];
  if (thing.thingtime.length !== 1 || thing.thingtime[0] !== 'data' || thing.crystal.transferValue !== 1 || !Object.prototype.hasOwnProperty.call(thing.crystal, 'value')) return fail('This is a saved Thing, not a nested value. Use Import in My Things');
  return snapshotTransferValue(thing.crystal.value);
};

export const readValueTransferFile = async (file: Blob, signal?: AbortSignal): Promise<JsonValue> => {
  signal?.throwIfAborted();
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  signal?.throwIfAborted();
  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4) return valueFromBundle(await readTransferFile(file, signal));
  if (file.size > TRANSFER_LIMITS.manifestBytes) return fail('Value file is too large');
  const text = await file.text();
  signal?.throwIfAborted();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail('Choose a JSON value or a complete Thingtime value ZIP'); }
  if (parsed && typeof parsed === 'object' && 'format' in parsed && parsed.format === TRANSFER_FORMAT) return valueFromBundle({ manifest: validateTransfer(parsed), files: new Map() });
  const value = snapshotTransferValue(parsed);
  bundleFromValue(value, 'Imported value'); // Enforce the same encoded-size cap.
  return value;
};
