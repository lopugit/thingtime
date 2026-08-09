import type { ConditionRow } from '../Search/searchTypes.ts';

// Client-side row querying for the bounded admin tables/cards. Conditions use
// the shared Search builder's ConditionRow grammar so admin surfaces do not
// invent another operator vocabulary; this module specializes evaluation for
// typed, already-fetched rows and always ANDs active clauses.

export type AdminRowFieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'date';

export type AdminRowFieldOption = {
  value: string;
  label: string;
};

export type AdminRowField<T> = {
  id: string;
  label: string;
  kind: AdminRowFieldKind;
  path?: string;
  getValue?: (row: T) => unknown;
  options?: readonly AdminRowFieldOption[];
  searchable?: boolean;
  sortable?: boolean;
};

export type AdminRowSort = {
  field: string;
  direction: 'asc' | 'desc';
};

export type AdminRowQuery = {
  search: string;
  filters: ConditionRow[];
  sort: AdminRowSort | null;
};

const ROW_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const createAdminRowQuery = (sort: AdminRowSort | null = null): AdminRowQuery => ({
  search: '',
  filters: [],
  sort
});

export const adminFilterValueForOperatorChange = (
  fieldKind: AdminRowFieldKind,
  previousOp: string,
  nextOp: string,
  currentValue: string
): string => {
  if (nextOp === 'exists') return 'true';
  if (previousOp === 'exists') return fieldKind === 'boolean' ? 'true' : '';
  return currentValue;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const flattenArrays = (value: unknown): unknown[] =>
  Array.isArray(value) ? value.flatMap((entry) => flattenArrays(entry)) : [value];

const readPathValues = (value: unknown, segments: string[], offset = 0): unknown[] => {
  if (Array.isArray(value)) return value.flatMap((entry) => readPathValues(entry, segments, offset));
  if (offset === segments.length) return flattenArrays(value);
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segments[offset])) return [];
  return readPathValues(value[segments[offset]], segments, offset + 1);
};

const pathExists = (value: unknown, segments: string[], offset = 0): boolean => {
  if (offset === segments.length) return true;
  if (Array.isArray(value)) return value.some((entry) => pathExists(entry, segments, offset));
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segments[offset])) return false;
  return pathExists(value[segments[offset]], segments, offset + 1);
};

const fieldPath = <T>(field: AdminRowField<T>): string[] =>
  (field.path || field.id)
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

export const readAdminRowFieldValues = <T>(row: T, field: AdminRowField<T>): unknown[] => {
  if (field.getValue) return flattenArrays(field.getValue(row));
  const path = fieldPath(field);
  return path.length ? readPathValues(row, path) : [];
};

const adminRowFieldExists = <T>(row: T, field: AdminRowField<T>): boolean => {
  if (field.getValue) return field.getValue(row) !== undefined;
  const path = fieldPath(field);
  return path.length > 0 && pathExists(row, path);
};

const searchText = (value: unknown, seen = new WeakSet<object>()): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => searchText(entry, seen)).filter(Boolean).join(' ');
  if (isRecord(value)) {
    if (seen.has(value)) return '';
    seen.add(value);
    return Object.values(value)
      .map((entry) => searchText(entry, seen))
      .filter(Boolean)
      .join(' ');
  }
  return String(value);
};

const normalizedText = (value: unknown): string => searchText(value).trim().toLocaleLowerCase('en');

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
};

const asDateMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const dateRange = (value: string): { start: number; end: number } | null => {
  const raw = value.trim();
  const dateOnly = DATE_ONLY.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const startDate = new Date(0);
    startDate.setFullYear(year, month, day);
    startDate.setHours(0, 0, 0, 0);
    if (startDate.getFullYear() !== year || startDate.getMonth() !== month || startDate.getDate() !== day) return null;
    const endExclusive = new Date(startDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return { start: startDate.getTime(), end: endExclusive.getTime() - 1 };
  }
  const timestamp = asDateMs(raw);
  return timestamp === null ? null : { start: timestamp, end: timestamp };
};

const filterIsActive = (filter: ConditionRow): boolean => {
  if (!filter.field.trim()) return false;
  if (filter.op === 'exists') return true;
  if (filter.op === 'between') return !!filter.value.trim() || !!filter.value2.trim();
  if (filter.op === 'in' || filter.op === 'nin') {
    return filter.value.split(',').some((entry) => !!entry.trim());
  }
  return !!filter.value.trim();
};

const stringEquals = (left: unknown, right: unknown): boolean => normalizedText(left) === normalizedText(right);

const scalarEquals = (kind: AdminRowFieldKind, actual: unknown, expected: string): boolean => {
  if (kind === 'number') {
    const left = asNumber(actual);
    const right = asNumber(expected);
    return left !== null && right !== null && left === right;
  }
  if (kind === 'boolean') {
    const left = asBoolean(actual);
    const right = asBoolean(expected);
    return left !== null && right !== null && left === right;
  }
  if (kind === 'date') {
    const left = asDateMs(actual);
    const right = dateRange(expected);
    return left !== null && right !== null && left >= right.start && left <= right.end;
  }
  return stringEquals(actual, expected);
};

const scalarComparison = (kind: AdminRowFieldKind, actual: unknown, expected: string): number | null => {
  if (kind === 'number') {
    const left = asNumber(actual);
    const right = asNumber(expected);
    return left === null || right === null ? null : left - right;
  }
  if (kind === 'date') {
    const left = asDateMs(actual);
    const right = dateRange(expected);
    return left === null || right === null ? null : left - right.start;
  }
  return ROW_COLLATOR.compare(normalizedText(actual), normalizedText(expected));
};

const matchesDateBoundary = (actual: unknown, op: string, expected: string): boolean => {
  const timestamp = asDateMs(actual);
  const range = dateRange(expected);
  if (timestamp === null || !range) return false;
  if (op === 'gt') return timestamp > range.end;
  if (op === 'gte') return timestamp >= range.start;
  if (op === 'lt') return timestamp < range.start;
  if (op === 'lte') return timestamp <= range.end;
  return timestamp >= range.start && timestamp <= range.end;
};

const matchesPositiveOperator = (
  actual: unknown,
  field: AdminRowField<unknown>,
  filter: ConditionRow
): boolean => {
  if (filter.op === 'contains') return normalizedText(actual).includes(normalizedText(filter.value));
  if (filter.op === 'startsWith') return normalizedText(actual).startsWith(normalizedText(filter.value));
  if (filter.op === 'endsWith') return normalizedText(actual).endsWith(normalizedText(filter.value));
  if (filter.op === 'eq') return scalarEquals(field.kind, actual, filter.value);
  if (field.kind === 'date' && ['gt', 'gte', 'lt', 'lte'].includes(filter.op)) {
    return matchesDateBoundary(actual, filter.op, filter.value);
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(filter.op)) {
    const comparison = scalarComparison(field.kind, actual, filter.value);
    if (comparison === null) return false;
    if (filter.op === 'gt') return comparison > 0;
    if (filter.op === 'gte') return comparison >= 0;
    if (filter.op === 'lt') return comparison < 0;
    return comparison <= 0;
  }
  if (filter.op === 'between') {
    if (field.kind === 'date') {
      const timestamp = asDateMs(actual);
      const hasLow = !!filter.value.trim();
      const hasHigh = !!filter.value2.trim();
      const low = hasLow ? dateRange(filter.value) : null;
      const high = hasHigh ? dateRange(filter.value2) : null;
      if (timestamp === null || (hasLow && !low) || (hasHigh && !high)) return false;
      return (!low || timestamp >= low.start) && (!high || timestamp <= high.end);
    }
    const hasLow = !!filter.value.trim();
    const hasHigh = !!filter.value2.trim();
    const low = hasLow ? scalarComparison(field.kind, actual, filter.value) : null;
    const high = hasHigh ? scalarComparison(field.kind, actual, filter.value2) : null;
    if ((hasLow && low === null) || (hasHigh && high === null)) return false;
    return (!hasLow || (low !== null && low >= 0)) && (!hasHigh || (high !== null && high <= 0));
  }
  if (filter.op === 'in') {
    return filter.value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .some((expected) => scalarEquals(field.kind, actual, expected));
  }
  if (filter.op === 'type') {
    const actualType = actual instanceof Date ? 'date' : Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual;
    return actualType === filter.value.trim().toLowerCase();
  }
  return false;
};

export const adminRowMatchesFilter = <T>(
  row: T,
  field: AdminRowField<T>,
  filter: ConditionRow
): boolean => {
  const values = readAdminRowFieldValues(row, field);
  const presentValues = values.filter((value) => value !== undefined);
  if (filter.op === 'exists') {
    const exists = adminRowFieldExists(row, field);
    return (filter.value || 'true') === 'false' ? !exists : exists;
  }
  if (!presentValues.length) return false;
  const untypedField = field as AdminRowField<unknown>;
  if (filter.op === 'ne') {
    return presentValues.every((actual) => !scalarEquals(field.kind, actual, filter.value));
  }
  if (filter.op === 'nin') {
    const excluded = filter.value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return presentValues.every((actual) => excluded.every((expected) => !scalarEquals(field.kind, actual, expected)));
  }
  return presentValues.some((actual) => matchesPositiveOperator(actual, untypedField, filter));
};

export const filterAdminRows = <T>(
  rows: readonly T[],
  fields: readonly AdminRowField<T>[],
  query: Pick<AdminRowQuery, 'search' | 'filters'>
): T[] => {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const searchFields = fields.filter((field) => field.searchable !== false);
  const terms = query.search
    .trim()
    .toLocaleLowerCase('en')
    .split(/\s+/)
    .filter(Boolean);
  const filters = query.filters.filter(filterIsActive);

  return rows.filter((row) => {
    if (terms.length) {
      const haystack = searchFields
        .flatMap((field) => readAdminRowFieldValues(row, field))
        .map((value) => normalizedText(value))
        .filter(Boolean)
        .join(' ');
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return filters.every((filter) => {
      const field = fieldById.get(filter.field);
      return field ? adminRowMatchesFilter(row, field, filter) : false;
    });
  });
};

const sortableValue = <T>(row: T, field: AdminRowField<T>): string | number | boolean | null => {
  const values = readAdminRowFieldValues(row, field);
  const sortable = values
    .map((value) => {
      if (field.kind === 'number') return asNumber(value);
      if (field.kind === 'boolean') return asBoolean(value);
      if (field.kind === 'date') return asDateMs(value);
      return value === null || value === undefined ? null : normalizedText(value);
    })
    .filter((value): value is string | number | boolean => value !== null);
  if (!sortable.length) return null;
  return sortable.sort((left, right) => {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
    return ROW_COLLATOR.compare(String(left), String(right));
  })[0];
};

const compareSortableValues = (
  left: string | number | boolean | null,
  right: string | number | boolean | null
): number => {
  // Missing values stay last in both directions; changing direction should not
  // make incomplete rows jump above rows with actual values.
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return ROW_COLLATOR.compare(String(left), String(right));
};

export const sortAdminRows = <T>(
  rows: readonly T[],
  fields: readonly AdminRowField<T>[],
  sort: AdminRowSort | null,
  getRowId: (row: T) => string
): T[] => {
  if (!sort) return [...rows];
  const field = fields.find((candidate) => candidate.id === sort.field && candidate.sortable !== false);
  if (!field) return [...rows];
  return rows
    .map((row, index) => ({ row, index, id: String(getRowId(row)), value: sortableValue(row, field) }))
    .sort((left, right) => {
      const valueOrder = compareSortableValues(left.value, right.value);
      if (valueOrder) {
        if (left.value === null || right.value === null) return valueOrder;
        return sort.direction === 'desc' ? -valueOrder : valueOrder;
      }
      return ROW_COLLATOR.compare(left.id, right.id) || left.index - right.index;
    })
    .map(({ row }) => row);
};

export const applyAdminRowQuery = <T>(
  rows: readonly T[],
  fields: readonly AdminRowField<T>[],
  query: AdminRowQuery,
  getRowId: (row: T) => string
): T[] => sortAdminRows(filterAdminRows(rows, fields, query), fields, query.sort, getRowId);
