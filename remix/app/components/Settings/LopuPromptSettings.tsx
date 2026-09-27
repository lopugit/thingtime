import React from 'react';
import { Box, Button, Checkbox, Flex, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { DEFAULT_LOPU_BASE_PROMPT, MAX_LOPU_BASE_PROMPT_CHARS, MAX_LOPU_INSTRUCTIONS, MAX_LOPU_INSTRUCTION_CHARS, type LopuBasePromptSettings, type LopuInstructionSettings } from '~/api/utils/lopu/promptSettingsCore';

type Snapshot = { base: LopuBasePromptSettings; personal: LopuInstructionSettings };
const fallback: Snapshot = { base: { basePrompt: DEFAULT_LOPU_BASE_PROMPT, revision: null }, personal: { revision: null, instructions: [] } };
const baseCacheKey = 'tt-lopu-base-prompt';
// Personal text stays in memory only, scoped by account; never cached publicly
// or written into the browser's persistent local-storage cache.
const personalCache = new Map<string, LopuInstructionSettings>();
export const LopuPromptSettings = ({ userId, admin = false }: { userId?: string; admin?: boolean }) => {
  const api = useApi();
  const lopu = useLopu();
  const loadSettings = api.v1.settings.lopuPrompt;
  const [snapshot, setSnapshot] = React.useState<Snapshot>(() => ({ base: readLocalCache<LopuBasePromptSettings>(baseCacheKey) ?? fallback.base, personal: userId ? personalCache.get(userId) ?? fallback.personal : fallback.personal }));
  const [basePrompt, setBasePrompt] = React.useState(snapshot.base.basePrompt);
  const [instructions, setInstructions] = React.useState(snapshot.personal.instructions);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);
  const dirty = React.useRef(false);
  const request = React.useRef(0);
  React.useEffect(() => {
    const controller = new AbortController();
    const generation = ++request.current;
    setLoaded(false);
    loadSettings({ signal: controller.signal }).then((result: Snapshot) => {
      if (controller.signal.aborted || generation !== request.current) return;
      // Keep the revision the draft was based on. A background refresh must
      // not silently authorize overwriting a newer edit from another tab.
      setSnapshot(previous => !dirty.current ? result : admin
        ? { ...result, base: previous.base }
        : { ...result, personal: previous.personal });
      writeLocalCache(baseCacheKey, result.base);
      if (userId) personalCache.set(userId, result.personal);
      if (!admin || !dirty.current) setBasePrompt(result.base.basePrompt);
      if (!dirty.current) setInstructions(result.personal.instructions);
      setLoaded(true);
      setError('');
    }).catch((cause: any) => {
      if (!controller.signal.aborted) setError(cause?.error || cause?.message || 'Could not load Lopu instructions.');
    });
    return () => { controller.abort(); request.current = generation + 1; };
  }, [loadSettings, userId, admin, reload]);
  const edit = () => { dirty.current = true; setError(''); };
  const save = async () => {
    const generation = request.current;
    setSaving(true); setError('');
    try {
      const result = await api.v1.settings.setLopuPrompt(admin
        ? { scope: 'base', revision: snapshot.base.revision, basePrompt }
        : { scope: 'personal', revision: snapshot.personal.revision, instructions });
      if (generation !== request.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Could not save Lopu instructions.');
      if (admin) {
        setSnapshot(previous => ({ ...previous, base: result.base })); setBasePrompt(result.base.basePrompt); writeLocalCache(baseCacheKey, result.base);
      } else {
        setSnapshot(previous => ({ ...previous, personal: result.personal })); setInstructions(result.personal.instructions);
        if (userId) personalCache.set(userId, result.personal);
      }
      dirty.current = false;
      lopu({ title: admin ? 'Lopu base prompt saved' : 'Your Lopu instructions are saved', description: 'They apply to new AI replies and newly started direct voice sessions.', status: 'success' });
    } catch (cause: any) {
      if (generation === request.current) setError(cause?.error || cause?.message || 'Could not save Lopu instructions.');
    } finally { if (generation === request.current) setSaving(false); }
  };
  return <Flex direction="column" gap={4} minW={0} id={admin ? 'lopu-base-prompt' : 'lopu-instructions'}>
    <Text fontWeight="600">{admin ? 'Lopu · Base prompt' : 'Lopu · Instructions'}</Text>
    <Text fontSize="sm">{admin ? 'Edit the public base prompt included with every AI-generated Lopu message, for everyone.' : 'The shared base prompt is included with every AI-generated Lopu message. Add private instructions below to make Lopu work your way.'} Task-specific guidance and tool permissions also apply. Canned messages do not use an AI prompt.</Text>
    {admin ? <Textarea borderWidth="1px" borderColor="var(--tt-border, #ececef)" borderRadius="md" aria-label="Lopu base prompt" value={basePrompt} maxLength={MAX_LOPU_BASE_PROMPT_CHARS} minH="280px" resize="vertical" isDisabled={saving} onChange={event => { edit(); setBasePrompt(event.target.value); }} />
      : <Box as="details" minW={0}><Box as="summary" cursor="pointer" fontWeight="500">View base prompt</Box><Text mt={3} whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="sm">{basePrompt}</Text></Box>}
    {!admin && (userId ? <Flex direction="column" gap={3}>
      <Text fontWeight="500">Your custom instructions</Text>
      <Text fontSize="sm">Tick the instructions you want Lopu to use, then save. Unticked instructions stay in your list.</Text>
      {!instructions.length && <Text fontSize="sm">No custom instructions yet.</Text>}
      {instructions.map((row, index) => <Flex key={row.id} align="flex-start" gap={3} minW={0}>
        <Checkbox mt={3} flexShrink={0} sx={{ '& .chakra-checkbox__control': { borderWidth: '1px', borderColor: 'var(--tt-muted, #777)', width: '20px', height: '20px' } }} aria-label={`Enable instruction ${index + 1}`} isChecked={row.enabled} isDisabled={saving} onChange={event => { edit(); setInstructions(rows => rows.map(item => item.id === row.id ? { ...item, enabled: event.target.checked } : item)); }} />
        <Flex direction="column" flex={1} minW={0} gap={1}>
          <Textarea borderWidth="1px" borderColor="var(--tt-border, #ececef)" borderRadius="md" aria-label={`Instruction ${index + 1}`} placeholder="For example: Use Australian English." value={row.text} maxLength={MAX_LOPU_INSTRUCTION_CHARS} minH="80px" resize="vertical" isDisabled={saving} onChange={event => { edit(); setInstructions(rows => rows.map(item => item.id === row.id ? { ...item, text: event.target.value } : item)); }} />
          <Button size="xs" variant="ghost" alignSelf="flex-end" isDisabled={saving} aria-label={`Remove instruction ${index + 1}`} onClick={() => { edit(); setInstructions(rows => rows.filter(item => item.id !== row.id)); }}>Remove</Button>
        </Flex>
      </Flex>)}
      <Button size="sm" variant="outline" alignSelf="flex-start" isDisabled={saving || instructions.length >= MAX_LOPU_INSTRUCTIONS} onClick={() => { edit(); setInstructions(rows => [...rows, { id: crypto.randomUUID(), text: '', enabled: true }]); }}>Add instruction</Button>
    </Flex> : <Text fontSize="sm">Sign in to save your custom instructions.</Text>)}
    {error && <Flex direction="column" gap={2}><Text role="alert" fontSize="sm">{error}</Text><Button size="sm" alignSelf="flex-start" onClick={() => { dirty.current = false; setReload(value => value + 1); }}>Reload saved settings</Button></Flex>}
    {(admin || userId) && <Button size="sm" alignSelf="flex-start" isDisabled={!loaded || saving || !dirty.current} onClick={save}>{saving ? 'Saving…' : admin ? 'Save base prompt' : 'Save instructions'}</Button>}
  </Flex>;
};
