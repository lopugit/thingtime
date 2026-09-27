import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../../timeline/snapshotParts';
import React from 'react';
import { TimelineBranches } from './TimelineBranches';
import { Box, Button, Flex, Heading, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useThingTimeline } from '../../timeline/useThingTimeline';
import type { TimelineEvent, TimelineSnapshot } from '../../timeline/contract';
import { timelineChanges, timelineChangeLabel, timelineValueLabel } from '../../timeline/changes';
import { TimelineVersionActions } from './TimelineVersionActions';

const OPEN_HISTORY = 'thingtime:open-history';
export function openThingHistory(thingId: string) {
	window.dispatchEvent(new CustomEvent(OPEN_HISTORY, { detail: { thingId } }));
}

const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const preview = (snapshot: TimelineSnapshot | null) => {
	if (!snapshot) return 'This Thing does not exist at this point.';
	if (snapshot.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER) return 'The complete data for this large version is retained in your account. Full preview is not available here yet.';
	const text = JSON.stringify(snapshot.value, null, 2);
	return text.length > 16_000 ? `${text.slice(0, 16_000)}\n… Preview shortened for display.` : text;
};
const sourceLabel = (event: TimelineEvent) => ({ client: 'Editor', api: 'API', ai: 'Lopu', action: 'Action', system: 'Thingtime' }[event.source]);
const thingTitle = (event: TimelineEvent) => {
	const value = (event.after?.value ?? event.before?.value) as any;
	const title = value?.crystal?.title || value?.crystal?.name;
	return typeof title === 'string' && title.trim() ? title : 'Thing';
};

function TimelinePanel({ thingId, folderId }: { thingId: string | null; folderId?: string }) {
	const timeline = useThingTimeline(thingId);
	const navigate = useNavigate();
	const [selection, setSelection] = React.useState<{ identity: string; event: TimelineEvent } | null>(null);
	const selected = selection?.identity === timeline.identity ? selection.event : null;
	const setSelected = (event: TimelineEvent | null) => setSelection(event ? { identity: timeline.identity, event } : null);
	const [showDrafts, setShowDrafts] = React.useState(true);
	const [showData, setShowData] = React.useState(false);
	const largeVersion = selected?.before?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER || selected?.after?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER;
	const changes = React.useMemo(() => selected && !largeVersion ? timelineChanges(selected.before, selected.after) : [], [selected, largeVersion]);
	const events = timeline.rows.filter(row => showDrafts || row.event.mode !== 'draft');
	const pending = timeline.rows.filter(row => row.status === 'pending').length;
	if (!timeline.signedIn) return <Text>Sign in to see your Timeline.</Text>;
	if (folderId && timeline.folderId && timeline.folderId !== folderId) return <Text>This Timeline is not available in the current account or data source.</Text>;
	return <Flex direction="column" gap={4} minW={0}>
		<Flex gap={2} wrap="wrap" align="center">
			<Text flex="1" fontSize="sm" color="var(--tt-muted)">{pending ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to sync` : timeline.error ? 'Could not refresh history' : timeline.ready ? 'Saved to your account' : 'Opening history…'}</Text>
			<Button size="sm" variant="ghost" onClick={() => setShowDrafts(value => !value)} aria-pressed={showDrafts}>{showDrafts ? 'Hide drafts' : 'Show drafts'}</Button>
			<Button size="sm" variant="outline" onClick={() => void timeline.refresh()}>Refresh</Button>
			{thingId && timeline.folderId ? <Button size="sm" variant="ghost" onClick={() => navigate(`/things?folder=${encodeURIComponent(timeline.folderId!)}`)}>Open Timeline</Button> : null}
		</Flex>
		{timeline.error ? <Text role="status" fontSize="sm" color="var(--tt-muted)">{timeline.error} {timeline.rows.length ? 'Your cached changes are still here.' : ''}</Text> : null}
		{thingId ? <TimelineBranches key={timeline.identity} thingId={thingId} selected={selected} onSelect={setSelected} /> : null}
		{timeline.ready && !events.length ? <Box p={6} borderWidth="1px" borderRadius="xl" borderColor="var(--tt-border)"><Heading size="sm">No recorded changes yet</Heading><Text mt={2} color="var(--tt-muted)">Changes recorded from now on appear here. Older activity cannot be reconstructed automatically.</Text></Box> : null}
		<Flex direction={{ base: 'column', md: selected ? 'row' : 'column' }} gap={4} minW={0} align="stretch">
			<Flex direction="column" gap={2} flex={selected ? '0 0 38%' : '1'} minW={0} aria-label="History events">
				{events.map(({ event, receipt, status }) => <Box as="button" type="button" key={event.id} textAlign="left" p={3} borderWidth="1px" borderRadius="xl" borderColor={selected?.id === event.id ? 'var(--tt-accent)' : 'var(--tt-border)'} bg={selected?.id === event.id ? 'var(--tt-surface)' : 'transparent'} onClick={() => setSelected(event)} aria-pressed={selected?.id === event.id}>
					<Flex gap={2} wrap="wrap" align="baseline"><Text fontWeight="600" overflowWrap="anywhere">{event.label}</Text><Text fontSize="xs" color="var(--tt-muted)">{event.mode === 'draft' ? 'Draft' : event.mode === 'effect' ? 'Activity' : 'Saved version'}</Text></Flex>
					<Text fontSize="xs" color="var(--tt-muted)" mt={1}>{date(receipt?.acceptedAt ?? event.occurredAt)} · {sourceLabel(event)}{status === 'pending' ? ' · On this device' : ''}</Text>
					{thingId === null ? <Text fontSize="sm" mt={1} noOfLines={1}>{thingTitle(event)}</Text> : null}
				</Box>)}
				{timeline.nextBefore !== null ? <Button flexShrink={0} variant="outline" onClick={() => void timeline.older()}>Load older changes</Button> : null}
			</Flex>
			{selected ? <Box flex="1" minW={0} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="xl" p={4}>
				<Flex justify="space-between" align="center" gap={2} mb={3}><Heading size="sm">{selected.label}</Heading><Button size="xs" variant="ghost" onClick={() => setSelected(null)}>Close preview</Button></Flex>
				<Text fontSize="xs" color="var(--tt-muted)" mb={4}>{selected.branchId} · {date(selected.occurredAt)}</Text>
				{largeVersion ? <Text fontSize="sm" mb={3}>The complete data for this large version is retained in your account. Full preview is not available here yet.</Text> : null}
				{changes.map((change, index) => <Box key={index} mb={3} p={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg">
					<Text fontWeight="600" mb={2} overflowWrap="anywhere">{timelineChangeLabel(change.path)}</Text>
					<Text fontSize="sm" color="var(--tt-muted)" noOfLines={4} overflowWrap="anywhere">Before: {timelineValueLabel(change.before, change.path)}</Text>
					<Text fontSize="sm" mt={1} noOfLines={4} overflowWrap="anywhere">After: {timelineValueLabel(change.after, change.path)}</Text>
				</Box>)}
				<Button size="sm" variant="ghost" mb={3} onClick={() => setShowData(value => !value)} aria-expanded={showData}>{showData ? 'Hide data' : 'View data'}</Button>
				{showData ? (['before', 'after'] as const).map(side => <Box key={side} mb={4}><Text fontWeight="600" fontSize="sm" mb={2}>{side === 'before' ? 'Before' : 'After'}</Text><Box as="pre" fontSize="xs" whiteSpace="pre-wrap" overflowWrap="anywhere" maxH="280px" overflow="auto" p={3} borderRadius="md" bg="var(--tt-surface)">{preview(selected[side])}</Box></Box>) : null}
				<Button size="sm" variant="outline" onClick={() => navigate(`/thing/${encodeURIComponent(selected.thingId)}`)}>Open Thing</Button>
				<TimelineVersionActions key={`${timeline.identity}:${selected.id}`} event={selected} onApplied={() => void timeline.refresh()} />
			</Box> : null}
		</Flex>
	</Flex>;
}

export function TimelineLibrary({ folderId }: { folderId: string }) {
	const navigate = useNavigate();
	const user = useCurrentUser();
	return <PageShell width={1100} columnProps={{ pt: 4 }}>
		<Button alignSelf="flex-start" variant="ghost" size="sm" onClick={() => navigate('/things')}>← Things</Button>
		<PageHeader eyebrow="Thingtime · Things" title="Timeline" variant="ink" subtitle="Your changes across Thingtime, saved in one place." />
		<TimelinePanel key={`${user?.id}:${folderId}`} thingId={null} folderId={folderId} />
	</PageShell>;
}

export function TimelineHost() {
	const [thingId, setThingId] = React.useState<string | null>(null);
	const user = useCurrentUser();
	React.useEffect(() => {
		const open = (event: Event) => {
			const id = (event as CustomEvent).detail?.thingId;
			if (typeof id === 'string' && id.length > 0 && id.length <= 200) setThingId(id);
		};
		window.addEventListener(OPEN_HISTORY, open);
		return () => window.removeEventListener(OPEN_HISTORY, open);
	}, []);
	return <Modal isOpen={thingId !== null} onClose={() => setThingId(null)} size="5xl" scrollBehavior="inside" isCentered>
		<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} /><ModalContent maxW="min(1100px, calc(100vw - 24px))" maxH="calc(100dvh - 24px)" containerProps={{ zIndex: DRAWER_MODAL_Z }}>
			<ModalHeader>History</ModalHeader><ModalCloseButton /><ModalBody pb={6} minW={0}>{thingId ? <TimelinePanel key={`${user?.id}:${thingId}`} thingId={thingId} /> : null}</ModalBody>
		</ModalContent>
	</Modal>;
}
