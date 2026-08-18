import React from 'react';
import { Badge, Box, Button, Flex, Spinner, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';

// /admin → Moderation: the NSFW/TOS review queue. Rows are moderationFlag
// things written by the analysis pipeline (api/utils/moderation); actions
// override the verdict on the attachment's protected moderation stamp.
// Admins can open the raw media (the content route serves blocked bytes to
// admins only) to judge the evidence.

type ModerationFlagRow = {
	id: string;
	attachmentId: string;
	status: string;
	categories: string[];
	reason: string | null;
	provider: string | null;
	model: string | null;
	attachmentOwnerId: string;
	attachmentName: string;
	attachmentPurpose: string | null;
	reviewedBy: string | null;
	reviewedAt: string | null;
	createdAt: string | null;
};

type ModerationOverview = {
	flags: ModerationFlagRow[];
	counts: { flags: number; unanalyzedReady: number };
};

const statusColor = (status: string) => (status === 'blocked' ? 'red' : status === 'nsfw' ? 'orange' : status === 'clear' ? 'green' : 'gray');

export const ModerationTab = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const [overview, setOverview] = React.useState<ModerationOverview | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState<string | null>(null);

	const refresh = React.useCallback(async () => {
		setLoading(true);
		try {
			const resp = await apiRef.current.v1.admin.moderation();
			if (resp?.ok) {
				setOverview({ flags: resp.flags || [], counts: resp.counts || { flags: 0, unanalyzedReady: 0 } });
				setError(null);
			} else {
				setError(resp?.error || 'Could not load moderation queue');
			}
		} catch (err: any) {
			setError(err?.error || err?.message || 'Could not load moderation queue');
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	const runSweep = async () => {
		setBusy('sweep');
		try {
			const resp = await apiRef.current.v1.admin.moderationSweep();
			if (resp?.ok) {
				const sweep = resp.sweep || {};
				lopu({
					title: `Sweep: ${sweep.analyzed ?? 0} analyzed, ${sweep.flagged ?? 0} flagged, ${sweep.skipped ?? 0} skipped, ${sweep.failed ?? 0} failed`,
					status: 'success'
				});
				await refresh();
			} else {
				lopu({ title: resp?.error || 'Sweep failed', status: 'error' });
			}
		} catch {
			lopu({ title: 'Sweep failed', status: 'error' });
		} finally {
			setBusy(null);
		}
	};

	const review = async (row: ModerationFlagRow, verdict: 'clear' | 'nsfw' | 'block') => {
		setBusy(`${row.id}:${verdict}`);
		try {
			const resp = await apiRef.current.v1.admin.moderationReview({ attachmentId: row.attachmentId, verdict });
			if (resp?.ok) {
				lopu({ title: `“${row.attachmentName || row.attachmentId}” marked ${resp.moderationStatus}`, status: 'success' });
				await refresh();
			} else {
				lopu({ title: resp?.error || 'Review failed', status: 'error' });
			}
		} catch {
			lopu({ title: 'Review failed', status: 'error' });
		} finally {
			setBusy(null);
		}
	};

	return (
		<Box>
			<Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap" mb={3}>
				<Text fontSize="sm" opacity={0.75}>
					{overview ? `${overview.counts.flags} flag(s) · ${overview.counts.unanalyzedReady} ready attachment(s) awaiting analysis` : '…'}
				</Text>
				<Button size="xs" variant="outline" marginLeft="auto" isLoading={busy === 'sweep'} onClick={runSweep} title="Analyze a batch of attachments the async pipeline missed">
					Run analysis sweep
				</Button>
				<Button size="xs" variant="ghost" onClick={() => void refresh()} isLoading={loading && !!overview}>
					Refresh
				</Button>
			</Flex>
			{error ? (
				<Text fontSize="sm" color="var(--tt-danger, #e5484d)" mb={3}>
					{error}
				</Text>
			) : null}
			{loading && !overview ? (
				<Flex justify="center" py={10}>
					<Spinner />
				</Flex>
			) : overview && overview.flags.length === 0 ? (
				<Text fontSize="sm" opacity={0.6} py={4}>
					No moderation flags 🎉 — flagged uploads will appear here for review.
				</Text>
			) : overview ? (
				<Box overflowX="auto">
					<Table size="sm" minW="880px">
						<Thead>
							<Tr>
								<Th>Attachment</Th>
								<Th>Status</Th>
								<Th>Categories</Th>
								<Th>Reason</Th>
								<Th>Reviewed</Th>
								<Th>Actions</Th>
							</Tr>
						</Thead>
						<Tbody>
							{overview.flags.map((row) => (
								<Tr key={row.id}>
									<Td>
										<Text fontWeight={600} fontSize="sm" noOfLines={1} maxW="220px" title={row.attachmentName}>
											{row.attachmentName || row.attachmentId}
										</Text>
										<Text fontSize="xs" opacity={0.6}>
											{row.attachmentPurpose || 'unknown'} · owner {row.attachmentOwnerId.slice(0, 8)}…
										</Text>
									</Td>
									<Td>
										<Badge colorScheme={statusColor(row.status)} fontSize="0.65em">
											{row.status}
										</Badge>
										<Text fontSize="10px" opacity={0.6}>
											{row.provider || '—'}
										</Text>
									</Td>
									<Td fontSize="xs" maxW="160px">
										<Text noOfLines={2}>{row.categories.join(', ') || '—'}</Text>
									</Td>
									<Td fontSize="xs" maxW="240px">
										<Text noOfLines={2} title={row.reason || undefined}>
											{row.reason || '—'}
										</Text>
									</Td>
									<Td fontSize="xs" whiteSpace="nowrap">
										{row.reviewedBy ? `✅ ${new Date(row.reviewedAt || '').toLocaleDateString()}` : '—'}
									</Td>
									<Td whiteSpace="nowrap">
										<Button
											as="a"
											href={`/api/v1/attachments/content?id=${encodeURIComponent(row.attachmentId)}`}
											target="_blank"
											rel="noreferrer"
											size="xs"
											variant="ghost"
											mr={1}
											title="Open the raw media (admin-only for blocked attachments)"
										>
											View
										</Button>
										<Button size="xs" variant="outline" mr={1} isLoading={busy === `${row.id}:clear`} onClick={() => review(row, 'clear')}>
											Clear
										</Button>
										<Button size="xs" variant="outline" mr={1} isLoading={busy === `${row.id}:nsfw`} onClick={() => review(row, 'nsfw')}>
											NSFW
										</Button>
										<Button size="xs" colorScheme="red" variant="outline" isLoading={busy === `${row.id}:block`} onClick={() => review(row, 'block')}>
											Block
										</Button>
									</Td>
								</Tr>
							))}
						</Tbody>
					</Table>
				</Box>
			) : null}
		</Box>
	);
};
