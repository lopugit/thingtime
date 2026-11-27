import React from 'react';
import { Box, Button, Flex, Input, Select, Spinner, Text, Textarea } from '@chakra-ui/react';

import { isCssPropertyName, normalizeCssPropertyName } from '~/schemas/cssDeclarationNames';
import { cssLinesToRecord, cssRecordToLines, splitCssPriority } from './cssDeclarations';
import { cssPropertyDefinition, cssValueOptions, htmlAttributeDefinition, htmlAttributeNames, isHtmlAttributeName, loadElementStandards, type DeclarationRecord, type ElementStandards } from './elementStandards';

const EMPTY: DeclarationRecord = Object.freeze({});
const ink = 'var(--tt-ink, #16161a)';
const muted = 'var(--tt-muted, #666670)';
const border = 'var(--tt-border, #dadade)';
const mono = 'var(--tt-font-mono, ui-monospace, monospace)';
const inputStyles = {
 size: 'sm', minHeight: { base: '44px', md: '36px' }, borderRadius: 'var(--tt-radius-xs, 7px)', borderColor: border,
 color: ink, fontFamily: mono, bg: 'var(--tt-card, #ffffff)', _focusVisible: { outline: '2px solid var(--tt-accent, #5b44cc)', outlineOffset: '1px' }
} as const;

function useStandards() {
 const [requested, setRequested] = React.useState(false);
 const [catalog, setCatalog] = React.useState<ElementStandards>();
 const [failed, setFailed] = React.useState(false);
 const [attempt, setAttempt] = React.useState(0);
 React.useEffect(() => {
  if (!requested) return;
  let live = true;
  void loadElementStandards().then(data => { if (live) { setCatalog(data); setFailed(false); } }, () => { if (live) setFailed(true); });
  return () => { live = false; };
 }, [requested, attempt]);
 return { catalog, request: () => setRequested(true), loading: requested && !catalog && !failed, failed,
  retry: () => { setFailed(false); setAttempt(value => value + 1); } };
}

const matchSuggestions = (options: string[], query: string) => {
 const q = query.trim().toLowerCase();
 if (!q) return options;
 return [...options.filter(option => option.toLowerCase().startsWith(q)),
  ...options.filter(option => !option.toLowerCase().startsWith(q) && option.toLowerCase().includes(q))];
};

/** Editable WAI-ARIA combobox: options help typing, and never replace free entry. */
function SuggestionField({ label, id, value, options, onChange, onPick, onEnter, onFocus, placeholder, inputRef, describedBy, testId }: {
 label: string; id?: string; value: string; options: string[]; onChange: (value: string) => void; onPick?: (value: string) => void;
 onEnter?: () => void; onFocus?: () => void; placeholder?: string; inputRef?: React.Ref<HTMLInputElement>; describedBy?: string; testId?: string;
}) {
 const generatedId = React.useId();
 const listId = `${id || generatedId}-suggestions`;
 const [open, setOpen] = React.useState(false);
 const [filtered, setFiltered] = React.useState(false);
 const [active, setActive] = React.useState(-1);
 const matching = React.useMemo(() => open ? matchSuggestions(options, filtered ? value : '') : [], [open, options, value, filtered]);
 const visible = matching.slice(0, 24);
 const expanded = open && visible.length > 0;
 const choose = (next: string) => {
  (onPick || onChange)(next);
  setOpen(false);
  setActive(-1);
 };
 React.useEffect(() => {
  if (expanded && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
 }, [active, expanded, listId]);

 return <Box minW={0}>
  <Input {...inputStyles} id={id} ref={inputRef} role="combobox" aria-label={label} aria-autocomplete="list"
   aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-describedby={describedBy}
   aria-activedescendant={expanded && visible[active] !== undefined ? `${listId}-${active}` : undefined}
   autoComplete="off" spellCheck={false} value={value} placeholder={placeholder} data-testid={testId}
   onFocus={() => { setOpen(true); setFiltered(false); setActive(-1); onFocus?.(); }}
   onBlur={() => { setOpen(false); setActive(-1); }}
   onChange={event => { onChange(event.target.value); setOpen(true); setFiltered(true); setActive(-1); }}
   onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
     if (!options.length) return;
     event.preventDefault(); setOpen(true);
     if (!open) setFiltered(false);
     const size = open ? visible.length : Math.min(options.length, 24);
     setActive(current => size ? (current + (event.key === 'ArrowDown' ? 1 : current < 0 ? 0 : -1) + size) % size : -1);
    } else if (event.key === 'Enter') {
     if (expanded && visible[active] !== undefined) { event.preventDefault(); choose(visible[active]); }
     else if (onEnter) { event.preventDefault(); onEnter(); }
    } else if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); setActive(-1); }
   }}
  />
  {expanded && <Box mt="1" border="1px solid" borderColor={border} bg="var(--tt-card, #ffffff)" borderRadius="var(--tt-radius-xs, 7px)">
   <Box id={listId} role="listbox" aria-label={`${label} suggestions`} maxH="168px" overflowY="auto">
    {visible.map((option, index) => <Box key={option} id={`${listId}-${index}`} role="option" aria-selected={index === active}
     minH={{ base: "44px", md: "32px" }} px="2" py="1.5" cursor="pointer" overflowWrap="anywhere" fontSize="xs" fontFamily={mono} color={ink}
     bg={index === active ? 'var(--tt-surface-2, rgba(127,127,127,.16))' : undefined}
     _hover={{ bg: 'var(--tt-surface-2, rgba(127,127,127,.16))' }}
     onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option}</Box>)}
   </Box>
   {matching.length > visible.length && <Text fontSize="xs" px="2" py="1" color={muted}>Type to find more options</Text>}
  </Box>}
 </Box>;
}

function TypedValueChoices({ label, value, options, syntax, onChange }: {
 label: string; value: string; options: string[]; syntax?: string; onChange: (value: string) => void;
}) {
 const isColor = /^(?:<color>(?:\s*[|#?].*)?|<color>\{\d+(?:,\d+)?\})$/.test(syntax || '');
 const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value)
  ? '#' + value.slice(1).split('').map(part => part.repeat(2)).join('') : '#000000';
 if (isColor) return <Input type="color" aria-label={`Pick a color for ${label}`} size="sm" height={{ base: "44px", md: "36px" }} width="44px" p="1"
  borderColor={border} value={hex} onChange={event => onChange(event.target.value)} title={`Pick a color for ${label}`} />;
 if (options.length < 2 || options.length > 12) return null;
 return <Select {...inputStyles} aria-label={`Choose a value for ${label}`} value={options.includes(value) ? value : ''}
  onChange={event => { if (event.target.value) onChange(event.target.value); }}>
  <option value="">Choose a value</option>
  {options.map(option => <option key={option} value={option}>{option}</option>)}
 </Select>;
}

type RecordEditorProps = {
 value?: DeclarationRecord;
 onChange: (value: DeclarationRecord) => void;
 defaults?: DeclarationRecord;
 tagName?: string;
 testId?: string;
 isAllowed?: (name: string) => boolean;
 primaryAttributes?: string[];
 inputLabelPrefix?: string;
 showRestricted?: boolean;
};

function RecordEditor({ value = EMPTY, onChange, defaults = EMPTY, tagName = 'div', testId, isAllowed, primaryAttributes, inputLabelPrefix, showRestricted, mode }: RecordEditorProps & { mode: 'css' | 'html' }) {
 const css = mode === 'css';
 const noun = css ? 'property' : 'attribute';
 const title = css ? 'CSS properties' : `HTML attributes · <${tagName}>`;
 const { catalog, request, loading, failed, retry } = useStandards();
 const [name, setName] = React.useState('');
 const [newValue, setNewValue] = React.useState('');
 const [adding, setAdding] = React.useState(false);
 const newValueRef = React.useRef<HTMLInputElement>(null);
 const titleId = React.useId();
 const normalize = css ? normalizeCssPropertyName : (candidate: string) => candidate.trim().toLowerCase();
 const allowed = (candidate: string) => (css ? isCssPropertyName(candidate) : isHtmlAttributeName(candidate)) && (isAllowed?.(candidate) ?? true);
 const key = normalize(name);
 const duplicate = Object.prototype.hasOwnProperty.call(value, key);
 const cannotAdd = !key || !allowed(key) || duplicate || (css && !newValue.trim());
 const allNames = React.useMemo(() => css ? Object.keys(catalog?.properties || {}) : htmlAttributeNames(catalog, tagName), [catalog, css, tagName]);
 const available = allNames.filter(candidate => !primaryAttributes?.includes(candidate) && !Object.prototype.hasOwnProperty.call(value, candidate) && (showRestricted || (isAllowed?.(candidate) ?? true)));
 const knownDefault = (property: string) => {
  if (Object.prototype.hasOwnProperty.call(defaults, property)) return { value: defaults[property], origin: 'Current default' };
  const initial = css ? cssPropertyDefinition(catalog, property).initial : '';
  return initial && !initial.includes('<') ? { value: initial, origin: 'Standard initial value' } : null;
 };
 const attributeData = (attribute: string) => htmlAttributeDefinition(catalog, tagName, attribute);
 const typedOptions = (property: string) => {
  if (!css) return attributeData(property)?.values || [];
  const syntax = cssPropertyDefinition(catalog, property).syntax;
  return /^(?:-?[a-z][a-z0-9-]*)(?:\s*\|\s*-?[a-z][a-z0-9-]*)+$/.test(syntax) ? syntax.split('|').map(value => value.trim()) : [];
 };
 const valueOptions = (property: string) => {
  const suggested = css ? cssValueOptions(catalog, property, value) : attributeData(property)?.values || [];
  const initial = knownDefault(property);
  return initial ? [...new Set([initial.value, ...suggested])] : suggested;
 };
 const entries = [...new Set([...(primaryAttributes || []), ...Object.keys(value)])];
 const remove = (property: string) => {
  const next = { ...value };
  delete next[property];
  onChange(next);
 };
 const add = () => {
  if (cannotAdd) return;
  onChange({ ...value, [key]: newValue });
  setName(''); setNewValue(''); setAdding(false); setChecked(undefined);
 };
 const pickName = (candidate: string) => {
  setName(candidate);
  if (!newValue && attributeData(candidate)?.boolean) setNewValue('true');
  if (allowed(candidate)) newValueRef.current?.focus();
 };
 const newHint = knownDefault(key);
 const newDefinition = css ? cssPropertyDefinition(catalog, key).syntax : attributeData(key)?.syntax;
 const newProblem = name && (duplicate ? `This ${noun} is already saved.` : !allowed(key) ? `This ${noun} is restricted on this surface.` : '');
 const [checked, setChecked] = React.useState<{ property: string; value: string }>();
 const supportMessage = checked && css && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !checked.property.startsWith('--') &&
  checked.value.trim() && !CSS.supports(checked.property, splitCssPriority(checked.value).value)
  ? 'This browser does not recognize the value. You can still save it.' : '';
 return <Flex as="section" aria-labelledby={titleId} data-testid={testId} direction="column" gap="2" minW={0} color={ink}
  onFocus={request} onBlur={event => {
   const target = event.target as HTMLInputElement;
   if (css && target.dataset.testid === 'css-new-value') setChecked({ property: key, value: newValue });
  }}>
  <Text id={titleId} as="h3" fontSize="sm" fontWeight={650}>{title}</Text>
  <Text color={muted} fontSize="xs">{css ? 'Edit saved declarations, browse suggestions, or type your own value.' : 'Edit saved attributes or add one for this element.'}</Text>
  {entries.map(property => {
   const content = Object.prototype.hasOwnProperty.call(value, property) ? value[property] : '';
   const inputId = `${titleId}-saved-${property}`;
   const syntax = css ? cssPropertyDefinition(catalog, property).syntax : attributeData(property)?.syntax;
   const editable = allowed(property);
   return <Flex direction="column" gap="1" key={property} minW={0}>
    <Text as="label" htmlFor={inputId} fontFamily={mono} fontSize="xs" overflowWrap="anywhere">{property}</Text>
    <Flex gap="1" align="start" minW={0}>
     <Box flex="1" minW={0}>
      {editable ? <SuggestionField id={inputId} label={inputLabelPrefix ? `${inputLabelPrefix} ${property}` : `${property} value`} value={content} options={valueOptions(property)}
       onChange={next => onChange({ ...value, [property]: next })} testId={`${mode}-value-${property}`}
       describedBy={`${inputId}-syntax`} placeholder={knownDefault(property)?.value} />
       : <Input {...inputStyles} id={inputId} aria-label={`${property} value (locked)`} value={content} isReadOnly />}
     </Box>
     {editable && Object.prototype.hasOwnProperty.call(value, property) && <Button type="button" size="sm" minH={{ base: "44px", md: "36px" }} minW={{ base: "44px", md: "36px" }} variant="ghost" aria-label={`Remove ${property}`} onClick={() => remove(property)}>×</Button>}
    </Flex>
    {editable && <TypedValueChoices label={property} syntax={css ? syntax : undefined} value={content} options={typedOptions(property)}
     onChange={next => onChange({ ...value, [property]: next })} />}
    <Text id={`${inputId}-syntax`} fontSize="xs" color={muted} noOfLines={2}>
     {syntax}
    </Text>
   </Flex>;
  })}
  {adding ? <Flex direction="column" gap="2" minW={0} p="2" border="1px solid" borderColor={border} borderRadius="var(--tt-radius-xs, 7px)">
   <Box>
    <Text as="label" htmlFor={`${titleId}-name`} fontSize="xs" fontWeight={600}>{css ? 'Property name' : 'Attribute name'}</Text>
    <SuggestionField label={css ? 'CSS property name' : 'HTML attribute name'} id={`${titleId}-name`} value={name} options={available} onChange={setName}
     onPick={pickName} onEnter={() => { if (allowed(key) && !duplicate) pickName(key); }} placeholder={css ? 'e.g. object-fit' : 'e.g. title or data-user-label'} testId={`${mode}-new-name`}
     describedBy={newProblem ? `${titleId}-name-help` : undefined} />
    {newProblem && <Text id={`${titleId}-name-help`} fontSize="xs" color={muted}>{newProblem}</Text>}
   </Box>
   <Box>
    <Text as="label" htmlFor={`${titleId}-value`} fontSize="xs" fontWeight={600}>Value</Text>
    <SuggestionField id={`${titleId}-value`} label={css ? 'CSS property value' : 'HTML attribute value'} value={newValue} options={valueOptions(key)}
     onChange={next => { setNewValue(next); setChecked(undefined); }} onEnter={add} inputRef={newValueRef} testId={`${mode}-new-value`}
     placeholder={newHint?.value} describedBy={`${titleId}-value-help`} />
    <Box mt="1">
     <TypedValueChoices label={key || noun} syntax={css ? newDefinition : undefined} value={newValue} options={typedOptions(key)}
      onChange={next => { setNewValue(next); setChecked(undefined); }} />
    </Box>
    <Box id={`${titleId}-value-help`} mt="1" fontSize="xs" color={muted} overflowWrap="anywhere">
     {newHint && <Text>{newHint.origin}: <code>{newHint.value}</code>. Applied only if selected or typed.</Text>}
     {newDefinition && <Text noOfLines={2} title={newDefinition}>{css ? 'Syntax: ' : 'Accepts: '}{newDefinition}</Text>}
     {supportMessage && <Text role="status">{supportMessage}</Text>}
    </Box>
   </Box>
   <Flex gap="2" flexWrap="wrap">
    <Button type="button" size="sm" minH={{ base: "44px", md: "36px" }} variant="outline" isDisabled={cannotAdd} onClick={add}>Add {noun}</Button>
    <Button type="button" size="sm" minH={{ base: "44px", md: "36px" }} variant="ghost" onClick={() => { setAdding(false); setName(''); setNewValue(''); setChecked(undefined); }}>Cancel</Button>
   </Flex>
   {loading && <Spinner role="status" aria-label="Loading suggestions" size="xs" color={muted} alignSelf="start" />}
  </Flex> : <Flex gap="2" align="center">
   <Button type="button" size="sm" minH={{ base: "44px", md: "36px" }} variant="outline" alignSelf="start" onClick={() => { setAdding(true); request(); }}>Add {noun}</Button>
   {loading && <Spinner role="status" aria-label="Loading suggestions" size="xs" color={muted} />}
  </Flex>}

  {failed && <Flex gap="2" align="center" wrap="wrap"><Text color={muted} fontSize="xs">Suggestions are unavailable.</Text><Button type="button" size="xs" variant="ghost" onClick={retry}>Retry</Button></Flex>}
 </Flex>;
}

function CssSourceEditor({ value, onChange, live }: Pick<RecordEditorProps, 'value' | 'onChange'> & { live?: boolean }) {
 const id = React.useId();
 const serialized = cssRecordToLines(value);
 const [draft, setDraft] = React.useState<string | null>(null);
 const commit = () => {
  if (draft === null) return;
  setDraft(null);
  if (!live) onChange(cssLinesToRecord(draft));
 };
 return <Box as="details" minW={0}>
  <Box as="summary" cursor="pointer" fontSize="xs" fontWeight={600}>Edit CSS declarations as text</Box>
  <Textarea {...inputStyles} mt="2" id={id} rows={5} value={draft ?? serialized} onChange={event => {
   const text = event.target.value;
   setDraft(text);
   if (live) onChange(cssLinesToRecord(text));
  }} onBlur={commit}
   aria-label="Custom CSS declarations" placeholder={'padding: 24px\nobject-fit: cover'} data-testid="css-custom-editor" />
 </Box>;
}

export function CssPropertyEditor({ liveSource, ...props }: Omit<RecordEditorProps, 'isAllowed'> & { liveSource?: boolean }) {
 return <Flex direction="column" gap="2" minW={0}>
  <RecordEditor {...props} mode="css" />
  <CssSourceEditor value={props.value} onChange={props.onChange} live={liveSource} />
 </Flex>;
}

export function HtmlAttributeEditor(props: RecordEditorProps & { tagName: string }) {
 return <RecordEditor {...props} mode="html" />;
}

/** Source remains an escape hatch, rendered by the consumer's existing sanitizer. */
export function HtmlSourceEditor({ value, onChange, label = 'HTML source', testId = 'html-block-editor' }: {
 value: string; onChange: (value: string) => void; label?: string; testId?: string;
}) {
 const id = React.useId();
 return <Flex direction="column" gap="1" minW={0}>
  <Text as="label" htmlFor={id} fontSize="xs" fontWeight={600}>{label}</Text>
  <Textarea {...inputStyles} id={id} rows={10} spellCheck={false} value={value} onChange={event => onChange(event.target.value)} data-testid={testId} />
 </Flex>;
}
