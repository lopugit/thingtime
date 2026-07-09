// Schema + value validation for the generic CRUD stack (thingTypes +
// kind:'record' things). See PLANS/codexCRUDImplementation.md.

export type ThingTypeFieldKind = 'text' | 'number' | 'boolean' | 'date' | 'json' | 'url' | 'fileRef';
export type ThingTypeSearchMode = 'none' | 'exact' | 'term';
export type ThingTypeVisibility = 'private' | 'public';

export type ThingTypeField = {
  key: string;
  label: string;
  kind: ThingTypeFieldKind;
  required: boolean;
  encrypted: boolean;
  searchable: ThingTypeSearchMode;
  sortable: boolean;
  maxBytes: number;
};

export type Fail = { ok: false; status: number; error: string };
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
export const isFail = (value: unknown): value is Fail =>
  !!value && typeof value === 'object' && !Array.isArray(value) && (value as any).ok === false;

export const FIELD_KINDS: ThingTypeFieldKind[] = ['text', 'number', 'boolean', 'date', 'json', 'url', 'fileRef'];
export const SEARCH_MODES: ThingTypeSearchMode[] = ['none', 'exact', 'term'];

const MAX_TYPE_NAME_CHARS = 80;
const MAX_TYPE_DESCRIPTION_CHARS = 400;
const MAX_TYPE_KEY_CHARS = 40;
const MAX_FIELDS_PER_TYPE = 40;
const MAX_FIELD_LABEL_CHARS = 80;
const MAX_FIELD_KEY_CHARS = 40;
// Values are stored inside a single Mongo doc (16MB hard cap) alongside the
// search token arrays, so per-field bytes stay small by default.
const DEFAULT_VALUE_MAX_BYTES = 16 * 1024;
const MAX_VALUE_MAX_BYTES = 64 * 1024;

// Field/type keys are stable machine identifiers (integrations depend on
// them), so they get slug rules instead of free text.
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

export const valueByteSize = (value: unknown) => utf8Bytes(JSON.stringify(value) ?? '');

// The extensible data escape hatch: `extended` carries ANY JSON structure with
// no schema validation — Thingtime wraps it in platform metadata (ids, ACLs,
// versions, timestamps) but never interprets it. Byte-capped so a single doc
// stays well inside Mongo's 16MB limit alongside values + search tokens.
export const EXTENDED_MAX_BYTES = 512 * 1024;

// Returns the value to store under `extended`. undefined means "not provided"
// (callers keep the existing value); null clears it; anything else is accepted
// as-is if it fits the byte cap and JSON round-trips.
export const sanitizeExtended = (value: unknown): { ok: true; value: unknown } | Fail => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value === 'function') return fail(400, 'extended must be JSON-serializable');
  const bytes = valueByteSize(value);
  if (!Number.isFinite(bytes) || bytes === 0) {
    return fail(400, 'extended must be JSON-serializable');
  }
  if (bytes > EXTENDED_MAX_BYTES) {
    return fail(400, `extended exceeds the ${EXTENDED_MAX_BYTES} byte limit`);
  }
  return { ok: true, value };
};

const sanitizeKey = (value: unknown, maxChars: number): string | null => {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key || key.length > maxChars || !KEY_PATTERN.test(key)) return null;
  return key;
};

const sanitizeField = (value: unknown, index: number): ThingTypeField | Fail => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(400, `Field #${index + 1} must be an object`);
  }
  const input = value as Record<string, unknown>;

  const key = sanitizeKey(input.key, MAX_FIELD_KEY_CHARS);
  if (!key) {
    return fail(400, `Field #${index + 1} needs a lowercase slug key (a-z, 0-9, _; max ${MAX_FIELD_KEY_CHARS})`);
  }

  const label = typeof input.label === 'string' ? input.label.trim().slice(0, MAX_FIELD_LABEL_CHARS) : '';

  const kind = FIELD_KINDS.includes(input.kind as ThingTypeFieldKind) ? (input.kind as ThingTypeFieldKind) : null;
  if (!kind) return fail(400, `Field "${key}" has an unknown kind (allowed: ${FIELD_KINDS.join(', ')})`);

  const searchable = SEARCH_MODES.includes(input.searchable as ThingTypeSearchMode)
    ? (input.searchable as ThingTypeSearchMode)
    : input.searchable === undefined
      ? 'none'
      : null;
  if (searchable === null) {
    return fail(400, `Field "${key}" has an unknown search mode (allowed: ${SEARCH_MODES.join(', ')})`);
  }
  // Word-token search only makes sense for text; everything else matches as a
  // whole normalized value.
  if (searchable === 'term' && kind !== 'text') {
    return fail(400, `Field "${key}" can only use term search when its kind is text`);
  }
  if (searchable !== 'none' && kind === 'json') {
    return fail(400, `Field "${key}" is json and cannot be searchable in v1`);
  }

  let maxBytes = DEFAULT_VALUE_MAX_BYTES;
  if (input.maxBytes !== undefined) {
    const requested = Number(input.maxBytes);
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_VALUE_MAX_BYTES) {
      return fail(400, `Field "${key}" maxBytes must be an integer between 1 and ${MAX_VALUE_MAX_BYTES}`);
    }
    maxBytes = requested;
  }

  return {
    key,
    label: label || key,
    kind,
    required: !!input.required,
    encrypted: !!input.encrypted,
    searchable,
    sortable: !!input.sortable,
    maxBytes
  };
};

export type ValidatedTypeInput = {
  key: string;
  name: string;
  description: string | null;
  visibility: ThingTypeVisibility;
  fields: ThingTypeField[];
};

// Validate the caller-supplied type definition (create or update payload).
export const validateTypeInput = (input: Record<string, unknown>): ValidatedTypeInput | Fail => {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_TYPE_NAME_CHARS) : '';
  if (!name) return fail(400, 'Type name is required');

  const key = sanitizeKey(input.key, MAX_TYPE_KEY_CHARS);
  if (!key) {
    return fail(400, `Type key must be a lowercase slug (a-z, 0-9, _; max ${MAX_TYPE_KEY_CHARS})`);
  }

  const description =
    typeof input.description === 'string' ? input.description.trim().slice(0, MAX_TYPE_DESCRIPTION_CHARS) || null : null;

  // Only an explicit 'public' publishes — mirrors the themes convention.
  const visibility: ThingTypeVisibility = input.visibility === 'public' ? 'public' : 'private';

  // Zero-field types are valid: records of such a type carry everything in
  // their schema-free `extended` property — the escape hatch that lets
  // external apps and service accounts store arbitrary data through Thingtime.
  if (input.fields !== undefined && !Array.isArray(input.fields)) {
    return fail(400, 'fields must be a list of field definitions');
  }
  const inputFields = Array.isArray(input.fields) ? input.fields : [];
  if (inputFields.length > MAX_FIELDS_PER_TYPE) {
    return fail(400, `A type can have at most ${MAX_FIELDS_PER_TYPE} fields`);
  }

  const fields: ThingTypeField[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < inputFields.length; index += 1) {
    const field = sanitizeField(inputFields[index], index);
    if (isFail(field)) return field;
    if (seen.has(field.key)) return fail(400, `Duplicate field key "${field.key}"`);
    seen.add(field.key);
    fields.push(field);
  }

  return { key, name, description, visibility, fields };
};

// Validate one submitted value against its field policy. Returns the
// normalized plain value (encryption happens later, in records.ts).
export const validateFieldValue = (field: ThingTypeField, value: unknown): { ok: true; value: unknown } | Fail => {
  if (value === null || value === undefined) {
    if (field.required) return fail(400, `Field "${field.key}" is required`);
    return { ok: true, value: null };
  }

  let normalized: unknown;
  switch (field.kind) {
    case 'text': {
      if (typeof value !== 'string') return fail(400, `Field "${field.key}" must be a string`);
      normalized = value;
      break;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(400, `Field "${field.key}" must be a finite number`);
      }
      normalized = value;
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return fail(400, `Field "${field.key}" must be a boolean`);
      normalized = value;
      break;
    }
    case 'date': {
      const time = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
      if (!Number.isFinite(time)) return fail(400, `Field "${field.key}" must be an ISO date string`);
      normalized = new Date(time).toISOString();
      break;
    }
    case 'url': {
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) {
        return fail(400, `Field "${field.key}" must be an http(s) URL`);
      }
      normalized = value.trim();
      break;
    }
    case 'fileRef': {
      if (typeof value !== 'string' || !value.trim()) {
        return fail(400, `Field "${field.key}" must be a file reference string`);
      }
      normalized = value.trim();
      break;
    }
    case 'json': {
      normalized = value;
      break;
    }
  }

  if (valueByteSize(normalized) > field.maxBytes) {
    return fail(400, `Field "${field.key}" exceeds its ${field.maxBytes} byte limit`);
  }
  return { ok: true, value: normalized };
};

// Required-field check across a full (merged) value map — used on create and
// after merging an update's partial values.
export const missingRequiredField = (
  fields: ThingTypeField[],
  values: Record<string, unknown>
): ThingTypeField | null => {
  for (const field of fields) {
    if (!field.required) continue;
    const value = values[field.key];
    if (value === null || value === undefined) return field;
  }
  return null;
};
