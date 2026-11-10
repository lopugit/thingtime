import { activityInterval, clearActivityInterval, activityEvents } from '~/activity/activityManager';
import { Link } from 'react-router';
import type { LocalTimelineRow } from '../../timeline/localStore';
import { branchBuilderHref } from '../Builder/branchWebpageCore';
import React from 'react';
import { TimelineBranchEditor } from './TimelineBranchEditor';
import { TimelineBranchMerge } from './TimelineBranchMerge';
import { Box, Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import type { TimelineEvent } from '../../timeline/contract';
import type { QueuedBranchCommand } from '../../timeline/branchStore';
import type { TimelineBranchCommand, TimelineBranchEntry } from '../../timeline/branches';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';

/** Mounted by account/data-plane/Thing identity. Cache first; remote pulls
 * update branch pointers, never the user's open editor or published content. */
export function TimelineBranches({ thingId, selected, selectedStatus, onSelect }: { thingId: string; selected: TimelineEvent | null; selectedStatus?: LocalTimelineRow['status']; onSelect: (event: TimelineEvent) => void }) {
	const { connection, held } = useTimelineSession();
	const [editing, setEditing] = React.useState<TimelineBranchEntry | null>(null);
	const [merge, setMerge] = React.useState<{ target: TimelineBranchEntry; incoming: TimelineEvent } | null>(null);
	const [open, setOpen] = React.useState(false); const [name, setName] = React.useState('');
	const [branches, setBranches] = React.useState<TimelineBranchEntry[]>([]); const [queued, setQueued] = React.useState<QueuedBranchCommand[]>([]);
	const [nextBefore, setNextBefore] = React.useState<number | null>(null);
	const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState(''); const [busy, setBusy] = React.useState(false);
	const alive = React.useRef(true); const working = React.useRef(false);
	React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
	const cached = React.useCallback(async () => {
		if (!connection) return;
		const [entries, pending] = await Promise.all([connection.branches.forThing(thingId), connection.branches.queued()]);
		if (alive.current) { setBranches(entries.sort((a, b) => a.branch.name.localeCompare(b.branch.name))); setQueued(pending.filter(row => row.command.thingId === thingId)); }
	}, [connection, thingId]);
	const pull = React.useCallback(async (before?: number) => {
		if (!connection) return;
		try {
			await cached();
			if (!connection.verified) return;
			const page = await connection.sync.branchPage(thingId, before);
			await cached(); if (alive.current) { setNextBefore(page.nextBefore); setError(''); }
		} catch (failure: any) { if (alive.current) setError(failure?.error || failure?.message || 'Could not refresh branches. Cached versions are still available.'); }
	}, [connection, thingId, cached]);
	React.useEffect(() => {
		if (!open) return;
		void pull();
		const changed = () => { if (document.visibilityState !== 'hidden') return pull(); return cached().catch(() => {}); };
		activityEvents(window, 'events:components/Timeline/TimelineBranches', 'TimelineBranches').addEventListener(TIMELINE_CHANGED_EVENT, changed); activityEvents(window, 'events:components/Timeline/TimelineBranches', 'TimelineBranches').addEventListener('online', changed); activityEvents(window, 'events:components/Timeline/TimelineBranches', 'TimelineBranches').addEventListener('focus', changed);
		const timer = activityInterval('timer:components/Timeline/TimelineBranches:1', 'Timeline Branches', changed, 15_000);
		return () => { clearActivityInterval(timer); activityEvents(window, 'events:components/Timeline/TimelineBranches', 'TimelineBranches').removeEventListener(TIMELINE_CHANGED_EVENT, changed); activityEvents(window, 'events:components/Timeline/TimelineBranches', 'TimelineBranches').removeEventListener('online', changed); activityEvents(window, 'events:components/Timeline/TimelineBranches', 'TimelineBranches').removeEventListener('focus', changed); };
	}, [open, pull, cached]);
	const queue = async (command: TimelineBranchCommand) => {
		if (!connection || working.current) return;
		working.current = true; setBusy(true); setError(''); setNotice('');
		try {
			await connection.branches.enqueue(command);
			if (!alive.current) return;
			if (command.command === 'create-branch') setName('');
			await cached(); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			if (held) { setNotice('Saved on this device. Resume sync to save this branch command to your account.'); return; }
			if (!connection.verified) { setNotice('Saved on this device. This branch command will sync when you reconnect.'); return; }
			await connection.sync.pushPending();
			const remaining = (await connection.branches.queued()).find(row => row.command.operationId === command.operationId);
			if (alive.current) {
				setNotice(remaining ? (localOnly ? 'Branch command is on this device. Retry saving to complete it.' : 'Saved on this device. This branch command is waiting for the next sync.') : (localOnly ? 'Branch saved on this device. It will never be uploaded.' : 'Branch saved to your account.'));
				window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); await cached();
			}
		} catch (failure: any) { if (alive.current) { setError(failure?.error || failure?.message || 'The branch command is still on this device. Retry syncing to check its result.'); await cached(); } }
		finally { working.current = false; if (alive.current) setBusy(false); }
	};
	const view = async (entry: TimelineBranchEntry) => {
		if (!connection || working.current) return;
		working.current = true; setBusy(true); setError('');
		try {
			const local = (await connection.store.forThing(thingId)).find(row => row.event.id === entry.head.eventId);
			if (local && alive.current) onSelect(local.event);
			const result = await connection.sync.entry(entry.head.eventId);
			if (result.event.thingId !== thingId) throw new Error('This branch points to another Thing.');
			// The read cached the version and its notes; let open history views repaint them.
			window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			if (alive.current) onSelect(result.event);
		} catch (failure: any) { if (alive.current) setError(failure?.error || failure?.message || 'Could not load this version.'); }
		finally { working.current = false; if (alive.current) setBusy(false); }
	};
	const candidate = selected?.thingId === thingId && selected.after && selected.mode !== 'effect' ? selected : null;
	// Review and combine previews on the server with the selected version's id: a pending row under the hold would 404 there.
	const combineBlocked = held && selectedStatus === 'pending';
	return <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="xl" p={3}>
		<Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide variations' : 'Try a variation'}</Button>
		{open ? <Box mt={3}>
			<Text fontSize="sm" color="var(--tt-muted)" mb={3}>Variations are private branches. Select a version in History to start a variation or review and combine changes.</Text>
			<Flex gap={2} wrap="wrap" mb={3} align="center"><Button size="sm" variant="outline" onClick={() => void pull()}>Get latest changes</Button>{queued.some(row => !row.failure) ? <Button size="sm" isDisabled={busy || held} title={held ? 'Resume sync in Settings → History' : undefined} onClick={() => { void connection?.sync.pushPending().then(() => { window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }).catch((failure: any) => { if (alive.current) setError(failure?.error || failure?.message || 'Could not sync branches.'); }); }}>Retry sync</Button> : null}{held && queued.some(row => !row.failure) ? <Text fontSize="xs" color="var(--tt-muted)">Resume sync to upload waiting branch commands. <Button as={Link} to="/settings/history" size="xs" variant="link">Resume sync</Button></Text> : null}</Flex>
			{branches.map(entry => <Flex key={entry.head.id} gap={2} align="center" wrap="wrap" mb={2} p={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg">
				<Box flex={{ base: '1 0 100%', md: '1' }} minW={0}><Text fontWeight="600" overflowWrap="anywhere">{entry.branch.name}</Text><Text fontSize="xs" color="var(--tt-muted)">{queued.some(row => row.command.branchId === entry.branch.id && row.failure) ? 'Needs review' : queued.some(row => row.command.branchId === entry.branch.id) ? (localOnly ? 'Waiting to save' : 'Waiting to sync') : (localOnly ? 'Saved on this device' : 'Saved to your account')}</Text></Box>
				<Button size="sm" variant="outline" isDisabled={busy} onClick={() => void view(entry)}>View version</Button>
				{connection ? <Button as={Link} reloadDocument size="sm" variant="outline" to={branchBuilderHref(entry.branch.id, thingId, connection.scope.ownerId, connection.scope.dataPlane)}>Open in Builder</Button> : null}
				<Button size="sm" variant="outline" isDisabled={busy || !!editing || !!merge || queued.some(row => row.command.branchId === entry.branch.id)} onClick={() => setEditing(entry)}>Edit variation</Button>
				<Button size="sm" variant="ghost" isDisabled={busy || !!editing || !candidate || candidate.id === entry.head.eventId || queued.some(row => row.command.branchId === entry.branch.id)} onClick={() => candidate && void queue({ command: 'advance-branch', operationId: crypto.randomUUID(), branchId: entry.branch.id, thingId, eventId: candidate.id, expectedRevision: entry.head.revision, name: null })}>Send selected version</Button>
				<Button size="sm" variant="outline" isDisabled={busy || !!editing || !candidate || combineBlocked || candidate.id === entry.head.eventId || queued.some(row => row.command.branchId === entry.branch.id)} title={combineBlocked ? 'Resume sync to review and combine' : undefined} onClick={() => candidate && setMerge({ target: entry, incoming: candidate })}>Review and combine…</Button>
			</Flex>)}
			{editing ? <TimelineBranchEditor target={editing} onClose={() => setEditing(null)} /> : null}
			{merge ? <TimelineBranchMerge target={merge.target} incoming={merge.incoming} incomingPending={selected?.id === merge.incoming.id && selectedStatus === 'pending'} onClose={() => setMerge(null)} /> : null}
			{combineBlocked && candidate ? <Text fontSize="xs" color="var(--tt-muted)" mb={2}>Resume sync to review and combine</Text> : null}
			{nextBefore !== null ? <Button size="sm" variant="ghost" onClick={() => void pull(nextBefore)}>Load more variations</Button> : null}
			{queued.map(({ command, failure }) => <Box key={command.operationId} p={3} mb={2} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg"><Text fontSize="sm" role="status">{command.name || branches.find(entry => entry.branch.id === command.branchId)?.branch.name || 'Branch push'} · {failure ? 'needs attention' : (localOnly ? 'on this device, waiting to save' : 'saved on this device, waiting to sync')}</Text>{failure ? <><Text fontSize="sm" mt={2}>{failure.message}</Text><Text fontSize="xs" color="var(--tt-muted)" mt={1}>Your selected version remains in History.</Text><Flex gap={2} wrap="wrap" mt={2}><Button size="sm" variant="outline" onClick={() => { void connection?.branches.retryRejected(command.operationId).then(() => { window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }).catch((error: any) => { if (alive.current) setError(error?.message); }); }}>Retry command</Button><Button size="sm" variant="ghost" onClick={() => { void connection?.branches.dismissRejected(command.operationId).then(cached).catch((error: any) => { if (alive.current) setError(error?.message); }); }}>Keep version, cancel push</Button></Flex></> : null}</Box>)}
			<FormControl mt={3}><FormLabel fontSize="sm">New variation from {candidate ? 'the selected version' : 'a version in History'}</FormLabel><Flex gap={2} wrap="wrap"><Input aria-label="Variation name" placeholder="e.g. New layout" size="sm" maxLength={80} flex="1" minW="160px" value={name} onChange={event => setName(event.target.value)} /><Button size="sm" isLoading={busy} isDisabled={!connection || !candidate || !name.trim()} onClick={() => candidate && void queue({ command: 'create-branch', operationId: crypto.randomUUID(), branchId: `branch-${crypto.randomUUID()}`, thingId, eventId: candidate.id, expectedRevision: 0, name: name.trim() })}>Create variation</Button></Flex></FormControl>
			{!candidate ? <Text fontSize="xs" color="var(--tt-muted)" mt={2}>Select a change below to choose its version.</Text> : null}
			{notice ? <Text role="status" fontSize="sm" mt={3}>{notice}</Text> : null}
			{error ? <Text role="alert" fontSize="sm" mt={3} overflowWrap="anywhere">{error}</Text> : null}
		</Box> : null}
	</Box>;
}
