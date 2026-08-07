import React from 'react';
import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Select,
  Text,
  VisuallyHidden
} from '@chakra-ui/react';
import { X } from 'lucide-react';

import { OPERATORS, newRow, opKind } from '~/components/Search/searchBuilder';
import type { ConditionRow, RowValueType } from '~/components/Search/searchTypes';

import {
  adminFilterValueForOperatorChange,
  applyAdminRowQuery,
  createAdminRowQuery,
  type AdminRowField,
  type AdminRowFieldKind,
  type AdminRowQuery,
  type AdminRowSort
} from './adminRowQuery';

const OPERATOR_IDS: Record<AdminRowFieldKind, readonly string[]> = {
  string: ['contains', 'eq', 'ne', 'startsWith', 'endsWith', 'in', 'nin', 'exists'],
  number: ['eq', 'ne', 'between', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'exists'],
  boolean: ['eq', 'ne', 'exists'],
  enum: ['eq', 'ne', 'exists'],
  date: ['eq', 'ne', 'between', 'gt', 'gte', 'lt', 'lte', 'exists']
};

const DEFAULT_OPERATOR: Record<AdminRowFieldKind, string> = {
  string: 'contains',
  number: 'eq',
  boolean: 'eq',
  enum: 'eq',
  date: 'eq'
};

const VALUE_TYPE: Record<AdminRowFieldKind, RowValueType> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  enum: 'text',
  date: 'text'
};

const DATE_OPERATOR_LABELS: Record<string, string> = {
  eq: 'on',
  ne: 'not on',
  between: 'between',
  gt: 'after',
  gte: 'on or after',
  lt: 'before',
  lte: 'on or before',
  exists: 'field presence'
};

const ACCESSIBLE_OPERATOR_LABELS: Record<string, string> = {
  gt: 'greater than',
  gte: 'greater than or equal to',
  lt: 'less than',
  lte: 'less than or equal to',
  in: 'any of',
  nin: 'none of'
};

const operatorsFor = (kind: AdminRowFieldKind) =>
  OPERATORS.filter((operator) => OPERATOR_IDS[kind].includes(operator.id));

const operatorLabel = (kind: AdminRowFieldKind, id: string, fallback: string): string =>
  kind === 'date' ? DATE_OPERATOR_LABELS[id] || fallback : ACCESSIBLE_OPERATOR_LABELS[id] || fallback;

const filterForField = <T,>(field: AdminRowField<T>): ConditionRow =>
  newRow({
    field: field.id,
    op: DEFAULT_OPERATOR[field.kind],
    value: field.kind === 'boolean' ? 'true' : '',
    valueType: VALUE_TYPE[field.kind],
    meta: {
      type: field.kind,
      values: field.options?.map((option) => option.value)
    }
  });

export type AdminRowQueryControlsProps<T> = {
  fields: readonly AdminRowField<T>[];
  value: AdminRowQuery;
  onChange: React.Dispatch<React.SetStateAction<AdminRowQuery>>;
  resultCount?: number;
  totalCount?: number;
  ariaLabel?: string;
  searchPlaceholder?: string;
};

export const AdminRowQueryControls = <T,>({
  fields,
  value,
  onChange,
  resultCount,
  totalCount,
  ariaLabel = 'Filter and sort admin rows',
  searchPlaceholder = 'Search rows…'
}: AdminRowQueryControlsProps<T>) => {
  const searchId = React.useId();
  const sortableFields = React.useMemo(() => fields.filter((field) => field.sortable !== false), [fields]);
  const fieldById = React.useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);

  const updateFilter = React.useCallback(
    (id: string, patch: Partial<ConditionRow>) =>
      onChange((current) => ({
        ...current,
        filters: current.filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter))
      })),
    [onChange]
  );

  const removeFilter = React.useCallback(
    (id: string) => onChange((current) => ({ ...current, filters: current.filters.filter((filter) => filter.id !== id) })),
    [onChange]
  );

  const renderFilterValue = (filter: ConditionRow, field: AdminRowField<T>, index: number) => {
    const label = `Filter ${index + 1} ${field.label}`;
    const kind = opKind(filter.op);
    if (kind === 'exists') {
      return (
        <Select
          aria-label={`${label} existence`}
          maxW="150px"
          onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
          size="sm"
          value={filter.value || 'true'}
        >
          <option value="true">exists</option>
          <option value="false">does not exist</option>
        </Select>
      );
    }
    if (kind === 'range') {
      const inputType = field.kind === 'date' ? 'date' : 'number';
      return (
        <Flex align="center" gap={2} wrap="wrap">
          <Input
            aria-label={`${label} minimum`}
            maxW="150px"
            onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
            size="sm"
            type={inputType}
            value={filter.value}
          />
          <Text aria-hidden fontSize="sm" opacity={0.55}>
            to
          </Text>
          <Input
            aria-label={`${label} maximum`}
            maxW="150px"
            onChange={(event) => updateFilter(filter.id, { value2: event.target.value })}
            size="sm"
            type={inputType}
            value={filter.value2}
          />
        </Flex>
      );
    }
    if (field.kind === 'boolean') {
      return (
        <Select
          aria-label={`${label} value`}
          maxW="120px"
          onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
          size="sm"
          value={filter.value || 'true'}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      );
    }
    if (field.kind === 'enum') {
      return (
        <Select
          aria-label={`${label} value`}
          maxW="190px"
          onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
          placeholder="Choose value"
          size="sm"
          value={filter.value}
        >
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }
    return (
      <Input
        aria-label={`${label} value`}
        maxW="220px"
        onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
        placeholder={kind === 'list' ? 'value, value, …' : 'value'}
        size="sm"
        type={kind === 'list' ? 'text' : field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'}
        value={filter.value}
      />
    );
  };

  return (
    <Box as="section" aria-label={ariaLabel} role="search">
      <Flex align="end" gap={3} mb={3} wrap="wrap">
        <FormControl flex="1 1 260px" maxW="420px">
          <FormLabel fontSize="xs" htmlFor={searchId} mb={1}>
            Search
          </FormLabel>
          <Input
            id={searchId}
            onChange={(event) => {
              const search = event.target.value;
              onChange((current) => ({ ...current, search }));
            }}
            placeholder={searchPlaceholder}
            size="sm"
            type="search"
            value={value.search}
          />
        </FormControl>
        <FormControl flex="0 1 210px">
          <FormLabel fontSize="xs" mb={1}>
            Sort by
          </FormLabel>
          <Select
            aria-label="Sort admin rows by field"
            onChange={(event) => {
              const field = event.target.value;
              onChange((current) => ({
                ...current,
                sort: field ? { field, direction: current.sort?.direction || 'asc' } : null
              }));
            }}
            size="sm"
            value={value.sort?.field || ''}
          >
            <option value="">Default order</option>
            {sortableFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </Select>
        </FormControl>
        <FormControl flex="0 1 150px">
          <FormLabel fontSize="xs" mb={1}>
            Direction
          </FormLabel>
          <Select
            aria-label="Sort admin rows direction"
            isDisabled={!value.sort}
            onChange={(event) => {
              const direction = event.target.value as AdminRowSort['direction'];
              onChange((current) => (current.sort ? { ...current, sort: { ...current.sort, direction } } : current));
            }}
            size="sm"
            value={value.sort?.direction || 'asc'}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </Select>
        </FormControl>
      </Flex>

      {value.filters.length ? (
        <Flex direction="column" gap={2} mb={3}>
          {value.filters.map((filter, index) => {
            const field = fieldById.get(filter.field) || fields[0];
            if (!field) return null;
            const operators = operatorsFor(field.kind);
            return (
              <Flex
                align="center"
                as="fieldset"
                borderWidth="1px"
                borderRadius="md"
                gap={2}
                key={filter.id}
                p={2}
                wrap="wrap"
              >
                <VisuallyHidden as="legend">Filter {index + 1}</VisuallyHidden>
                <Select
                  aria-label={`Filter ${index + 1} field`}
                  maxW="190px"
                  onChange={(event) => {
                    const nextField = fieldById.get(event.target.value);
                    if (!nextField) return;
                    const next = filterForField(nextField);
                    updateFilter(filter.id, { ...next, id: filter.id });
                  }}
                  size="sm"
                  value={field.id}
                >
                  {fields.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={`Filter ${index + 1} operator`}
                  maxW="180px"
                  onChange={(event) => {
                    const op = event.target.value;
                    const nextKind = opKind(op);
                    updateFilter(filter.id, {
                      op,
                      value: adminFilterValueForOperatorChange(field.kind, filter.op, op, filter.value),
                      value2: nextKind === 'range' ? filter.value2 : ''
                    });
                  }}
                  size="sm"
                  value={filter.op}
                >
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operatorLabel(field.kind, operator.id, operator.label)}
                    </option>
                  ))}
                </Select>
                {renderFilterValue(filter, field, index)}
                <IconButton
                  aria-label={`Remove ${field.label} filter`}
                  icon={<X size={14} />}
                  ml="auto"
                  onClick={() => removeFilter(filter.id)}
                  size="sm"
                  variant="ghost"
                />
              </Flex>
            );
          })}
        </Flex>
      ) : null}

      <Flex align="center" gap={2} wrap="wrap">
        <Button
          aria-label="Add row filter"
          isDisabled={!fields.length}
          onClick={() =>
            fields[0] && onChange((current) => ({ ...current, filters: [...current.filters, filterForField(fields[0])] }))
          }
          size="xs"
          variant="outline"
        >
          Add filter
        </Button>
        {value.search || value.filters.length ? (
          <Button
            onClick={() => onChange((current) => ({ ...current, search: '', filters: [] }))}
            size="xs"
            variant="ghost"
          >
            Clear filters
          </Button>
        ) : null}
        {typeof resultCount === 'number' && typeof totalCount === 'number' ? (
          <Text aria-live="polite" fontSize="xs" ml="auto" opacity={0.65} role="status">
            {resultCount} of {totalCount} rows
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
};

export type UseAdminRowQueryOptions<T> = {
  rows: readonly T[];
  fields: readonly AdminRowField<T>[];
  getRowId: (row: T) => string;
  initialSort?: AdminRowSort | null;
};

export const useAdminRowQuery = <T,>({ rows, fields, getRowId, initialSort = null }: UseAdminRowQueryOptions<T>) => {
  const [query, setQuery] = React.useState<AdminRowQuery>(() => createAdminRowQuery(initialSort));
  const deferredQuery = React.useDeferredValue(query);
  const visibleRows = React.useMemo(
    () => applyAdminRowQuery(rows, fields, deferredQuery, getRowId),
    [deferredQuery, fields, getRowId, rows]
  );
  return { query, setQuery, rows: visibleRows };
};
