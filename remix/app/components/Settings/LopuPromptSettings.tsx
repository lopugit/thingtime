import React from 'react';
import { Box, Button, Checkbox, Flex, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { DEFAULT_LOPU_BASE_PROMPT, MAX_LOPU_BASE_PROMPT_CHARS, type LopuBasePromptSettings } from '~/api/utils/lopu/promptSettingsCore';

import { announceLopuInstructions, lopuInstructionWorkspace, LOPU_INSTRUCTIONS_CHANGED } from '~/local-workspace/lopuInstructions.client';
import { subscribeWorkspaceIdentity, workspaceIdentityKey } from '~/local-workspace/runtime.client';
import type { InstructionState } from '~/local-workspace/lopuInstructions';
type Snapshot = InstructionState;
const fallback: Snapshot = { base: { basePrompt: DEFAULT_LOPU_BASE_PROMPT, revision: null }, personal: { revision: null, instructions: [] } };
const baseCacheKey = 'tt-lopu-base-prompt';
// Private settings use the scoped workspace database, never the public cache.
export const LopuPromptSettings = ({ userId, admin = false }: { userId?: string; admin?: boolean }) => {
  const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, workspaceIdentityKey);
  return <PromptEditor key={`${identity}:${admin}:${userId ?? ''}`} admin={admin} identity={identity} />;
};
const PromptEditor = ({ admin, identity }: { admin: boolean; identity: string }) => {
  const service = React.useMemo(() => !admin && identity ? lopuInstructionWorkspace() : null, [admin, identity]);
  const api = useApi();
  const lopu = useLopu();
  const loadSettings = api.v1.settings.lopuPrompt;
  const [snapshot, setSnapshot] = React.useState<Snapshot>(() => ({ base: readLocalCache<LopuBasePromptSettings>(baseCacheKey) ?? fallback.base, personal: fallback.personal }));
  const [basePrompt, setBasePrompt] = React.useState(snapshot.base.basePrompt);
  const [instructions, setInstructions] = React.useState(snapshot.personal.instructions);
  const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);
  const dirty = React.useRef(false);
  const request = React.useRef(0);
  const reads = React.useRef(0);
  React.useEffect(() => {
    const controller = new AbortController();
    const generation = ++request.current;
    const load = () => {
    const read = ++reads.current;
    (admin ? loadSettings({ signal: controller.signal }) : service ? service.read() : Promise.resolve(fallback)).then((result: Snapshot) => {
      if (controller.signal.aborted || generation !== request.current || read !== reads.current) return;
      // Keep the revision the draft was based on. A background refresh must
      // not silently authorize overwriting a newer edit from another tab.
      setSnapshot(previous => !dirty.current ? result : admin
        ? { ...result, base: previous.base }
        : { ...result, personal: previous.personal });
      if (admin) writeLocalCache(baseCacheKey, result.base);
      if (!admin || !dirty.current) setBasePrompt(result.base.basePrompt);
      if (!dirty.current) setInstructions(result.personal.instructions);
      setLoaded(admin || !!service);
      setError('');
    }).catch((cause: any) => {
      if (!controller.signal.aborted && read === reads.current) setError(cause?.error || cause?.message || 'Could not load Lopu instructions.');
    });
    };
    load();
    if (!admin) window.addEventListener(LOPU_INSTRUCTIONS_CHANGED, load);
    return () => { controller.abort(); request.current = generation + 1; window.removeEventListener(LOPU_INSTRUCTIONS_CHANGED, load); };
  }, [loadSettings, service, admin, reload]);
  const edit = () => { dirty.current = true; setError(''); };
  const save = async () => {
    const generation = request.current;
    setSaving(true); setError('');
    try {
      const result = admin ? await api.v1.settings.setLopuPrompt({ scope: 'base', revision: snapshot.base.revision, basePrompt })
        : { ok: true, ...await service!.save({ revision: snapshot.personal.revision, instructions }) };
      reads.current++;
      if (generation !== request.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Could not save Lopu instructions.');
      if (admin) {
        setSnapshot(previous => ({ ...previous, base: result.base })); setBasePrompt(result.base.basePrompt); writeLocalCache(baseCacheKey, result.base);
      } else {
        setSnapshot(result); setInstructions(result.personal.instructions);
      }
      dirty.current = false;
      if (service) announceLopuInstructions(service.scope, true);
      lopu({ title: admin ? 'Lopu base prompt saved' : 'Lopu instructions saved on this device', description: admin ? 'Applies to new AI replies and newly started direct voice sessions.' : service?.scope.kind === 'account' ? 'Account sync runs separately. Account replies use these instructions after sync completes.' : 'Kept in this local workspace. Nothing was sent to an account.', status: 'success' });
    } catch (cause: any) {
      if (generation === request.current) setError(cause?.error || cause?.message || 'Could not save Lopu instructions.');
    } finally { if (generation === request.current) setSaving(false); }
  };
  const resolve = async (choice: 'device' | 'account') => {
    if (!service || !snapshot.conflict) return;
    const generation = request.current; setSaving(true); setError('');
    try {
      const result = await service.resolve(snapshot.personal.revision, snapshot.conflict.revision, choice);
      if (generation !== request.current) return;
      reads.current++; dirty.current = false; setSnapshot(result); setInstructions(result.personal.instructions); announceLopuInstructions(service.scope, true);
    } catch (cause: any) { if (generation === request.current) setError(cause?.message || 'Could not resolve these settings.'); }
    finally { if (generation === request.current) setSaving(false); }
  };
  return <Flex direction="column" gap={4} minW={0} id={admin ? 'lopu-base-prompt' : 'lopu-instructions'}>
    <Text fontWeight="600">{admin ? 'Lopu · Base prompt' : 'Lopu · Instructions'}</Text>
    <Text fontSize="sm">{admin ? 'Edit the public base prompt included with every AI-generated Lopu message, for everyone.' : 'Save custom instructions in this workspace. Signed-in accounts sync independently; account replies use them after sync completes.'} Task-specific guidance and tool permissions also apply. Canned messages do not use an AI prompt.</Text>
    {admin ? <Textarea borderWidth="1px" borderColor="var(--tt-border, #ececef)" borderRadius="md" aria-label="Lopu base prompt" value={basePrompt} maxLength={MAX_LOPU_BASE_PROMPT_CHARS} minH="280px" resize="vertical" isDisabled={saving || !loaded} onChange={event => { edit(); setBasePrompt(event.target.value); }} />
      : <Box as="details" minW={0}><Box as="summary" cursor="pointer" fontWeight="500">View base prompt</Box><Text mt={3} whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="sm">{basePrompt}</Text></Box>}
    {!admin && (<Flex direction="column" gap={3}>
      <Text fontWeight="500">Your custom instructions</Text>
      <Text fontSize="sm">Tick the instructions you want Lopu to use, then save. Unticked instructions stay in your list.</Text>
      {!instructions.length && <Text fontSize="sm">No custom instructions yet.</Text>}
      {instructions.map((row, index) => <Flex key={row.id} align="flex-start" gap={3} minW={0}>
        <Checkbox mt={3} flexShrink={0} sx={{ '& .chakra-checkbox__control': { borderWidth: '1px', borderColor: 'var(--tt-muted, #777)', width: '20px', height: '20px' } }} aria-label={`Enable instruction ${index + 1}`} isChecked={row.enabled} isDisabled={saving || !loaded} onChange={event => { edit(); setInstructions(rows => rows.map(item => item.id === row.id ? { ...item, enabled: event.target.checked } : item)); }} />
        <Flex direction="column" flex={1} minW={0} gap={1}>
          <Textarea borderWidth="1px" borderColor="var(--tt-border, #ececef)" borderRadius="md" aria-label={`Instruction ${index + 1}`} placeholder="For example: Use Australian English." value={row.text} minH="80px" resize="vertical" isDisabled={saving || !loaded} onChange={event => { edit(); setInstructions(rows => rows.map(item => item.id === row.id ? { ...item, text: event.target.value } : item)); }} />
          <Button size="xs" variant="ghost" alignSelf="flex-end" isDisabled={saving} aria-label={`Remove instruction ${index + 1}`} onClick={() => { edit(); setInstructions(rows => rows.filter(item => item.id !== row.id)); }}>Remove</Button>
        </Flex>
      </Flex>)}
      <Button size="sm" variant="outline" alignSelf="flex-start" isDisabled={saving || !loaded} onClick={() => { edit(); setInstructions(rows => [...rows, { id: crypto.randomUUID(), text: '', enabled: true }]); }}>Add instruction</Button>
    </Flex>)}
    {!admin && loaded && <Text role="status" fontSize="sm">{snapshot.conflict ? 'Account instructions changed. Your device version is kept for review.' : snapshot.error || (snapshot.pending ? 'Saved on this device. Waiting for account sync.' : service?.scope.kind === 'anonymous' ? 'Local workspace. No account sync.' : snapshot.remote ? 'Device and account instructions are in sync.' : 'Device instructions are available. Account settings have not been checked.')}</Text>}
    {!admin && snapshot.conflict && <Box as="details"><Box as="summary" cursor="pointer">Compare account instructions</Box>
      <Text mt={3} fontWeight="500">Account version</Text>
      {snapshot.conflict.instructions.length ? snapshot.conflict.instructions.map(row => <Text key={row.id} whiteSpace="pre-wrap" overflowWrap="anywhere" my={2}>{row.enabled ? 'Enabled' : 'Disabled'}: {row.text}</Text>) : <Text>No account instructions.</Text>}
      <Flex gap={2} mt={3} flexWrap="wrap"><Button size="sm" isDisabled={saving || dirty.current} onClick={() => void resolve('device')}>Use saved device version</Button><Button size="sm" isDisabled={saving || dirty.current} onClick={() => void resolve('account')}>Use account version</Button></Flex>
      {dirty.current && <Text fontSize="sm">Save your current edits before choosing a version.</Text>}
    </Box>}
    {error && <Flex direction="column" gap={2}><Text role="alert" fontSize="sm">{error}</Text><Button size="sm" alignSelf="flex-start" onClick={() => { dirty.current = false; setReload(value => value + 1); }}>Reload saved settings</Button></Flex>}
    {(admin || service) && <Button size="sm" alignSelf="flex-start" isDisabled={!loaded || saving || !dirty.current} onClick={save}>{saving ? 'Saving…' : admin ? 'Save base prompt' : 'Save instructions'}</Button>}
  </Flex>;
};
