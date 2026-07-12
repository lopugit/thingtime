import React from 'react';
import { Box, Button, Flex, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';
import { CornerDownRight, Plus, Trash2, X } from 'lucide-react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import {
  MAX_SCHEMA_FIELDS,
  MAX_SCHEMA_FIELD_DEPTH,
  MAX_SCHEMA_NAME_CHARS,
  SCHEMA_FIELD_TYPES,
  type SchemaFieldType,
  type SchemaThingField
} from '~/schemas/registry';
import { generateSampleFromFields } from '~/schemas/tools';

// "Create a Schema" — arbitrarily nested field trees with per-type
// constraints, publishing through the one real creation path
// (POST /api/v1/things, thingtime ["schema"]).

export type BuilderPrefill = {
  name?: string;
  description?: string;
  fields?: SchemaThingField[];
  forkOf?: string;
};

type SchemaBuilderProps = {
  prefill: BuilderPrefill | null;
  onClose: () => void;
  onCreated: (thing: any) => void;
};

const draftId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

type DraftField = {
  id: string;
  name: string;
  type: SchemaFieldType;
  description: string;
  required: boolean;
  values: string; // enum: one value per line (values may contain commas)
  min: string;
  max: string;
  unit: string;
  maxLength: string;
  minItems: string;
  maxItems: string;
  children: DraftField[]; // object
  items: DraftField | null; // array (name unused)
};

const blankField = (partial: Partial<DraftField> = {}): DraftField => ({
  id: draftId(),
  name: '',
  type: 'string',
  description: '',
  required: false,
  values: '',
  min: '',
  max: '',
  unit: '',
  maxLength: '',
  minItems: '',
  maxItems: '',
  children: [],
  items: null,
  ...partial
});

const fromSchemaField = (field: SchemaThingField): DraftField =>
  blankField({
    name: field.name || '',
    type: (SCHEMA_FIELD_TYPES as readonly string[]).includes(field.type) ? field.type : 'string',
    description: field.description || '',
    required: !!field.required,
    values: (field.values || []).join('\n'),
    min: field.min !== undefined ? String(field.min) : '',
    max: field.max !== undefined ? String(field.max) : '',
    unit: field.unit || '',
    maxLength: field.maxLength !== undefined ? String(field.maxLength) : '',
    minItems: field.minItems !== undefined ? String(field.minItems) : '',
    maxItems: field.maxItems !== undefined ? String(field.maxItems) : '',
    children: (field.children || []).map(fromSchemaField),
    items: field.items ? fromSchemaField({ name: 'items', ...field.items } as SchemaThingField) : null
  });

// mirrors the server's SCHEMA_FIELD_NAME_PATTERN: one path segment, no dots —
// nesting comes from object children / array items
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const RESERVED_TOP_LEVEL_NAMES = new Set(['schema', 'schemaid']);

type CompileResult = { fields: SchemaThingField[]; issues: string[]; nodes: number };

const compileDrafts = (drafts: DraftField[], depth: number, path: string): CompileResult => {
  const fields: SchemaThingField[] = [];
  const issues: string[] = [];
  let nodes = 0;
  const seen = new Set<string>();

  for (const draft of drafts) {
    nodes += 1;
    const label = draft.name || `${path || 'field'} #${drafts.indexOf(draft) + 1}`;
    if (!draft.name.trim()) {
      issues.push(`${label}: needs a name`);
      continue;
    }
    const name = draft.name.trim();
    if (!FIELD_NAME_PATTERN.test(name) || name.length > 60) {
      issues.push(`${name}: names are letters/numbers/_/- (nest with object fields, not dots), max 60 chars`);
      continue;
    }
    if (depth === 1 && RESERVED_TOP_LEVEL_NAMES.has(name.toLowerCase())) {
      issues.push(`${name}: reserved — it tags data things with their schema`);
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      issues.push(`${name}: duplicate field name`);
      continue;
    }
    seen.add(name.toLowerCase());
    if (depth > MAX_SCHEMA_FIELD_DEPTH) {
      issues.push(`${name}: nests deeper than ${MAX_SCHEMA_FIELD_DEPTH} levels`);
      continue;
    }

    const field: SchemaThingField = { name, type: draft.type };
    if (draft.description.trim()) field.description = draft.description.trim();
    if (draft.required) field.required = true;

    const num = (raw: string) => (raw.trim() === '' ? undefined : Number(raw));
    if (draft.type === 'enum') {
      // one value per line — never split on commas, values may contain them
      const values = draft.values
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (!values.length) issues.push(`${name}: enum needs at least one value`);
      field.values = values;
    }
    if (draft.type === 'number') {
      const min = num(draft.min);
      const max = num(draft.max);
      if (min !== undefined) {
        if (Number.isFinite(min)) field.min = min;
        else issues.push(`${name}: min must be a number`);
      }
      if (max !== undefined) {
        if (Number.isFinite(max)) field.max = max;
        else issues.push(`${name}: max must be a number`);
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        issues.push(`${name}: min can’t exceed max`);
      }
      if (draft.unit.trim()) field.unit = draft.unit.trim();
    }
    if (draft.type === 'string' || draft.type === 'string[]') {
      const maxLength = num(draft.maxLength);
      if (maxLength !== undefined) {
        if (Number.isInteger(maxLength) && maxLength > 0) field.maxLength = maxLength;
        else issues.push(`${name}: maxLength must be a whole number > 0`);
      }
    }
    if (draft.type === 'string[]' || draft.type === 'array') {
      const minItems = num(draft.minItems);
      const maxItems = num(draft.maxItems);
      if (minItems !== undefined) {
        if (Number.isInteger(minItems) && minItems >= 0) field.minItems = minItems;
        else issues.push(`${name}: minItems must be a whole number ≥ 0`);
      }
      if (maxItems !== undefined) {
        if (Number.isInteger(maxItems) && maxItems >= 0) field.maxItems = maxItems;
        else issues.push(`${name}: maxItems must be a whole number ≥ 0`);
      }
      if (field.minItems !== undefined && field.maxItems !== undefined && field.minItems > field.maxItems) {
        issues.push(`${name}: minItems can’t exceed maxItems`);
      }
    }
    if (draft.type === 'object') {
      if (!draft.children.length) {
        issues.push(`${name}: objects need at least one nested field`);
      } else {
        const nested = compileDrafts(draft.children, depth + 1, name);
        nodes += nested.nodes;
        issues.push(...nested.issues);
        field.children = nested.fields;
      }
    }
    if (draft.type === 'array') {
      if (!draft.items) {
        issues.push(`${name}: arrays need an entry type`);
      } else {
        const itemDraft = { ...draft.items, name: 'items', required: false };
        const nested = compileDrafts([itemDraft], depth + 1, `${name}.items`);
        nodes += nested.nodes;
        issues.push(...nested.issues);
        if (nested.fields[0]) {
          const { name: _drop, required: _drop2, ...spec } = nested.fields[0];
          field.items = spec;
        }
      }
    }

    fields.push(field);
  }

  return { fields, issues, nodes };
};

const inputSx = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid transparent',
  borderRadius: 'var(--tt-radius-sm, 9px)',
  fontSize: '13px',
  height: '30px',
  paddingX: 2.5,
  _placeholder: { color: 'var(--tt-muted, #9a9aa6)' },
  _focus: { background: 'var(--tt-card, #ffffff)', borderColor: 'var(--tt-border, #ececef)' }
} as const;

const tinyLabel = {
  color: 'var(--tt-faint, #b6b6c0)',
  fontSize: '10px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const
};

type FieldEditorProps = {
  draft: DraftField;
  depth: number;
  isItems?: boolean;
  onChange: (next: DraftField) => void;
  onRemove?: () => void;
};

const FieldEditor = ({ draft, depth, isItems, onChange, onRemove }: FieldEditorProps) => {
  const set = (patch: Partial<DraftField>) => onChange({ ...draft, ...patch });

  return (
    <Flex
      background={depth % 2 ? 'var(--tt-surface, #fafafb)' : 'var(--tt-card, #ffffff)'}
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-md, 12px)"
      direction="column"
      gap={2}
      padding={2.5}
    >
      <Flex align="center" gap={2} wrap="wrap">
        {isItems ? (
          <Flex align="center" color="var(--tt-muted, #9a9aa6)" fontSize="12px" gap={1} minWidth="70px">
            <CornerDownRight size={12} /> entries
          </Flex>
        ) : (
          <Input
            {...inputSx}
            aria-label="Field name"
            maxWidth="180px"
            onChange={(event) => set({ name: event.target.value })}
            placeholder="field_name"
            value={draft.name}
          />
        )}
        <Select
          aria-label="Field type"
          background="var(--tt-surface-alt, #f5f5f7)"
          border="1px solid transparent"
          borderRadius="var(--tt-radius-sm, 9px)"
          fontSize="13px"
          height="30px"
          maxWidth="120px"
          onChange={(event) => {
            const type = event.target.value as SchemaFieldType;
            set({
              type,
              children: type === 'object' && !draft.children.length ? [blankField()] : draft.children,
              items: type === 'array' && !draft.items ? blankField({ name: 'items' }) : draft.items
            });
          }}
          size="sm"
          value={draft.type}
        >
          {SCHEMA_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>

        {draft.type === 'number' && (
          <>
            <Input {...inputSx} maxWidth="70px" onChange={(event) => set({ min: event.target.value })} placeholder="min" value={draft.min} />
            <Input {...inputSx} maxWidth="70px" onChange={(event) => set({ max: event.target.value })} placeholder="max" value={draft.max} />
            <Input {...inputSx} maxWidth="70px" onChange={(event) => set({ unit: event.target.value })} placeholder="unit" value={draft.unit} />
          </>
        )}
        {(draft.type === 'string' || draft.type === 'string[]') && (
          <Input
            {...inputSx}
            maxWidth="92px"
            onChange={(event) => set({ maxLength: event.target.value })}
            placeholder="max chars"
            value={draft.maxLength}
          />
        )}
        {(draft.type === 'string[]' || draft.type === 'array') && (
          <>
            <Input {...inputSx} maxWidth="80px" onChange={(event) => set({ minItems: event.target.value })} placeholder="min #" value={draft.minItems} />
            <Input {...inputSx} maxWidth="80px" onChange={(event) => set({ maxItems: event.target.value })} placeholder="max #" value={draft.maxItems} />
          </>
        )}

        <Box flex={1} />
        {!isItems && (
          <Flex align="center" gap={1.5}>
            <Text {...tinyLabel}>required</Text>
            <Switch isChecked={draft.required} onChange={(event) => set({ required: event.target.checked })} size="sm" />
          </Flex>
        )}
        {onRemove && (
          <Button aria-label="Remove field" onClick={onRemove} size="xs" variant="ghost">
            <Trash2 size={13} />
          </Button>
        )}
      </Flex>

      {draft.type === 'enum' && (
        <Textarea
          {...inputSx}
          minHeight="72px"
          onChange={(event) => set({ values: event.target.value })}
          placeholder={'allowed values, one per line —\nwood\nwood, reclaimed\nconcrete'}
          rows={3}
          value={draft.values}
        />
      )}

      <Input
        {...inputSx}
        onChange={(event) => set({ description: event.target.value })}
        placeholder="description (optional)"
        value={draft.description}
      />

      {draft.type === 'object' && (
        <Flex direction="column" gap={2} paddingLeft={4}>
          {draft.children.map((child, index) => (
            <FieldEditor
              depth={depth + 1}
              draft={child}
              key={child.id}
              onChange={(next) => set({ children: draft.children.map((existing, i) => (i === index ? next : existing)) })}
              onRemove={() => set({ children: draft.children.filter((_, i) => i !== index) })}
            />
          ))}
          <Button
            alignSelf="flex-start"
            isDisabled={depth + 1 > MAX_SCHEMA_FIELD_DEPTH}
            leftIcon={<Plus size={12} />}
            onClick={() => set({ children: [...draft.children, blankField()] })}
            size="xs"
            variant="ghost"
          >
            nested field
          </Button>
        </Flex>
      )}

      {draft.type === 'array' && draft.items && (
        <Box paddingLeft={4}>
          <FieldEditor
            depth={depth + 1}
            draft={draft.items}
            isItems
            onChange={(next) => set({ items: next })}
          />
        </Box>
      )}
    </Flex>
  );
};

export const SchemaBuilder = ({ prefill, onClose, onCreated }: SchemaBuilderProps) => {
  const api = useApi();
  const lopu = useLopu();
  const [name, setName] = React.useState(prefill?.name || '');
  const [description, setDescription] = React.useState(prefill?.description || '');
  const [drafts, setDrafts] = React.useState<DraftField[]>(() =>
    prefill?.fields?.length ? prefill.fields.map(fromSchemaField) : [blankField()]
  );
  const [publishing, setPublishing] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(true);

  const compiled = React.useMemo(() => compileDrafts(drafts, 1, ''), [drafts]);
  const issues = [...compiled.issues];
  if (!name.trim()) issues.unshift('Give your schema a name');
  if (name.length > MAX_SCHEMA_NAME_CHARS) issues.unshift(`Name caps at ${MAX_SCHEMA_NAME_CHARS} chars`);
  if (!drafts.length) issues.push('Add at least one field');
  if (compiled.nodes > MAX_SCHEMA_FIELDS) issues.push(`Too many fields — max ${MAX_SCHEMA_FIELDS} counting nested ones`);

  const sample = React.useMemo(
    () => (compiled.fields.length ? generateSampleFromFields(compiled.fields) : null),
    [compiled.fields]
  );

  const publish = async () => {
    if (issues.length) {
      lopu({ title: issues[0], status: 'error', duration: 8000 });
      return;
    }
    setPublishing(true);
    try {
      const resp: any = await api.v1.things.create({
        thingtime: ['schema'],
        crystal: {
          name: name.trim(),
          description: description.trim(),
          fields: compiled.fields,
          ...(prefill?.forkOf ? { forkOf: prefill.forkOf } : {})
        }
      });
      if (!resp?.ok) throw resp;
      lopu({ title: `Schema “${name.trim()}” published ✨`, status: 'success', duration: 6000 });
      onCreated(resp.thing);
    } catch (err: any) {
      lopu({ title: err?.error || 'Publishing hiccuped — try again 🌈', status: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Flex
      background="var(--tt-card, #ffffff)"
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-lg, 16px)"
      direction="column"
      gap={3}
      padding={4}
    >
      <Flex align="center" gap={2}>
        <Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={700}>
          {prefill?.forkOf ? 'Fork this schema 🍴' : prefill?.fields?.length ? 'New schema (prefilled)' : 'Create a Schema'}
        </Text>
        <Box flex={1} />
        <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
          {compiled.nodes}/{MAX_SCHEMA_FIELDS} fields
        </Text>
        <Button aria-label="Close builder" onClick={onClose} size="xs" variant="ghost">
          <X size={14} />
        </Button>
      </Flex>

      <Flex gap={2} wrap="wrap">
        <Input
          {...inputSx}
          fontWeight={600}
          maxWidth="280px"
          onChange={(event) => setName(event.target.value)}
          placeholder="Schema name — e.g. Table"
          value={name}
        />
        <Textarea
          background="var(--tt-surface-alt, #f5f5f7)"
          border="1px solid transparent"
          borderRadius="var(--tt-radius-sm, 9px)"
          flex={1}
          fontSize="13px"
          minHeight="30px"
          minWidth="220px"
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What shape does this describe?"
          rows={1}
          value={description}
          _focus={{ background: 'var(--tt-card, #ffffff)', borderColor: 'var(--tt-border, #ececef)' }}
          _placeholder={{ color: 'var(--tt-muted, #9a9aa6)' }}
        />
      </Flex>

      <Flex direction="column" gap={2}>
        {drafts.map((draft, index) => (
          <FieldEditor
            depth={1}
            draft={draft}
            key={draft.id}
            onChange={(next) => setDrafts((prev) => prev.map((existing, i) => (i === index ? next : existing)))}
            onRemove={drafts.length > 1 ? () => setDrafts((prev) => prev.filter((_, i) => i !== index)) : undefined}
          />
        ))}
      </Flex>

      <Flex align="center" gap={2} wrap="wrap">
        <Button leftIcon={<Plus size={13} />} onClick={() => setDrafts((prev) => [...prev, blankField()])} size="xs" variant="outline">
          Add field
        </Button>
        <Button onClick={() => setShowPreview((show) => !show)} size="xs" variant="ghost">
          {showPreview ? 'Hide' : 'Show'} sample
        </Button>
        <Box flex={1} />
        <Button colorScheme="pink" isLoading={publishing} onClick={publish} size="sm">
          Publish schema ✨
        </Button>
      </Flex>

      {issues.length > 0 && (
        <Flex direction="column" gap={1}>
          {issues.slice(0, 4).map((issue) => (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" key={issue}>
              · {issue}
            </Text>
          ))}
        </Flex>
      )}

      {showPreview && sample && (
        <Box
          as="pre"
          background="var(--tt-surface, #fafafb)"
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-md, 12px)"
          color="var(--tt-text, #33333c)"
          fontFamily="var(--tt-font-mono, monospace)"
          fontSize="12px"
          overflowX="auto"
          padding={3}
        >
          {JSON.stringify(sample, null, 2)}
        </Box>
      )}
    </Flex>
  );
};
