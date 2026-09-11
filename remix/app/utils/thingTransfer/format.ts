/** Portable content, not a database backup or an authorization envelope.
 * Importers must create new, private, caller-owned Things through normal APIs.
 * A clipboard's claimed source or cut intent never authorizes a move/delete.
 */
export const TRANSFER_FORMAT = 'thingtime.transfer' as const;
export const TRANSFER_VERSION = 1 as const;
export const TRANSFER_LIMITS = { manifestBytes: 16 * 1024 * 1024, things: 1000, files: 2000, fileBytes: 512 * 1024 * 1024, depth: 64 } as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type TransferThing = {
  id: string;
  thingtime: string[];
  crystal: { [key: string]: JsonValue };
  extended?: JsonValue;
  tags?: string[];
  folderId?: string;
  targetId?: string;
};
export type TransferFile = {
  id: string;
  targetId: string;
  path: string;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
};
export type ThingTransfer = {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  roots: string[];
  things: TransferThing[];
  files: TransferFile[];
};

export class TransferFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'TransferFormatError'; }
}
const invalid = (message: string): never => { throw new TransferFormatError(message); };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keys = (value: Record<string, unknown>, allowed: string[]) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`Unsupported transfer field: ${key}`);
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);
const strings = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max &&
  value.every((item) => typeof item === 'string' && item.length <= 500) && new Set(value).size === value.length;

/** Validate before handing arbitrary JSON to schema merging/rendering code. */
const json = (value: unknown, depth = 0): void => {
  if (depth > TRANSFER_LIMITS.depth) invalid('Transfer content is nested too deeply');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((entry) => json(entry, depth + 1)); return; }
  if (!object(value)) invalid('Transfer content must contain only JSON values');
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid('Unsafe property in transfer content');
    json(entry, depth + 1);
  }
};

export const validateTransfer = (value: unknown): ThingTransfer => {
  if (!object(value)) return invalid('This is not a Thingtime transfer');
  keys(value, ['format', 'version', 'roots', 'things', 'files']);
  if (value.format !== TRANSFER_FORMAT || value.version !== TRANSFER_VERSION) return invalid('Unsupported Thingtime transfer version');
  if (!Array.isArray(value.things) || !value.things.length || value.things.length > TRANSFER_LIMITS.things) return invalid('Invalid number of Things');
  if (!strings(value.roots, TRANSFER_LIMITS.things) || !value.roots.length) return invalid('Invalid transfer roots');
  if (!Array.isArray(value.files) || value.files.length > TRANSFER_LIMITS.files) return invalid('Invalid number of files');
  const docs = new Map<string, TransferThing>();
  for (const thing of value.things) {
    if (!object(thing)) return invalid('Invalid Thing');
    keys(thing, ['id', 'thingtime', 'crystal', 'extended', 'tags', 'folderId', 'targetId']);
    if (!id(thing.id) || docs.has(thing.id)) return invalid('Invalid or duplicate Thing ID');
    if (!strings(thing.thingtime, 32) || !thing.thingtime.length || !thing.thingtime.every(id)) return invalid('Invalid Thing kinds');
    if (!object(thing.crystal)) return invalid('Invalid Thing content');
    json(thing.crystal);
    if (thing.extended !== undefined) json(thing.extended);
    if (thing.tags !== undefined && !strings(thing.tags, 500)) return invalid('Invalid tags');
    for (const field of ['folderId', 'targetId']) if (thing[field] !== undefined && !id(thing[field])) return invalid(`Invalid ${field}`);
    docs.set(thing.id, thing as TransferThing);
  }
  for (const root of value.roots) if (!docs.has(root)) return invalid('A transfer root is missing');
  for (const thing of docs.values()) {
    if (thing.folderId && !docs.get(thing.folderId)?.thingtime.includes('folder')) return invalid('A parent folder is missing');
    if (thing.targetId && !docs.has(thing.targetId)) return invalid('A relationship target is missing');
    const seen = new Set([thing.id]);
    let parent = thing.folderId;
    while (parent) {
      if (seen.has(parent)) return invalid('Circular folder hierarchy');
      seen.add(parent);
      parent = docs.get(parent)?.folderId;
    }
  }
  const files = new Set<string>();
  let bytes = 0;
  for (const file of value.files) {
    if (!object(file)) return invalid('Invalid file');
    keys(file, ['id', 'targetId', 'path', 'name', 'mime', 'bytes', 'sha256']);
    if (!id(file.id) || files.has(file.id) || docs.has(file.id)) return invalid('Invalid or duplicate file ID');
    // Never use display names as archive paths. This excludes traversal,
    // backslashes, absolute paths, URL fetching, and case-fold collisions.
    if (file.path !== `files/${files.size.toString().padStart(6, '0')}`) return invalid('Invalid archive file path');
    if (!id(file.targetId) || !docs.has(file.targetId)) return invalid('A file target is missing');
    if (typeof file.name !== 'string' || !file.name.length || file.name.length > 500 || [...file.name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return invalid('Invalid file name');
    if (typeof file.mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mime) || file.mime.length > 200) return invalid('Invalid file type');
    if (typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0) return invalid('Invalid file size');
    bytes += file.bytes;
    if (bytes > TRANSFER_LIMITS.fileBytes) return invalid('Transfer files are too large');
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) return invalid('Invalid file checksum');
    files.add(file.id);
  }
  return value as ThingTransfer;
};

export const parseTransfer = (text: string): ThingTransfer => {
  if (text.length > TRANSFER_LIMITS.manifestBytes || new TextEncoder().encode(text).byteLength > TRANSFER_LIMITS.manifestBytes) return invalid('Transfer manifest is too large');
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalid('This file does not contain valid JSON'); }
  return validateTransfer(value);
};

export const serializeTransfer = (value: ThingTransfer): string => {
  validateTransfer(value);
  const text = JSON.stringify(value, null, 2);
  if (new TextEncoder().encode(text).byteLength > TRANSFER_LIMITS.manifestBytes) return invalid('Transfer manifest is too large');
  return text;
};
