import React from 'react';
import {
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalOverlay,
  Select,
  Switch,
  Text
} from '@chakra-ui/react';
import { Plus, Trash2, X } from 'lucide-react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { validateValueAgainstFields, type SchemaItemSpec, type SchemaThingField } from '~/schemas/registry';
import { describeSchemaField } from '~/schemas/tools';

import { schemaSearchPath, searchableSchemaSource, type SchemaCardSource } from './schemaBrowseTypes';

// "Create a thing using this schema" — a value form generated from the
// schema's field tree (nesting included). Publishes a free-form data thing
// whose crystal carries the schema-name convention (crystal.schema), so
// /search finds it via the schema rail.
//
// SchemaThingFormBody is the form itself (state, validation, publish) and
// renders inline on the schema's own page (/schemas/:key); SchemaThingForm
// wraps that same body in the modal the browse cards open. One form, one
// setPath, one publish payload — the two surfaces cannot drift.

type SchemaThingFormProps = {
  source: SchemaCardSource;
  onClose: () => void;
};

export type SchemaThingFormBodyProps = {
  source: SchemaCardSource;
  // the created thing (the API's public projection) — the modal closes on it,
  // the inline page refreshes its "your things" list
  onCreated?: (thing: Record<string, any> | null) => void;
  // inline surfaces start a fresh blank form after each create; the modal
  // closes instead, so it keeps the values until unmount
  resetOnCreate?: boolean;
};

const inputSx = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid transparent',
  borderRadius: 'var(--tt-radius-sm, 9px)',
  fontSize: '13px',
  height: '32px',
  paddingX: 2.5,
  _placeholder: { color: 'var(--tt-muted, #9a9aa6)' },
  _focus: { background: 'var(--tt-card, #ffffff)', borderColor: 'var(--tt-border, #ececef)' }
} as const;

const getPath = (value: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

// Clearing a leaf (next === undefined) DELETES the key and collapses now-empty
// parent objects, so an optional object like post.listing returns to "missing"
// when its inputs are cleared — a lingering { price: undefined } would otherwise
// trap publish behind the object's required children (checkSchemaValue only
// treats absent/null/'' as missing).
const setPath = (value: Record<string, unknown>, path: string[], next: unknown): Record<string, unknown> => {
  if (!path.length) return value;
  const [head, ...rest] = path;
  let child = next;
  if (rest.length) {
    const branch =
      value[head] && typeof value[head] === 'object' && !Array.isArray(value[head])
        ? (value[head] as Record<string, unknown>)
        : {};
    const updated = setPath(branch, rest, next);
    child = Object.keys(updated).length ? updated : undefined;
  }
  if (child === undefined) {
    const { [head]: _removed, ...remaining } = value;
    return remaining;
  }
  return { ...value, [head]: child };
};

type LeafInputProps = {
  field: SchemaThingField | SchemaItemSpec;
  value: unknown;
  onChange: (next: unknown) => void;
};

const LeafInput = ({ field, value, onChange }: LeafInputProps) => {
  switch (field.type) {
    case 'boolean':
      return <Switch isChecked={value === true} onChange={(event) => onChange(event.target.checked)} size="sm" />;
    case 'enum':
      return (
        <Select
          background="var(--tt-surface-alt, #f5f5f7)"
          border="1px solid transparent"
          borderRadius="var(--tt-radius-sm, 9px)"
          fontSize="13px"
          maxWidth="240px"
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder="pick one…"
          size="sm"
          value={typeof value === 'string' ? value : ''}
        >
          {(field.values || []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case 'number':
      return (
        <Input
          {...inputSx}
          maxWidth="160px"
          onChange={(event) => {
            const raw = event.target.value.trim();
            onChange(raw === '' ? undefined : Number(raw));
          }}
          placeholder={describeSchemaField(field)}
          type="number"
          value={typeof value === 'number' && Number.isFinite(value) ? String(value) : ''}
        />
      );
    case 'date':
      return (
        <Input
          {...inputSx}
          maxWidth="200px"
          onChange={(event) => onChange(event.target.value ? new Date(event.target.value).toISOString() : undefined)}
          type="date"
          value={typeof value === 'string' && value ? value.slice(0, 10) : ''}
        />
      );
    case 'string[]':
      return (
        <Input
          {...inputSx}
          onChange={(event) => {
            const parts = event.target.value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean);
            onChange(parts.length ? parts : undefined);
          }}
          placeholder="comma, separated, values"
          value={Array.isArray(value) ? value.join(', ') : ''}
        />
      );
    default:
      return (
        <Input
          {...inputSx}
          maxLength={field.maxLength || undefined}
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder={field.description || `Sample ${describeSchemaField(field)}`}
          value={typeof value === 'string' ? value : ''}
        />
      );
  }
};

type FieldRowProps = {
  field: SchemaThingField;
  value: Record<string, unknown>;
  onChange: (path: string[], next: unknown) => void;
  base: string[];
};

const FieldRow = ({ field, value, onChange, base }: FieldRowProps) => {
  const path = [...base, ...field.name.split('.')];
  const current = getPath(value, path);

  if (field.type === 'object') {
    // once any child holds a value the object is "provided" and its required
    // children validate — mirror the escape hatch: clear drops the subtree so
    // an optional object (post.listing) can return to missing without
    // reopening the modal (a toggled-off Switch still stores false)
    const hasValue =
      !!current && typeof current === 'object' && !Array.isArray(current) && Object.keys(current).length > 0;
    return (
      <Flex
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-md, 12px)"
        direction="column"
        gap={2}
        padding={2.5}
      >
        <Flex align="center" justify="space-between">
          <Text color="var(--tt-ink, #16161a)" fontSize="13px" fontWeight={600}>
            {field.name}
            {field.required ? ' *' : ''}
          </Text>
          {hasValue && !field.required ? (
            <Button
              color="var(--tt-muted, #9a9aa6)"
              fontSize="12px"
              fontWeight={500}
              height="auto"
              minWidth="0"
              onClick={() => onChange(path, undefined)}
              padding="2px 6px"
              size="xs"
              variant="ghost"
            >
              clear
            </Button>
          ) : null}
        </Flex>
        {(field.children || []).map((child) => (
          <FieldRow base={path} field={child} key={child.name} onChange={onChange} value={value} />
        ))}
      </Flex>
    );
  }

  if (field.type === 'array') {
    const items = Array.isArray(current) ? current : [];
    const spec = field.items;
    return (
      <Flex
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-md, 12px)"
        direction="column"
        gap={2}
        padding={2.5}
      >
        <Flex align="center" gap={2}>
          <Text color="var(--tt-ink, #16161a)" fontSize="13px" fontWeight={600}>
            {field.name}
            {field.required ? ' *' : ''}
          </Text>
          <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
            {describeSchemaField(field)}
          </Text>
        </Flex>
        {items.map((item, index) => (
          <Flex align="flex-start" gap={2} key={index}>
            <Box flex={1}>
              {spec?.type === 'object' ? (
                <Flex border="1px dashed var(--tt-border, #ececef)" borderRadius="var(--tt-radius-sm, 9px)" direction="column" gap={2} padding={2}>
                  {(spec.children || []).map((child) => {
                    const childPath = child.name.split('.');
                    const childValue = getPath((item || {}) as Record<string, unknown>, childPath);
                    return (
                      <Flex align="center" gap={2} key={child.name} wrap="wrap">
                        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" minWidth="90px">
                          {child.name}
                          {child.required ? ' *' : ''}
                        </Text>
                        <Box flex={1}>
                          <LeafInput
                            field={child}
                            onChange={(next) => {
                              const nextItem = setPath(
                                (item && typeof item === 'object' && !Array.isArray(item) ? item : {}) as Record<string, unknown>,
                                childPath,
                                next
                              );
                              onChange(path, items.map((existing, i) => (i === index ? nextItem : existing)));
                            }}
                            value={childValue}
                          />
                        </Box>
                      </Flex>
                    );
                  })}
                </Flex>
              ) : (
                <LeafInput
                  field={(spec || { type: 'string' }) as SchemaItemSpec}
                  onChange={(next) => onChange(path, items.map((existing, i) => (i === index ? next : existing)))}
                  value={item}
                />
              )}
            </Box>
            <Button aria-label="Remove entry" onClick={() => onChange(path, items.filter((_, i) => i !== index))} size="xs" variant="ghost">
              <Trash2 size={12} />
            </Button>
          </Flex>
        ))}
        <Button
          alignSelf="flex-start"
          isDisabled={field.maxItems !== undefined && items.length >= field.maxItems}
          leftIcon={<Plus size={12} />}
          onClick={() => onChange(path, [...items, spec?.type === 'object' ? {} : spec?.type === 'number' ? 0 : ''])}
          size="xs"
          variant="ghost"
        >
          add entry
        </Button>
      </Flex>
    );
  }

  return (
    <Flex align="center" gap={2} wrap="wrap">
      <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" minWidth="120px">
        {field.name}
        {field.required ? ' *' : ''}
      </Text>
      <Box flex={1} minWidth="200px">
        <LeafInput field={field} onChange={(next) => onChange(path, next)} value={current} />
      </Box>
    </Flex>
  );
};

export const SchemaThingFormBody = ({ source, onCreated, resetOnCreate = false }: SchemaThingFormBodyProps) => {
  const api = useApi();
  const lopu = useLopu();
  const [value, setValue] = React.useState<Record<string, unknown>>({});
  const [publishing, setPublishing] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const handleChange = React.useCallback((path: string[], next: unknown) => {
    setTouched(true);
    setValue((prev) => setPath(prev, path, next));
  }, []);

  const validation = React.useMemo(() => validateValueAgainstFields(source.fields, value), [source.fields, value]);

  const publish = async () => {
    setTouched(true);
    if (!validation.ok) {
      lopu({ title: `${validation.issues[0].path}: ${validation.issues[0].message}`, status: 'error', duration: 8000 });
      return;
    }
    setPublishing(true);
    try {
      // the scope/provenance tags spread LAST so no user field can clobber
      // them (top-level fields named schema/schemaId are also rejected at
      // author time); schemaId pins usage counts to this exact schema thing
      const resp: any = await api.v1.things.create({
        thingtime: ['data'],
        crystal: {
          ...value,
          schema: source.name,
          ...(source.origin === 'community' ? { schemaId: source.id } : {})
        }
      });
      if (!resp?.ok) throw resp;
      // only link to /search when SearchPage can actually resolve the schema
      // — non-searchable builtin kinds (share/save/user/…) would dead-end on
      // a "not visible" toast
      lopu({
        title: `Thing created with the ${source.name} schema ✨`,
        status: 'success',
        duration: 8000,
        ...(searchableSchemaSource(source) ? { link: { label: 'Find it on /search', href: schemaSearchPath(source) } } : {})
      });
      if (resetOnCreate) {
        setValue({});
        setTouched(false);
      }
      onCreated?.(resp.thing && typeof resp.thing === 'object' ? resp.thing : null);
    } catch (err: any) {
      lopu({ title: err?.error || 'Creating hiccuped — try again 🌈', status: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Flex direction="column" gap={3}>
      {source.description && (
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="13px">
          {source.description}
        </Text>
      )}
      {(source.fields || []).map((field) => (
        <FieldRow base={[]} field={field} key={field.name} onChange={handleChange} value={value} />
      ))}
      {!source.fields?.length && (
        <Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
          This schema has no fields — the thing will just carry the schema tag.
        </Text>
      )}
      {touched && !validation.ok && (
        <Flex direction="column" gap={0.5}>
          {validation.issues.slice(0, 3).map((issue) => (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" key={`${issue.path}-${issue.message}`}>
              · {issue.path}: {issue.message}
            </Text>
          ))}
        </Flex>
      )}
      <Flex justify="flex-end">
        <Button colorScheme="pink" isLoading={publishing} onClick={publish} size="sm">
          Create thing
        </Button>
      </Flex>
    </Flex>
  );
};

export const SchemaThingForm = ({ source, onClose }: SchemaThingFormProps) => (
  <Modal isOpen onClose={onClose} scrollBehavior="inside" size="lg">
    <ModalOverlay />
    <ModalContent background="var(--tt-card, #ffffff)" borderRadius="var(--tt-radius-lg, 16px)">
      <ModalBody padding={5}>
        <Flex direction="column" gap={3}>
          <Flex align="center" gap={2}>
            <Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={700}>
              New {source.name} ✨
            </Text>
            <Box flex={1} />
            <Button aria-label="Close" onClick={onClose} size="xs" variant="ghost">
              <X size={14} />
            </Button>
          </Flex>
          <SchemaThingFormBody onCreated={onClose} source={source} />
        </Flex>
      </ModalBody>
    </ModalContent>
  </Modal>
);
