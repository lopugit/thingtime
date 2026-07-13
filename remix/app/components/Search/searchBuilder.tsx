import React from 'react';
import { Button, Flex, IconButton, Input, Select, Text } from '@chakra-ui/react';
import { X } from 'lucide-react';

import type { ConditionRow, RowValueType } from './searchTypes';

// The query-builder core shared by /search and the feed/profile Advanced
// filters panel: the GUI operator vocabulary, row → API-condition compilation,
// and the row editor component itself. One grammar, one compiler, two homes.

// UI operator vocabulary. `between` is sugar for a gte+lte pair; the rest map
// 1:1 onto the API grammar (which whitelists them server-side too).
export const OPERATORS: { id: string; label: string; kind: 'value' | 'range' | 'list' | 'exists' | 'type' }[] = [
  { id: 'contains', label: 'contains', kind: 'value' },
  { id: 'eq', label: 'is', kind: 'value' },
  { id: 'ne', label: 'is not', kind: 'value' },
  { id: 'between', label: 'between', kind: 'range' },
  { id: 'gt', label: '>', kind: 'value' },
  { id: 'gte', label: '≥', kind: 'value' },
  { id: 'lt', label: '<', kind: 'value' },
  { id: 'lte', label: '≤', kind: 'value' },
  { id: 'in', label: 'any of', kind: 'list' },
  { id: 'nin', label: 'none of', kind: 'list' },
  { id: 'startsWith', label: 'starts with', kind: 'value' },
  { id: 'endsWith', label: 'ends with', kind: 'value' },
  { id: 'exists', label: 'exists', kind: 'exists' },
  { id: 'type', label: 'has type', kind: 'type' }
];

export const DATATYPES = ['string', 'number', 'boolean', 'date', 'array', 'object', 'null'];

export const ROOT_FIELD_SUGGESTIONS = ['tags', 'thingtime', 'createdAt', 'updatedAt', 'targetId'];

export const opKind = (op: string) => OPERATORS.find((entry) => entry.id === op)?.kind || 'value';

const rowId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

export const newRow = (partial: Partial<ConditionRow> = {}): ConditionRow => ({
  id: rowId(),
  field: '',
  op: 'contains',
  value: '',
  value2: '',
  valueType: 'auto',
  ...partial
});

export const PURE_NUMBER = /^-?\d+(\.\d+)?$/;

// GUI string → API scalar, honouring the row's datatype hint. 'auto' reads
// like a developer would: true/false/null literals and pure numbers become
// their real types, everything else stays text.
export const coerceValue = (raw: string, valueType: RowValueType): string | number | boolean | null => {
  const value = raw.trim();
  if (valueType === 'text') return value;
  if (valueType === 'number') return PURE_NUMBER.test(value) ? Number(value) : value;
  if (valueType === 'boolean') return value === 'true';
  if (valueType === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (PURE_NUMBER.test(value)) return Number(value);
  return value;
};

export type ApiCondition = Record<string, unknown>;

// Pre-submit validation: a row explicitly typed 'number' whose value isn't one
// is a typo the user should hear about, not a silent string comparison.
export const invalidNumberField = (rows: ConditionRow[]): string | null => {
  for (const row of rows) {
    if (row.valueType !== 'number' || !row.field.trim()) continue;
    const kind = opKind(row.op);
    const values =
      kind === 'range'
        ? [row.value, row.value2]
        : kind === 'list'
          ? row.value.split(',')
          : kind === 'value'
            ? [row.value]
            : [];
    for (const value of values) {
      const trimmed = value.trim();
      if (trimmed && !PURE_NUMBER.test(trimmed)) return row.field.trim();
    }
  }
  return null;
};

// Compile GUI rows to the API's condition list. Empty rows are ignored (that's
// what makes schema prefill browsable — rows appear, you fill what you care
// about). Returns null when nothing is filled in.
export const compileRows = (rows: ConditionRow[]): ApiCondition[] | null => {
  const conditions: ApiCondition[] = [];
  for (const row of rows) {
    const field = row.field.trim();
    if (!field) continue;
    const kind = opKind(row.op);

    if (kind === 'exists') {
      conditions.push({ field, op: 'exists', value: row.value !== 'false' });
      continue;
    }
    if (kind === 'type') {
      if (!row.value) continue;
      conditions.push({ field, op: 'type', value: row.value });
      continue;
    }
    if (kind === 'range') {
      const low = row.value.trim();
      const high = row.value2.trim();
      if (!low && !high) continue;
      // the API's native between keeps the range atomic in any-of searches
      conditions.push({
        field,
        op: 'between',
        values: [low ? coerceValue(low, row.valueType) : null, high ? coerceValue(high, row.valueType) : null]
      });
      continue;
    }
    if (kind === 'list') {
      const values = row.value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => coerceValue(entry, row.valueType));
      if (!values.length) continue;
      conditions.push({ field, op: row.op, values });
      continue;
    }
    if (row.valueType !== 'null' && !row.value.trim()) continue;
    conditions.push({ field, op: row.op, value: coerceValue(row.value, row.valueType) });
  }
  return conditions.length ? conditions : null;
};

export type ConditionRowsEditorProps = {
  rows: ConditionRow[];
  onUpdateRow: (id: string, patch: Partial<ConditionRow>) => void;
  onRemoveRow: (id: string) => void;
  fieldSuggestions?: string[];
  // must be unique per mounted editor (datalists are looked up by document id)
  datalistId?: string;
  // page-specific escape hatch: return a node to replace a row's standard
  // widgets entirely (e.g. /search renders its pinned schema-scope chip),
  // return null/undefined to keep the default rendering
  renderRow?: (row: ConditionRow) => React.ReactNode;
};

// The builder rows themselves — field, operator, value widgets (enum chips,
// between ranges with unit hints, exists yes/no, datatype select) and the
// per-row datatype hint. Purely controlled; compilation stays with the caller.
export const ConditionRowsEditor = (props: ConditionRowsEditorProps) => {
  const { rows, onUpdateRow, onRemoveRow, fieldSuggestions = [], datalistId = 'tt-search-fields', renderRow } = props;

  if (!rows.length) return null;

  return (
    <Flex direction="column" gap={2}>
      <datalist id={datalistId}>
        {fieldSuggestions.map((field) => (
          <option key={field} value={field} />
        ))}
      </datalist>
      {rows.map((row) => {
        const custom = renderRow?.(row);
        if (custom !== undefined && custom !== null) {
          return <React.Fragment key={row.id}>{custom}</React.Fragment>;
        }
        const kindOfOp = opKind(row.op);
        const enumValues = row.meta?.values;
        const unit = row.meta?.unit;
        const rangeHint = row.meta?.min !== undefined || row.meta?.max !== undefined;
        return (
          <Flex align="center" gap={2} key={row.id} wrap="wrap">
            {row.meta?.type ? (
              // schema-prefilled rows lock the field name — the schema defined
              // it, so it renders as a labelled column instead of a free input
              <Flex direction="column" flexShrink={0} minWidth="140px" maxWidth="180px">
                <Text
                  color="var(--tt-ink, #16161a)"
                  fontFamily="var(--tt-font-mono, monospace)"
                  fontSize="13px"
                  isTruncated
                  title={row.meta?.description || row.field}
                >
                  {row.field}
                </Text>
                <Text color="var(--tt-faint, #b6b6c0)" fontSize="10px">
                  {row.meta.type}
                  {unit ? ` · ${unit}` : ''}
                </Text>
              </Flex>
            ) : (
              <Input
                list={datalistId}
                maxWidth="180px"
                onChange={(event) => onUpdateRow(row.id, { field: event.target.value })}
                placeholder="field (e.g. legs)"
                size="sm"
                title={row.meta?.description || 'crystal field path — bare names mean crystal.<name>'}
                value={row.field}
              />
            )}
            <Select
              maxWidth="130px"
              onChange={(event) => onUpdateRow(row.id, { op: event.target.value })}
              size="sm"
              value={row.op}
            >
              {OPERATORS.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.label}
                </option>
              ))}
            </Select>

            {kindOfOp === 'exists' ? (
              <Select
                maxWidth="90px"
                onChange={(event) => onUpdateRow(row.id, { value: event.target.value })}
                size="sm"
                value={row.value || 'true'}
              >
                <option value="true">yes</option>
                <option value="false">no</option>
              </Select>
            ) : kindOfOp === 'type' ? (
              <Select
                maxWidth="120px"
                onChange={(event) => onUpdateRow(row.id, { value: event.target.value })}
                placeholder="datatype"
                size="sm"
                value={row.value}
              >
                {DATATYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            ) : kindOfOp === 'range' ? (
              <>
                <Input
                  maxWidth="110px"
                  onChange={(event) => onUpdateRow(row.id, { value: event.target.value })}
                  placeholder={row.meta?.min !== undefined ? String(row.meta.min) : 'min'}
                  size="sm"
                  value={row.value}
                />
                <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
                  –
                </Text>
                <Input
                  maxWidth="110px"
                  onChange={(event) => onUpdateRow(row.id, { value2: event.target.value })}
                  placeholder={row.meta?.max !== undefined ? String(row.meta.max) : 'max'}
                  size="sm"
                  value={row.value2}
                />
                {unit || rangeHint ? (
                  <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
                    {unit || ''}
                  </Text>
                ) : null}
              </>
            ) : kindOfOp === 'list' && enumValues?.length ? (
              <Flex gap={1} wrap="wrap">
                {enumValues.map((option) => {
                  const selected = row.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                  const isOn = selected.includes(option);
                  return (
                    <Button
                      colorScheme={isOn ? 'pink' : undefined}
                      key={option}
                      onClick={() => {
                        const next = isOn
                          ? selected.filter((entry) => entry !== option)
                          : [...selected, option];
                        onUpdateRow(row.id, { value: next.join(',') });
                      }}
                      size="xs"
                      variant={isOn ? 'solid' : 'outline'}
                    >
                      {option}
                    </Button>
                  );
                })}
              </Flex>
            ) : (
              <Input
                list={enumValues?.length ? `${datalistId}-values-${row.id}` : undefined}
                maxWidth="220px"
                onChange={(event) => onUpdateRow(row.id, { value: event.target.value })}
                placeholder={kindOfOp === 'list' ? 'value, value, …' : unit ? `value (${unit})` : 'value'}
                size="sm"
                value={row.value}
              />
            )}
            {enumValues?.length && kindOfOp === 'value' ? (
              <datalist id={`${datalistId}-values-${row.id}`}>
                {enumValues.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            ) : null}

            {kindOfOp === 'value' || kindOfOp === 'range' || kindOfOp === 'list' ? (
              <Select
                flexShrink={0}
                onChange={(event) => onUpdateRow(row.id, { valueType: event.target.value as RowValueType })}
                size="sm"
                title="value datatype — auto reads true/false/null and numbers as their real types"
                value={row.valueType}
                width="105px"
              >
                <option value="auto">auto</option>
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="boolean">bool</option>
                <option value="null">null</option>
              </Select>
            ) : null}

            <IconButton
              aria-label="Remove filter"
              icon={<X size={14} />}
              onClick={() => onRemoveRow(row.id)}
              size="sm"
              variant="ghost"
            />
          </Flex>
        );
      })}
    </Flex>
  );
};
