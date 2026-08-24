import React from 'react';
import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	Container,
	Flex,
	Heading,
	HStack,
	Icon,
	Input,
	Link,
	Select,
	SimpleGrid,
	Spinner,
	Stack,
	Table,
	TableContainer,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr
} from '@chakra-ui/react';
import { Grid2X2, LayoutList, PanelsTopLeft, RefreshCw, Search } from 'lucide-react';

import { CARD_STYLES } from '~/theme/card';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { filterPeerExplorerRows, mergePeerExplorerPage, PEER_EXPLORER_FIELDS, type PeerExplorerField, type PeerExplorerRow } from './peerExplorer';

type ViewMode = 'grid' | 'cards' | 'list';
type PeerPage = { ok: true; peers: PeerExplorerRow[]; nextCursor: string | null };

const PAGE_SIZE = 25;

const dateLabel = (value: string) => {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : value;
};

const publicKeyLabel = (value: string) => (value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value);

const PeerStatus = ({ peer }: { peer: PeerExplorerRow }) => (
	<Badge colorScheme={peer.status === 'active' ? 'green' : 'orange'} borderRadius="full" px={2} py={0.5} textTransform="capitalize">
		{peer.status}
	</Badge>
);

const PeerProperties = ({ peer, compact = false }: { peer: PeerExplorerRow; compact?: boolean }) => (
	<Stack spacing={compact ? 2 : 3} fontSize={compact ? 'xs' : 'sm'} minW={0}>
		<Flex align="center" justify="space-between" gap={3}>
			<Text opacity={0.62}>First seen</Text>
			<Text fontFamily="mono" textAlign="right">
				{dateLabel(peer.firstSeenAt)}
			</Text>
		</Flex>
		<Flex align="center" justify="space-between" gap={3}>
			<Text opacity={0.62}>Last seen</Text>
			<Text fontFamily="mono" textAlign="right">
				{dateLabel(peer.lastSeenAt)}
			</Text>
		</Flex>
		<Flex align="center" justify="space-between" gap={3}>
			<Text opacity={0.62}>Lease expiry</Text>
			<Text fontFamily="mono" textAlign="right">
				{dateLabel(peer.expiresAt)}
			</Text>
		</Flex>
		<Box minW={0}>
			<Text opacity={0.62} mb={1}>
				Pinned signing key
			</Text>
			<Text fontFamily="mono" fontSize="xs" wordBreak="break-all" title={peer.signingPublicKey}>
				{compact ? publicKeyLabel(peer.signingPublicKey) : peer.signingPublicKey}
			</Text>
		</Box>
	</Stack>
);

const PeerCard = ({ peer, compact = false }: { peer: PeerExplorerRow; compact?: boolean }) => (
	<Box {...CARD_STYLES} p={compact ? 4 : 5} minW={0} h="100%">
		<Stack spacing={compact ? 3 : 4} h="100%">
			<Flex align="flex-start" justify="space-between" gap={3}>
				<Box minW={0}>
					<Text fontSize="10px" fontWeight={700} letterSpacing="0.1em" textTransform="uppercase" opacity={0.5} mb={1}>
						Deployment peer
					</Text>
					<Link
						href={peer.origin}
						isExternal
						color="var(--tt-link, #2C7A7B)"
						fontFamily="mono"
						fontSize={compact ? 'xs' : 'sm'}
						wordBreak="break-all"
					>
						{peer.origin}
					</Link>
				</Box>
				<PeerStatus peer={peer} />
			</Flex>
			<PeerProperties peer={peer} compact={compact} />
		</Stack>
	</Box>
);

const PeerList = ({ peers }: { peers: PeerExplorerRow[] }) => (
	<TableContainer borderWidth="1px" borderColor="var(--tt-border, #E2E8F0)" borderRadius="var(--tt-radius-md, 12px)">
		<Table size="sm" minW="980px">
			<Thead>
				<Tr>
					<Th>Origin</Th>
					<Th>Status</Th>
					<Th>Last seen</Th>
					<Th>Lease expiry</Th>
					<Th>Pinned signing key</Th>
				</Tr>
			</Thead>
			<Tbody>
				{peers.map((peer) => (
					<Tr key={peer.origin}>
						<Td maxW="320px">
							<Link href={peer.origin} isExternal color="var(--tt-link, #2C7A7B)" fontFamily="mono" fontSize="xs" wordBreak="break-all">
								{peer.origin}
							</Link>
						</Td>
						<Td>
							<PeerStatus peer={peer} />
						</Td>
						<Td fontFamily="mono" fontSize="xs">
							{dateLabel(peer.lastSeenAt)}
						</Td>
						<Td fontFamily="mono" fontSize="xs">
							{dateLabel(peer.expiresAt)}
						</Td>
						<Td fontFamily="mono" fontSize="xs" maxW="260px" wordBreak="break-all" title={peer.signingPublicKey}>
							{publicKeyLabel(peer.signingPublicKey)}
						</Td>
					</Tr>
				))}
			</Tbody>
		</Table>
	</TableContainer>
);

export const DeploymentPeersPage = () => {
	const user = useCurrentUser();
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const [peers, setPeers] = React.useState<PeerExplorerRow[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null | undefined>(undefined);
	const [loading, setLoading] = React.useState(true);
	const [loadingMore, setLoadingMore] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [view, setView] = React.useState<ViewMode>('grid');
	const [field, setField] = React.useState<PeerExplorerField>('all');
	const [query, setQuery] = React.useState('');

	const loadPage = React.useCallback(async (cursor?: string | null, replace = false) => {
		if (replace) setLoading(true);
		else setLoadingMore(true);
		setError(null);
		try {
			const response = (await apiRef.current.v1.admin.peers({ limit: PAGE_SIZE, cursor: cursor || undefined })) as PeerPage;
			if (!response?.ok || !Array.isArray(response.peers) || (response.nextCursor !== null && typeof response.nextCursor !== 'string')) {
				throw new Error('Peer explorer received an invalid page');
			}
			setPeers((current) => (replace ? mergePeerExplorerPage([], response.peers) : mergePeerExplorerPage(current, response.peers)));
			setNextCursor(response.nextCursor);
		} catch (reason: any) {
			setError(reason?.error || reason?.message || 'Could not load deployment peers');
		} finally {
			if (replace) setLoading(false);
			else setLoadingMore(false);
		}
	}, []);

	React.useEffect(() => {
		if (!user?.isAdmin) {
			setLoading(false);
			return;
		}
		void loadPage(null, true);
	}, [loadPage, user?.isAdmin]);

	const filteredPeers = React.useMemo(() => filterPeerExplorerRows(peers, query, field), [field, peers, query]);
	const activePeers = peers.filter((peer) => peer.status === 'active').length;

	if (!user?.isAdmin) {
		return (
			<Flex justify="center" px={4} py={16} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 32px)">
				<Box {...CARD_STYLES} maxW="440px" width="100%" p={6} textAlign="center">
					<Heading size="md" mb={2}>
						🔐 Developer access required
					</Heading>
					<Text fontSize="sm" opacity={0.7}>
						{user
							? 'Deployment peer diagnostics are available to administrators only.'
							: 'Sign in with an administrator account to inspect deployment peers.'}
					</Text>
				</Box>
			</Flex>
		);
	}

	return (
		<Container
			maxW="container.xl"
			py={{ base: 6, md: 10 }}
			px={{ base: 3, md: 6 }}
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 20px)"
		>
			<Stack spacing={6}>
				<Flex justify="space-between" align={{ base: 'flex-start', md: 'center' }} gap={4} direction={{ base: 'column', md: 'row' }}>
					<Box>
						<Text fontSize="11px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" opacity={0.52} mb={1}>
							Developer · deployment mesh
						</Text>
						<Heading size="lg">Peer explorer</Heading>
						<Text mt={2} fontSize="sm" opacity={0.66} maxW="760px">
							Observe the locally known signed deployment leases. Pages stay cursor-bounded; the browser never receives mesh credentials or private
							traversal cursors.
						</Text>
					</Box>
					<Button
						leftIcon={<Icon as={RefreshCw} />}
						size="sm"
						variant="outline"
						onClick={() => void loadPage(null, true)}
						isLoading={loading}
						loadingText="Refreshing…"
					>
						Refresh first page
					</Button>
				</Flex>

				<SimpleGrid columns={{ base: 1, sm: 3 }} spacing={3}>
					<Box {...CARD_STYLES} p={4}>
						<Text fontSize="xs" opacity={0.6}>
							Loaded leases
						</Text>
						<Heading size="md" mt={1}>
							{peers.length}
						</Heading>
					</Box>
					<Box {...CARD_STYLES} p={4}>
						<Text fontSize="xs" opacity={0.6}>
							Active leases
						</Text>
						<Heading size="md" mt={1}>
							{activePeers}
						</Heading>
					</Box>
					<Box {...CARD_STYLES} p={4}>
						<Text fontSize="xs" opacity={0.6}>
							More pages
						</Text>
						<Heading size="md" mt={1}>
							{nextCursor ? 'Available' : 'Complete'}
						</Heading>
					</Box>
				</SimpleGrid>

				<Box {...CARD_STYLES} p={{ base: 3, md: 4 }}>
					<Flex align={{ base: 'stretch', lg: 'center' }} direction={{ base: 'column', lg: 'row' }} gap={3}>
						<HStack flex={1} minW={0} spacing={2}>
							<Icon as={Search} opacity={0.55} />
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search every loaded peer property…"
								aria-label="Search deployment peers"
							/>
						</HStack>
						<Select
							value={field}
							onChange={(event) => setField(event.target.value as PeerExplorerField)}
							maxW={{ base: '100%', lg: '240px' }}
							aria-label="Peer property to filter"
						>
							{PEER_EXPLORER_FIELDS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</Select>
						<ButtonGroup size="sm" isAttached variant="outline" aria-label="Peer explorer view">
							<Button aria-label="Grid view" isActive={view === 'grid'} onClick={() => setView('grid')}>
								<Icon as={Grid2X2} />
							</Button>
							<Button aria-label="Card view" isActive={view === 'cards'} onClick={() => setView('cards')}>
								<Icon as={PanelsTopLeft} />
							</Button>
							<Button aria-label="List view" isActive={view === 'list'} onClick={() => setView('list')}>
								<Icon as={LayoutList} />
							</Button>
						</ButtonGroup>
					</Flex>
					<Text fontSize="xs" opacity={0.58} mt={3}>
						Showing {filteredPeers.length} of {peers.length} loaded lease{peers.length === 1 ? '' : 's'}; filtering considers every safe displayed
						property.
					</Text>
				</Box>

				{error ? (
					<Box borderWidth="1px" borderColor="red.200" bg="red.50" color="red.800" borderRadius="md" p={3} fontSize="sm">
						{error}
					</Box>
				) : null}
				{loading && peers.length === 0 ? (
					<Flex minH="180px" justify="center" align="center">
						<Spinner size="lg" />
					</Flex>
				) : null}
				{!loading && filteredPeers.length === 0 ? (
					<Box {...CARD_STYLES} p={6}>
						<Text fontSize="sm" opacity={0.7}>
							{peers.length ? 'No loaded peer leases match that filter.' : 'No deployment peer leases are known to this deployment yet.'}
						</Text>
					</Box>
				) : null}
				{filteredPeers.length > 0 && view === 'grid' ? (
					<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
						{filteredPeers.map((peer) => (
							<PeerCard key={peer.origin} peer={peer} compact />
						))}
					</SimpleGrid>
				) : null}
				{filteredPeers.length > 0 && view === 'cards' ? (
					<Stack spacing={4}>
						{filteredPeers.map((peer) => (
							<PeerCard key={peer.origin} peer={peer} />
						))}
					</Stack>
				) : null}
				{filteredPeers.length > 0 && view === 'list' ? <PeerList peers={filteredPeers} /> : null}

				{nextCursor ? (
					<Flex justify="center">
						<Button variant="outline" onClick={() => void loadPage(nextCursor)} isLoading={loadingMore} loadingText="Loading page…">
							Load next bounded page
						</Button>
					</Flex>
				) : null}
			</Stack>
		</Container>
	);
};
