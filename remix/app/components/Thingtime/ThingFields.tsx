import React from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Input, Text, Textarea } from '@chakra-ui/react';
import { moveThingField, type ThingMods } from './thingMods';
import { totpCode } from '~/passwords/totp';

export function OneTimeCode({ value }: { value: string }) {
  const [result, setResult] = React.useState<{ code: string; remaining: number } | null>(null);
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    const update = () => totpCode(value).then(result => { if (active) { setResult(result); setInvalid(false); } }, () => { if (active) { setResult(null); setInvalid(true); } });
    setResult(null); update(); const timer = window.setInterval(update, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [value]);
  return <Text aria-live="off" fontFamily="monospace" fontSize="lg">{invalid ? 'Enter a valid TOTP secret or setup link' : result ? `${result.code} · ${result.remaining}s` : '—'}</Text>;
}
export function ThingFields({ thing, mods, onChange, onModsChange }: {
  thing: Record<string, string>; mods: ThingMods; onChange?: (next: Record<string, string>) => void; onModsChange?: (next: ThingMods) => void;
}) {
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const clear = React.useCallback(() => setRevealed({}), []);
  React.useEffect(() => {
    window.addEventListener('blur', clear); window.addEventListener('thingtime:hide-vault-values', clear); window.addEventListener('thingtime:mask-vault-values', clear);
    return () => { window.removeEventListener('blur', clear); window.removeEventListener('thingtime:hide-vault-values', clear); window.removeEventListener('thingtime:mask-vault-values', clear); };
  }, [clear]);
  return <Flex className="thing thing-mod-fields" flexDirection="column" gap={4} minWidth={0} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
  }}>
    {mods.fields.slice(0, 64).map((field, index) => {
      const secret = field.type === 'password' || field.type === 'totp';
      const props = { value: thing[field.id] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange?.({ ...thing, [field.id]: event.target.value }),
        isReadOnly: !onChange, autoComplete: 'off', spellCheck: false, 'aria-label': field.label, maxLength: 16384 };
      return <FormControl key={field.id} minWidth={0}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} mb={1}>
          <FormLabel mb={0} fontSize="sm" overflowWrap="anywhere">{field.label}</FormLabel>
          <Flex gap={1} flexShrink={0}>
            {mods.sortable && onModsChange && <><Button size="xs" isDisabled={index === 0} aria-label={`Move ${field.label} up`} onClick={() => onModsChange({ ...mods, fields: moveThingField(mods.fields, index, -1) })}>↑</Button><Button size="xs" isDisabled={index === mods.fields.length - 1} aria-label={`Move ${field.label} down`} onClick={() => onModsChange({ ...mods, fields: moveThingField(mods.fields, index, 1) })}>↓</Button></>}
            {mods.removable && onModsChange && <Button size="xs" aria-label={`Remove ${field.label}`} onClick={() => onModsChange({ ...mods, fields: mods.fields.filter(item => item.id !== field.id) })}>×</Button>}
          </Flex>
        </Flex>
        <Flex gap={2} alignItems="start">
          <Box flex={1} minWidth={0}>{field.type === 'notes' ? <Textarea {...props} rows={3} /> : <Input {...props} type={secret && !revealed[field.id] ? 'password' : 'text'} inputMode={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'} />}</Box>
          {secret && mods.revealSecrets && <Button size="sm" aria-label={`${revealed[field.id] ? 'Hide' : 'Show'} ${field.label}`} onClick={() => setRevealed(prev => ({ ...prev, [field.id]: !prev[field.id] }))}>{revealed[field.id] ? 'Hide' : 'Show'}</Button>}
        </Flex>
        {field.type === 'totp' && thing[field.id] && <OneTimeCode value={thing[field.id]} />}
      </FormControl>;
    })}
  </Flex>;
}
