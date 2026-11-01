import type { ReactNode } from 'react';
import React from 'react';
import { Box, Button, Flex, Link, Text } from '@chakra-ui/react';

import type { VercelDeploymentStatus } from '~/api/utils/vercel/status';
import { CARD_STYLES } from '~/theme/card';
import { RAINBOW } from '~/theme/rainbow';
import { PageHeader } from '../Layout/PageShell';

// The /status page decomposed into standalone, pixel-identical SECTIONS —
// the same components render the route AND its site-doc blocks (see
// Builder/nativeSections.tsx), so "every element within a native block is a
// builder block" holds with zero duplicated markup. Sections own their data
// through one shared, module-cached fetch (optimistic-render house rule:
// last-known state paints instantly, a background refetch reconciles).

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const value = (raw?: string | null) => raw || '—';

// ---- shared data: one fetch, every section subscribes -----------------------

let statusCache: VercelDeploymentStatus | null = null;
let statusInflight: Promise<void> | null = null;
const statusListeners = new Set<() => void>();

const notifyStatus = () => statusListeners.forEach((listener) => listener());

const fetchStatus = (): Promise<void> => {
	if (!statusInflight) {
		statusInflight = fetch('/api/v1/vercel/status', { credentials: 'include' })
			.then(async (response) => {
				if (!response.ok) return;
				statusCache = (await response.json()) as VercelDeploymentStatus;
			})
			.catch(() => {
				// keep last-known state — the page stays useful offline
			})
			.finally(() => {
				statusInflight = null;
				notifyStatus();
			});
	}
	return statusInflight;
};

export const useVercelStatusData = () => {
	const [, force] = React.useReducer((tick: number) => tick + 1, 0);
	const [checking, setChecking] = React.useState(false);

	React.useEffect(() => {
		statusListeners.add(force);
		// render cached state instantly; refresh in the background
		fetchStatus();
		return () => {
			statusListeners.delete(force);
		};
	}, []);

	const recheck = React.useCallback(async () => {
		setChecking(true);
		await fetchStatus();
		setChecking(false);
	}, []);

	const status: VercelDeploymentStatus =
		statusCache ||
		({
			state: 'local',
			label: 'Checking deployment status…',
			configured: false
		} as VercelDeploymentStatus);

	return { status, checking, recheck, loaded: !!statusCache };
};

const StatusRow = (props: { label: string; first?: boolean; children: ReactNode }) => (
	<Flex
		justify="space-between"
		alignItems="baseline"
		gap={4}
		py={2.5}
		borderTop={props.first ? undefined : '1px solid var(--tt-border-light, #f0f0f2)'}
	>
		<Text
			fontFamily={MONO}
			fontSize="xs"
			fontWeight={600}
			letterSpacing="0.06em"
			textTransform="uppercase"
			color="var(--tt-muted, #9a9aa6)"
			flexShrink={0}
		>
			{props.label}
		</Text>
		{props.children}
	</Flex>
);

// ---- the sections -----------------------------------------------------------

export const StatusHeaderSection = () => (
	<PageHeader
		eyebrow="Thingtime · deployment health"
		title="Status 🚀"
		variant="rainbow"
		subtitle={
			<>
				Sourced from server endpoint{' '}
				<Text as="span" fontFamily={MONO}>
					/api/v1/vercel/status
				</Text>
			</>
		}
	/>
);

export const StatusStateSection = () => {
	const { status } = useVercelStatusData();
	const dotColor =
		status.state === 'ready'
			? 'var(--tt-positive, #2f8f4f)'
			: status.state === 'building' || status.state === 'queued'
				? 'var(--tt-warning, #ffbc48)'
				: status.state === 'local'
					? 'var(--tt-muted, #9a9aa6)'
					: 'var(--tt-danger, #d6455a)';

	return (
		<Box {...CARD_STYLES} px={5} py={4}>
			<Flex alignItems="center" gap={3}>
				<Box width="10px" height="10px" borderRadius="full" bg={dotColor} flexShrink={0} />
				<Text
					fontFamily={MONO}
					fontSize="xs"
					fontWeight={600}
					letterSpacing="0.08em"
					textTransform="uppercase"
					color="var(--tt-muted, #9a9aa6)"
				>
					{status.label}
				</Text>
			</Flex>
		</Box>
	);
};

export const StatusReadoutSection = () => {
	const { status } = useVercelStatusData();
	const buildProgress = typeof status.buildProgress === 'number' ? status.buildProgress : 0;
	const buildProgressText =
		status.buildProgress === undefined || Number.isNaN(status.buildProgress) ? '—' : `${status.buildProgress}%`;

	return (
		<Box {...CARD_STYLES} px={5} py={2}>
			<StatusRow label="Branch" first>
				<Text fontFamily={MONO} fontSize="sm" color="var(--tt-ink, #16161a)">
					{value(status.branch)}
				</Text>
			</StatusRow>
			<StatusRow label="Commit">
				<Text fontFamily={MONO} fontSize="sm" color="var(--tt-ink, #16161a)">
					{value(status.commitSha)}
				</Text>
			</StatusRow>
			<StatusRow label="Environment">
				<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
					{value(status.environment)}
				</Text>
			</StatusRow>
			<StatusRow label="Deployment URL">
				<Text fontFamily={MONO} fontSize="sm" textAlign="right" maxW="65%" wordBreak="break-all">
					{status.deploymentUrl ? (
						<Link href={status.deploymentUrl} color="var(--tt-link, #2f8fd6)" isExternal>
							{status.deploymentUrl}
						</Link>
					) : (
						'—'
					)}
				</Text>
			</StatusRow>
			<StatusRow label="Latest Deployment URL">
				<Text fontFamily={MONO} fontSize="sm" textAlign="right" maxW="65%" wordBreak="break-all">
					{status.latestDeploymentUrl ? (
						<Link href={status.latestDeploymentUrl} color="var(--tt-link, #2f8fd6)" isExternal>
							{status.latestDeploymentUrl}
						</Link>
					) : (
						'—'
					)}
				</Text>
			</StatusRow>
			<StatusRow label="Build page">
				<Text fontFamily={MONO} fontSize="sm" textAlign="right" maxW="65%">
					{status.buildPageUrl ? (
						<Link href={status.buildPageUrl} color="var(--tt-link, #2f8fd6)" isExternal>
							Open build info
						</Link>
					) : (
						'—'
					)}
				</Text>
			</StatusRow>
			<StatusRow label="Build phase">
				<Text fontFamily={MONO} fontSize="sm" textAlign="right" color="var(--tt-ink, #16161a)">
					{value(status.buildPhase)}
				</Text>
			</StatusRow>
			<StatusRow label="Build progress">
				<Text fontFamily={MONO} fontSize="sm" textAlign="right" color="var(--tt-ink, #16161a)">
					{buildProgressText}
				</Text>
			</StatusRow>
			{status.state === 'building' || status.state === 'queued' ? (
				<Box
					mb={2.5}
					height="6px"
					borderRadius="var(--tt-radius-pill, 999px)"
					bg="var(--tt-surface-alt, #f5f5f7)"
					overflow="hidden"
				>
					<Box
						height="100%"
						borderRadius="var(--tt-radius-pill, 999px)"
						width={status.buildProgress === undefined ? '100%' : `${buildProgress}%`}
						background={status.buildProgress === undefined ? RAINBOW : 'var(--tt-positive, #2f8f4f)'}
						transition="width 0.3s ease"
					/>
				</Box>
			) : null}
			<StatusRow label="Vercel API configured">
				<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
					{status.configured ? 'yes' : 'no'}
				</Text>
			</StatusRow>
		</Box>
	);
};

export const StatusRecheckSection = () => {
	const { status, checking, recheck } = useVercelStatusData();
	return (
		<>
			{status.error ? (
				<Box bg="rgba(214, 69, 90, 0.12)" borderRadius="var(--tt-radius-md, 12px)" px={4} py={3} mb={4}>
					<Text color="var(--tt-danger, #d6455a)" fontSize="sm" whiteSpace="pre-wrap">
						{status.error}
					</Text>
				</Box>
			) : null}
			<Button size="sm" width="fit-content" onClick={recheck} isLoading={checking} loadingText="Re-checking…">
				Re-check deployment status
			</Button>
		</>
	);
};
