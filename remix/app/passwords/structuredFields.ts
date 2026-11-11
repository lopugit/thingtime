import type { PasswordField } from './model';

type JsonPath = number[];
type Kind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
export type PasswordProperty = { path: string; kind: Kind; secret: boolean; multiline: boolean };
const blocked = new Set(['__proto__', 'constructor', 'prototype']);
const own = (value: object, key: string | number) => Object.prototype.hasOwnProperty.call(value, key);
const knownLabels: Record<string, string> = { street: 'Street', street1: 'Street', street2: 'Street line 2', city: 'City', state: 'State', province: 'Province', zip: 'Postal code', postalCode: 'Postal code', country: 'Country', region: 'Region', privateKey: 'Private key', publicKey: 'Public key', metadata: 'Metadata', keyType: 'Key type', fingerprint: 'Fingerprint', year: 'Year', month: 'Month', day: 'Day', value: 'Value', label: 'Label', name: 'Name', number: 'Number' };
const publicKeys = new Set(['street', 'street1', 'street2', 'city', 'state', 'province', 'zip', 'postalCode', 'country', 'region', 'year', 'month', 'day', 'publicKey', 'keyType', 'fingerprint']);
export const passwordFieldIsSecret = (field: PasswordField) => Boolean(field.concealed || ['password', 'totp', 'ssh-key', 'credit-card-number'].includes(field.type));
const kind = (value: unknown): Kind => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as Kind;
const token = (path: JsonPath) => path.length ? path.join('.') : 'root';
const parsePath = (path: unknown): JsonPath => {
  if (path === 'root') return [];
  if (typeof path !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(path)) throw new Error('Invalid property path.');
  const result = path.split('.').map(Number);
  if (result.some(index => !Number.isSafeInteger(index))) throw new Error('Invalid property path.');
  return result;
};
function root(field: PasswordField) {
  if (!field.structured || field.type === 'structured') throw new Error('Use the JSON editor for this field.');
  if (!safeJsonNumbers(field.value || 'null')) throw new Error('Keep this field in JSON to preserve its numeric values.');
  return JSON.parse(field.value || 'null') as unknown;
}
function decimalIdentity(token: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  const digits = (match[2] + (match[3] || '')).replace(/^0+/, '');
  if (!digits) return `${match[1]}0`;
  const significant = digits.replace(/0+$/, '');
  const exponent = BigInt(match[4] || '0') - BigInt((match[3] || '').length) + BigInt(digits.length - significant.length);
  return `${match[1]}${significant}e${exponent}`;
}
function safeNumber(token: string) {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return false;
  const parsed = Number(token);
  return Number.isFinite(parsed) && (!Number.isInteger(parsed) || Number.isSafeInteger(parsed)) && decimalIdentity(token) === decimalIdentity(String(parsed));
}
/** JSON.parse/stringify must not round an untouched unknown numeric sibling.
 * Compare decimal identities without expanding exponents or capping input size. */
function safeJsonNumbers(json: string) {
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const keys: (Set<string> | null)[] = [];
  for (let index = 0; index < json.length; index++) {
    const character = json[index];
    if (character === '"') {
      const start = index;
      for (index++; index < json.length; index++) { if (json[index] === '\\') index++; else if (json[index] === '"') break; }
      let after = index + 1;
      while (/\s/.test(json[after] || '') && after < json.length) after++;
      if (json[after] === ':') {
        const names = keys.at(-1), key = JSON.parse(json.slice(start, index + 1));
        if (!names || names.has(key)) return false;
        names.add(key);
      }
      continue;
    }
    if (character === '{' || character === '[') { keys.push(character === '{' ? new Set() : null); continue; }
    if (character === '}' || character === ']') { keys.pop(); continue; }
    if (!/[0-9-]/.test(character)) continue;
    number.lastIndex = index;
    const match = number.exec(json);
    if (!match) return false;
    if (!safeNumber(match[0])) return false;
    index = number.lastIndex - 1;
  }
  return true;
}
/** Paths identify positions, never decrypted property names. Resolve them only
 * against the current private draft; no creation, coercion or prototype lookup. */
function resolve(value: unknown, path: JsonPath) {
  let current = value, parent: any, key: string | number | undefined;
  const labels: string[] = [];
  let secret = false;
  for (const index of path) {
    if (!current || typeof current !== 'object') throw new Error('Property no longer exists.');
    const keys = Object.keys(current);
    if (keys.some(key => blocked.has(key)) || index >= keys.length) throw new Error('Invalid property path.');
    parent = current; key = keys[index];
    if (!own(parent, key)) throw new Error('Property no longer exists.');
    const array = Array.isArray(parent);
    labels.push(array ? `Item ${Number(key) + 1}` : own(knownLabels, key) ? knownLabels[key] : key);
    if (!array && !publicKeys.has(key)) secret = true;
    current = parent[key];
  }
  return { value: current, parent, key, label: labels.join(' / '), secret };
}
function* propertyNodes(field: PasswordField) {
  const pending = [{ value: root(field), path: [] as JsonPath, label: field.label, secret: passwordFieldIsSecret(field) }];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.value && typeof node.value === 'object' && Object.keys(node.value).length) {
      const keys = Object.keys(node.value), array = Array.isArray(node.value);
      if (keys.some(key => blocked.has(key))) throw new Error('Use the JSON editor for this field.');
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index], label = array ? `Item ${Number(key) + 1}` : own(knownLabels, key) ? knownLabels[key] : key;
        pending.push({ value: (node.value as any)[key], path: [...node.path, index], label: node.path.length ? `${node.label} / ${label}` : label, secret: node.secret || (!array && !publicKeys.has(key)) });
      }
    } else yield node;
  }
}
export function passwordProperties(field: PasswordField): PasswordProperty[] | null {
  try {
    return [...propertyNodes(field)].map(node => ({ path: token(node.path), kind: kind(node.value), secret: node.secret, multiline: typeof node.value === 'string' && (node.value.includes('\n') || field.type === 'ssh-key') }));
  } catch { return null; }
}
/** Private adapter data only. Build once per draft render rather than parsing
 * the whole JSON tree for every hydrated control. Never expose this map as scope. */
export function passwordPropertyValues(field: PasswordField) {
  return new Map([...propertyNodes(field)].map(node => [token(node.path), { label: node.label, value: typeof node.value === 'boolean' ? node.value : node.value === null || typeof node.value === 'object' ? JSON.stringify(node.value) ?? '' : String(node.value) }]));
}
/** Private identity only. Never put this key/type structure into display scope. */
export function passwordPropertyShape(field: PasswordField): string {
  try { return JSON.stringify([field.type, field.structured, JSON.stringify(root(field), (_key, value) => value === null ? 'null' : typeof value === 'object' ? value : typeof value)]); }
  catch { return ''; }
}
export function readPasswordProperty(field: PasswordField, path: unknown, label = false): string | boolean {
  const resolved = resolve(root(field), parsePath(path));
  if (label) return resolved.label || field.label;
  if (resolved.value === null) return 'null';
  if (typeof resolved.value === 'boolean') return resolved.value;
  if (typeof resolved.value === 'object') return JSON.stringify(resolved.value);
  return String(resolved.value);
}
export function patchPasswordProperty(field: PasswordField, path: unknown, input: unknown): PasswordField {
  const properties = passwordProperties(field);
  if (!properties || !properties.some(property => property.path === path)) throw new Error('Invalid property path.');
  const value = root(field), indices = parsePath(path), resolved = resolve(value, indices), type = kind(resolved.value);
  let next: unknown;
  if (type === 'string' && typeof input === 'string') next = input;
  else if (type === 'boolean' && (typeof input === 'boolean' || input === 'true' || input === 'false')) next = input === true || input === 'true';
  else if (type === 'number' && typeof input === 'string' && safeNumber(input)) next = Number(input);
  else throw new Error('Enter a value with the original property type.');
  if (!indices.length) return { ...field, value: JSON.stringify(next) };
  Object.defineProperty(resolved.parent, resolved.key!, { value: next, enumerable: true, writable: true, configurable: true });
  return { ...field, value: JSON.stringify(value) };
}
