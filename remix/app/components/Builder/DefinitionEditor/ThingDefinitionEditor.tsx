import React from 'react';
import { Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { validateThingtimeCrystal } from '~/schemas/registry';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { DefinitionValueEditor } from './DefinitionValueEditor';

type DefinitionThing = { id: string; author?: { id: string }; thingtime: string[]; crystal: Record<string, any>; updatedAt: string };
export function ThingDefinitionEditor(props: { id: string; onClose: () => void; onSaved?: (thing: DefinitionThing) => void }) {
 const user = useCurrentUser();
 return <Editor key={`${user?.id}:${props.id}`} {...props} actor={user?.id} />;
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
   const response = await apiRef.current.v1.things.update({ id, crystal: parsed, replaceCrystal: true, expectedUpdatedAt: thing.updatedAt, expectedActor: actor });
   if (!response?.ok) throw new Error(response?.error || 'Could not save the definition');
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
    <Flex gap={2} mb={4}><Button size="sm" variant={mode === 'fields' ? 'solid' : 'outline'} isDisabled={!!parseError || !thing} onClick={() => setMode('fields')}>Fields</Button><Button size="sm" variant={mode === 'source' ? 'solid' : 'outline'} onClick={() => setMode('source')}>Source</Button></Flex>
    {thing ? mode === 'source' ? <Textarea aria-label="Definition source" fontFamily="mono" fontSize="sm" rows={22} value={source} onChange={(event) => { setSource(event.target.value); setError(''); }} /> : <DefinitionValueEditor value={parsed} onChange={(value) => { setSource(JSON.stringify(value, null, 2)); setError(''); }} /> : <Text>{error ? '' : 'Opening definition…'}</Text>}
    {parseError || error ? <Text role="alert" color="red.600" mt={3} overflowWrap="anywhere">{parseError || error}</Text> : null}
   </ModalBody>
   <ModalFooter gap={2} justifyContent={{ base: "flex-start", md: "flex-end" }}><Button onClick={onClose} isDisabled={saving}>Cancel</Button><Button colorScheme="pink" onClick={() => void save()} isLoading={saving} isDisabled={!thing || !!parseError || !parsed}>Save definition</Button></ModalFooter>
  </ModalContent>
 </Modal>;
}
