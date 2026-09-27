import React from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useApi } from '../../hooks/useApi';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import type { TimelineEvent, TimelineSnapshot } from '../../timeline/contract';
import type { VersionChoices, VersionConflict } from '../../timeline/versions';
import { TimelineVersionComparison } from './TimelineVersionComparison';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';

type Preview = { mode: 'restore' | 'merge'; expectedHeadId: string; current: TimelineSnapshot; result: TimelineSnapshot; conflicts: VersionConflict[] };
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
 if (!event.after || event.mode === 'effect' || !['thing-content', 'webpage-draft', 'definition-source', 'folder-placement'].includes(event.after.adapter)) return null;
 return <Box mt={4} borderTopWidth="1px" borderColor="var(--tt-border)" pt={4}>
  {saved ? <Text role="status" fontSize="sm">Version saved. The previous versions are still in your Timeline.</Text> : preview ? <>
   <Heading size="sm" mb={2}>{preview.mode === 'merge' ? 'Review merge' : 'Review restore'}</Heading>
   <Text fontSize="sm" color="var(--tt-muted)" mb={3}>This creates a new saved version. Your later history stays available.</Text>
   <TimelineVersionComparison {...preview} choices={choices} busy={busy} onChoose={(key, side) => setChoices(previous => ({ ...previous, [key]: side }))} />
   <Flex gap={2} wrap="wrap"><Button size="sm" isLoading={busy} isDisabled={preview.conflicts.some(conflict => !choices[JSON.stringify(conflict.path)])} onClick={() => void (preview.conflicts.length ? compare(preview.mode, choices) : apply())}>{preview.conflicts.length ? 'Review choices' : preview.mode === 'merge' ? 'Apply merge' : 'Restore this version'}</Button><Button size="sm" variant="ghost" isDisabled={busy} onClick={() => { setPreview(null); setChoices({}); setError(''); request.current = null; }}>Cancel</Button></Flex>
  </> : <Flex gap={2} wrap="wrap"><Button size="sm" variant="outline" isLoading={busy} onClick={() => void compare('restore')}>Restore…</Button><Button size="sm" variant="ghost" isDisabled={busy} onClick={() => void compare('merge')}>Merge into current…</Button></Flex>}
  {error ? <Text role="alert" fontSize="sm" mt={3} overflowWrap="anywhere">{error}</Text> : null}
 </Box>;
}
