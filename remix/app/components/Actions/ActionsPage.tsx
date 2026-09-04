import React from 'react';
import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react';
import { Link } from 'react-router';

import { ActionBuilder } from './ActionBuilder';
import { ActionChip, type ChipSize, type ChipTone } from './ActionChip';

import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';
import {
	ACTION_OP_TONES,
	actionEffectsOf,
	actionLimitsOf,
	ACTION_LIMIT_LABELS,
	collectSchemaRefs,
	displayRef,
	type ActionThing
} from './actionInspect';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const monoLabel = {
	color: MUTED,
	fontFamily: 'var(--tt-font-mono, monospace)',
	fontSize: '11px',
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const
};

type ActionsCache = { actions: ActionThing[] };
const cacheKeyFor = (userId: string | null | undefined) => `tt-actions-${userId || 'anon'}`;

export const opChipTone = (op: string): ChipTone => {
	const tone = ACTION_OP_TONES[op]?.tone;
	if (tone === 'write') return 'write';
	if (tone === 'read') return 'read';
	if (tone === 'invoke') return 'invoke';
	return 'neutral';
};

// sm = dense row (name + tone dots), md = default card, lg = roomy card with
// the full effect vocabulary — the same program at three densities.
export const ActionCard = ({
	action,
	schemaNames,
	size = 'md'
}: {
	action: ActionThing;
	schemaNames?: Record<string, string>;
	size?: ChipSize;
}) => {
	const crystal = action.crystal || {};
	const effects = actionEffectsOf(crystal);
	const limits = actionLimitsOf(crystal);
	const steps = Array.isArray(crystal.steps) ? crystal.steps : [];
	const ops = [...new Set(steps.map((step) => String(step.op || '')))];
	const pad = size === 'sm' ? 3 : size === 'lg' ? { base: 5, md: 6 } : { base: 4, md: 5 };
	const nameSize = size === 'sm' ? '13px' : size === 'lg' ? '17px' : '15px';
	return (
		<Box {...CARD_STYLES} p={pad} _hover={{ borderColor: 'var(--tt-accent, #7c6cff)' }} transition="border-color 120ms">
			<Flex align="center" gap={2} minW={0}>
				<Text fontSize={nameSize}>⚡</Text>
				<Text color="var(--tt-ink, #16161a)" fontSize={nameSize} fontWeight="600" isTruncated>
					{crystal.name || 'Action'}
				</Text>
				{size === 'sm' ? (
					<Flex align="center" gap="5px" ml="auto">
						{ops.map((op) => (
							<ActionChip key={op} size="sm" tone={opChipTone(op)}>
								{op.replace('things.', '').replace('actions.', '')}
							</ActionChip>
						))}
					</Flex>
				) : crystal.actionKey ? (
					<Text {...monoLabel} ml="auto">
						{crystal.actionKey}
					</Text>
				) : null}
			</Flex>
			{size !== 'sm' && crystal.description ? (
				<Text color="var(--tt-text, #33333c)" fontSize={size === 'lg' ? 'sm' : '13px'} mt={2} noOfLines={2}>
					{crystal.description}
				</Text>
			) : null}
			{size !== 'sm' ? (
				<Flex gap={1.5} mt={3} wrap="wrap">
					{effects.creates.map((schema) => (
						<ActionChip key={`c-${schema}`} size={size} tone="create">
							creates {displayRef(schema, schemaNames)}
						</ActionChip>
					))}
					{effects.reads.map((schema) => (
						<ActionChip key={`r-${schema}`} size={size} tone="read">
							reads {schema === '*' ? 'things' : displayRef(schema, schemaNames)}
						</ActionChip>
					))}
					{effects.publicReads.map((schema) => (
						<ActionChip key={`pr-${schema}`} size={size} tone="read">
							reads everyone’s public {displayRef(schema, schemaNames)}
						</ActionChip>
					))}
					{effects.systemReads.map((schema) => (
						<ActionChip key={`sr-${schema}`} size={size} tone="read">
							reads the platform’s {displayRef(schema, schemaNames)}
						</ActionChip>
					))}
					{effects.updates ? (
						<ActionChip size={size} tone="write">
							updates things
						</ActionChip>
					) : null}
					{effects.deletes ? (
						<ActionChip size={size} tone="danger">
							deletes things
						</ActionChip>
					) : null}
					{effects.invokes.map((key) => (
						<ActionChip key={`i-${key}`} size={size} tone="invoke">
							⚡ {key}
						</ActionChip>
					))}
					<ActionChip dot={false} size={size}>
						{ACTION_LIMIT_LABELS.timeoutMs(limits.timeoutMs)} · {ACTION_LIMIT_LABELS.maxOperations(limits.maxOperations)}
					</ActionChip>
				</Flex>
			) : null}
		</Box>
	);
};

export const ActionsPage = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const user = useCurrentUser();
	const cacheKey = cacheKeyFor(user?.id);
	const cached = React.useMemo(() => readLocalCache<ActionsCache>(cacheKey), [cacheKey]);
	const [actions, setActions] = React.useState<ActionThing[]>(cached?.actions || []);
	const [loaded, setLoaded] = React.useState(false);
	const [schemaNames, setSchemaNames] = React.useState<Record<string, string>>({});
	const [building, setBuilding] = React.useState(false);

	// resolve schema refs (ids) to display names — one fetch per unique ref
	React.useEffect(() => {
		const refs = [...new Set(actions.flatMap((action) => collectSchemaRefs(action.crystal)))].filter(
			(ref) => !(ref in schemaNames)
		);
		if (!refs.length) return;
		let cancelled = false;
		(async () => {
			const resolved: Record<string, string> = {};
			await Promise.all(
				refs.map(async (ref) => {
					try {
						const response = await apiRef.current.v1.things.get({ id: ref });
						const name = response?.thing?.crystal?.name;
						if (typeof name === 'string' && name) resolved[ref] = name;
					} catch {}
				})
			);
			if (!cancelled && Object.keys(resolved).length) setSchemaNames((prior) => ({ ...prior, ...resolved }));
		})();
		return () => {
			cancelled = true;
		};
	}, [actions, schemaNames]);

	React.useEffect(() => {
		if (!user?.id) return;
		let cancelled = false;
		(async () => {
			try {
				const response = await apiRef.current.v1.things.list({ thingtime: 'action', limit: 100 });
				if (cancelled) return;
				const list = (response?.things || []).filter((thing: ActionThing) => thing?.crystal);
				setActions(list);
				setLoaded(true);
				writeLocalCache(cacheKey, { actions: list } satisfies ActionsCache);
			} catch {
				if (!cancelled) setLoaded(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [user?.id, cacheKey]);

	return (
		<Flex
			background="var(--tt-surface, #fafafb)"
			justify="center"
			minHeight="100vh"
			paddingBottom={16}
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
			width="100%"
		>
			<Stack maxW="920px" minW={0} px={{ base: 4, md: 6 }} pt={{ base: 4, md: 7 }} spacing={5} width="100%">
				<Flex align="flex-start" justify="space-between" gap={3} wrap="wrap">
					<Box minW={0}>
						<Text as="h1" fontSize="2xl" fontWeight="800" color="var(--tt-ink, #16161a)">
							⚡ Actions
						</Text>
						<Text color={MUTED} fontSize="sm" mt={1}>
							Small declarative programs over your things — typed inputs, explicit capabilities, a shared
							execution budget, and an inspectable trail. Click one to see exactly what it can (and cannot) do.
						</Text>
					</Box>
					{user && !building ? (
						<Button bg="var(--tt-accent, hotpink)" color="var(--tt-accent-contrast, #ffffff)" onClick={() => setBuilding(true)} size="sm" _hover={{ opacity: 0.9 }}>
							⚡ New action
						</Button>
					) : null}
				</Flex>
				{building ? <ActionBuilder onClose={() => setBuilding(false)} /> : null}
				{!user ? (
					<Box {...CARD_STYLES} p={6}>
						<Text color={MUTED}>Sign in to see and run your actions.</Text>
					</Box>
				) : actions.length === 0 && loaded ? (
					<Box {...CARD_STYLES} p={6}>
						<Text color="var(--tt-text, #33333c)">No actions yet.</Text>
						<Text color={MUTED} fontSize="sm" mt={2}>
							Create one through the unified things API — POST /api/v1/things with thingtime ["action"] — or
							seed the Customer/Invoice demo app: <code>node scripts/seed-demo-app.mjs</code>. The API
							reference lives at{' '}
							<Button as={Link} size="xs" to="/docs/api/actions" variant="link">
								/docs/api → actions
							</Button>
							.
						</Text>
					</Box>
				) : (
					<Stack spacing={3}>
						{/* each card is a REAL link to the action's inspector — middle-click,
						    ⌘-click and the keyboard all work; the card itself stays inert (no
						    armed control ever lives on a browse surface). Any button that
						    lands inside ActionCard must stopPropagation so it never follows
						    the link. */}
						{actions.map((action) => (
							<Box
								as={Link}
								_focusVisible={{ outline: '2px solid var(--tt-accent, #7c6cff)', outlineOffset: '2px', borderRadius: 'var(--tt-radius-lg, 16px)' }}
								color="inherit"
								data-testid="action-card-link"
								display="block"
								key={action.id}
								textDecoration="none"
								to={`/actions/${encodeURIComponent(action.id)}`}
							>
								<ActionCard action={action} schemaNames={schemaNames} />
							</Box>
						))}
					</Stack>
				)}
			</Stack>
		</Flex>
	);
};
