import React from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import { timelineScopeKey, type TimelineEvent } from '../../timeline/contract';
import type { TimelineBranchEntry } from '../../timeline/branches';
import { createBranchMergeProposal, parseBranchMergePreview, type BranchMergePreview, type BranchMergeRequest } from '../../timeline/branchMerge';
import type { VersionChoices } from '../../timeline/versions';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';
import { TimelineVersionComparison } from './TimelineVersionComparison';

type Props = { target: TimelineBranchEntry; incoming: TimelineEvent; onClose: () => void };
export function TimelineBranchMerge(props: Props) {
 const { connection, identity } = useTimelineSession();
 if (!connection) return null;
 const key = JSON.stringify([identity, timelineScopeKey(connection.scope), props.target.head.id, props.target.head.revision, props.incoming.id]);
 return <BranchMergeReview key={key} {...props} connection={connection} />;
}

/** A review is bound to one scope and exact pair of versions. Applying first
 * persists a normal merge event, then queues the existing fenced branch push. */
function BranchMergeReview({ target, incoming, onClose, connection }: Props & { connection: NonNullable<ReturnType<typeof useTimelineSession>['connection']> }) {
 const api = useApi(); const apiRef = React.useRef(api); apiRef.current = api;
 const [preview, setPreview] = React.useState<BranchMergePreview | null>(null);
 const [choices, setChoices] = React.useState<VersionChoices>({});
 const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState('');
 const [queued, setQueued] = React.useState(false);
 const proposal = React.useRef<ReturnType<typeof createBranchMergeProposal> | null>(null);
 const eventSaved = React.useRef(false); const commandSaved = React.useRef(false);
 const alive = React.useRef(true); const working = React.useRef(false); const controller = React.useRef<AbortController | null>(null);
 const compare = async (selected: VersionChoices = {}) => {
  if (working.current || proposal.current) return;
  working.current = true; setBusy(true); setError('');
  const attempt = new AbortController(); controller.current = attempt;
  try {
   await connection.sync.pushPending();
   if (!alive.current || attempt.signal.aborted) return;
   const request: BranchMergeRequest = { command: 'preview-branch-merge', branchId: target.branch.id, thingId: target.head.thingId, eventId: incoming.id, expectedHeadId: target.head.eventId, expectedRevision: target.head.revision, choices: selected };
   const result = await apiRef.current.v1.timeline.branchMerge(connection.scope, request, { signal: attempt.signal });
   if (result?.ok !== true) throw new Error(result?.error || 'Could not compare these versions.');
   const checked = parseBranchMergePreview(result.preview, connection.scope.ownerId, request);
   if (alive.current && !attempt.signal.aborted) { setPreview(checked); setChoices(selected); }
  } catch (failure: any) { if (alive.current && !attempt.signal.aborted) setError(failure?.error || failure?.message || 'Could not compare these versions. Reconnect and try again.'); }
  finally { if (controller.current === attempt) { working.current = false; if (alive.current) setBusy(false); } }
 };
 React.useEffect(() => {
  alive.current = true; void compare();
  return () => { alive.current = false; controller.current?.abort(); working.current = false; };
  // The wrapper remounts this review when its account, source or target changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);
 const apply = async () => {
  if (!preview || preview.conflicts.length || working.current) return;
  working.current = true; setBusy(true); setError('');
  try {
   proposal.current ??= createBranchMergeProposal(preview, crypto.randomUUID());
   const { event, command } = proposal.current;
   await connection.store.enqueue(event); eventSaved.current = true;
   await connection.branches.enqueue(command); commandSaved.current = true;
   if (!alive.current) return;
   setQueued(true); setNotice('Merge saved on this device. Waiting to sync to your account.');
   window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
   await connection.sync.pushPending();
   const pending = (await connection.branches.queued()).find(row => row.command.operationId === command.operationId);
   if (alive.current) {
    setNotice(pending ? 'Merge saved on this device. Its branch push is waiting to sync.' : `Merge saved to ${target.branch.name} in your account.`);
    window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
   }
  } catch (failure: any) {
   if (alive.current) { if (eventSaved.current && !commandSaved.current) setNotice('Your merged version is saved on this device. Retry saving to queue its branch push.'); setError(failure?.error || failure?.message || 'Could not finish this merge. Retry the same operation.'); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
  } finally { working.current = false; if (alive.current) setBusy(false); }
 };
 return <Box p={3} my={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg" role="region" aria-label="Review branch merge">
  <Heading size="sm" overflowWrap="anywhere">Merge into {target.branch.name}</Heading>
  <Text fontSize="sm" color="var(--tt-muted)" mt={2} mb={3}>Current is the branch version. The published Thing stays unchanged.</Text>
  <Text fontSize="sm" mb={3} overflowWrap="anywhere">Selected version: {incoming.label} · {new Date(incoming.occurredAt).toLocaleString()}</Text>
  {preview && !queued ? <TimelineVersionComparison {...preview} choices={choices} busy={busy || !!proposal.current} onChoose={(key, side) => setChoices(previous => ({ ...previous, [key]: side }))} /> : null}
  {notice ? <Text role="status" fontSize="sm" mb={3}>{notice}</Text> : null}
  {error ? <Text role="alert" fontSize="sm" mb={3} overflowWrap="anywhere">{error}</Text> : null}
  {queued ? <Text fontSize="xs" color="var(--tt-muted)" mb={3}>Your merged version is kept in History. If the branch changed before syncing, pull its latest version and compare again.</Text> : null}
  <Flex gap={2} wrap="wrap">
   {!queued ? <Button size="sm" isLoading={busy} isDisabled={preview?.conflicts.some(conflict => !choices[JSON.stringify(conflict.path)])} onClick={() => void (!preview ? compare() : preview.conflicts.length ? compare(choices) : apply())}>{!preview ? 'Retry comparison' : preview.conflicts.length ? 'Review choices' : proposal.current ? 'Retry saving merge' : 'Save merge to branch'}</Button> : null}
   <Button size="sm" variant="ghost" isDisabled={busy} onClick={onClose}>{queued || proposal.current ? 'Close' : 'Cancel'}</Button>
  </Flex>
 </Box>;
}
