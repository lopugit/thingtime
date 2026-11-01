import React from 'react';
import { Box, Button, Flex, Select, Spinner, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';

import {
	MODERATION_MEDIA_PROVIDER_OPTIONS,
	MODERATION_TEXT_PROVIDER_OPTIONS,
	type ModerationMediaProviderId,
	type ModerationSettings,
	type ModerationTextProviderId
} from '~/api/utils/moderation/moderationSettingsCore';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { CARD_STYLES } from '~/theme/card';

// /admin → Moderation: the AI-moderation settings + the NSFW/TOS review
// queue. Rows are moderationFlag things written by the analysis pipelines
// (api/utils/moderation) for media uploads AND post/comment text; actions
// override the verdict on the target's protected moderation stamp. Admins can
// open raw media (the content route serves blocked bytes to admins only) or
// read the stored text excerpt to judge the evidence.

type ModerationFlagRow = {
	id: string;
	attachmentId: string;
	targetKind: 'attachment' | 'text';
	excerpt: string | null;
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
	counts: { flags: number; unanalyzedReady: number; unmoderatedText: number };
	settings?: ModerationSettings;
	effective?: { media: string; text: string };
};

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const eyebrow = {
	fontFamily: MONO,
	fontSize: '10px',
	fontWeight: 600,
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const,
	color: 'var(--tt-muted, #9a9aa6)'
};

// House status pattern: token-colored dot + mono uppercase label.
const statusColor = (status: string) =>
	status === 'blocked'
		? 'var(--tt-danger, #d6455a)'
		: status === 'nsfw'
			? 'var(--tt-warning, #ffbc48)'
			: status === 'clear'
				? 'var(--tt-positive, #2f8f4f)'
				: 'var(--tt-faint, #b6b6c0)';

export const ModerationTab = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const [overview, setOverview] = React.useState<ModerationOverview | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState<string | null>(null);

	const [settingsDraft, setSettingsDraft] = React.useState<ModerationSettings | null>(null);
	const [effective, setEffective] = React.useState<{ media: string; text: string } | null>(null);

	const refresh = React.useCallback(async () => {
		setLoading(true);
		try {
			const resp = await apiRef.current.v1.admin.moderation();
			if (resp?.ok) {
				setOverview({ flags: resp.flags || [], counts: resp.counts || { flags: 0, unanalyzedReady: 0, unmoderatedText: 0 } });
				if (resp.settings) setSettingsDraft(resp.settings);
				if (resp.effective) setEffective(resp.effective);
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

	const saveSettings = async (settings: ModerationSettings) => {
		setSettingsDraft(settings); // optimistic — revert on failure
		setBusy('settings');
		try {
			const resp = await apiRef.current.v1.admin.moderationSettings({ settings });
			if (resp?.ok) {
				if (resp.settings) setSettingsDraft(resp.settings);
				if (resp.effective) setEffective(resp.effective);
				lopu({ title: 'Moderation settings saved', status: 'success' });
			} else {
				lopu({ title: resp?.error || 'Could not save moderation settings', status: 'error' });
				await refresh();
			}
		} catch {
			lopu({ title: 'Could not save moderation settings', status: 'error' });
			await refresh();
		} finally {
			setBusy(null);
		}
	};

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	const runSweep = async () => {
		setBusy('sweep');
		try {
			const resp = await apiRef.current.v1.admin.moderationSweep();
			if (resp?.ok) {
				const sweep = resp.sweep || {};
				const textSweep = resp.textSweep || {};
				const textLine = textSweep.skippedOff ? 'text: off' : `text: ${textSweep.analyzed ?? 0} analyzed, ${textSweep.flagged ?? 0} flagged`;
				lopu({
					title: `Sweep — media: ${sweep.analyzed ?? 0} analyzed, ${sweep.flagged ?? 0} flagged, ${sweep.failed ?? 0} failed · ${textLine}`,
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
			const resp = await apiRef.current.v1.admin.moderationReview({ attachmentId: row.attachmentId, verdict, targetKind: row.targetKind });
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

	const mediaNote = MODERATION_MEDIA_PROVIDER_OPTIONS.find((option) => option.id === settingsDraft?.mediaProvider)?.note;
	const textNote = MODERATION_TEXT_PROVIDER_OPTIONS.find((option) => option.id === settingsDraft?.textProvider)?.note;

	return (
		<Box>
			<Box {...CARD_STYLES} p={4} mb={4}>
				<Text sx={eyebrow} mb={1}>
					AI moderation settings
				</Text>
				<Text fontSize="xs" color="var(--tt-text, #5a5a66)" mb={3}>
					Which AI analyzes each surface. Choices here override the server env default; “Default” follows the environment’s API keys.
				</Text>
				<Flex columnGap={6} rowGap={3} flexWrap="wrap">
					<Box minW="260px" flex="1">
						<Text fontSize="xs" fontWeight={600} color="var(--tt-ink, #16161a)" mb={1}>
							Media uploads (images){effective ? ` — running: ${effective.media}` : ''}
						</Text>
						<Select
							size="sm"
							value={settingsDraft?.mediaProvider || 'default'}
							isDisabled={!settingsDraft || busy === 'settings'}
							onChange={(event) =>
								settingsDraft && void saveSettings({ ...settingsDraft, mediaProvider: event.target.value as ModerationMediaProviderId })
							}
						>
							{MODERATION_MEDIA_PROVIDER_OPTIONS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</Select>
						{mediaNote ? (
							<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt={1}>
								{mediaNote}
							</Text>
						) : null}
					</Box>
					<Box minW="260px" flex="1">
						<Text fontSize="xs" fontWeight={600} color="var(--tt-ink, #16161a)" mb={1}>
							Post & comment text{effective ? ` — running: ${effective.text}` : ''}
						</Text>
						<Select
							size="sm"
							value={settingsDraft?.textProvider || 'default'}
							isDisabled={!settingsDraft || busy === 'settings'}
							onChange={(event) =>
								settingsDraft && void saveSettings({ ...settingsDraft, textProvider: event.target.value as ModerationTextProviderId })
							}
						>
							{MODERATION_TEXT_PROVIDER_OPTIONS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</Select>
						{textNote ? (
							<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt={1}>
								{textNote}
							</Text>
						) : null}
					</Box>
				</Flex>
			</Box>
			<Flex alignItems="center" columnGap={3} rowGap={2} flexWrap="wrap" mb={3}>
				<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
					{overview
						? `${overview.counts.flags} flag(s) · ${overview.counts.unanalyzedReady} attachment(s) + ${overview.counts.unmoderatedText} text post(s) awaiting analysis`
						: '…'}
				</Text>
				<Button size="xs" variant="outline" marginLeft="auto" isLoading={busy === 'sweep'} onClick={runSweep} title="Analyze a batch of attachments the async pipeline missed">
					Run analysis sweep
				</Button>
				<Button size="xs" variant="ghost" onClick={() => void refresh()} isLoading={loading && !!overview}>
					Refresh
				</Button>
			</Flex>
			{error ? (
				<Text fontSize="sm" color="var(--tt-danger, #d6455a)" mb={3}>
					{error}
				</Text>
			) : null}
			{loading && !overview ? (
				<Flex justify="center" py={10}>
					<Spinner />
				</Flex>
			) : overview && overview.flags.length === 0 ? (
				<Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" py={4}>
					No moderation flags 🎉 — flagged uploads will appear here for review.
				</Text>
			) : overview ? (
				<Box
					overflowX="auto"
					{...CARD_STYLES}
					sx={{
						'& th': {
							fontFamily: MONO,
							fontSize: '10px',
							letterSpacing: '0.08em',
							color: 'var(--tt-muted, #9a9aa6)',
							borderColor: 'var(--tt-border-light, #f0f0f2)'
						},
						'& td': { borderColor: 'var(--tt-border-light, #f0f0f2)' }
					}}
				>
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
										<Text fontWeight={600} fontSize="sm" color="var(--tt-ink, #16161a)" noOfLines={1} maxW="220px" title={row.targetKind === 'text' ? row.excerpt || row.attachmentId : row.attachmentName}>
											{row.targetKind === 'text' ? `“${(row.excerpt || '').slice(0, 60) || row.attachmentId}”` : row.attachmentName || row.attachmentId}
										</Text>
										<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
											{row.targetKind === 'text' ? `${row.attachmentPurpose || 'post'} text` : row.attachmentPurpose || 'unknown'} · owner{' '}
											{row.attachmentOwnerId.slice(0, 8)}…
										</Text>
									</Td>
									<Td>
										<Flex alignItems="center" columnGap={1.5}>
											<Box width="7px" height="7px" borderRadius="2px" flexShrink={0} background={statusColor(row.status)} />
											<Text
												fontFamily={MONO}
												fontSize="10px"
												fontWeight={600}
												letterSpacing="0.06em"
												textTransform="uppercase"
												color="var(--tt-muted, #9a9aa6)"
											>
												{row.status}
											</Text>
										</Flex>
										<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
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
										{row.targetKind === 'attachment' ? (
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
										) : null}
										<Button size="xs" variant="outline" mr={1} isLoading={busy === `${row.id}:clear`} onClick={() => review(row, 'clear')}>
											Clear
										</Button>
										<Button size="xs" variant="outline" mr={1} isLoading={busy === `${row.id}:nsfw`} onClick={() => review(row, 'nsfw')}>
											NSFW
										</Button>
										<Button
											size="xs"
											variant="outline"
											color="var(--tt-danger, #d6455a)"
											borderColor="rgba(214, 69, 90, 0.4)"
											_hover={{ background: 'rgba(214, 69, 90, 0.12)' }}
											isLoading={busy === `${row.id}:block`}
											onClick={() => review(row, 'block')}
										>
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
