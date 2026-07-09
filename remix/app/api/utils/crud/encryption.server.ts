import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

import { fail, type Fail } from './validation';

// Server-side envelope encryption for CRUD record fields. Deliberately
// separate from the public /api/v1/crypto diagnostic helpers.
//
// Env (placeholders only in docs — never commit real keys):
//   THINGTIME_DATA_MASTER_KEYS   JSON map of key id -> base64url 32-byte key
//   THINGTIME_ACTIVE_DATA_KEY_ID active key id for new writes

export type EncryptedValueEnvelope = {
  alg: 'AES-256-GCM';
  kid: string;
  iv: string;
  ciphertext: string;
  tag: string;
  aad: string;
};

export type StoredThingValue =
  | { storage: 'plain'; value: unknown }
  | { storage: 'encrypted'; envelope: EncryptedValueEnvelope };

type DataKeys = { keys: Map<string, Buffer>; activeKid: string };

const b64urlDecode = (value: string) => Buffer.from(value, 'base64url');
const b64urlEncode = (value: Buffer) => value.toString('base64url');

const keysNotConfigured = () => fail(503, 'Data encryption keys are not configured');

// Read + validate the configured master keys at request time (no module-level
// caching — serverless instances can see env changes between deploys).
export const loadDataKeys = (): { ok: true; keys: DataKeys } | Fail => {
  const rawKeys = process.env.THINGTIME_DATA_MASTER_KEYS;
  const activeKid = (process.env.THINGTIME_ACTIVE_DATA_KEY_ID || '').trim();
  if (!rawKeys || !activeKid) return keysNotConfigured();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    return keysNotConfigured();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return keysNotConfigured();

  const keys = new Map<string, Buffer>();
  for (const [kid, encoded] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof encoded !== 'string') return keysNotConfigured();
    const key = b64urlDecode(encoded);
    if (key.byteLength !== 32) return keysNotConfigured();
    keys.set(kid, key);
  }
  if (!keys.has(activeKid)) return keysNotConfigured();

  return { ok: true, keys: { keys, activeKid } };
};

export const dataEncryptionConfigured = () => loadDataKeys().ok === true;

// AAD binds the ciphertext to its record/type/field so an envelope can't be
// replayed into another slot and still decrypt.
export const envelopeAad = (typeId: string, recordId: string, fieldKey: string) =>
  `v1:${typeId}:${recordId}:${fieldKey}`;

export const encryptValue = (
  dataKeys: DataKeys,
  plainValue: unknown,
  aad: string
): EncryptedValueEnvelope => {
  const key = dataKeys.keys.get(dataKeys.activeKid)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plainValue), 'utf8'), cipher.final()]);
  return {
    alg: 'AES-256-GCM',
    kid: dataKeys.activeKid,
    iv: b64urlEncode(iv),
    ciphertext: b64urlEncode(ciphertext),
    tag: b64urlEncode(cipher.getAuthTag()),
    aad
  };
};

// Decrypt with the envelope's own kid (not just the active key) so key
// rotation keeps old envelopes readable; writes re-encrypt with the active key.
export const decryptEnvelope = (
  dataKeys: DataKeys,
  envelope: EncryptedValueEnvelope,
  expectedAad: string
): { ok: true; value: unknown } | Fail => {
  const key = dataKeys.keys.get(envelope.kid);
  if (!key || envelope.alg !== 'AES-256-GCM' || envelope.aad !== expectedAad) {
    return fail(500, 'Stored value cannot be decrypted');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, b64urlDecode(envelope.iv));
    decipher.setAAD(Buffer.from(expectedAad, 'utf8'));
    decipher.setAuthTag(b64urlDecode(envelope.tag));
    const plain = Buffer.concat([decipher.update(b64urlDecode(envelope.ciphertext)), decipher.final()]);
    return { ok: true, value: JSON.parse(plain.toString('utf8')) };
  } catch {
    return fail(500, 'Stored value cannot be decrypted');
  }
};

// ---------------------------------------------------------------------------
// Blind-index search tokens. Encrypted searchable fields store HMAC digests of
// normalized values instead of anything derived from the plaintext ordering —
// no prefix/fuzzy matching in v1 (it leaks shape; see the plan's threat model).
// Tokens are keyed off the ACTIVE master key: after a key rotation, records
// written under an old key stop matching until their next write re-tokenizes
// them — the documented v1 tradeoff.

const deriveSearchKey = (dataKeys: DataKeys) =>
  createHmac('sha256', dataKeys.keys.get(dataKeys.activeKid)!).update('thingtime-crud-search-key-v1').digest();

export const normalizeExactValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value) ?? '';

const MAX_TERM_TOKENS = 128;
const MIN_TERM_CHARS = 2;

export const normalizeTerms = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  const terms = value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= MIN_TERM_CHARS);
  return [...new Set(terms)].slice(0, MAX_TERM_TOKENS);
};

// Token format: v1:<typeId>:<fieldKey>:<mode>:<digest-or-plain-token>.
// Plain searchable fields store the normalized token itself; encrypted fields
// store the HMAC digest, so one array serves both under one query shape.
export const searchToken = (
  typeId: string,
  fieldKey: string,
  mode: 'exact' | 'term',
  normalized: string,
  encryptedWith: DataKeys | null
): string => {
  const digest = encryptedWith
    ? createHmac('sha256', deriveSearchKey(encryptedWith)).update(`${typeId}:${fieldKey}:${mode}:${normalized}`).digest('base64url')
    : normalized;
  return `v1:${typeId}:${fieldKey}:${mode}:${digest}`;
};
