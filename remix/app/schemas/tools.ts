import type { SchemaItemSpec, SchemaThingField } from '~/schemas/registry';

// Pure helpers over schema-thing field trees, shared by the /schemas browse
// page (sample renders, type chips) and the /search schema refinement form
// (flattened searchable paths). No react, no mongo — safe everywhere.

export type FlatSchemaField = {
  // dotted crystal path the search grammar can address (e.g. "maker.name");
  // fields inside arrays keep their dotted path — Mongo matches into arrays
  path: string;
  field: SchemaThingField;
  depth: number;
  // true when this leaf sits inside an array (affects copy, not queryability)
  inArray: boolean;
};

const SEARCHABLE_LEAF_TYPES = new Set(['string', 'number', 'boolean', 'date', 'enum', 'string[]']);

// Internal walker shared by flattenSchemaFields (search) and
// flattenSchemaFieldsForDisplay (display). One tree recursion, one depth guard,
// one dotted-path builder, one array-item descent — so search paths and display
// chips can never drift apart on the same schema. `mode` switches ONLY the five
// points where the two policies genuinely differ:
//   1. name guard — search skips the free-form data schema's '*' wildcard;
//      display keeps it (both skip empty/non-string names).
//   2. objects — search always descends children (emitting the children, never
//      the object node); display descends only objects that have children, and
//      emits a childless object as a leaf.
//   3. arrays of objects — search descends whenever the item type is 'object'
//      (childless items descend to nothing); display descends only when those
//      item-objects have children, otherwise emits the array node as a leaf.
//   4. arrays of scalars — search emits the array path itself when the item
//      type is searchable (multikey); display emits the array node as a leaf.
//   5. leaves — search keeps only SEARCHABLE_LEAF_TYPES; display keeps every
//      leaf (record/id/unknown, childless object, non-descended array, '*').
const walkSchemaFields = (
  fields: SchemaThingField[] | undefined,
  mode: 'search' | 'display',
  base = '',
  depth = 0,
  inArray = false
): FlatSchemaField[] => {
  if (!Array.isArray(fields) || depth > 8) return [];
  const out: FlatSchemaField[] = [];
  for (const field of fields) {
    if (!field || typeof field.name !== 'string' || !field.name) continue;
    if (mode === 'search' && field.name === '*') continue;
    const path = base ? `${base}.${field.name}` : field.name;
    if (field.type === 'object') {
      if (mode === 'search' || (Array.isArray(field.children) && field.children.length)) {
        out.push(...walkSchemaFields(field.children, mode, path, depth + 1, inArray));
        continue;
      }
      // display: childless object falls through and is emitted as a leaf
    } else if (field.type === 'array') {
      const items = field.items as SchemaItemSpec | undefined;
      if (mode === 'search') {
        if (items?.type === 'object') {
          out.push(...walkSchemaFields(items.children, mode, path, depth + 1, true));
        } else if (items && SEARCHABLE_LEAF_TYPES.has(items.type)) {
          // array of scalars: the path itself matches entries (multikey)
          out.push({ path, field: { ...items, name: field.name } as SchemaThingField, depth, inArray: true });
        }
        continue;
      }
      if (items?.type === 'object' && Array.isArray(items.children) && items.children.length) {
        out.push(...walkSchemaFields(items.children, mode, path, depth + 1, true));
        continue;
      }
      // display: any other array falls through and is emitted as a leaf
    } else if (mode === 'search') {
      if (SEARCHABLE_LEAF_TYPES.has(field.type)) {
        out.push({ path, field, depth, inArray });
      }
      continue;
    }
    // display only: emit every remaining node as a leaf
    out.push({ path, field, depth, inArray });
  }
  return out;
};

// Flatten a field tree into search-addressable dotted paths. Object nodes emit
// their children (not themselves); arrays of objects emit their item children
// under the same path; arrays of scalars emit themselves. The '*' wildcard of
// the free-form data schema is never addressable and is skipped by callers.
export const flattenSchemaFields = (
  fields: SchemaThingField[] | undefined,
  base = '',
  depth = 0,
  inArray = false
): FlatSchemaField[] => walkSchemaFields(fields, 'search', base, depth, inArray);

// Flatten a field tree for DISPLAY — unlike flattenSchemaFields (search paths)
// this keeps every leaf: record/id/unknown types, childless objects, the data
// schema's '*' wildcard. Powers the "all properties" chips on schema cards.
export const flattenSchemaFieldsForDisplay = (
  fields: SchemaThingField[] | undefined,
  base = '',
  depth = 0,
  inArray = false
): FlatSchemaField[] => walkSchemaFields(fields, 'display', base, depth, inArray);

// Compact type label for chips: "number 0–12 cm", "enum wood|plastic|…",
// "text ≤80", "list<text> ≤6", "object ×3", "list<object>"
export const describeSchemaField = (field: SchemaThingField | SchemaItemSpec): string => {
  switch (field.type as string) {
    case 'record':
      return 'json';
    case 'id':
      return 'id';
  }
  switch (field.type) {
    case 'number': {
      const range =
        field.min !== undefined || field.max !== undefined
          ? ` ${field.min !== undefined ? field.min : ''}–${field.max !== undefined ? field.max : ''}`
          : '';
      return `number${range}${field.unit ? ` ${field.unit}` : ''}`;
    }
    case 'enum': {
      const values = field.values || [];
      const preview = values.slice(0, 3).join('|');
      return `enum ${preview}${values.length > 3 ? '|…' : ''}`;
    }
    case 'string':
      return `text${field.maxLength ? ` ≤${field.maxLength}` : ''}`;
    case 'string[]':
      return `list<text>${field.maxItems !== undefined ? ` ≤${field.maxItems}` : ''}`;
    case 'boolean':
      return 'yes/no';
    case 'date':
      return 'date';
    case 'object':
      return field.children?.length ? `object ×${field.children.length}` : 'object';
    case 'array': {
      const items = field.items as SchemaItemSpec | undefined;
      return `list<${items ? describeSchemaField(items).split(' ')[0] : '?'}>${
        field.maxItems !== undefined ? ` ≤${field.maxItems}` : ''
      }`;
    }
    default:
      return String(field.type);
  }
};

// Deterministic sample data from a field tree — powers the "sample rendered
// view" on schema cards. Values come from the schema's own constraints (enum
// first value, number midpoint, honest placeholders elsewhere).
const sampleScalar = (field: SchemaThingField | SchemaItemSpec, name: string): unknown => {
  switch (field.type) {
    case 'number': {
      const min = field.min !== undefined ? field.min : 0;
      const max = field.max !== undefined ? field.max : field.min !== undefined ? field.min + 10 : 42;
      const mid = (min + max) / 2;
      return Number.isInteger(min) && Number.isInteger(max) ? Math.round(mid) : Math.round(mid * 100) / 100;
    }
    case 'boolean':
      return true;
    case 'date':
      return new Date().toISOString();
    case 'enum':
      return (field.values && field.values[0]) || '';
    case 'string': {
      const text = `Sample ${name || 'text'}`;
      return field.maxLength ? text.slice(0, field.maxLength) : text;
    }
    default:
      return `Sample ${name || 'value'}`;
  }
};

const sampleForField = (field: SchemaThingField | SchemaItemSpec, name: string, depth: number): unknown => {
  if (depth > 8) return null;
  switch (field.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const child of (field.children || []).slice(0, 12)) {
        setAtPath(out, child.name.split('.'), sampleForField(child, child.name, depth + 1));
      }
      return out;
    }
    case 'array': {
      const items = field.items as SchemaItemSpec | undefined;
      if (!items) return [];
      const count = Math.max(1, Math.min(field.minItems || 1, 3));
      return Array.from({ length: count }, (_, index) =>
        sampleForField(items, `${name} ${index + 1}`, depth + 1)
      );
    }
    case 'string[]': {
      const count = Math.max(2, Math.min(field.minItems || 2, 3));
      const entries = Array.from({ length: count }, (_, index) => `${name || 'item'} ${index + 1}`);
      return field.maxItems !== undefined ? entries.slice(0, Math.max(1, field.maxItems)) : entries;
    }
    default:
      return sampleScalar(field, name);
  }
};

const setAtPath = (target: Record<string, unknown>, path: string[], value: unknown): void => {
  let current = target;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index];
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
};

export const generateSampleFromFields = (fields: SchemaThingField[] | undefined): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of (fields || []).slice(0, 24)) {
    if (!field || typeof field.name !== 'string' || !field.name || field.name === '*') continue;
    setAtPath(out, field.name.split('.'), sampleForField(field, field.name, 0));
  }
  return out;
};

// Count every node in a field tree (matches the registry's node accounting).
export const countSchemaFieldNodes = (fields: SchemaThingField[] | undefined): number => {
  let count = 0;
  for (const field of fields || []) {
    count += 1;
    if (field.type === 'object') count += countSchemaFieldNodes(field.children);
    if (field.type === 'array' && field.items) {
      count += 1;
      const items = field.items as SchemaItemSpec;
      if (items.type === 'object') count += countSchemaFieldNodes(items.children);
    }
  }
  return count;
};
