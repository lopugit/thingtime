import React from 'react';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';

import { MONGO_FILTER_OPERATORS, type MongoBsonValueType } from '~/api/utils/mongodb/queryContract';
import { BsonValueEditor } from './BsonValueEditor';
import {
  createBsonValue,
  createFilterGroup,
  createFilterRule,
  type FilterGroup,
  type FilterRule
} from './queryBuilderState';

type Props = {
  value: FilterGroup;
  onChange: (value: FilterGroup) => void;
  depth?: number;
};

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const ROOT_OPERATORS = new Set(['$expr', '$jsonSchema', '$text']);

const typeForOperator = (operator: string): MongoBsonValueType => {
  if (operator === '$exists') return 'boolean';
  if (operator === '$regex') return 'regex';
  if (operator === '$size') return 'int32';
  if (['$in', '$nin', '$all', '$mod', '$bitsAllClear', '$bitsAllSet', '$bitsAnyClear', '$bitsAnySet'].includes(operator)) {
    return 'array';
  }
  if (['$elemMatch', '$expr', '$jsonSchema', '$not', '$geoIntersects', '$geoWithin', '$near', '$nearSphere'].includes(operator)) {
    return 'document';
  }
  return 'string';
};

const OperatorSelect = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const groups = Array.from(new Set(MONGO_FILTER_OPERATORS.map((operator) => operator.group)));
  return (
    <Select
      aria-label="MongoDB filter operator"
      size="sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...inputStyles}
    >
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {MONGO_FILTER_OPERATORS.filter((operator) => operator.group === group).map((operator) => (
            <option key={operator.value} value={operator.value}>
              {operator.label} ({operator.value})
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
};

const RuleEditor = ({ value, onChange }: { value: FilterRule; onChange: (value: FilterRule) => void }) => {
  const rootOperator = ROOT_OPERATORS.has(value.operator);
  const changeOperator = (operator: string) => {
    const type = typeForOperator(operator);
    const next = createBsonValue(type, operator === '$exists' ? 'true' : '');
    if (type === 'document' || type === 'array') next.entries = [];
    onChange({ ...value, operator, value: next });
  };

  return (
    <Flex
      gap={2}
      flexDirection={{ base: 'column', lg: 'row' }}
      alignItems={{ base: 'stretch', lg: 'flex-start' }}
      minWidth={0}
      width="100%"
    >
      {rootOperator ? (
        <Flex
          alignItems="center"
          minHeight="32px"
          width={{ base: '100%', lg: '190px' }}
          flexShrink={0}
          paddingX={3}
          borderRadius="var(--tt-radius-sm, 9px)"
          background="var(--tt-surface-alt, #f5f5f7)"
        >
          <Text fontSize="xs" fontWeight={600} color="var(--tt-muted, #777783)">
            Whole document
          </Text>
        </Flex>
      ) : (
        <Input
          aria-label="MongoDB field path"
          size="sm"
          width={{ base: '100%', lg: '190px' }}
          flexShrink={0}
          fontFamily="mono"
          value={value.field}
          placeholder="field.path"
          onChange={(event) => onChange({ ...value, field: event.target.value })}
          {...inputStyles}
        />
      )}
      <Box width={{ base: '100%', lg: '250px' }} flexShrink={0}>
        <OperatorSelect value={value.operator} onChange={changeOperator} />
      </Box>
      <Box flex="1 1 280px" minWidth={0}>
        <BsonValueEditor value={value.value} onChange={(next) => onChange({ ...value, value: next })} compact />
      </Box>
    </Flex>
  );
};

const FilterBuilderComponent = ({ value, onChange, depth = 0 }: Props) => {
  const updateChild = (index: number, child: (typeof value.children)[number]) => {
    const children = [...value.children];
    children[index] = child;
    onChange({ ...value, children });
  };

  const moveChild = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.children.length) return;
    const children = [...value.children];
    [children[index], children[target]] = [children[target], children[index]];
    onChange({ ...value, children });
  };

  const removeChild = (index: number) =>
    onChange({ ...value, children: value.children.filter((_, childIndex) => childIndex !== index) });

  return (
    <Flex
      flexDirection="column"
      rowGap={3}
      padding={depth ? { base: 2, md: 3 } : 0}
      border={depth ? '1px solid var(--tt-border, #ececef)' : undefined}
      borderRadius={depth ? 'var(--tt-radius-md, 12px)' : undefined}
      background={depth ? 'var(--tt-card, #ffffff)' : undefined}
      minWidth={0}
    >
      <Flex alignItems="center" gap={2} flexWrap="wrap">
        <Text fontSize="xs" fontWeight={700} color="var(--tt-muted, #777783)">
          Match
        </Text>
        <Select
          aria-label="Filter group logic"
          size="xs"
          width="150px"
          value={value.combinator}
          onChange={(event) => onChange({ ...value, combinator: event.target.value as FilterGroup['combinator'] })}
          {...inputStyles}
        >
          <option value="and">ALL · AND</option>
          <option value="or">ANY · OR</option>
          <option value="nor">NONE · NOR</option>
        </Select>
        <Text fontSize="xs" color="var(--tt-muted, #777783)">
          of these rules
        </Text>
      </Flex>

      {value.children.map((child, index) => (
        <Flex
          key={child.id}
          flexDirection="column"
          rowGap={2}
          padding={3}
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-md, 12px)"
          background={child.kind === 'group' ? 'var(--tt-surface, #fafafb)' : 'var(--tt-card, #ffffff)'}
          minWidth={0}
        >
          <Flex justifyContent="flex-end" gap={1} flexWrap="wrap">
            <Button
              aria-label="Move rule up"
              size="xs"
              variant="ghost"
              isDisabled={index === 0}
              onClick={() => moveChild(index, -1)}
            >
              ↑
            </Button>
            <Button
              aria-label="Move rule down"
              size="xs"
              variant="ghost"
              isDisabled={index === value.children.length - 1}
              onClick={() => moveChild(index, 1)}
            >
              ↓
            </Button>
            <Button aria-label="Remove rule" size="xs" variant="ghost" colorScheme="red" onClick={() => removeChild(index)}>
              ✕
            </Button>
          </Flex>
          {child.kind === 'group' ? (
            <FilterBuilder value={child} depth={depth + 1} onChange={(next) => updateChild(index, next)} />
          ) : (
            <RuleEditor value={child} onChange={(next) => updateChild(index, next)} />
          )}
        </Flex>
      ))}

      <Flex gap={2} flexWrap="wrap">
        <Button size="xs" variant="outline" onClick={() => onChange({ ...value, children: [...value.children, createFilterRule()] })}>
          + Condition
        </Button>
        <Button size="xs" variant="outline" onClick={() => onChange({ ...value, children: [...value.children, createFilterGroup('and')] })}>
          + Nested group
        </Button>
      </Flex>
    </Flex>
  );
};

export const FilterBuilder = React.memo(FilterBuilderComponent);
