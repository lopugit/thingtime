import React from 'react';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';

import { MONGO_BSON_VALUE_TYPES, type MongoBsonValueType } from '~/api/utils/mongodb/queryContract';
import { createBsonEntry, createBsonValue, type BsonValueNode } from './queryBuilderState';

type Props = {
  value: BsonValueNode;
  onChange: (value: BsonValueNode) => void;
  depth?: number;
  compact?: boolean;
};

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const placeholderFor = (type: MongoBsonValueType) => {
  if (type === 'date') return '2026-07-12T12:00';
  if (type === 'objectId') return '664f1c2a9d3e5b0012345678';
  if (type === 'regex') return '^hello';
  if (type === 'timestamp') return 'seconds:increment';
  if (type === 'uuid') return '00112233-4455-6677-8899-aabbccddeeff';
  if (type === 'binary') return 'base64 data';
  if (type === 'int64') return '9007199254740993';
  return 'Value';
};

const isLiteralType = (type: MongoBsonValueType) => type === 'null' || type === 'minKey' || type === 'maxKey';

const BsonValueEditorComponent = ({ value, onChange, depth = 0, compact = false }: Props) => {
  const nested = value.type === 'document' || value.type === 'array';

  const changeType = (type: MongoBsonValueType) => {
    const next = createBsonValue(type, type === 'boolean' ? 'true' : '');
    next.id = value.id;
    if (type === 'document' || type === 'array') next.entries = [createBsonEntry()];
    onChange(next);
  };

  const updateEntry = (index: number, next: (typeof value.entries)[number]) => {
    const entries = [...value.entries];
    entries[index] = next;
    onChange({ ...value, entries });
  };

  const removeEntry = (index: number) =>
    onChange({ ...value, entries: value.entries.filter((_, entryIndex) => entryIndex !== index) });

  return (
    <Flex flexDirection="column" rowGap={2} minWidth={0} width="100%">
      <Flex gap={2} alignItems="center" minWidth={0} flexWrap={compact ? 'wrap' : { base: 'wrap', md: 'nowrap' }}>
        <Select
          aria-label="BSON value type"
          size="sm"
          width={compact ? { base: '100%', sm: '150px' } : { base: '100%', md: '170px' }}
          flexShrink={0}
          value={value.type}
          onChange={(event) => changeType(event.target.value as MongoBsonValueType)}
          {...inputStyles}
        >
          {MONGO_BSON_VALUE_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Select>

        {value.type === 'boolean' ? (
          <Select
            aria-label="Boolean value"
            size="sm"
            value={value.value || 'true'}
            onChange={(event) => onChange({ ...value, value: event.target.value })}
            {...inputStyles}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        ) : null}

        {!nested && !isLiteralType(value.type) && value.type !== 'boolean' ? (
          <Input
            aria-label={`${value.type} value`}
            size="sm"
            minWidth="120px"
            type={value.type === 'date' ? 'datetime-local' : 'text'}
            fontFamily={['number', 'int32', 'int64', 'double', 'decimal128'].includes(value.type) ? 'mono' : undefined}
            value={value.value}
            placeholder={placeholderFor(value.type)}
            onChange={(event) => onChange({ ...value, value: event.target.value })}
            {...inputStyles}
          />
        ) : null}

        {value.type === 'regex' ? (
          <Input
            aria-label="Regular expression flags"
            size="sm"
            width={{ base: '100%', sm: '92px' }}
            flexShrink={0}
            fontFamily="mono"
            value={value.options || ''}
            placeholder="imsx"
            onChange={(event) => onChange({ ...value, options: event.target.value })}
            {...inputStyles}
          />
        ) : null}

        {value.type === 'binary' ? (
          <Input
            aria-label="Binary subtype"
            size="sm"
            width={{ base: '100%', sm: '92px' }}
            flexShrink={0}
            fontFamily="mono"
            value={value.options || '00'}
            placeholder="00"
            maxLength={2}
            onChange={(event) => onChange({ ...value, options: event.target.value })}
            {...inputStyles}
          />
        ) : null}

        {isLiteralType(value.type) ? (
          <Text fontSize="sm" color="var(--tt-muted, #777783)">
            {value.type === 'null' ? 'null' : value.type === 'minKey' ? 'Minimum BSON value' : 'Maximum BSON value'}
          </Text>
        ) : null}
      </Flex>

      {nested ? (
        <Flex
          flexDirection="column"
          rowGap={2}
          marginLeft={depth ? { base: 1, md: 3 } : 0}
          paddingLeft={depth ? 2 : 0}
          borderLeft={depth ? '2px solid var(--tt-border, #ececef)' : undefined}
          minWidth={0}
        >
          {value.entries.map((entry, index) => (
            <Flex
              key={entry.id}
              gap={2}
              alignItems="flex-start"
              flexDirection={{ base: 'column', md: 'row' }}
              padding={2}
              borderRadius="var(--tt-radius-sm, 9px)"
              background="var(--tt-surface, #fafafb)"
              minWidth={0}
            >
              {value.type === 'document' ? (
                <Input
                  aria-label="Document field or operator"
                  size="sm"
                  width={{ base: '100%', md: '180px' }}
                  flexShrink={0}
                  fontFamily="mono"
                  value={entry.key}
                  placeholder="field or $operator"
                  onChange={(event) => updateEntry(index, { ...entry, key: event.target.value })}
                  {...inputStyles}
                />
              ) : (
                <Text width={{ base: 'auto', md: '30px' }} paddingTop={2} fontFamily="mono" fontSize="xs" opacity={0.55}>
                  {index}
                </Text>
              )}
              <Box flex="1 1 auto" minWidth={0} width="100%">
                <BsonValueEditor
                  value={entry.value}
                  depth={depth + 1}
                  compact
                  onChange={(next) => updateEntry(index, { ...entry, value: next })}
                />
              </Box>
              <Button
                aria-label={`Remove ${value.type === 'document' ? entry.key || 'field' : `item ${index + 1}`}`}
                size="xs"
                variant="ghost"
                colorScheme="red"
                flexShrink={0}
                onClick={() => removeEntry(index)}
              >
                ✕
              </Button>
            </Flex>
          ))}
          <Box>
            <Button
              size="xs"
              variant="outline"
              onClick={() => onChange({ ...value, entries: [...value.entries, createBsonEntry()] })}
            >
              + {value.type === 'document' ? 'Add field' : 'Add item'}
            </Button>
          </Box>
        </Flex>
      ) : null}
    </Flex>
  );
};

export const BsonValueEditor = React.memo(BsonValueEditorComponent);
