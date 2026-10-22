import { activityInterval, clearActivityInterval, activityEvents } from '~/activity/activityManager';
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
    setResult(null); update(); const timer = activityInterval('timer:components/Thingtime/ThingFields:1', 'Live Thing fields', update, 1000);
    return () => { active = false; clearActivityInterval(timer); };
  }, [value]);
  return <Text aria-live="off" fontFamily="monospace" fontSize="lg">{invalid ? 'Enter a valid TOTP secret or setup link' : result ? `${result.code} · ${result.remaining}s` : '—'}</Text>;
}
export function ThingFields({ thing, mods, onChange, onModsChange }: {
  thing: Record<string, string>; mods: ThingMods; onChange?: (next: Record<string, string>) => void; onModsChange?: (next: ThingMods) => void;
}) {
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const clear = React.useCallback(() => setRevealed({}), []);
  React.useEffect(() => {
    activityEvents(window, 'events:components/Thingtime/ThingFields', 'ThingFields').addEventListener('blur', clear); activityEvents(window, 'events:components/Thingtime/ThingFields', 'ThingFields').addEventListener('thingtime:hide-vault-values', clear); activityEvents(window, 'events:components/Thingtime/ThingFields', 'ThingFields').addEventListener('thingtime:mask-vault-values', clear);
    return () => { activityEvents(window, 'events:components/Thingtime/ThingFields', 'ThingFields').removeEventListener('blur', clear); activityEvents(window, 'events:components/Thingtime/ThingFields', 'ThingFields').removeEventListener('thingtime:hide-vault-values', clear); activityEvents(window, 'events:components/Thingtime/ThingFields', 'ThingFields').removeEventListener('thingtime:mask-vault-values', clear); };
  }, [clear]);
  return <Flex className="thing thing-mod-fields" flexDirection="column" gap={4} minWidth={0} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
  }}>
    {mods.fields.map((field, index) => {
      const secret = field.concealed || field.type === 'password' || field.type === 'totp' || field.type === 'ssh-key' || field.type === 'credit-card-number';
      const props = { value: thing[field.id] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange?.({ ...thing, [field.id]: event.target.value }),
        isReadOnly: !onChange, autoComplete: 'off', spellCheck: false, 'aria-label': field.label };
      return <FormControl key={field.id} minWidth={0}>
        {field.section && field.section !== mods.fields[index - 1]?.section && <Text fontWeight={600} mb={3}>{field.section}</Text>}
        <Flex justifyContent="space-between" alignItems="center" gap={2} mb={1}>
          <FormLabel mb={0} fontSize="sm" overflowWrap="anywhere">{field.label}</FormLabel>
          <Flex gap={1} flexShrink={0}>
            {mods.sortable && onModsChange && <><Button size="xs" isDisabled={index === 0} aria-label={`Move ${field.label} up`} onClick={() => onModsChange({ ...mods, fields: moveThingField(mods.fields, index, -1) })}>↑</Button><Button size="xs" isDisabled={index === mods.fields.length - 1} aria-label={`Move ${field.label} down`} onClick={() => onModsChange({ ...mods, fields: moveThingField(mods.fields, index, 1) })}>↓</Button></>}
            {mods.removable && onModsChange && <Button size="xs" aria-label={`Remove ${field.label}`} onClick={() => onModsChange({ ...mods, fields: mods.fields.filter(item => item.id !== field.id) })}>×</Button>}
          </Flex>
        </Flex>
        <Flex gap={2} alignItems="start">
          <Box flex={1} minWidth={0}>{(field.type === 'notes' || field.multiline || ['address', 'structured', 'ssh-key'].includes(field.type)) && (!secret || revealed[field.id]) ? <Textarea {...props} rows={3} /> : <Input {...props} type={secret && !revealed[field.id] ? 'password' : 'text'} inputMode={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'} />}</Box>
          {secret && mods.revealSecrets && <Button size="sm" aria-label={`${revealed[field.id] ? 'Hide' : 'Show'} ${field.label}`} onClick={() => setRevealed(prev => ({ ...prev, [field.id]: !prev[field.id] }))}>{revealed[field.id] ? 'Hide' : 'Show'}</Button>}
        </Flex>
        {field.type === 'totp' && thing[field.id] && <OneTimeCode value={thing[field.id]} />}
      </FormControl>;
    })}
  </Flex>;
}
