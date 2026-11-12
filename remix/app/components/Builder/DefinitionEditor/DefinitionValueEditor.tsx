import React from 'react';
import { remapDefinitionFields, validDefinitionNumber, type DefinitionFields } from './definitionDraft';
import { Box, Button, Flex, Input, Select, Text, Textarea } from '@chakra-ui/react';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
const typeOf = (value: Value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const empty = (type: string): Value => ({ string: '', number: 0, boolean: false, null: null, array: [], object: {} }[type]);
const forbidden = (key: string) => ['__proto__', 'constructor', 'prototype'].includes(key);

/** Editable JSON values shared by Components, Actions, schemas and Data. */
export function DefinitionValueEditor({ value, onChange, label = 'Definition', depth = 0, path = [], fields, setFields }: {
 value: Value; onChange: (value: Value) => void; label?: string; depth?: number; path?: string[]; fields?: DefinitionFields; setFields?: React.Dispatch<React.SetStateAction<DefinitionFields>>;
}) {
 const [localExpanded, setLocalExpanded] = React.useState(depth < 1);
 const [localNewKey, setLocalNewKey] = React.useState('');
 const fieldKey = JSON.stringify(path), field = fields?.[fieldKey];
 const patchField = (next: Partial<DefinitionFields[string]>) => setFields?.(all => ({ ...all, [fieldKey]: { ...all[fieldKey], ...next } }));
 const expanded = field?.expanded ?? localExpanded, newKey = field?.newKey ?? localNewKey;
 const setExpanded = (next: boolean) => setFields ? patchField({ expanded: next }) : setLocalExpanded(next);
 const setNewKey = (next: string) => setFields ? patchField({ newKey: next }) : setLocalNewKey(next);
 const type = typeOf(value);
 const nested = type === 'array' || type === 'object';
 const entries = nested ? Object.entries(value as object) : [];
 const patch = (key: string, next: Value) => {
  if (Array.isArray(value)) onChange(value.map((item, index) => String(index) === key ? next : item));
  else onChange({ ...(value as object), [key]: next });
 };
 const remove = (key: string) => {
  setFields?.(all => remapDefinitionFields(all, Array.isArray(value) ? path : [...path, key], Array.isArray(value) ? { remove: key } : { reset: true }));
  if (Array.isArray(value)) onChange(value.filter((_, index) => String(index) !== key));
  else onChange(Object.fromEntries(entries.filter(([name]) => name !== key)));
 };
 const move = (index: number, direction: number) => {
  if (!Array.isArray(value)) return;
  setFields?.(all => remapDefinitionFields(all, path, { move: [index, index + direction] }));
  const next = [...value];
  [next[index], next[index + direction]] = [next[index + direction], next[index]];
  onChange(next);
 };
 return <Box minW={0} width="100%">
  <Flex gap={2} align="center" wrap="wrap" mb={2}>
   {nested ? <Button size="xs" variant="ghost" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`Expand ${label}`}>{expanded ? '▾' : '▸'}</Button> : null}
   <Text fontSize="sm" fontWeight="600" overflowWrap="anywhere" flex={1}>{label}{nested ? ` (${entries.length})` : ''}</Text>
   <Select size="xs" width="100px" aria-label={`${label} type`} value={type} onChange={(event) => { setFields?.(all => remapDefinitionFields(all, path, { reset: true })); onChange(empty(event.target.value)); }}>
    {['string', 'number', 'boolean', 'null', 'object', 'array'].map((name) => <option key={name}>{name}</option>)}
   </Select>
  </Flex>
  {type === 'string' ? <Textarea aria-label={`${label} value`} value={String(value)} rows={String(value).includes('\n') ? 4 : 2} fontFamily="mono" fontSize="sm" onChange={(event) => onChange(event.target.value)} /> : null}
  {type === 'number' ? setFields ? <Input type="text" inputMode="decimal" aria-label={`${label} value`} value={field?.number ?? String(value)} aria-invalid={field?.number !== undefined && !validDefinitionNumber(field.number)} onChange={event => { const raw = event.target.value; patchField({ number: raw }); if (validDefinitionNumber(raw)) onChange(Number(raw)); }} /> : <Input type="number" aria-label={`${label} value`} defaultValue={Number(value)} key={String(value)} onBlur={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} /> : null}
  {type === 'boolean' ? <Select aria-label={`${label} value`} value={String(value)} onChange={(event) => onChange(event.target.value === 'true')}><option>false</option><option>true</option></Select> : null}
  {nested && expanded ? <Box borderLeft="1px solid var(--tt-border, #ddd)" pl={{ base: 2, md: 4 }}>
   {entries.map(([key, item], index) => <Box key={key} mb={4}>
    <Flex justify="flex-end" gap={1} mb={1}>
     {Array.isArray(value) ? <><Button size="xs" isDisabled={index === 0} aria-label={`Move ${label} ${index + 1} up`} onClick={() => move(index, -1)}>↑</Button><Button size="xs" isDisabled={index === entries.length - 1} aria-label={`Move ${label} ${index + 1} down`} onClick={() => move(index, 1)}>↓</Button></> : null}
     <Button size="xs" aria-label={`Remove ${key}`} onClick={() => remove(key)}>Remove</Button>
    </Flex>
    <DefinitionValueEditor label={Array.isArray(value) ? `${label} ${index + 1}` : key} value={item as Value} onChange={(next) => patch(key, next)} depth={depth + 1} path={[...path, key]} fields={fields} setFields={setFields} />
   </Box>)}
   <Flex gap={2} wrap="wrap">
    {type === 'object' ? <Input size="sm" flex={1} minW="100px" aria-label={`New ${label} property`} placeholder="Property name" value={newKey} onChange={(event) => setNewKey(event.target.value)} /> : null}
    <Button size="sm" onClick={() => {
     if (Array.isArray(value)) onChange([...value, '']);
     else if (newKey && !forbidden(newKey) && !Object.prototype.hasOwnProperty.call(value, newKey)) { patch(newKey, ''); setNewKey(''); }
    }}>Add {Array.isArray(value) ? 'item' : 'property'}</Button>
   </Flex>
  </Box> : null}
 </Box>;
}
