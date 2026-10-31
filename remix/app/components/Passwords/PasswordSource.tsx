import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import { Thingtime } from '~/components/Thingtime/Thingtime';
import type { PasswordEntry } from '~/passwords/model';
export function PasswordSource({ entry }: { entry: PasswordEntry }) {
  const source = React.useMemo(() => { try { return JSON.parse(entry.onePassword || '{}'); } catch { return {}; } }, [entry.onePassword]);
  const context = React.useMemo(() => { try { return JSON.parse(entry.onePasswordContext || '{}'); } catch { return {}; } }, [entry.onePasswordContext]);
  const history = Array.isArray(source.details?.passwordHistory) ? source.details.passwordHistory : [];
  return <Box mt={5}>
    {context?.account && <Text fontSize="sm">Source account: {String(context.account.accountName || context.account.name || context.account.uuid || '')}</Text>}
    {context?.vault && <Text fontSize="sm">Source vault: {String(context.vault.name || context.vault.uuid || '')}</Text>}
    {!!history.length && <Box mt={3}><details><summary>Password history ({history.length})</summary><Thingtime thing={Object.fromEntries(history.map((h: any, i: number) => [`history-${i}`, typeof h?.value === 'string' ? h?.value : JSON.stringify(h?.value)]))} mods={{ layout: 'fields', revealSecrets: true, fields: history.map((h: any, i: number) => ({ id: `history-${i}`, label: Number.isFinite(h?.time) ? new Date(h.time * 1000).toLocaleString() : `Previous password ${i + 1}`, type: 'password' })) }} /></details></Box>}
    <details><summary>Original item data</summary><Text fontSize="sm" mt={2}>Original properties, field definitions, relationships, dates, and unknown data are retained encrypted.</Text><Thingtime thing={{ source: entry.onePassword || '', context: entry.onePasswordContext || '' }} mods={{ layout: 'fields', fields: [{ id: 'source', label: 'Original 1Password item', type: 'notes', concealed: true, multiline: true }, { id: 'context', label: 'Original account and vault', type: 'notes', concealed: true, multiline: true }], revealSecrets: true }} /></details>
  </Box>;
}
