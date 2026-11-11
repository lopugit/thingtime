import React from 'react';
import type { PasswordEntry, FieldType } from '~/passwords/model';
import { FIELD_TYPES, PASSWORD_TYPES } from '~/passwords/model';
import { passwordPropertyShape, passwordPropertyValues, patchPasswordProperty } from '~/passwords/structuredFields';
import { totpCode } from '~/passwords/totp';
import { activityInterval, clearActivityInterval } from '~/activity/activityManager';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { TransientPrivateControls } from '../Builder/TransientPrivateControls';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { passwordEntryBlocks } from './passwordEntryBlocks';
import { passwordEntryDisplay } from './passwordEntryDisplay';

/** Draft values stay in this adapter and opted-in DOM controls. Builder sees
 * only the independently editable template and a deliberate display projection. */
export function PasswordEntryEditor({ entry, scopeKey, disabled, onChange }: {
  entry: PasswordEntry; scopeKey: string; disabled: boolean; onChange: (entry: PasswordEntry) => void;
}) {
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [rawFields, setRawFields] = React.useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = React.useState<Record<string, string>>({});
  const [customLabel, setCustomLabel] = React.useState(''), [customType, setCustomType] = React.useState<FieldType>('text');
  const [codes, setCodes] = React.useState<Record<string, string>>({});
  const identities = React.useRef(new Map<string, { shape: string; epoch: number }>()), epoch = React.useRef(0);
  const latest = React.useRef(entry); latest.current = entry;
  const copyEpoch = React.useRef(0);
  React.useEffect(() => {
    const mask = () => { copyEpoch.current++; setRevealed({}); setCopyFeedback({}); };
    window.addEventListener('blur', mask); window.addEventListener('thingtime:mask-vault-values', mask);
    return () => { copyEpoch.current++; window.removeEventListener('blur', mask); window.removeEventListener('thingtime:mask-vault-values', mask); };
  }, []);
  React.useEffect(() => { copyEpoch.current++; setCopyFeedback({}); }, [entry]);
  React.useEffect(() => {
    let current = true;
    const fields = entry.fields.filter(field => field.type === 'totp');
    setCodes({});
    if (!fields.length) return;
    const update = async () => {
      const values = await Promise.all(fields.map(async field => {
        try { const result = await totpCode(field.value); return [field.id, `${result.code} · ${result.remaining}s`]; }
        catch { return [field.id, 'Enter a valid TOTP secret or setup link']; }
      }));
      if (current) setCodes(Object.fromEntries(values));
    };
    void update();
    const timer = activityInterval('timer:password-entry:totp', 'Password verification codes', update, 1000);
    return () => { current = false; clearActivityInterval(timer); };
  }, [entry.fields]);
  for (const id of identities.current.keys()) if (!entry.fields.some(field => field.id === id)) identities.current.delete(id);
  for (const field of entry.fields) {
    const shape = passwordPropertyShape(field), previous = identities.current.get(field.id);
    if (!previous || previous.shape !== shape) identities.current.set(field.id, { shape, epoch: ++epoch.current });
  }
  const display = passwordEntryDisplay(entry, revealed, copyFeedback, rawFields);
  const privateValues = new Map<string, string | boolean>([['entry-title', entry.title], ['entry-tags', (entry.tags || []).join('\n')]]);
  for (const field of entry.fields) {
    privateValues.set(`field-${field.id}`, field.value);
    privateValues.set(`label-${field.id}`, field.label); privateValues.set(`section-${field.id}`, field.section || '');
    if (field.type === 'totp') privateValues.set(`totp-${field.id}`, codes[field.id] || '—');
  }
  for (const field of display.fields) if (field.structured) {
    const values = passwordPropertyValues(entry.fields.find(source => source.id === field.id)!);
    for (const property of field.properties) {
      Object.assign(property, { epoch: identities.current.get(field.id)?.epoch });
      const source = values.get(property.path)!;
      privateValues.set(property.name, typeof source.value === 'boolean' && !property.boolean ? String(source.value) : source.value);
      privateValues.set(property.labelName, source.label);
    }
  }
  const edit = (change: (value: PasswordEntry) => PasswordEntry) => { if (!disabled) onChange(change(latest.current)); };
  const fieldId = (id: unknown) => typeof id === 'string' && entry.fields.some(field => field.id === id) ? id : null;
  const move = (id: unknown, delta: number) => edit(value => {
    const from = value.fields.findIndex(field => field.id === id), to = from + delta;
    if (from < 0 || to < 0 || to >= value.fields.length) return value;
    const fields = [...value.fields]; [fields[from], fields[to]] = [fields[to], fields[from]];
    return { ...value, fields };
  });
  const actions: TransientBlockActions = {
    'entry.title': ({ value }) => edit(current => ({ ...current, title: String(value ?? '') })),
    'entry.tags': ({ value }) => edit(current => ({ ...current, tags: String(value ?? '').split('\n') })),
    'entry.type': ({ value }) => { if (value !== 'passkey' && PASSWORD_TYPES.includes(value as any) && entry.passwordType !== 'passkey') edit(current => ({ ...current, passwordType: value as PasswordEntry['passwordType'] })); },
    'entry.favorite': ({ value }) => edit(current => ({ ...current, favorite: value === true })),
    'entry.archived': ({ value }) => edit(current => ({ ...current, archived: value === true })),
    'field.change': ({ inputs, value }) => { const id = fieldId(inputs.id); if (id) { identities.current.delete(id); edit(current => ({ ...current, fields: current.fields.map(field => field.id === id ? { ...field, value: String(value ?? '') } : field) })); } },
    'field.rename': ({ inputs, value }) => edit(current => ({ ...current, fields: current.fields.map(field => field.id === inputs.id ? { ...field, label: String(value ?? '') } : field) })),
    'field.section': ({ inputs, value }) => edit(current => ({ ...current, fields: current.fields.map(field => field.id === inputs.id ? { ...field, section: String(value ?? '') } : field) })),
    'field.convert': ({ inputs, value }) => { if (FIELD_TYPES.includes(value as FieldType)) edit(current => ({ ...current, fields: current.fields.map(field => field.id === inputs.id ? { ...field, type: value as FieldType } : field) })); },
    'field.property': ({ inputs, value, setValidity }) => {
      const id = fieldId(inputs.id), identity = id && identities.current.get(id);
      if (!id || !identity || String(identity.epoch) !== String(inputs.epoch) || rawFields[id] || disabled) return;
      try {
        const patched = patchPasswordProperty(latest.current.fields.find(field => field.id === id)!, inputs.path, value);
        setValidity?.(''); edit(current => ({ ...current, fields: current.fields.map(field => field.id === id ? patched : field) }));
      } catch { setValidity?.('Enter a value with the original property type.'); }
    },
    'field.mode': ({ inputs }) => { const id = fieldId(inputs.id); if (id && !disabled) { identities.current.delete(id); setRawFields(previous => ({ ...previous, [id]: !previous[id] })); } },
    'field.copy': async ({ inputs, signal }) => {
      const id = fieldId(inputs.id), source = entry;
      if (!id || disabled || source.passwordType === 'passkey') return;
      const field = source.fields.find(field => field.id === id)!, attempt = ++copyEpoch.current;
      const current = () => !signal.aborted && attempt === copyEpoch.current && latest.current === source;
      try {
        const value = field.type === 'totp' ? (await totpCode(field.value)).code : field.value;
        if (!current()) return;
        await navigator.clipboard.writeText(value);
        if (current()) setCopyFeedback({ [id]: field.type === 'totp' ? 'Verification code copied.' : 'Copied.' });
      } catch { if (current()) setCopyFeedback({ [id]: 'Could not copy. Try again.' }); }
    },
    'field.reveal': ({ inputs }) => { const id = fieldId(inputs.id); if (id) setRevealed(previous => ({ ...previous, [id]: !previous[id] })); },
    'field.up': ({ inputs }) => move(inputs.id, -1), 'field.down': ({ inputs }) => move(inputs.id, 1),
    'field.remove': ({ inputs }) => edit(current => ({ ...current, fields: current.fields.filter(field => field.id !== inputs.id) })),
    'field.label': ({ value }) => setCustomLabel(String(value ?? '')),
    'field.type': ({ value }) => { if (FIELD_TYPES.includes(value as FieldType)) setCustomType(value as FieldType); },
    'field.add': () => { if (!customLabel.trim()) return; edit(current => ({ ...current, fields: [...current.fields, { id: crypto.randomUUID(), label: customLabel.trim(), type: customType, value: '', ...(customType === 'structured' ? { structured: true } : {}) }] })); setCustomLabel(''); },
    'field.noop': () => {},
  };
  return <SettingsDocumentHost documentKey="password-entry-editor" title="Password entry layout" defaultDocument={passwordEntryBlocks} scopeKey={scopeKey} layoutEditingDisabled={disabled}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ passwords: { ...display, busy: disabled, customLabel, customType, cannotAddField: disabled || !customLabel.trim() } }} actions={actions} enabled={!editing}>
      <TransientPrivateControls scopeKey={scopeKey} readValue={name => privateValues.get(name)} enabled={!editing}>
        <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
      </TransientPrivateControls>
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
