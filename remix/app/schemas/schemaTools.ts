// Schema tools — pure helpers over a schema thing's `crystal.fields`
// (SchemaThingField[]): a runtime adherence validator (the "Thingtime Schema"
// checker), a sample-data generator for render previews, and a field-path
// flattener for the search builder. Kept PURE (no mongo/node) so the client
// (/schemas, /search), the docs, and the server can all import it.

import type { SchemaFieldType, SchemaThingField } from './registry';

export type SchemaCrystal = {
  name?: string;
  description?: string;
  fields?: SchemaThingField[];
  forkedFrom?: string;
};

// ---------------------------------------------------------------------------
// Sample data — representative values for a preview render. Deterministic (no
// Date.now/random) so SSR and hydration agree.

const SAMPLE_STRINGS = ['Sample', 'Example', 'Thingtime', 'Preview', 'Demo'];
const SAMPLE_DATE = '2026-01-15';

const clampNumberSample = (field: SchemaThingField): number => {
  const { min, max } = field;
  if (min !== undefined && max !== undefined) return Math.round((min + max) / 2);
  if (min !== undefined) return min + 1;
  if (max !== undefined) return max;
  return 42;
};

export const sampleForField = (field: SchemaThingField, seed = 0): unknown => {
  switch (field.type) {
    case 'string': {
      const base = SAMPLE_STRINGS[seed % SAMPLE_STRINGS.length];
      const text = field.name ? `${base} ${field.name}` : base;
      return field.maxLength ? text.slice(0, field.maxLength) : text;
    }
    case 'number':
      return clampNumberSample(field);
    case 'boolean':
      return seed % 2 === 0;
    case 'date':
      return SAMPLE_DATE;
    case 'enum':
      return field.values?.[seed % Math.max(1, field.values.length)] ?? '';
    case 'string[]': {
      const count = Math.max(field.minItems ?? 0, 2);
      return Array.from({ length: Math.min(count, field.maxItems ?? count) }, (_, i) => SAMPLE_STRINGS[i % SAMPLE_STRINGS.length]);
    }
    case 'array': {
      if (!field.items) return [];
      const count = Math.max(field.minItems ?? 0, 2);
      const n = Math.min(count, field.maxItems ?? count);
      return Array.from({ length: n }, (_, i) => sampleForField(field.items as SchemaThingField, seed + i));
    }
    case 'object':
      return sampleForFields(field.fields || [], seed);
    default:
      return null;
  }
};

export const sampleForFields = (fields: SchemaThingField[], seed = 0): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  fields.forEach((field, i) => {
    if (field.name) out[field.name] = sampleForField(field, seed + i);
  });
  return out;
};

// A sample thing-like object for the kind renderers: the schema's fields as a
// crystal, plus name/kind hints renderers may key on.
export const sampleThingForSchema = (crystal: SchemaCrystal): Record<string, unknown> => {
  const sample = sampleForFields(crystal.fields || []);
  return { kind: (crystal.name || '').toLowerCase(), ...sample };
};

// ---------------------------------------------------------------------------
// Field paths — flatten nested object fields to dotted crystal paths for the
// search builder (crystal.<a>.<b>). Arrays/string[] surface at their own path
// (searching inside array elements is a `contains`, handled by the API).

export type SchemaFieldPath = {
  path: string; // dotted, relative to crystal (e.g. "dimensions.width")
  label: string; // human label (last segment)
  type: SchemaFieldType;
  field: SchemaThingField;
};

export const schemaFieldPaths = (fields: SchemaThingField[], prefix = ''): SchemaFieldPath[] => {
  const paths: SchemaFieldPath[] = [];
  for (const field of fields) {
    if (!field.name) continue;
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    if (field.type === 'object' && field.fields?.length) {
      // both the object itself (exists) and its leaves are addressable
      paths.push({ path, label: field.name, type: field.type, field });
      paths.push(...schemaFieldPaths(field.fields, path));
    } else {
      paths.push({ path, label: field.name, type: field.type, field });
    }
  }
  return paths;
};

// ---------------------------------------------------------------------------
// Runtime adherence validation — does a value conform to a field? Returns a
// flat list of human-readable errors (empty = valid). This is the "Thingtime
// Schema" validator: it validates real datatypes, never gates storage.

const typeOfValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const validateField = (field: SchemaThingField, value: unknown, path: string, errors: string[]): void => {
  const missing = value === undefined || value === null || value === '';
  if (missing) {
    if (field.required) errors.push(`${path} is required`);
    return;
  }

  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string') return errors.push(`${path} must be text`);
      if (field.minLength !== undefined && value.length < field.minLength) errors.push(`${path} needs at least ${field.minLength} characters`);
      if (field.maxLength !== undefined && value.length > field.maxLength) errors.push(`${path} allows at most ${field.maxLength} characters`);
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return errors.push(`${path} must be a number`);
      if (field.min !== undefined && value < field.min) errors.push(`${path} must be ≥ ${field.min}`);
      if (field.max !== undefined && value > field.max) errors.push(`${path} must be ≤ ${field.max}`);
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path} must be true or false`);
      return;
    case 'date': {
      const ok = value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
      if (!ok) errors.push(`${path} must be a date`);
      return;
    }
    case 'enum':
      if (!field.values?.includes(String(value))) errors.push(`${path} must be one of: ${(field.values || []).join(', ')}`);
      return;
    case 'string[]': {
      if (!Array.isArray(value)) return errors.push(`${path} must be a list`);
      if (field.minItems !== undefined && value.length < field.minItems) errors.push(`${path} needs at least ${field.minItems} items`);
      if (field.maxItems !== undefined && value.length > field.maxItems) errors.push(`${path} allows at most ${field.maxItems} items`);
      value.forEach((item, i) => {
        if (typeof item !== 'string') errors.push(`${path}[${i}] must be text`);
      });
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) return errors.push(`${path} must be a list`);
      if (field.minItems !== undefined && value.length < field.minItems) errors.push(`${path} needs at least ${field.minItems} items`);
      if (field.maxItems !== undefined && value.length > field.maxItems) errors.push(`${path} allows at most ${field.maxItems} items`);
      if (field.items) value.forEach((item, i) => validateField(field.items as SchemaThingField, item, `${path}[${i}]`, errors));
      return;
    }
    case 'object': {
      if (typeOfValue(value) !== 'object') return errors.push(`${path} must be an object`);
      (field.fields || []).forEach((child) =>
        validateField(child, (value as Record<string, unknown>)[child.name], `${path}.${child.name}`, errors)
      );
      return;
    }
  }
};

export const validateAgainstSchema = (
  fields: SchemaThingField[],
  crystal: Record<string, unknown>
): { ok: true } | { ok: false; errors: string[] } => {
  const errors: string[] = [];
  for (const field of fields) {
    if (!field.name) continue;
    validateField(field, crystal[field.name], field.name, errors);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
};
