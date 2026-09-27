import React from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import type { TimelineEvent, TimelineSnapshot } from '../../timeline/contract';
import type { VersionChoices, VersionConflict, VersionValue } from '../../timeline/versions';
import { timelineChanges, timelineChangeLabel, timelineValueLabel } from '../../timeline/changes';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';

type Preview = { mode: 'restore' | 'merge'; expectedHeadId: string; current: TimelineSnapshot; result: TimelineSnapshot; conflicts: VersionConflict[] };
const label = (value: VersionValue) => timelineValueLabel(value.present ? { exists: true, value: value.value } : { exists: false });
const data = (value: VersionValue) => {
 const text = value.present ? JSON.stringify(value.value, null, 2) : 'Not set';
 return text.length > 24_000 ? `${text.slice(0, 24_000)}\n… Display shortened.` : text;
};

/** Mounted by scope/event identity: a late reply cannot land in another
 * account or comparison. The apply command survives retries unchanged. */
export function TimelineVersionActions({ event, onApplied }: { event: TimelineEvent; onApplied: () => void }) {
 const { connection } = useTimelineSession(); const api = useApi();
 const [preview, setPreview] = React.useState<Preview | null>(null);
 const [choices, setChoices] = React.useState<VersionChoices>({});
 const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(''); const [saved, setSaved] = React.useState(false);
 const alive = React.useRef(true); const request = React.useRef<any>(null); const pending = React.useRef(false);
 React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 const compare = async (mode: Preview['mode'], selected: VersionChoices = {}) => {
  if (!connection || pending.current) return;
  pending.current = true; setBusy(true); setError(''); request.current = null;
  try {
   await connection.sync.pushPending();
   const result = await api.v1.timeline.version(connection.scope, { command: 'preview-version', mode, eventId: event.id, choices: selected });
   if (result?.ok === false || !result?.preview) throw new Error(result?.error || 'Could not compare this version.');
   if (alive.current) { setPreview(result.preview); setChoices(selected); }
  } catch (failure: any) { if (alive.current) setError(failure?.error || failure?.message || 'Could not compare this version.'); }
  finally { pending.current = false; if (alive.current) setBusy(false); }
 };
 const apply = async () => {
  if (!connection || !preview || pending.current || preview.conflicts.length) return;
  pending.current = true; setBusy(true); setError('');
  request.current ??= { command: 'apply-version', mode: preview.mode, eventId: event.id, expectedHeadId: preview.expectedHeadId, operationId: crypto.randomUUID(), choices };
  try {
   const result = await api.v1.timeline.version(connection.scope, request.current);
   if (result?.ok === false || !result?.entry) throw new Error(result?.error || 'Could not apply this version.');
   await connection.store.accept([result.entry]);
   if (alive.current) { setSaved(true); setPreview(null); onApplied(); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); window.dispatchEvent(new Event('thingtime:root-data-refresh')); window.dispatchEvent(new CustomEvent('thingtime:timeline-applied', { detail: { thingId: event.thingId } })); }
  } catch (failure: any) { if (alive.current) setError(failure?.error || failure?.message || 'The result is uncertain. Retry to check this same operation.'); }
  finally { pending.current = false; if (alive.current) setBusy(false); }
 };
 const changes = React.useMemo(() => preview ? timelineChanges(preview.current, preview.result) : [], [preview]);
 if (!event.after || event.mode === 'effect' || !['thing-content', 'webpage-draft', 'definition-source', 'folder-placement'].includes(event.after.adapter)) return null;
 return <Box mt={4} borderTopWidth="1px" borderColor="var(--tt-border)" pt={4}>
  {saved ? <Text role="status" fontSize="sm">Version saved. The previous versions are still in your Timeline.</Text> : preview ? <>
   <Heading size="sm" mb={2}>{preview.mode === 'merge' ? 'Review merge' : 'Review restore'}</Heading>
   <Text fontSize="sm" color="var(--tt-muted)" mb={3}>This creates a new saved version. Your later history stays available.</Text>
   {preview.conflicts.map(conflict => { const key = JSON.stringify(conflict.path); return <Box key={key} p={3} mb={3} borderWidth="1px" borderRadius="lg" borderColor="var(--tt-border)">
    <Text fontWeight="600" overflowWrap="anywhere">Both versions changed {timelineChangeLabel(conflict.path)}</Text>
    <Text fontSize="sm" mt={2} overflowWrap="anywhere" noOfLines={4}>Current: {label(conflict.current)}</Text>
    <Text fontSize="sm" mt={1} overflowWrap="anywhere" noOfLines={4}>This version: {label(conflict.incoming)}</Text>
    <Box as="details" mt={2}><Box as="summary" fontSize="sm" cursor="pointer">Compare data</Box>{([['Current', conflict.current], ['This version', conflict.incoming]] as const).map(([title, value]) => <Box key={title} mt={2}><Text fontSize="sm" fontWeight="600">{title}</Text><Box as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="xs" maxH="240px" overflow="auto">{data(value)}</Box></Box>)}</Box>
    <Flex gap={2} wrap="wrap" mt={2}>{(['current', 'incoming'] as const).map(side => <Button key={side} size="sm" variant={choices[key] === side ? 'solid' : 'outline'} aria-pressed={choices[key] === side} isDisabled={busy} onClick={() => setChoices(previous => ({ ...previous, [key]: side }))}>{side === 'current' ? 'Keep current' : 'Use this version'}</Button>)}</Flex>
   </Box>; })}
   {!preview.conflicts.length && !changes.length ? <Text fontSize="sm" mb={3}>The content already matches. Applying records the version relationship.</Text> : null}
   {changes.map((change, index) => <Box key={index} mb={3}><Text fontWeight="600" fontSize="sm" overflowWrap="anywhere">{timelineChangeLabel(change.path)}</Text><Text fontSize="sm" color="var(--tt-muted)" overflowWrap="anywhere" noOfLines={3}>Current: {timelineValueLabel(change.before, change.path)}</Text><Text fontSize="sm" overflowWrap="anywhere" noOfLines={3}>Result: {timelineValueLabel(change.after, change.path)}</Text></Box>)}
   <Flex gap={2} wrap="wrap"><Button size="sm" isLoading={busy} isDisabled={preview.conflicts.some(conflict => !choices[JSON.stringify(conflict.path)])} onClick={() => void (preview.conflicts.length ? compare(preview.mode, choices) : apply())}>{preview.conflicts.length ? 'Review choices' : preview.mode === 'merge' ? 'Apply merge' : 'Restore this version'}</Button><Button size="sm" variant="ghost" isDisabled={busy} onClick={() => { setPreview(null); setChoices({}); setError(''); request.current = null; }}>Cancel</Button></Flex>
  </> : <Flex gap={2} wrap="wrap"><Button size="sm" variant="outline" isLoading={busy} onClick={() => void compare('restore')}>Restore…</Button><Button size="sm" variant="ghost" isDisabled={busy} onClick={() => void compare('merge')}>Merge into current…</Button></Flex>}
  {error ? <Text role="alert" fontSize="sm" mt={3} overflowWrap="anywhere">{error}</Text> : null}
 </Box>;
}
