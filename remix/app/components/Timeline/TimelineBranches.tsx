import React from 'react';
import { TimelineBranchMerge } from './TimelineBranchMerge';
import { Box, Button, Flex, FormControl, FormLabel, Input, Text } from '@chakra-ui/react';
import { useTimelineSession } from '../../timeline/TimelineProvider';
import type { TimelineEvent } from '../../timeline/contract';
import type { QueuedBranchCommand } from '../../timeline/branchStore';
import type { TimelineBranchCommand, TimelineBranchEntry } from '../../timeline/branches';
import { TIMELINE_CHANGED_EVENT } from '../../timeline/clientEvents';

/** Mounted by account/data-plane/Thing identity. Cache first; remote pulls
 * update branch pointers, never the user's open editor or published content. */
export function TimelineBranches({ thingId, selected, onSelect }: { thingId: string; selected: TimelineEvent | null; onSelect: (event: TimelineEvent) => void }) {
	const { connection } = useTimelineSession();
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
		const changed = () => { if (document.visibilityState !== 'hidden') void pull(); else void cached().catch(() => {}); };
		window.addEventListener(TIMELINE_CHANGED_EVENT, changed); window.addEventListener('online', changed); window.addEventListener('focus', changed);
		const timer = setInterval(changed, 15_000);
		return () => { clearInterval(timer); window.removeEventListener(TIMELINE_CHANGED_EVENT, changed); window.removeEventListener('online', changed); window.removeEventListener('focus', changed); };
	}, [open, pull, cached]);
	const queue = async (command: TimelineBranchCommand) => {
		if (!connection || working.current) return;
		working.current = true; setBusy(true); setError(''); setNotice('');
		try {
			await connection.branches.enqueue(command);
			if (!alive.current) return;
			if (command.command === 'create-branch') setName('');
			await cached(); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			if (!connection.verified) { setNotice('Saved on this device. This branch command will sync when you reconnect.'); return; }
			await connection.sync.pushPending();
			const remaining = (await connection.branches.queued()).find(row => row.command.operationId === command.operationId);
			if (alive.current) {
				setNotice(remaining ? 'Saved on this device. This branch command is waiting for the next sync.' : 'Branch saved to your account.');
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
			if (alive.current) onSelect(result.event);
		} catch (failure: any) { if (alive.current) setError(failure?.error || failure?.message || 'Could not load this version.'); }
		finally { working.current = false; if (alive.current) setBusy(false); }
	};
	const candidate = selected?.after && selected.mode !== 'effect' ? selected : null;
	return <Box borderWidth="1px" borderColor="var(--tt-border)" borderRadius="xl" p={3}>
		<Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide branches' : 'Branches'}</Button>
		{open ? <Box mt={3}>
			<Text fontSize="sm" color="var(--tt-muted)" mb={3}>Keep alternate versions here. Select a change in History, then review a merge into a branch. Published content stays unchanged.</Text>
			<Flex gap={2} wrap="wrap" mb={3}><Button size="sm" variant="outline" onClick={() => void pull()}>Pull updates</Button>{queued.some(row => !row.failure) ? <Button size="sm" isDisabled={busy} onClick={() => { void connection?.sync.pushPending().then(() => { window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }).catch((failure: any) => { if (alive.current) setError(failure?.error || failure?.message || 'Could not sync branches.'); }); }}>Retry sync</Button> : null}</Flex>
			{branches.map(entry => <Flex key={entry.head.id} gap={2} align="center" wrap="wrap" mb={2} p={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg">
				<Box flex="1" minW={0}><Text fontWeight="600" overflowWrap="anywhere">{entry.branch.name}</Text><Text fontSize="xs" color="var(--tt-muted)">{queued.some(row => row.command.branchId === entry.branch.id && row.failure) ? 'Needs attention' : queued.some(row => row.command.branchId === entry.branch.id) ? 'Waiting to sync' : 'Saved to your account'}</Text></Box>
				<Button size="sm" variant="outline" isDisabled={busy} onClick={() => void view(entry)}>View version</Button>
				<Button size="sm" variant="ghost" isDisabled={busy || !candidate || candidate.id === entry.head.eventId || queued.some(row => row.command.branchId === entry.branch.id)} onClick={() => candidate && void queue({ command: 'advance-branch', operationId: crypto.randomUUID(), branchId: entry.branch.id, thingId, eventId: candidate.id, expectedRevision: entry.head.revision, name: null })}>Push selected version</Button>
				<Button size="sm" variant="outline" isDisabled={busy || !candidate || candidate.id === entry.head.eventId || queued.some(row => row.command.branchId === entry.branch.id)} onClick={() => candidate && setMerge({ target: entry, incoming: candidate })}>Merge selected version…</Button>
			</Flex>)}
			{merge ? <TimelineBranchMerge target={merge.target} incoming={merge.incoming} onClose={() => setMerge(null)} /> : null}
			{nextBefore !== null ? <Button size="sm" variant="ghost" onClick={() => void pull(nextBefore)}>Load more branches</Button> : null}
			{queued.map(({ command, failure }) => <Box key={command.operationId} p={3} mb={2} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg"><Text fontSize="sm" role="status">{command.name || branches.find(entry => entry.branch.id === command.branchId)?.branch.name || 'Branch push'} · {failure ? 'needs attention' : 'saved on this device, waiting to sync'}</Text>{failure ? <><Text fontSize="sm" mt={2}>{failure.message}</Text><Text fontSize="xs" color="var(--tt-muted)" mt={1}>Your selected version remains in History.</Text><Flex gap={2} wrap="wrap" mt={2}><Button size="sm" variant="outline" onClick={() => { void connection?.branches.retryRejected(command.operationId).then(() => { window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }).catch((error: any) => { if (alive.current) setError(error?.message); }); }}>Retry command</Button><Button size="sm" variant="ghost" onClick={() => { void connection?.branches.dismissRejected(command.operationId).then(cached).catch((error: any) => { if (alive.current) setError(error?.message); }); }}>Keep version, cancel push</Button></Flex></> : null}</Box>)}
			<FormControl mt={3}><FormLabel fontSize="sm">New branch from {candidate ? 'the selected version' : 'a version in History'}</FormLabel><Flex gap={2} wrap="wrap"><Input aria-label="Branch name" placeholder="e.g. New layout" size="sm" maxLength={80} flex="1" minW="160px" value={name} onChange={event => setName(event.target.value)} /><Button size="sm" isLoading={busy} isDisabled={!connection || !candidate || !name.trim()} onClick={() => candidate && void queue({ command: 'create-branch', operationId: crypto.randomUUID(), branchId: `branch-${crypto.randomUUID()}`, thingId, eventId: candidate.id, expectedRevision: 0, name: name.trim() })}>Create branch</Button></Flex></FormControl>
			{!candidate ? <Text fontSize="xs" color="var(--tt-muted)" mt={2}>Select a change below to choose its version.</Text> : null}
			{notice ? <Text role="status" fontSize="sm" mt={3}>{notice}</Text> : null}
			{error ? <Text role="alert" fontSize="sm" mt={3} overflowWrap="anywhere">{error}</Text> : null}
		</Box> : null}
	</Box>;
}
