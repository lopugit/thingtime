import { TimelineEventBrowser } from './TimelineEventBrowser';
import { readHistoryFilters, writeHistoryFilters, historyComparison, type HistoryFilters } from '../../timeline/browserModel';
import { COMPONENT_BINDING_PREFIX } from '../../timeline/componentBindings';
import { TimelinePagePreview } from './TimelinePagePreview';
import { historyStorageForThing, timelineFolderHref, type TimelineStorage } from '../../timeline/storageScope';
import { TimelineStorageProvider, useTimelineSession, useSelectedTimelineSession } from '../../timeline/TimelineProvider';
import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../../timeline/snapshotParts';
import React from 'react';
import { useMediaQuery } from '@chakra-ui/react';
import { TimelineBranches } from './TimelineBranches';
import { Box, Button, Flex, Heading, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useThingTimeline } from '../../timeline/useThingTimeline';
import type { TimelineEvent, TimelineSnapshot } from '../../timeline/contract';
import { timelineDisplayChanges, timelineChangeLabel, timelineValueLabel } from '../../timeline/changes';
import { TimelineVersionActions } from './TimelineVersionActions';
import { useApi } from '../../hooks/useApi';
import { useDataPlane } from '../../hooks/useDataPlane';
import { thingHistoryHref } from '../../utils/dataPlane';
import { apiErrorMessage } from '../../hooks/apiFailure';

const OPEN_HISTORY = 'thingtime:open-history';
export function openThingHistory(thingId: string, thingtime?: readonly string[]) {
	window.dispatchEvent(new CustomEvent(OPEN_HISTORY, { detail: { thingId, storage: historyStorageForThing(thingtime) } }));
}

const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const preview = (snapshot: TimelineSnapshot | null) => {
	if (!snapshot) return 'This Thing does not exist at this point.';
	if (snapshot.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER)
		return 'The complete data for this large version is retained in your account. Full preview is not available here yet.';
	const text = JSON.stringify(snapshot.value, null, 2);
	return text.length > 16_000 ? `${text.slice(0, 16_000)}\n… Preview shortened for display.` : text;
};
const sourceLabel = (event: TimelineEvent) => ({ client: 'Editor', api: 'API', ai: 'Lopu', action: 'Action', system: 'Thingtime' }[event.source]);

function TimelinePanel({ thingId, folderId, urlState = false }: { thingId: string | null; folderId?: string; urlState?: boolean }) {
	const [params, setParams] = useSearchParams();
	const [filters, setFilters] = React.useState(() => readHistoryFilters(urlState ? params : new URLSearchParams(), thingId ?? ''));
	React.useEffect(() => {
		setFilters(readHistoryFilters(urlState ? params : new URLSearchParams(), thingId ?? ''));
	}, [urlState, params, thingId]);
	const changeFilters = (next: HistoryFilters) => {
		// Controls and cached history respond before route revalidation finishes.
		setFilters(next);
		if (urlState) setParams(writeHistoryFilters(params, next), { replace: true, preventScrollReset: true });
	};
	const timeline = useThingTimeline(filters.thingId || null);
	const session = useTimelineSession();
	const dataPlane = useDataPlane();
	const api = useApi();
	const homeHistory = session.connection?.scope.dataPlane === 'home';
	const differentSource = homeHistory && dataPlane !== 'home';
	const navigate = useNavigate();
	const [opening, setOpening] = React.useState(false);
	const [openError, setOpenError] = React.useState('');
	const [selection, setSelection] = React.useState<{ identity: string; event: TimelineEvent } | null>(null);
	const selected = selection?.identity === timeline.identity ? selection.event : null;
	const setSelected = (event: TimelineEvent | null) => setSelection(event ? { identity: timeline.identity, event } : null);
	const [comparison, setComparison] = React.useState<{ identity: string; event: TimelineEvent } | null>(null);
	const compareFrom = comparison?.identity === timeline.identity ? comparison.event : null;
	const comparisonResult = React.useMemo(() => (selected && compareFrom ? historyComparison(compareFrom, selected) : null), [selected, compareFrom]);
	const [showData, setShowData] = React.useState(false);
	const largeVersion = selected?.before?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER || selected?.after?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER;
	const changes = React.useMemo(
		() => (selected && !largeVersion ? timelineDisplayChanges(selected.before, selected.after) : []),
		[selected, largeVersion]
	);

	const pending = timeline.rows.filter((row) => row.status === 'pending').length;
	const detail = selected ? (
		<Box flex="1" minW={0} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="xl" p={4}>
			<Flex justify="space-between" align="center" gap={2} mb={3} flexWrap="wrap">
				<Heading size="sm" minW={0} overflowWrap="anywhere">
					{selected.label}
				</Heading>
				<Button size="xs" flexShrink={0} variant="ghost" onClick={() => setSelected(null)}>
					Close preview
				</Button>
			</Flex>
			<Text fontSize="xs" color="var(--tt-muted)" mb={4}>
				{selected.branchId === 'main' ? 'Saved version' : 'Private variation'} · {date(selected.occurredAt)} · {sourceLabel(selected)}
			</Text>
			<Text fontSize="xs" color="var(--tt-muted)" mb={3}>
				{selected.parentIds.length
					? `${selected.parentIds.length === 2 ? 'Combined from' : 'Continues from'} ${selected.parentIds.map((id) => id.slice(0, 12)).join(' + ')}`
					: 'First recorded moment'}{' '}
				· {selected.mode === 'draft' ? 'Private draft' : selected.operation}
			</Text>
			{largeVersion ? (
				<Text fontSize="sm" mb={3}>
					The complete data for this large version is retained in your account. Full preview is not available here yet.
				</Text>
			) : null}
			<Flex gap={2} wrap="wrap" mb={3}>
				<Button size="sm" variant="outline" onClick={() => setComparison({ identity: timeline.identity, event: selected })}>
					Compare from this version
				</Button>
				{compareFrom ? (
					<Button size="sm" variant="ghost" onClick={() => setComparison(null)}>
						Clear comparison
					</Button>
				) : null}
			</Flex>
			{compareFrom ? (
				<Box p={3} mb={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg">
					<Text fontWeight="600" fontSize="sm">
						Read-only comparison
					</Text>
					<Text fontSize="xs" color="var(--tt-muted)" mb={2}>
						From {compareFrom.label} · {date(compareFrom.occurredAt)}. Select another version of this Thing, including a variation.
					</Text>
					{compareFrom.id === selected.id ? (
						<Text fontSize="sm">Choose the second version in History.</Text>
					) : comparisonResult?.error ? (
						<Text role="status" fontSize="sm">
							{comparisonResult.error}
						</Text>
					) : (
						<>
							<Text fontSize="sm" mb={2}>
								{comparisonResult?.changes.length ?? 0} changed content properties
							</Text>
							{comparisonResult?.dependenciesChanged ? (
								<Text fontSize="sm" mb={2}>
									Recorded component dependencies also differ. Open each version's recorded page preview to inspect them.
								</Text>
							) : null}
							{comparisonResult?.changes.map((change, index) => (
								<Box key={index} mb={2}>
									<Text fontSize="sm" fontWeight="600">
										{timelineChangeLabel(change.path)}
									</Text>
									<Text fontSize="xs" overflowWrap="anywhere">
										Then: {timelineValueLabel(change.before, change.path)}
									</Text>
									<Text fontSize="xs" overflowWrap="anywhere">
										Selected: {timelineValueLabel(change.after, change.path)}
									</Text>
								</Box>
							))}
						</>
					)}
				</Box>
			) : null}
			<TimelinePagePreview key={`page-preview:${timeline.identity}:${selected.id}`} event={selected} />
			{changes.map((change, index) => (
				<Box key={index} mb={3} p={3} borderWidth="1px" borderColor="var(--tt-border)" borderRadius="lg">
					<Text fontWeight="600" mb={2} overflowWrap="anywhere">
						{timelineChangeLabel(change.path)}
					</Text>
					<Text fontSize="sm" color="var(--tt-muted)" noOfLines={4} overflowWrap="anywhere">
						Before: {timelineValueLabel(change.before, change.path)}
					</Text>
					<Text fontSize="sm" mt={1} noOfLines={4} overflowWrap="anywhere">
						After: {timelineValueLabel(change.after, change.path)}
					</Text>
				</Box>
			))}
			<Button size="sm" variant="ghost" mb={3} onClick={() => setShowData((value) => !value)} aria-expanded={showData}>
				{showData ? 'Hide data' : 'View data'}
			</Button>
			{showData
				? (['before', 'after'] as const).map((side) => (
						<Box key={side} mb={4}>
							<Text fontWeight="600" fontSize="sm" mb={2}>
								{side === 'before' ? 'Before' : 'After'}
							</Text>
							<Box
								as="pre"
								fontSize="xs"
								whiteSpace="pre-wrap"
								overflowWrap="anywhere"
								maxH="280px"
								overflow="auto"
								p={3}
								borderRadius="md"
								bg="var(--tt-surface)"
							>
								{preview(selected[side])}
							</Box>
						</Box>
				  ))
				: null}
			{!selected.thingId.startsWith(COMPONENT_BINDING_PREFIX) ? (
				<Button
					size="sm"
					variant="outline"
					isLoading={opening}
					isDisabled={!session.connection}
					onClick={async () => {
						const scope = session.connection?.scope;
						if (!scope) return;
						setOpening(true);
						setOpenError('');
						try {
							if (differentSource) await api.v1.mongodb.endpoint.set({ reset: true });
							navigate(thingHistoryHref(selected.thingId, scope.dataPlane, scope.ownerId));
						} catch (error) {
							setOpenError(apiErrorMessage(error, 'Could not open this Thing. Your history is still here.'));
						} finally {
							setOpening(false);
						}
					}}
				>
					{differentSource ? 'Open Thing in home' : 'Open Thing'}
				</Button>
			) : null}
			{differentSource && !selected.thingId.startsWith(COMPONENT_BINDING_PREFIX) ? (
				<Text fontSize="xs" color="var(--tt-muted)" mt={2}>
					Opening this Thing switches your selected database to your home account.
				</Text>
			) : null}
			{openError ? (
				<Text role="status" fontSize="sm" mt={2}>
					{openError}
				</Text>
			) : null}
			<TimelineVersionActions key={`${timeline.identity}:${selected.id}`} event={selected} onApplied={() => void timeline.refresh()} />
		</Box>
	) : null;

	if (!timeline.signedIn) return <Text>Sign in to see your Timeline.</Text>;
	if (folderId && timeline.folderId && timeline.folderId !== folderId)
		return <Text>This Timeline is not available in the current account or data source.</Text>;
	return (
		<Flex direction="column" gap={4} minW={0}>
			<Flex gap={2} wrap="wrap" align="center">
				<Text flex="1" fontSize="sm" color="var(--tt-muted)">
					{pending
						? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to sync`
						: timeline.error
						? 'Could not refresh history'
						: timeline.ready
						? 'Saved to your account'
						: 'Opening history…'}
				</Text>

				<Button size="sm" variant="outline" onClick={() => void timeline.refresh()}>
					Refresh
				</Button>
				{!urlState ? (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => navigate(`/history?${writeHistoryFilters(new URLSearchParams({ storage: homeHistory ? 'home' : 'selected' }), filters)}`)}
					>
						Open History browser
					</Button>
				) : null}
			</Flex>
			{differentSource ? (
				<Text fontSize="sm" color="var(--tt-muted)">
					Home account history · your selected database is unchanged.
				</Text>
			) : null}
			{timeline.error ? (
				<Text role="status" fontSize="sm" color="var(--tt-muted)">
					{timeline.error} {timeline.rows.length ? 'Your cached changes are still here.' : ''}
				</Text>
			) : null}
			{filters.thingId ? <TimelineBranches key={timeline.identity} thingId={filters.thingId} selected={selected} onSelect={setSelected} /> : null}
			<Flex direction={{ base: 'column', lg: selected ? 'row' : 'column' }} gap={4} minW={0} align="stretch">
				<Box flex={selected ? '0 0 48%' : '1'} minW={0}>
					<TimelineEventBrowser
						rows={timeline.rows}
						filters={filters}
						onFilters={changeFilters}
						selected={selected}
						onSelect={setSelected}
						initialThingId={thingId}
						older={timeline.older}
						hasOlder={timeline.nextBefore !== null}
						ready={timeline.ready}
					/>
				</Box>
				<HistoryDetails onClose={() => setSelected(null)}>{selected ? detail : null}</HistoryDetails>
			</Flex>
		</Flex>
	);
}

function HistoryDetails({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
	const [mobile] = useMediaQuery('(max-width: 820px)');
	if (!children) return null;
	if (mobile)
		return (
			<Modal isOpen onClose={onClose} scrollBehavior="inside" motionPreset="none">
				<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
				<ModalContent
					aria-label="Version details"
					maxW="100%"
					maxH="80dvh"
					mb={0}
					borderBottomRadius={0}
					containerProps={{ zIndex: DRAWER_MODAL_Z, alignItems: 'flex-end' }}
				>
					<ModalHeader>Version details</ModalHeader>
					<ModalCloseButton />
					<ModalBody px={2} pb={4}>
						{children}
					</ModalBody>
				</ModalContent>
			</Modal>
		);
	return (
		<Box
			as="aside"
			aria-label="Version details"
			flex="1"
			minW={0}
			position="sticky"
			top="calc(var(--tt-nav-clearance, 54px) + 12px)"
			alignSelf="flex-start"
			maxH="80dvh"
			overflowY="auto"
		>
			{children}
		</Box>
	);
}

export function TimelineLibrary({ folderId, storage = 'selected' }: { folderId: string; storage?: TimelineStorage }) {
	const navigate = useNavigate();
	const user = useCurrentUser();
	const selected = useSelectedTimelineSession();
	return (
		<PageShell width={1100} columnProps={{ pt: 4 }}>
			<Button alignSelf="flex-start" variant="ghost" size="sm" onClick={() => navigate('/things')}>
				← Things
			</Button>
			<PageHeader eyebrow="Thingtime · Things" title="Timeline" variant="ink" subtitle="Your changes across Thingtime, saved in one place." />
			{selected.connection?.scope.dataPlane !== 'home' ? (
				<Flex gap={2} wrap="wrap" role="group" aria-label="History location">
					<Button
						size="sm"
						variant={storage === 'home' ? 'solid' : 'outline'}
						aria-pressed={storage === 'home'}
						onClick={() => navigate(timelineFolderHref(folderId, 'home'))}
					>
						Home account
					</Button>
					<Button
						size="sm"
						variant={storage === 'selected' ? 'solid' : 'outline'}
						aria-pressed={storage === 'selected'}
						onClick={() => navigate(timelineFolderHref(folderId, 'selected'))}
					>
						Selected database
					</Button>
				</Flex>
			) : null}
			<TimelineStorageProvider storage={storage}>
				<TimelinePanel key={`${user?.id}:${folderId}:${storage}`} thingId={null} folderId={folderId} />
			</TimelineStorageProvider>
		</PageShell>
	);
}

export function HistoryPage() {
	const [params, setParams] = useSearchParams();
	const user = useCurrentUser();
	const selected = useSelectedTimelineSession();
	const storage: TimelineStorage = params.get('storage') === 'selected' ? 'selected' : 'home';
	return (
		<PageShell width={1180} columnProps={{ pt: 4 }}>
			<PageHeader eyebrow="Thingtime" title="History" variant="ink" subtitle="Every change, in its place. Explore your Things as they were." />
			{selected.connection?.scope.dataPlane !== 'home' ? (
				<Flex gap={2} wrap="wrap" role="group" aria-label="History location">
					{(['home', 'selected'] as const).map((value) => (
						<Button
							key={value}
							size="sm"
							variant={storage === value ? 'solid' : 'outline'}
							aria-pressed={storage === value}
							onClick={() => {
								const next = new URLSearchParams(params);
								next.set('storage', value);
								next.delete('thing');
								setParams(next);
							}}
						>
							{value === 'home' ? 'Home account' : 'Selected database'}
						</Button>
					))}
				</Flex>
			) : null}
			<TimelineStorageProvider storage={storage}>
				<TimelinePanel key={`${user?.id}:${storage}`} thingId={null} urlState />
			</TimelineStorageProvider>
		</PageShell>
	);
}

export function TimelineHost() {
	const [target, setTarget] = React.useState<{ thingId: string; storage: TimelineStorage } | null>(null);
	const user = useCurrentUser();
	const location = useLocation();
	React.useEffect(() => setTarget(null), [location.key]);
	React.useEffect(() => {
		const open = (event: Event) => {
			const id = (event as CustomEvent).detail?.thingId;
			if (typeof id === 'string' && id.length > 0 && id.length <= 200)
				setTarget({ thingId: id, storage: (event as CustomEvent).detail?.storage === 'home' ? 'home' : 'selected' });
		};
		window.addEventListener(OPEN_HISTORY, open);
		return () => window.removeEventListener(OPEN_HISTORY, open);
	}, []);
	return (
		<Modal isOpen={target !== null} onClose={() => setTarget(null)} size="5xl" scrollBehavior="inside" isCentered>
			<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
			<ModalContent maxW="min(1100px, calc(100vw - 24px))" maxH="calc(100dvh - 24px)" containerProps={{ zIndex: DRAWER_MODAL_Z }}>
				<ModalHeader>History</ModalHeader>
				<ModalCloseButton />
				<ModalBody pb={6} minW={0}>
					{target ? (
						<TimelineStorageProvider storage={target.storage}>
							<TimelinePanel key={`${user?.id}:${target.thingId}:${target.storage}`} thingId={target.thingId} />
						</TimelineStorageProvider>
					) : null}
				</ModalBody>
			</ModalContent>
		</Modal>
	);
}
