import React from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { DefinitionValueEditor } from '../Builder/DefinitionEditor/DefinitionValueEditor';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { TimelineDraftRecorder } from '../../timeline/draftRecorder';
import { timelineScopeKey, type TimelineEvent, type TimelineSnapshot } from '../../timeline/contract';
import type { TimelineBranchEntry, TimelineBranchCommand } from '../../timeline/branches';
import { branchCheckoutRequest, branchCrystalSnapshot, branchEditableSnapshot, branchEditCommand, parseBranchCheckout } from '../../timeline/branchCheckout';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';

type Props = { target: TimelineBranchEntry; onClose: () => void };
export function TimelineBranchEditor(props: Props) {
 const { connection, identity } = useTimelineSession();
 if (!connection) return null;
 return <BranchEditor key={JSON.stringify([identity, timelineScopeKey(connection.scope), props.target.head.id, props.target.head.revision])} {...props} connection={connection} />;
}

/** The ordinary field editor writes canonical drafts. Only the existing branch
 * queue can move the named head; no published-Thing update is issued here. */
function BranchEditor({ target, onClose, connection }: Props & { connection: NonNullable<ReturnType<typeof useTimelineSession>['connection']> }) {
 const api = useApi(); const apiRef = React.useRef(api); apiRef.current = api;
 const [snapshot, setSnapshot] = React.useState<TimelineSnapshot | null>(null);
 const current = React.useRef<TimelineSnapshot | null>(null);
 const recorder = React.useRef<TimelineDraftRecorder | null>(null);
 const resumed = React.useRef<string | null>(null);
 const [recovery, setRecovery] = React.useState<TimelineEvent | null>(null);
 const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState('');
 const [loading, setLoading] = React.useState(false); const [writing, setWriting] = React.useState(false); const [saving, setSaving] = React.useState(false);
 const [queued, setQueued] = React.useState(false); const [edited, setEdited] = React.useState(false);
 const command = React.useRef<TimelineBranchCommand | null>(null);
 const alive = React.useRef(true); const working = React.useRef(false); const controller = React.useRef<AbortController | null>(null);
 const publish = (value: TimelineSnapshot, parentId: string) => {
  current.current = value; setSnapshot(value);
  recorder.current = new TimelineDraftRecorder(connection.store, target.head.thingId, target.branch.id, crypto.randomUUID(), parentId);
 };
 const load = async () => {
  if (working.current || current.current) return;
  working.current = true; setLoading(true); setError('');
  const attempt = new AbortController(); controller.current = attempt;
  const active = () => alive.current && !attempt.signal.aborted;
  try {
   const rows = await connection.store.forThing(target.head.thingId);
   const draft = rows.find(row => row.draftKey && row.event.branchId === target.branch.id && row.event.id !== target.head.eventId && row.event.after?.adapter === 'thing-content');
   if (active()) setRecovery(draft?.event ?? null);
   const local = rows.find(row => row.event.id === target.head.eventId);
   if (local?.draftKey) await connection.store.releaseDraft(local.event.id);
   if (local?.event.after?.adapter === 'thing-content' && active()) {
    try { publish(branchEditableSnapshot(local.event.after), local.event.id); } catch { /* Fetch the complete supported projection below. */ }
   }
   const request = branchCheckoutRequest(target);
   const result = await apiRef.current.v1.timeline.checkoutBranch(connection.scope, request, { signal: attempt.signal });
   if (result?.ok !== true) throw new Error(result?.error || 'Could not open this branch.');
   const checked = parseBranchCheckout(result.checkout, connection.scope.ownerId, request);
   if (!active()) return;
   await connection.store.accept([checked.entry]);
   // A background read must never replace an edit made against cached content.
   if (active() && !current.current) publish(checked.snapshot, checked.head.eventId);
  } catch (failure: any) {
   if (active()) {
    // A pinned full draft remains usable offline even if its original head was
    // evicted. Resuming is explicit and the server still checks ancestry on push.
    setError(failure?.error || failure?.message || 'Could not refresh this branch. Cached fields and drafts are still available.');
   }
  } finally { if (controller.current === attempt) { working.current = false; if (active()) setLoading(false); } }
 };
 React.useEffect(() => {
  alive.current = true; void load();
  return () => { alive.current = false; controller.current?.abort(); working.current = false; };
  // Exact account/source/head identity remounts the wrapper.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);
 const change = (crystal: unknown) => {
  if (!current.current || !recorder.current || (working.current && !loading) || command.current) return;
  try {
   const next = branchCrystalSnapshot(current.current, crystal);
   const pending = recorder.current.capture(current.current, next, `Edit ${target.branch.name}`);
   current.current = next; setSnapshot(next); setEdited(true); setWriting(true); setError('');
   void pending.then(() => { if (alive.current) { setWriting(recorder.current!.hasUnwrittenChanges); setNotice('Draft saved on this device.'); } window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); })
    .catch(failure => { if (alive.current) { setWriting(false); setError(failure?.message || 'Could not save this draft on your device. Keep the editor open and retry.'); } });
  } catch (failure: any) { if (alive.current) setError(failure?.message || 'These fields are too large to save.'); }
 };
 const save = async () => {
  if (!recorder.current || working.current || queued) return;
  working.current = true; setSaving(true); setError('');
  try {
   await recorder.current.flush();
   const eventId = recorder.current.eventId ?? resumed.current;
   if (!eventId || !alive.current) return;
   command.current ??= branchEditCommand(target, eventId);
   await connection.branches.enqueue(command.current);
   if (!alive.current) return;
   setQueued(true); setNotice('Branch edit saved on this device. Waiting to sync to your account.');
   window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
   await connection.sync.pushPending();
   const pending = (await connection.branches.queued()).find(row => row.command.operationId === command.current!.operationId);
   if (!pending) await connection.store.releaseDraft(eventId);
   if (alive.current) { setNotice(pending?.failure ? 'The branch changed. Your edit is preserved in History; close this editor and review a merge.' : pending ? 'Branch edit saved on this device. Its push is waiting to sync.' : `Saved to ${target.branch.name} in your account.`); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
  } catch (failure: any) { if (alive.current) { if (command.current) setNotice('Your edited version is preserved in History. Close this editor to check its branch push.'); setError(failure?.error || failure?.message || 'Could not finish saving. Retry the same operation.'); } }
  finally { working.current = false; if (alive.current) { setSaving(false); setWriting(false); } }
 };
 return <Box role="region" aria-label="Edit branch" p={3} my={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg" minW={0}>
  <Heading size="sm" overflowWrap="anywhere">Edit {target.branch.name}</Heading>
  <Text fontSize="sm" color="var(--tt-muted)" mt={2} mb={3}>Changes go to this branch. The published Thing stays unchanged.</Text>
  {recovery && !edited && !command.current ? <Box mb={3}><Text fontSize="sm">An unfinished draft is saved on this device.</Text><Button size="sm" variant="outline" isDisabled={saving} onClick={() => { try { const value = branchEditableSnapshot(recovery.after!); publish(value, recovery.id); resumed.current = recovery.id; setEdited(true); setRecovery(null); setError(''); setNotice('Draft resumed. Saving will check whether the branch has changed.'); } catch (failure: any) { setError(failure.message); } }}>Resume draft</Button></Box> : null}
  {snapshot && !queued ? <fieldset disabled={saving || !!command.current} style={{ border: 0, padding: 0, minWidth: 0 }}><DefinitionValueEditor value={(snapshot.value as any).crystal} label="Branch fields" onChange={change} /></fieldset> : null}
  {loading && !snapshot ? <Text fontSize="sm">Opening branch…</Text> : null}
  {writing ? <Text role="status" fontSize="sm">Saving draft on this device…</Text> : notice ? <Text role="status" fontSize="sm" mt={3}>{notice}</Text> : null}
  {error ? <Text role="alert" fontSize="sm" my={3} overflowWrap="anywhere">{error}</Text> : null}
  <Flex gap={2} mt={3} wrap="wrap">
   {!queued && (snapshot || edited) ? <Button size="sm" isLoading={saving} isDisabled={!edited || loading} onClick={() => void save()}>{command.current ? 'Retry saving branch' : 'Save to branch'}</Button> : null}
   {!snapshot && !loading ? <Button size="sm" onClick={() => void load()}>Retry opening branch</Button> : null}
   <Button size="sm" variant="ghost" isDisabled={saving || writing || !!recorder.current?.hasUnwrittenChanges} onClick={onClose}>Close editor</Button>
  </Flex>
 </Box>;
}
