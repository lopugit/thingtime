import { useWorkspaceDraft } from '~/drafts/useWorkspaceDraft';
import { createWithDraft } from '~/drafts/createWithDraft';
import { restoreDefinitionDraft, parseDefinitionSource, hasInvalidDefinitionNumbers, type DefinitionFields } from './definitionDraft';
import { DraftSaveStatus } from '~/drafts/DraftPicker';
import React from 'react';
import { Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useWorkspaceUser } from '~/hooks/useWorkspaceUser';
import { useWorkspaceScope } from '~/hooks/useWorkspaceScope';
import { validateThingtimeCrystal } from '~/schemas/registry';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { DefinitionValueEditor } from './DefinitionValueEditor';
import { useTimelineDraft } from '~/timeline/useTimelineDraft';
import { openThingHistory } from '~/components/Timeline/TimelineHost';
import { useTimelineSession } from '~/timeline/TimelineProvider';

type DefinitionThing = { id: string; author?: { id: string }; thingtime: string[]; crystal: Record<string, any>; updatedAt: string; timelineHeadId?: string };
export function ThingDefinitionEditor(props: { id: string; initialThing?: DefinitionThing; onClose: () => void; onSaved?: (thing: DefinitionThing) => void }) {
 const user = useWorkspaceUser();
 const scope = useWorkspaceScope();
 const timeline = useTimelineSession();
 return <Editor key={`${scope}:${timeline.identity}:${props.id}`} {...props} actor={scope === 'pending' ? undefined : user?.id} localOnly={!!user?.localOnly} />;
}
function Editor({ id, actor, localOnly, initialThing, onClose, onSaved }: React.ComponentProps<typeof ThingDefinitionEditor> & { actor?: string; localOnly: boolean }) {
 const api = useApi();
 const apiRef = React.useRef(api); apiRef.current = api;
 const initial = initialThing?.id === id && initialThing.author?.id === actor ? initialThing : null;
 const [thing, setThing] = React.useState<DefinitionThing | null>(initial);
 const [source, setSource] = React.useState(() => initial ? JSON.stringify(initial.crystal, null, 2) : '');
 const [draftBase, setDraftBase] = React.useState<string | null>(initial?.updatedAt || null);
 const [mode, setMode] = React.useState<'fields' | 'source'>('fields');
 const [dirty, setDirty] = React.useState(false);
 const edited = React.useRef(false);
 const [fields, setFields] = React.useState<DefinitionFields>({});
 const [error, setError] = React.useState('');
 const [saving, setSaving] = React.useState(false);
 const active = React.useRef(true);
 const pending = React.useRef(false);
 const restored = React.useRef(false);
 const accountDraft = useWorkspaceDraft({ surface: 'definition', context: `definition:${id}`,
  validateSnapshot: restoreDefinitionDraft,
  onRestore: saved => { const value = restoreDefinitionDraft(saved.snapshot); restored.current = true; setDraftBase(value.baseUpdatedAt); setSource(value.source); setMode(value.mode); setFields(value.fields); setDirty(true); }
 });
 const captureDraft = accountDraft.capture;
 React.useEffect(() => {
  if (thing && dirty && !saving) captureDraft({ name: String(thing.crystal?.name || 'Thing definition').slice(0, 160), surface: 'definition', context: accountDraft.context,
    snapshot: JSON.stringify({ source, baseUpdatedAt: draftBase, mode, fields }), attachmentIds: [] }, true, true);
 }, [source, draftBase, mode, fields, dirty, thing, saving, captureDraft, accountDraft.context]);
 const draft = useTimelineDraft(!localOnly && thing?.author?.id === actor ? id : null, 'definition-source', thing?.timelineHeadId ?? null);
 const sourceSnapshot = (value: string) => ({ source: value, baseUpdatedAt: draftBase, thingtime: thing?.thingtime ?? [] });
 const changeSource = (next: string, preserveFields = false) => {
  if (pending.current) return;
  const persisted = localOnly ? Promise.resolve(null) : draft.record(sourceSnapshot(source), sourceSnapshot(next), 'Edit definition');
  void persisted.catch(() => {});
  edited.current = true; setDirty(true); if (!preserveFields) setFields({});
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
   setThing(response.thing); if (!restored.current && !edited.current) { setDraftBase(response.thing.updatedAt); setSource(JSON.stringify(response.thing.crystal, null, 2)); }
  }).catch((failure: Error) => { if (!cancelled) setError(failure.message); });
  return () => { cancelled = true; active.current = false; };
 }, [id, actor]);
 let parsed: any = null, parseError = '';
 try { if (source) parsed = JSON.parse(source); } catch { parseError = 'The source contains invalid JSON.'; }
 const staleDraft = !!thing && restored.current && draftBase !== thing.updatedAt;
 // While draft history is paused for this Thing, record() captures nothing and release/dismiss refuse, so a pinned
 // draft is never released without a capture: the recover/dismiss/discard paths stay disabled with their reason.
 const pausedMessage = 'History is paused for this Thing. Resume history to recover or dismiss drafts.';
 const selectSavedVersion = async () => {
  if (pending.current || !thing) return;
  if (draft.paused) { setError(pausedMessage); return; }
  pending.current = true; setSaving(true);
  try {
   await draft.record({ source: JSON.stringify(thing.crystal, null, 2), baseUpdatedAt: thing.updatedAt, thingtime: thing.thingtime }, sourceSnapshot(source), 'Preserve recovered definition');
   await draft.flush();
   if (!active.current) return;
   await accountDraft.clear();
   if (!active.current) return;
   restored.current = false; setDraftBase(thing.updatedAt); setSource(JSON.stringify(thing.crystal, null, 2)); setError('');
  } catch (failure: any) { if (active.current) setError(failure?.message || 'Could not release this draft'); }
  finally { pending.current = false; if (active.current) setSaving(false); }
 };
 const save = async () => {
  if (pending.current || !thing || !parsed || parseError || staleDraft || invalidNumbers) return;
  const checked = validateThingtimeCrystal(thing.thingtime, parsed);
  if (checked.ok === false) { setError(checked.error); return; }
  pending.current = true; setSaving(true); setError('');
  try {
   // The canonical write owns completion. Neither recovery queue nor cleanup
   // may block it; the account facade supplies its own actor/data-plane fence.
   const history = localOnly ? Promise.resolve(null) : draft.flush().catch(() => null);
   const response = await createWithDraft(accountDraft, () => apiRef.current.v1.things.update({ id, crystal: parsed, replaceCrystal: true, expectedUpdatedAt: draftBase }));
   if (!response?.ok) throw new Error(response?.error || 'Could not save the definition');
   // A capture made before the pause stays pinned (recoverable) rather than being released without a capture.
   if (draftEventId && !draft.paused) await draft.release(draftEventId);
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
   <ModalBody minW={0}><DraftSaveStatus status={accountDraft.status} error={accountDraft.error} retry={accountDraft.retry} />
    {staleDraft ? <Flex role="alert" gap={2} my={3} wrap="wrap" align="center"><Text>This saved definition changed since your draft, or its original version is unknown. Your draft is preserved. Open History to compare.</Text><Button size="sm" isDisabled={saving || draft.paused} title={draft.paused ? pausedMessage : undefined} onClick={() => void selectSavedVersion()}>Use latest saved version</Button></Flex> : null}
    <Flex gap={2} mb={4}><Button size="sm" variant={mode === 'fields' ? 'solid' : 'outline'} isDisabled={!!parseError || !thing} onClick={() => setMode('fields')}>Fields</Button><Button size="sm" variant={mode === 'source' ? 'solid' : 'outline'} onClick={() => setMode('source')}>Source</Button><Button size="sm" variant="ghost" onClick={() => openThingHistory(id, thing?.thingtime)}>History</Button></Flex>
    {draft.recoverable.map(event => <Flex key={event.id} gap={2} mb={3} wrap="wrap" align="center"><Text fontSize="sm">Unsaved draft · {new Date(event.occurredAt).toLocaleString()}</Text><Button size="xs" isDisabled={draft.paused} title={draft.paused ? pausedMessage : undefined} onClick={() => { if (draft.paused) { setError(pausedMessage); return; } const value = event.after?.value as any; if (typeof value?.source === 'string') { if (value.baseUpdatedAt !== thing?.updatedAt) { setError('This definition changed since the draft. Open History to compare before merging.'); return; } void changeSource(value.source)?.then(() => draft.dismissRecovery(event)).catch(() => {}); } }}>Recover draft</Button><Button size="xs" variant="ghost" isDisabled={draft.paused} title={draft.paused ? pausedMessage : undefined} onClick={() => { if (draft.paused) { setError(pausedMessage); return; } void draft.dismissRecovery(event).catch((failure: any) => setError(failure?.message || pausedMessage)); }}>Dismiss</Button>{draft.paused ? <Text fontSize="xs" color="var(--tt-muted)" flexBasis="100%">Paused · {pausedMessage}</Text> : null}</Flex>)}
    {thing ? <fieldset disabled={saving} style={{ border: 0, padding: 0, minWidth: 0 }}>{mode === 'source' ? <Textarea aria-label="Definition source" fontFamily="mono" fontSize="sm" rows={22} value={source} onChange={(event) => changeSource(event.target.value)} /> : <DefinitionValueEditor value={parsed} onChange={(value) => changeSource(JSON.stringify(value, null, 2))} />}</fieldset> : <Text>{error ? '' : 'Opening definition…'}</Text>}
    {thing ? <Text role="status" fontSize="xs" color={draft.error ? 'red.600' : 'var(--tt-muted)'} mt={3}>{draft.error || (draft.paused ? 'History paused for this Thing. Edits are not captured on this device; saved versions still record.' : draft.saving ? 'Saving draft on this device…' : draft.ready ? 'Draft history saves on this device and syncs to your Timeline.' : 'Connecting Timeline…')}</Text> : null}
    {parseError || error ? <Text role="alert" color="red.600" mt={3} overflowWrap="anywhere">{parseError || error}</Text> : null}
   </ModalBody>
   <ModalFooter gap={2} justifyContent={{ base: "flex-start", md: "flex-end" }}><Button onClick={onClose} isDisabled={saving}>Cancel</Button><Button colorScheme="pink" onClick={() => void save()} isLoading={saving} isDisabled={!thing || !!parseError || !parsed || staleDraft || invalidNumbers}>Save definition</Button></ModalFooter>
  </ModalContent>
 </Modal>;
}
