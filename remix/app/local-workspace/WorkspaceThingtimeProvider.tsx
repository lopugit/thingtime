import React from 'react';
import localforage from 'localforage';
import { Box, Button, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { ThingtimeProvider } from '../Providers/ThingtimeProvider';
import { decodeThingtime } from '../Providers/thingtimeSerialization';
import { useThingtime } from '../components/Thingtime/useThingtime';
import { RootRecovery } from '../components/Layout/RootRecovery';
import { TRANSFER_DIALOG_Z } from '../components/Things/transferLayers';
import { validThingDraftPath } from '../drafts/thingDraftWorkspace';
import { LocalEditorTree } from './editorTree';
import { workspaceDatabase } from './runtime.client';
import { subscribeWorkspaceStorage, workspaceStorageBinding, workspaceStorageIdentity } from './storageStatus.client';

type Binding = NonNullable<ReturnType<typeof workspaceStorageBinding>>;
const EditorStorageContext = React.createContext<{ binding: Binding; store: LocalEditorTree } | null>(null);

export function WorkspaceThingtimeProvider({ children }: { children: React.ReactNode }) {
 const identity = React.useSyncExternalStore(subscribeWorkspaceStorage, workspaceStorageIdentity, () => '');
 // Capture the generation, including switches back to the same account/plane.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const binding = React.useMemo(() => workspaceStorageBinding(), [identity]);
 return binding ? <BoundTree key={identity} binding={binding}>{children}</BoundTree> : <RootRecovery refreshing />;
}
function BoundTree({ binding, children }: { binding: Binding; children: React.ReactNode }) {
 const store = React.useMemo(() => new LocalEditorTree(workspaceDatabase(), binding.scope, binding.lease, localforage), [binding]);
 const [error, setError] = React.useState('');
 const onStorageError = React.useCallback((failure: unknown) => {
  try { binding.lease.assertCurrent(); }
  catch { return; }
  setError(failure ? failure instanceof Error ? failure.message : 'The editor could not save on this device.' : '');
 }, [binding]);
 return <EditorStorageContext.Provider value={{ binding, store }}>
  <ThingtimeProvider storageKey={store.key} storage={store} onStorageError={onStorageError} accountId={binding.scope.kind === 'account' ? binding.scope.ownerId : undefined}>
   {error && <Box role="alert" mt="72px" mx={3} p={3} borderRadius="md" border="1px solid" borderColor="orange.300">
    <Text fontWeight="bold">Editor device storage needs attention</Text><Text fontSize="sm">{error}</Text>
   </Box>}
   {children}
  </ThingtimeProvider>
 </EditorStorageContext.Provider>;
}

/** Old owner-only trees have no selected-database identity. A reviewed local
 * copy is explicit, independent, and never removes the original device key. */
export function LegacyEditorTreeRecovery() {
 const storage = React.useContext(EditorStorageContext), { getThingtime, setThingtime, flushPersistence, loading } = useThingtime();
 const [available, setAvailable] = React.useState(false), [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
 const [review, setReview] = React.useState<{ serialized: string; roots: string[] } | null>(null);
 const [name, setName] = React.useState('Recovered device workspace'), [pendingName, setPendingName] = React.useState(''), [error, setError] = React.useState('');
 const live = React.useRef(true), active = React.useRef(false);
 const store = storage?.store;
 React.useEffect(() => {
  live.current = true;
  if (store) void store.hasLegacyAccountTree().then(value => { if (live.current) setAvailable(value); }).catch(() => {});
  return () => { live.current = false; };
 }, [store]);
 const run = async (action: () => Promise<void>) => {
  if (!storage || active.current) return;
  active.current = true;
  setBusy(true); setError('');
  try { storage.binding.lease.assertCurrent(); await action(); storage.binding.lease.assertCurrent(); }
  catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'The earlier tree could not be recovered.'); }
  finally { active.current = false; if (live.current) setBusy(false); }
 };
 const close = () => {
  if (busy) return;
  setOpen(false); setError('');
  // Failed durable saves retry the existing copy; other opens review afresh.
  if (!pendingName) setReview(null);
 };
 if (!storage || !available) return null;
 return <>
  <Button size="xs" variant="outline" borderRadius="999px" onClick={() => {
   setOpen(true);
   if (!review) void run(async () => {
    const previous = await storage.store.reviewLegacyAccountTree();
    if (live.current) setReview({ serialized: previous.serialized, roots: Object.keys(previous.value).filter(key => !['tt', 'thingtime', 'set', 'get'].includes(key)) });
   });
  }}>Recover earlier device tree</Button>
  <Modal isOpen={open} onClose={close} size="lg" scrollBehavior="inside">
   <ModalOverlay zIndex={TRANSFER_DIALOG_Z - 1} />
   <ModalContent containerProps={{ zIndex: TRANSFER_DIALOG_Z }} width="calc(100% - 24px)" marginX={0} marginY={6} maxHeight={{ base: 'calc(100dvh - 120px)', md: 'calc(100dvh - 48px)' }}>
    <ModalHeader>Earlier device workspace</ModalHeader><ModalCloseButton isDisabled={busy} />
    <ModalBody>
     <Text fontSize="sm" mb={3}>This account’s earlier editor tree has no database label. Copy it into a new item in the current workspace. Its original device copy is kept, and your current content and settings stay in place.</Text>
     <Input aria-label="Recovered workspace name" value={name} maxLength={160} isDisabled={busy || !!pendingName} onChange={event => { setName(event.target.value); setError(''); }} />
     {review && <>
      <Text fontSize="sm" mt={3}>Earlier roots: {review.roots.slice(0, 30).join(', ')}{review.roots.length > 30 ? ` and ${review.roots.length - 30} more` : ''}</Text>
      <Text fontSize="xs" mt={3}>Storage preview (first 4,000 characters). The complete tree, including Dates and cycles, is copied.</Text>
      <Text as="pre" fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere" maxHeight="220px" overflowY="auto">{review.serialized.slice(0, 4000)}</Text>
     </>}
     {error && <Text role="alert" mt={3} color="red.500">{error}</Text>}
    </ModalBody>
    <ModalFooter gap={2} flexWrap="wrap">
     <Button variant="ghost" isDisabled={busy} onClick={close}>Cancel</Button>
     <Button isLoading={busy} isDisabled={!review || loading} onClick={() => void run(async () => {
      if (!review || !flushPersistence) throw Error('The editor is not ready to save. Try again.');
      if (!pendingName) {
       const destination = name.trim();
       if (!validThingDraftPath([destination]) || destination.length > 160) throw Error('Choose a name for the recovered workspace.');
       const latest = await storage.store.reviewLegacyAccountTree();
       if (latest.serialized !== review.serialized) throw Error('The earlier device tree changed. Close and reopen recovery to review it again.');
       storage.binding.lease.assertCurrent();
       if (Object.prototype.hasOwnProperty.call(getThingtime(), destination)) throw Error('That name already exists. Choose another name to keep both items.');
       setThingtime([destination], decodeThingtime(review.serialized).value, { namespace: 'user' });
       setPendingName(destination);
      }
      await flushPersistence(); storage.binding.lease.assertCurrent();
      if (live.current) { setOpen(false); setAvailable(false); }
     })}>{pendingName ? 'Retry device save' : 'Copy into this workspace'}</Button>
    </ModalFooter>
   </ModalContent>
  </Modal>
 </>;
}
