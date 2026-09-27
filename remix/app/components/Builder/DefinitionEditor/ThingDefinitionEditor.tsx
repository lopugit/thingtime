import React from 'react';
import { Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { validateThingtimeCrystal } from '~/schemas/registry';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { DefinitionValueEditor } from './DefinitionValueEditor';
import { useTimelineDraft } from '~/timeline/useTimelineDraft';
import { openThingHistory } from '~/components/Timeline/TimelineHost';
import { useTimelineSession } from '~/timeline/TimelineProvider';

type DefinitionThing = { id: string; author?: { id: string }; thingtime: string[]; crystal: Record<string, any>; updatedAt: string; timelineHeadId?: string };
export function ThingDefinitionEditor(props: { id: string; onClose: () => void; onSaved?: (thing: DefinitionThing) => void }) {
 const user = useCurrentUser();
 const timeline = useTimelineSession();
 return <Editor key={`${timeline.identity}:${props.id}`} {...props} actor={user?.id} />;
}
function Editor({ id, actor, onClose, onSaved }: React.ComponentProps<typeof ThingDefinitionEditor> & { actor?: string }) {
 const api = useApi();
 const apiRef = React.useRef(api); apiRef.current = api;
 const [thing, setThing] = React.useState<DefinitionThing | null>(null);
 const [source, setSource] = React.useState('');
 const [mode, setMode] = React.useState<'fields' | 'source'>('fields');
 const [error, setError] = React.useState('');
 const [saving, setSaving] = React.useState(false);
 const active = React.useRef(true);
 const pending = React.useRef(false);
 const draft = useTimelineDraft(thing?.author?.id === actor ? id : null, 'definition-source', thing?.timelineHeadId ?? null);
 const sourceSnapshot = (value: string) => ({ source: value, baseUpdatedAt: thing?.updatedAt ?? null, thingtime: thing?.thingtime ?? [] });
 const changeSource = (next: string) => {
  if (pending.current) return;
  const persisted = draft.record(sourceSnapshot(source), sourceSnapshot(next), 'Edit definition');
  void persisted.catch(() => {});
  setSource(next); setError('');
  return persisted;
 };
 React.useEffect(() => {
  active.current = true;
  let cancelled = false;
  void apiRef.current.v1.things.get({ id }).then((response: any) => {
   if (cancelled) return;
   if (!response?.ok || !response.thing) throw new Error(response?.error || 'Could not open this definition');
   if (!actor || response.thing.author?.id !== actor) throw new Error('Save a private copy before editing this definition.');
   setThing(response.thing); setSource(JSON.stringify(response.thing.crystal, null, 2));
  }).catch((failure: Error) => { if (!cancelled) setError(failure.message); });
  return () => { cancelled = true; active.current = false; };
 }, [id, actor]);
 let parsed: any = null, parseError = '';
 try { if (source) parsed = JSON.parse(source); } catch { parseError = 'The source contains invalid JSON.'; }
 const save = async () => {
  if (pending.current || !thing || !parsed || parseError) return;
  const checked = validateThingtimeCrystal(thing.thingtime, parsed);
  if (checked.ok === false) { setError(checked.error); return; }
  pending.current = true; setSaving(true); setError('');
  try {
   const draftEventId = await draft.flush();
   if (!active.current) return;
   const response = await apiRef.current.v1.things.update({ id, crystal: parsed, replaceCrystal: true, expectedUpdatedAt: thing.updatedAt, expectedActor: actor });
   if (!response?.ok) throw new Error(response?.error || 'Could not save the definition');
   await draft.release(draftEventId);
   const readback = await apiRef.current.v1.things.get({ id });
   if (!readback?.ok || !readback.thing) throw new Error('Saved, but readback failed. Reopen the definition to check it.');
   if (!active.current) return;
   onSaved?.(readback.thing); onClose();
  } catch (failure: any) { if (active.current) setError(failure?.error || failure?.message || 'Could not save'); }
  finally { pending.current = false; if (active.current) setSaving(false); }
 };
 return <Modal isOpen onClose={() => { if (!pending.current) onClose(); }} size="4xl" scrollBehavior="inside" isCentered>
  <ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} /><ModalContent maxW="min(960px, calc(100vw - 24px))" maxH="calc(100dvh - 24px)" containerProps={{ zIndex: DRAWER_MODAL_Z }}>
   <ModalHeader>Edit {thing?.crystal?.name || 'definition'}</ModalHeader><ModalCloseButton isDisabled={saving} />
   <ModalBody minW={0}>
    <Flex gap={2} mb={4}><Button size="sm" variant={mode === 'fields' ? 'solid' : 'outline'} isDisabled={!!parseError || !thing} onClick={() => setMode('fields')}>Fields</Button><Button size="sm" variant={mode === 'source' ? 'solid' : 'outline'} onClick={() => setMode('source')}>Source</Button><Button size="sm" variant="ghost" onClick={() => openThingHistory(id)}>History</Button></Flex>
    {draft.recoverable.map(event => <Flex key={event.id} gap={2} mb={3} wrap="wrap" align="center"><Text fontSize="sm">Unsaved draft · {new Date(event.occurredAt).toLocaleString()}</Text><Button size="xs" onClick={() => { const value = event.after?.value as any; if (typeof value?.source === 'string') { if (value.baseUpdatedAt !== thing?.updatedAt) { setError('This definition changed since the draft. Open History to compare before merging.'); return; } void changeSource(value.source)?.then(() => draft.dismissRecovery(event)).catch(() => {}); } }}>Recover draft</Button><Button size="xs" variant="ghost" onClick={() => void draft.dismissRecovery(event)}>Dismiss</Button></Flex>)}
    {thing ? <fieldset disabled={saving} style={{ border: 0, padding: 0, minWidth: 0 }}>{mode === 'source' ? <Textarea aria-label="Definition source" fontFamily="mono" fontSize="sm" rows={22} value={source} onChange={(event) => changeSource(event.target.value)} /> : <DefinitionValueEditor value={parsed} onChange={(value) => changeSource(JSON.stringify(value, null, 2))} />}</fieldset> : <Text>{error ? '' : 'Opening definition…'}</Text>}
    {thing ? <Text role="status" fontSize="xs" color={draft.error ? 'red.600' : 'var(--tt-muted)'} mt={3}>{draft.error || (draft.saving ? 'Saving draft on this device…' : draft.ready ? 'Draft history saves on this device and syncs to your Timeline.' : 'Connecting Timeline…')}</Text> : null}
    {parseError || error ? <Text role="alert" color="red.600" mt={3} overflowWrap="anywhere">{parseError || error}</Text> : null}
   </ModalBody>
   <ModalFooter gap={2} justifyContent={{ base: "flex-start", md: "flex-end" }}><Button onClick={onClose} isDisabled={saving}>Cancel</Button><Button colorScheme="pink" onClick={() => void save()} isLoading={saving} isDisabled={!thing || !!parseError || !parsed}>Save definition</Button></ModalFooter>
  </ModalContent>
 </Modal>;
}
