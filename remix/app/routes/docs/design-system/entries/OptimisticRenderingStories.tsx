import React from 'react';
import { Box, Flex, Grid, Spinner, Text } from '@chakra-ui/react';

import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Optimistic rendering practice. Everything here is
// self-contained and offline: the "server" is a setTimeout, the "device cache"
// is a module variable standing in for the tt-<domain> localStorage mirror
// (~/hooks/localCache) so the demo can't pollute real keys. The two panels
// run the two competing recipes side by side — the spinner side exists to be
// pointed at, not copied.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const PanelLabel = (props: { children: React.ReactNode; danger?: boolean }) => (
	<Text
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.14em"
		textTransform="uppercase"
		color={props.danger ? 'var(--tt-danger, #e5484d)' : 'var(--tt-muted, #9a9aa6)'}
		marginBottom="8px"
	>
		{props.children}
	</Text>
);

type DemoAccount = { username: string; displayName: string; active?: boolean };

const DEMO_ROSTER: DemoAccount[] = [
	{ username: 'sunny', displayName: 'Sunny 🌻', active: true },
	{ username: 'gardener', displayName: 'The Gardener' },
	{ username: 'thingtime-dev', displayName: 'Dev account' }
];

// The stand-in for readLocalCache('tt-accounts-roster'): a device mirror that
// survives "reopening the switcher" (remounting), exactly like localStorage
// survives a page load.
let demoDeviceMirror: DemoAccount[] | null = null;

const AccountRow = (props: { account: DemoAccount }) => (
	<Flex
		alignItems="center"
		columnGap="10px"
		paddingX="10px"
		paddingY="7px"
		borderRadius="var(--tt-radius-sm, 9px)"
		background={props.account.active ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
	>
		<Flex
			width="26px"
			height="26px"
			flexShrink={0}
			alignItems="center"
			justifyContent="center"
			borderRadius="50%"
			background="var(--tt-accent-tint, #ffe3f1)"
			fontSize="12px"
		>
			{props.account.displayName.slice(0, 1)}
		</Flex>
		<Box minWidth={0}>
			<Text fontSize="13px" fontWeight={600} color="var(--tt-ink, #16161a)" noOfLines={1}>
				{props.account.displayName}
			</Text>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>
				@{props.account.username}
				{props.account.active ? ' · active' : ''}
			</Text>
		</Box>
	</Flex>
);

const SwitcherFrame = (props: { children: React.ReactNode; footer: React.ReactNode }) => (
	<Box
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-card, #ffffff)"
		boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
		padding="10px"
		minHeight="150px"
	>
		<Flex flexDirection="column" rowGap="2px" minHeight="112px">
			{props.children}
		</Flex>
		<Text fontFamily={MONO} fontSize="9.5px" color="var(--tt-faint, #b6b6c0)" marginTop="8px">
			{props.footer}
		</Text>
	</Box>
);

// The house recipe, shaped exactly like useAccountSwitcher: seed synchronously
// from the mirror in the useState lazy initializer, refetch in the background,
// commit through one funnel that keeps the mirror in lockstep.
const CachedPanel = () => {
	const [accounts, setAccounts] = React.useState<DemoAccount[]>(() => demoDeviceMirror || []);
	// the spinner is reserved for a true cold start (no cache at all)
	const [loading, setLoading] = React.useState(() => demoDeviceMirror === null);
	const [fresh, setFresh] = React.useState(false);

	React.useEffect(() => {
		const timer = setTimeout(() => {
			demoDeviceMirror = DEMO_ROSTER;
			setAccounts(DEMO_ROSTER);
			setLoading(false);
			setFresh(true);
		}, 1100);
		return () => clearTimeout(timer);
	}, []);

	return (
		<SwitcherFrame
			footer={
				loading
					? 'true cold start — no mirror yet, spinner is honest here'
					: fresh
						? 'reconciled with the server in the background'
						: 'painted from the tt-accounts-roster mirror at 0ms'
			}
		>
			{loading ? (
				<Flex alignItems="center" justifyContent="center" minHeight="112px" columnGap="8px">
					<Spinner size="sm" color="var(--tt-muted, #9a9aa6)" />
					<Text fontSize="12px" color="var(--tt-muted, #9a9aa6)">
						Checking accounts…
					</Text>
				</Flex>
			) : (
				accounts.map((account) => <AccountRow key={account.username} account={account} />)
			)}
		</SwitcherFrame>
	);
};

// The anti-pattern: prior state exists on the device, but the component
// ignores it and gates every open behind the network.
const SpinnerPanel = () => {
	const [accounts, setAccounts] = React.useState<DemoAccount[] | null>(null);

	React.useEffect(() => {
		const timer = setTimeout(() => setAccounts(DEMO_ROSTER), 1100);
		return () => clearTimeout(timer);
	}, []);

	return (
		<SwitcherFrame
			footer={accounts ? '1100ms of spinner for data the device already had' : 'the roster is in localStorage RIGHT NOW…'}
		>
			{accounts ? (
				accounts.map((account) => <AccountRow key={account.username} account={account} />)
			) : (
				<Flex alignItems="center" justifyContent="center" minHeight="112px" columnGap="8px">
					<Spinner size="sm" color="var(--tt-muted, #9a9aa6)" />
					<Text fontSize="12px" color="var(--tt-muted, #9a9aa6)">
						Checking accounts…
					</Text>
				</Flex>
			)}
		</SwitcherFrame>
	);
};

const CachedVsSpinnerStory = () => {
	const [generation, setGeneration] = React.useState(0);

	return (
		<Box>
			<Flex columnGap="10px" rowGap="8px" flexWrap="wrap" alignItems="center" marginBottom={4}>
				<Box
					as="button"
					type="button"
					paddingX="14px"
					paddingY="8px"
					minHeight="44px"
					background="var(--tt-accent, hotpink)"
					color="var(--tt-accent-contrast, #ffffff)"
					borderRadius="var(--tt-radius-md, 12px)"
					fontSize="13px"
					fontWeight={600}
					cursor="pointer"
					onClick={() => setGeneration((current) => current + 1)}
				>
					{generation === 0 ? 'Open the switcher' : 'Reopen the switcher'}
				</Box>
				<Box
					as="button"
					type="button"
					paddingX="12px"
					paddingY="8px"
					minHeight="44px"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					fontSize="12px"
					color="var(--tt-text, #5a5a66)"
					cursor="pointer"
					onClick={() => {
						demoDeviceMirror = null;
						setGeneration((current) => current + 1);
					}}
				>
					Clear the device mirror (cold start)
				</Box>
			</Flex>
			<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} columnGap={6} rowGap={5}>
				<Box>
					<PanelLabel>The house rule — seed from the mirror, refetch behind it</PanelLabel>
					{generation > 0 ? <CachedPanel key={`cached-${generation}`} /> : <ClosedSwitcherHint />}
				</Box>
				<Box>
					<PanelLabel danger>The anti-pattern — spinner-gates data it already has</PanelLabel>
					{generation > 0 ? <SpinnerPanel key={`spinner-${generation}`} /> : <ClosedSwitcherHint />}
				</Box>
			</Grid>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={3}>
				first open = cold start (both sides honestly spin) · every reopen = the difference: 0ms paint vs 1100ms of
				“Checking accounts…”
			</Text>
		</Box>
	);
};

const ClosedSwitcherHint = () => (
	<Flex
		alignItems="center"
		justifyContent="center"
		minHeight="182px"
		border="1px dashed var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
	>
		<Text fontSize="12px" color="var(--tt-faint, #b6b6c0)">
			switcher closed
		</Text>
	</Flex>
);

// Optimistic mutation: the reaction pill flips instantly, the server settles
// later, and a failure reverts (with a note) instead of blocking the tap.
const OptimisticReactionStory = () => {
	const [reacted, setReacted] = React.useState(false);
	const [count, setCount] = React.useState(11);
	const [failNext, setFailNext] = React.useState(false);
	const [log, setLog] = React.useState('tap the pill — it repaints before any request settles');
	const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[]
	);

	const react = () => {
		const adding = !reacted;
		// 1. repaint immediately (applyReactionToggle in PostCard.tsx)
		setReacted(adding);
		setCount((current) => current + (adding ? 1 : -1));
		setLog(adding ? 'optimistic +1 painted · request in flight…' : 'optimistic −1 painted · request in flight…');
		if (timerRef.current) clearTimeout(timerRef.current);
		const shouldFail = failNext;
		// 2. reconcile with the server's answer — or revert on failure
		timerRef.current = setTimeout(() => {
			if (shouldFail) {
				setReacted(!adding);
				setCount((current) => current - (adding ? 1 : -1));
				setLog('server said no → reverted to the truth (and the UI never froze)');
			} else {
				setLog('server confirmed — counts reconciled with the response');
			}
		}, 800);
	};

	return (
		<Box>
			<Flex alignItems="center" columnGap="12px" flexWrap="wrap" rowGap="10px">
				<Flex
					as="button"
					type="button"
					aria-label={reacted ? 'Remove your 🌻 reaction' : 'React with 🌻'}
					alignItems="center"
					columnGap="6px"
					minHeight="44px"
					paddingX="14px"
					border="1px solid"
					borderColor={reacted ? 'var(--tt-accent, hotpink)' : 'var(--tt-border, #ececef)'}
					borderRadius="var(--tt-radius-pill, 999px)"
					background={reacted ? 'var(--tt-accent-tint, #ffe3f1)' : 'var(--tt-card, #ffffff)'}
					cursor="pointer"
					onClick={react}
				>
					<Text fontSize="16px">🌻</Text>
					<Text fontFamily={MONO} fontSize="12px" fontWeight={600} color="var(--tt-ink, #16161a)">
						{count}
					</Text>
				</Flex>
				<Flex as="label" alignItems="center" columnGap="7px" cursor="pointer" minHeight="44px">
					<input type="checkbox" checked={failNext} onChange={(event) => setFailNext(event.target.checked)} />
					<Text fontSize="12px" color="var(--tt-text, #5a5a66)">
						make the next request fail
					</Text>
				</Flex>
			</Flex>
			<Text fontFamily={MONO} fontSize="10.5px" color="var(--tt-muted, #9a9aa6)" marginTop={3}>
				{log}
			</Text>
		</Box>
	);
};

// The layered first-paint model: which tier is allowed to answer at which
// moment. Rendered as a timeline so "gates first paint" stops being abstract.
const TIER_STEPS: { at: string; title: string; body: string }[] = [
	{
		at: '0ms · route resolving',
		title: 'HydrateFallback — a steady background, never a spinner',
		body: 'While the router resolves the initial navigation, routes.tsx renders an empty min-height surface holding the themed page background. Deliberately not a skeleton: the house rule says never flash a loading state.'
	},
	{
		at: 'first render',
		title: 'localCache — the synchronous tier (localStorage, tt-<domain>)',
		body: 'readLocalCache() in a useState lazy initializer paints last-known state in the same frame React mounts. Real keys: tt-accounts-roster, tt-recent-reactions:<userId>, tt-messenger-chats:<userId>, tt-schemas-<userId>, tt-search. This is the ONLY tier fast enough to gate first paint.'
	},
	{
		at: 'after mount',
		title: 'Async stores — localforage “thingtime” blob, module caches',
		body: 'Big state that does not gate first paint lives in the async localforage blob (ThingtimeProvider) or per-module memory like SiteBlocksHost’s routeCache/globalCache resolve maps. It hydrates after mount and must never be the thing an empty screen waits on.'
	},
	{
		at: 'background',
		title: 'The network — refetch, reconcile, revert',
		body: 'The real API call lands last. Fresh data reconciles over the cached paint (and every commit rewrites the mirror, like commitAccounts in useAccountSwitcher); a failure reverts the optimistic copy or fetches the truth (PostCard reactions).'
	}
];

const CacheTiersStory = () => (
	<Flex flexDirection="column" rowGap={0}>
		{TIER_STEPS.map((step, index) => (
			<Flex key={step.at} columnGap="14px" alignItems="stretch">
				<Flex flexDirection="column" alignItems="center" width="14px" flexShrink={0}>
					<Box
						width="10px"
						height="10px"
						borderRadius="50%"
						background={index === 1 ? 'var(--tt-accent, hotpink)' : 'var(--tt-border, #ececef)'}
						border="2px solid var(--tt-card, #ffffff)"
						boxShadow="0 0 0 1px var(--tt-border, #ececef)"
						marginTop="4px"
					/>
					{index < TIER_STEPS.length - 1 && <Box width="1px" flex="1" background="var(--tt-border-light, #f0f0f2)" />}
				</Flex>
				<Box paddingBottom={index < TIER_STEPS.length - 1 ? 5 : 0} minWidth={0}>
					<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
						{step.at}
					</Text>
					<Text fontSize="13.5px" fontWeight={600} color="var(--tt-ink, #16161a)" marginTop="2px">
						{step.title}
					</Text>
					<Text fontSize="12.5px" lineHeight="1.6" color="var(--tt-text, #5a5a66)" marginTop="3px" maxWidth="640px">
						{step.body}
					</Text>
				</Box>
			</Flex>
		))}
	</Flex>
);

export const optimisticRenderingStories: DesignSystemStory[] = [
	{
		id: 'cached-vs-spinner',
		title: 'Cached paint vs spinner flash',
		description:
			'The account-switcher scenario, run both ways against the same 1100ms “server”. The left panel follows useAccountSwitcher.tsx: seed synchronously from the device mirror in a useState lazy initializer, refetch behind the paint, reserve the spinner for a true cold start. The right panel is the anti-pattern this rule bans — it spinner-gates data the device already holds, so every single open costs a “Checking accounts…” flash.',
		render: CachedVsSpinnerStory,
		note: 'The demo “mirror” is module state standing in for readLocalCache("tt-accounts-roster") — same lifetime shape, no real keys touched.'
	},
	{
		id: 'optimistic-reaction',
		title: 'Optimistic mutation with revert',
		description:
			'The PostCard reaction recipe: repaint immediately, reconcile with the server’s counts when the response lands, revert to the truth on failure. Tick the failure box and tap again — the pill flips instantly either way; only the settlement differs. The UI never blocks a tap on a round-trip.',
		render: OptimisticReactionStory,
		note: 'Real implementation: handleReact in Feed/PostCard.tsx — applyReactionToggle → api.v1.things.react → reconcile, with in-flight token guards so a toggle endpoint never races itself.'
	},
	{
		id: 'cache-tiers',
		title: 'The first-paint timeline (which tier answers when)',
		description:
			'Optimistic rendering is a layering rule, not just a vibe: HydrateFallback holds the themed background while the route resolves; the synchronous localCache tier (localStorage, tt-<domain> keys) is the only store fast enough to seed the first render; the async localforage blob and module caches hydrate after mount; the network lands last and reconciles. Anything that gates first paint must live in tier two — the async blob cannot seed a lazy initializer.',
		render: CacheTiersStory
	}
];
