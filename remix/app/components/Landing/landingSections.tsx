import { Box, Flex, Input, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink } from 'react-router';

import { Logo } from '~/components/Branding/Logo';
import { useLopu } from '~/components/Lopu/useLopu';
import { Thingtime } from '~/components/Thingtime/Thingtime';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { useApi } from '~/hooks/useApi';

import { RAINBOW_TEXT } from '~/theme/rainbow';

import { BrutalButton } from './BrutalButton';
import { burstAtEvent, burstConfetti } from './confetti';

// The home landing (/) decomposed into standalone, pixel-identical SECTIONS —
// markup moved VERBATIM from Landing.tsx so the same components render the
// route AND its site-doc blocks (see Builder/nativeSections.tsx). The only
// page-local state shared by a section's lifecycle (waitlist membership) lives
// in a module-scoped store so sections stay order-independent; everything
// else (demo draft, open FAQ) is section-local. The landing's full-bleed
// chrome — background, safe-area/nav clearance padding, and the whiteSpace
// overrides the embedded Thingtime tree relies on — lives in LandingShell,
// which the route wraps around the section list (shellWidth 'full').

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const INK = 'var(--tt-ink, #1a1a1a)';
const TEXT = 'var(--tt-text, #4b4b4b)';
const MUTED = 'var(--tt-muted, #8a8a8a)';
const FAINT = 'var(--tt-faint, #c9c9c9)';
const HAIRLINE = 'var(--tt-border, #ececec)';
const CARD = 'var(--tt-card, #ffffff)';
const ACCENT = 'var(--tt-accent, hotpink)';
const ACCENT_TINT = 'var(--tt-accent-tint, #fff5fa)';
const PURPLE = 'var(--tt-landing-purple, #6f3198)';
const DISPLAY = 'var(--tt-font-display, -apple-system, BlinkMacSystemFont, sans-serif)';
const CHUNKY = 'var(--tt-border-w-chunky, 3px)';

const RainbowSpan = ({ children }: { children: React.ReactNode }) => (
	<Text
		as="span"
		color="transparent"
		background={RAINBOW_TEXT}
		backgroundSize="calc(100px + 200%)"
		sx={{
			WebkitBackgroundClip: 'text',
			backgroundClip: 'text',
			animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
		}}
	>
		{children}
	</Text>
);

const Eyebrow = ({ color = PURPLE, children }: any) => (
	<Text fontSize="12px" fontWeight={800} letterSpacing="0.2em" color={color} fontFamily={DISPLAY}>
		{children}
	</Text>
);

const SectionH2 = ({ children, chakras = {} }: any) => (
	<Text
		as="h2"
		margin={0}
		fontSize="clamp(32px, 4vw, 44px)"
		lineHeight={1.06}
		fontWeight={900}
		letterSpacing="-0.03em"
		fontFamily={DISPLAY}
		color={INK}
		{...chakras}
	>
		{children}
	</Text>
);

const ColorDot = ({ color, size = '10px' }: { color: string; size?: string }) => (
	<Box as="span" width={size} height={size} background={color} flex="none" display="inline-block" />
);

const BulletRow = ({ color, children }: any) => (
	<Flex alignItems="center" gap="10px" fontSize="15px" color={INK}>
		<ColorDot color={color} />
		{children}
	</Flex>
);

/* ------------------------------------------------------------------ */
/* Shared page state: waitlist membership. Module-scoped (same pattern */
/* as useVercelStatusData in Status/statusSections.tsx) so any section */
/* mounted in any order sees the same value — last-known state paints  */
/* instantly, localStorage hydrates it after mount.                    */
/* ------------------------------------------------------------------ */

let waitlistJoined = false;
const waitlistListeners = new Set<() => void>();
const notifyWaitlist = () => waitlistListeners.forEach((listener) => listener());

export const useWaitlistJoined = () => {
	const [, force] = React.useReducer((tick: number) => tick + 1, 0);

	React.useEffect(() => {
		waitlistListeners.add(force);
		try {
			if (!waitlistJoined && window.localStorage.getItem('tt-waitlist-joined') === 'true') {
				waitlistJoined = true;
				notifyWaitlist();
			}
		} catch (error) {
			// ignore
		}
		return () => {
			waitlistListeners.delete(force);
		};
	}, []);

	const setJoined = React.useCallback(() => {
		waitlistJoined = true;
		try {
			window.localStorage.setItem('tt-waitlist-joined', 'true');
		} catch (error) {
			// ignore
		}
		notifyWaitlist();
	}, []);

	return { joined: waitlistJoined, setJoined };
};

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
	{ href: '#demo', label: 'Demo' },
	{ href: '#use-cases', label: 'Use cases' },
	{ href: '#ecosystem', label: 'Ecosystem' },
	{ href: '#developers', label: 'Developers' },
	{ href: '#back', label: 'Back us 💖', color: PURPLE },
	{ href: '#faq', label: 'FAQ' }
];

const LandingNav = () => (
	<Flex
		as="nav"
		className="landingNav"
		position="sticky"
		// Clear the fixed global app nav (~54px) so the two bars stack cleanly.
		top="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
		zIndex={50}
		background="rgba(255, 255, 255, 0.94)"
		sx={{ backdropFilter: 'blur(8px)' }}
		borderBottom={`1px solid ${HAIRLINE}`}
		alignItems="center"
		justifyContent="space-between"
		padding="10px 28px"
		gap="16px"
		flexWrap="wrap"
	>
		<Flex as="a" href="#top" alignItems="center" gap="10px" textDecoration="none" color={INK}>
			<Logo icon theme="nature" voxelSize={9} space="0px" />
			<Text fontWeight={800} fontSize="16px" fontFamily={DISPLAY}>
				thingtime
			</Text>
		</Flex>
		<Flex alignItems="center" gap="20px" fontSize="14px" fontWeight={600} color={TEXT} flexWrap="wrap">
			{NAV_LINKS.map((link) => (
				<Box
					key={link.href}
					as="a"
					href={link.href}
					color={link.color || 'inherit'}
					textDecoration="none"
					_hover={{ color: INK }}
				>
					{link.label}
				</Box>
			))}
			<Box
				as={RouterLink}
				to="/things/Content"
				background={INK}
				color={CARD}
				fontWeight={700}
				padding="9px 16px"
				textDecoration="none"
			>
				Open the app
			</Box>
		</Flex>
	</Flex>
);

/* ------------------------------------------------------------------ */
/* Hero + waitlist                                                     */
/* ------------------------------------------------------------------ */

const PLATFORM_CHIPS = ['🌐 Web', '📱 iOS', '⌨️ Raycast', '🔌 API'];

const Hero = () => {
	const lopu = useLopu();
	const api = useApi();
	const { joined, setJoined } = useWaitlistJoined();
	const [email, setEmail] = React.useState('');
	const [joining, setJoining] = React.useState(false);

	const join = async (event: any) => {
		const address = email.trim();
		if (!address || joining) return;
		setJoining(true);
		try {
			const resp: any = await api.v1.waitlist.join({ email: address });
			setJoined();
			burstAtEvent(event, 120);
			// first contact is a gift: the API sends a fortune from Lopu's musing
			// library — surface it as the welcome (claude-todo/10 ✨)
			const fortune = typeof resp?.fortune === 'string' && resp.fortune ? resp.fortune : null;
			lopu({
				title: "You're on the waitlist! 💖",
				description: fortune ? `Your welcome fortune: ${fortune}` : "We'll write soon. No spam, only rainbows.",
				status: 'success',
				duration: fortune ? 9000 : undefined
			});
		} catch (error: any) {
			lopu({
				title: 'Waitlist hiccup 🌧️',
				description: error?.error || 'Could not join right now — please try again.',
				status: 'error'
			});
		} finally {
			setJoining(false);
		}
	};

	return (
		<Flex
			id="top"
			as="header"
			direction="column"
			alignItems="center"
			textAlign="center"
			padding="84px 24px 64px"
		>
			<Logo icon theme="nature" voxelSize={15} space="0px" />
			<Text
				as="h1"
				margin="30px 0 0"
				fontSize="clamp(44px, 7vw, 74px)"
				lineHeight={1.02}
				fontWeight={900}
				letterSpacing="-0.03em"
				maxWidth="900px"
				fontFamily={DISPLAY}
				color={INK}
			>
				A <RainbowSpan>GUI for the internet</RainbowSpan>.
			</Text>
			<Text margin="22px 0 0" maxWidth="560px" fontSize="20px" lineHeight={1.55} color={TEXT}>
				Thingtime keeps anything you care about — notes, cars, tools, ideas — as living, shareable things.
			</Text>
			{!joined ? (
				<>
					<Flex marginTop="34px" gap="12px" flexWrap="wrap" justifyContent="center">
						<Input
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') join(e);
							}}
							placeholder="you@anywhere.com"
							type="email"
							width="min(300px, 70vw)"
							border={`${CHUNKY} solid ${INK}`}
							borderRadius="0"
							padding="14px 16px"
							height="auto"
							fontSize="15px"
							background={CARD}
							_placeholder={{ color: MUTED }}
						/>
						<BrutalButton onClick={join} padding="14px 22px">
							{joining ? 'Joining… ✨' : 'Join the waitlist 🚀'}
						</BrutalButton>
					</Flex>
					<Text marginTop="14px" fontSize="13px" color={MUTED}>
						Free while in beta · no spam, only rainbows
					</Text>
				</>
			) : (
				<Box
					marginTop="34px"
					border={`${CHUNKY} solid ${INK}`}
					boxShadow="var(--tt-shadow-hard-sm, 5px 5px 0 #1a1a1a)"
					background={ACCENT_TINT}
					padding="16px 26px"
					fontSize="17px"
					fontWeight={800}
					fontFamily={DISPLAY}
					color={INK}
				>
					You&apos;re in! 💖 We&apos;ll write soon.
				</Box>
			)}
			<Flex marginTop="44px" alignItems="center" gap="12px" flexWrap="wrap" justifyContent="center">
				<Text fontSize="12px" fontWeight={800} letterSpacing="0.16em" color={MUTED}>
					WORKS EVERYWHERE
				</Text>
				{PLATFORM_CHIPS.map((chip) => (
					<Box
						key={chip}
						border={`2px solid ${INK}`}
						padding="6px 12px"
						fontSize="13px"
						fontWeight={700}
						color={INK}
						fontFamily={DISPLAY}
					>
						{chip}
					</Box>
				))}
			</Flex>
		</Flex>
	);
};

/* ------------------------------------------------------------------ */
/* Live demo — the real Thingtime editor in a mac-window card          */
/* ------------------------------------------------------------------ */

const parseSmartValue = (raw: string) => {
	const s = raw.trim();
	if (s === 'true') return true;
	if (s === 'false') return false;
	if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
	return s;
};

const DemoSection = () => {
	const { setThingtime, getThingtime } = useThingtime();
	const [addDraft, setAddDraft] = React.useState('');

	const addThing = (event: any) => {
		const text = addDraft.trim();
		if (!text) return;
		const ix = text.indexOf(':');
		const label = (ix > 0 ? text.slice(0, ix) : text).trim();
		const value = ix > 0 ? parseSmartValue(text.slice(ix + 1)) : '✨';
		if (!label) return;
		setThingtime(`Content.${label}`, value, { namespace: 'user' });
		setAddDraft('');
		const rect = event?.target?.getBoundingClientRect?.();
		burstConfetti(rect ? rect.left + rect.width / 2 : window.innerWidth / 2, rect ? rect.top : 300, 40);
	};

	return (
		<Flex id="demo" as="section" padding="72px 24px" borderTop={`1px solid ${HAIRLINE}`} justifyContent="center">
			<Flex width="min(1060px, 100%)" gap="48px" alignItems="center" flexWrap="wrap">
				<Flex flex="1" minWidth="300px" direction="column" alignItems="flex-start">
					<Eyebrow>LIVE DEMO</Eyebrow>
					<SectionH2 chakras={{ marginTop: '12px' }}>Your stuff, structured.</SectionH2>
					<Text marginTop="16px" fontSize="17px" lineHeight={1.6} color={TEXT}>
						Every thing gets a path, a shape, and a GUI. This one&apos;s real — click a value to edit it, fold the
						branches, add your own things.
					</Text>
					<Flex marginTop="22px" direction="column" gap="10px">
						<BulletRow color="var(--tt-rainbow-3, #58ca70)">Edit it like a doc</BulletRow>
						<BulletRow color="var(--tt-rainbow-4, #59bdff)">Share it like a link</BulletRow>
						<BulletRow color="var(--tt-rainbow-2, #ffc20e)">Query it like a database</BulletRow>
					</Flex>
					<BrutalButton
						href="/things/Content"
						chakras={{ marginTop: '26px' }}
					>
						Open the full app ✨
					</BrutalButton>
				</Flex>
				<Box
					width="min(460px, 100%)"
					flex="none"
					border={`${CHUNKY} solid ${INK}`}
					boxShadow="var(--tt-shadow-hard-lg, 8px 8px 0 #1a1a1a)"
					background={CARD}
				>
					<Flex alignItems="center" gap="8px" padding="10px 14px" borderBottom={`${CHUNKY} solid ${INK}`}>
						<ColorDot color="#ed1c24" />
						<ColorDot color="#ffc20e" />
						<ColorDot color="#59ff9c" />
						<Text marginLeft="8px" fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)" fontSize="12.5px" color={MUTED}>
							tt · Content
						</Text>
					</Flex>
					<Flex padding="14px 16px" direction="column" minHeight="250px" maxHeight="420px" overflowY="auto">
						<Thingtime path="Content" valuePl={0} width="100%" />
					</Flex>
					<Box padding="0 16px 14px">
						<Input
							value={addDraft}
							onChange={(e) => setAddDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') addThing(e);
							}}
							placeholder="＋ add a thing… (try  mood: 🌈  and press enter)"
							width="100%"
							border={`2px dashed ${FAINT}`}
							borderRadius="0"
							padding="10px 12px"
							height="auto"
							fontSize="13.5px"
							background={CARD}
							color={INK}
							_placeholder={{ color: MUTED }}
						/>
					</Box>
				</Box>
			</Flex>
		</Flex>
	);
};

/* ------------------------------------------------------------------ */
/* Use cases                                                           */
/* ------------------------------------------------------------------ */

const USE_CASES = [
	{
		dot: 'var(--tt-rainbow-4, #59bdff)',
		title: 'Your car 🚗',
		copy: "Log every oil change and repair. When it's time to sell, share the whole maintenance history as one link — buyers see a well-kept car, you get a better price."
	},
	{
		dot: '#a8e61d',
		title: 'Your drill 🛠️',
		copy: 'List it, lend it, track who has it and when it’s due back — and get paid for the weekend. Fewer drills in the world, more holes in walls.'
	},
	{
		dot: '#ffa3b1',
		title: 'Your ideas 📝',
		copy: 'Notes, recipes, projects, whole app datasets — any shape you can imagine, in one place, readable by people and machines equally.'
	}
];

const UseCasesSection = () => (
	<Flex id="use-cases" as="section" padding="72px 24px" borderTop={`1px solid ${HAIRLINE}`} justifyContent="center">
		<Box width="min(900px, 100%)">
			<Text
				as="h2"
				margin={0}
				fontSize="clamp(40px, 6vw, 64px)"
				lineHeight={1}
				fontWeight={900}
				letterSpacing="-0.04em"
				fontFamily={DISPLAY}
				color={INK}
			>
				Everything
				<br />
				<RainbowSpan>is a thing.</RainbowSpan>
			</Text>
			<Flex marginTop="40px" direction="column">
				{USE_CASES.map((useCase, index) => (
					<Flex
						key={useCase.title}
						alignItems="center"
						gap="16px"
						padding="20px 0"
						borderTop={`2px solid ${INK}`}
						borderBottom={index === USE_CASES.length - 1 ? `2px solid ${INK}` : undefined}
						flexWrap="wrap"
					>
						<ColorDot color={useCase.dot} size="12px" />
						<Text fontSize="21px" fontWeight={800} width="170px" flex="none" fontFamily={DISPLAY} color={INK}>
							{useCase.title}
						</Text>
						<Text flex="1" minWidth="240px" fontSize="16px" color={TEXT} lineHeight={1.55}>
							{useCase.copy}
						</Text>
					</Flex>
				))}
			</Flex>
		</Box>
	</Flex>
);

/* ------------------------------------------------------------------ */
/* Ecosystem                                                           */
/* ------------------------------------------------------------------ */

const ECOSYSTEM = [
	{ emoji: '🌐', title: 'Web app', copy: 'thingtime.com — the full GUI' },
	{ emoji: '📱', title: 'iOS', copy: 'your things, in your pocket' },
	{ logo: true },
	{ emoji: '⌨️', title: 'Raycast', copy: 'command your things from anywhere' },
	{ emoji: '🔌', title: 'API', copy: 'build on things · REST v1' }
];

const EcosystemSection = () => (
	<Flex
		id="ecosystem"
		as="section"
		padding="72px 24px"
		borderTop={`1px solid ${HAIRLINE}`}
		direction="column"
		alignItems="center"
		textAlign="center"
	>
		<SectionH2>One brain. Every surface.</SectionH2>
		<Text marginTop="14px" maxWidth="520px" fontSize="17px" lineHeight={1.55} color={TEXT}>
			Your things live once, in Thingtime — and show up wherever you are.
		</Text>
		<Flex marginTop="36px" alignItems="center" justifyContent="center" gap="18px" flexWrap="wrap" maxWidth="1000px">
			{ECOSYSTEM.map((item, index) =>
				item.logo ? (
					<Box
						key="logo"
						border={`${CHUNKY} solid ${INK}`}
						boxShadow="6px 6px 0 var(--tt-ink, #1a1a1a)"
						background={CARD}
						padding="16px 18px"
					>
						<Logo icon theme="nature" voxelSize={14} space="0px" />
					</Box>
				) : (
					<Box
						key={item.title}
						width="210px"
						border={`${CHUNKY} solid ${INK}`}
						background={CARD}
						padding="16px 18px"
						textAlign="left"
					>
						<Text fontSize="22px">{item.emoji}</Text>
						<Text as="b" fontSize="15px" fontFamily={DISPLAY} color={INK}>
							{item.title}
						</Text>
						<Text fontSize="12.5px" color={MUTED} marginTop="2px">
							{item.copy}
						</Text>
					</Box>
				)
			)}
		</Flex>
	</Flex>
);

/* ------------------------------------------------------------------ */
/* Developers (dark)                                                   */
/* ------------------------------------------------------------------ */

const DARK_BG = 'var(--tt-dark-bg, #131318)';
const DARK_CODE = '#0b0b0f';
const DARK_BORDER = 'var(--tt-dark-border, #2a2a33)';
const DARK_TEXT = 'var(--tt-dark-muted, #8a8a95)';
const GREEN = 'var(--tt-dark-accent, #59ff9c)';

const CodeLine = ({ pad = 0, children }: any) => (
	<Box paddingLeft={`${pad}px`} whiteSpace="normal">
		{children}
	</Box>
);

const DevelopersSection = () => (
	<Flex id="developers" as="section" background={DARK_BG} color="#ffffff" padding="72px 24px" direction="column" alignItems="center">
		<Box textAlign="center">
			<Eyebrow color={GREEN}>DEVELOPERS</Eyebrow>
			<SectionH2 chakras={{ marginTop: '12px', color: '#ffffff' }}>One API. Every shape.</SectionH2>
			<Text marginTop="12px" fontSize="16.5px" color="var(--tt-dark-text, #b9b9c3)">
				Everything in Thingtime is a thing — readable by people, writable by machines.
			</Text>
		</Box>
		<Flex gap="20px" marginTop="32px" alignItems="stretch" flexWrap="wrap" justifyContent="center" width="min(980px, 100%)">
			<Box
				flex="1.15"
				minWidth="320px"
				background={DARK_CODE}
				border={`2px solid ${DARK_BORDER}`}
				padding="18px 20px"
				fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
				fontSize="13.5px"
				lineHeight={1.75}
			>
				<CodeLine>
					<Text as="span" color={ACCENT}>
						${' '}
					</Text>
					<Text as="span" color="#e6e6ec">
						curl thingtime.com/api/v1/things/car
					</Text>
				</CodeLine>
				<CodeLine>
					<Text as="span" color={DARK_TEXT}>
						{'{'}
					</Text>
				</CodeLine>
				<CodeLine pad={18}>
					<Text as="span" color="#59bdff">
						&quot;make&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						:{' '}
					</Text>
					<Text as="span" color={GREEN}>
						&quot;Subaru Outback&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						,
					</Text>
				</CodeLine>
				<CodeLine pad={18}>
					<Text as="span" color="#59bdff">
						&quot;repairs&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						: [
					</Text>
				</CodeLine>
				<CodeLine pad={36}>
					<Text as="span" color={DARK_TEXT}>
						{'{ '}
					</Text>
					<Text as="span" color="#59bdff">
						&quot;what&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						:{' '}
					</Text>
					<Text as="span" color={GREEN}>
						&quot;Oil change&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						,{' '}
					</Text>
					<Text as="span" color="#59bdff">
						&quot;cost&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						:{' '}
					</Text>
					<Text as="span" color="#ffc20e">
						89
					</Text>
					<Text as="span" color={DARK_TEXT}>
						{' },'}
					</Text>
				</CodeLine>
				<CodeLine pad={36}>
					<Text as="span" color={DARK_TEXT}>
						{'{ '}
					</Text>
					<Text as="span" color="#59bdff">
						&quot;what&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						:{' '}
					</Text>
					<Text as="span" color={GREEN}>
						&quot;Tires&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						,{' '}
					</Text>
					<Text as="span" color="#59bdff">
						&quot;cost&quot;
					</Text>
					<Text as="span" color={DARK_TEXT}>
						:{' '}
					</Text>
					<Text as="span" color="#ffc20e">
						412
					</Text>
					<Text as="span" color={DARK_TEXT}>
						{' }'}
					</Text>
				</CodeLine>
				<CodeLine pad={18}>
					<Text as="span" color={DARK_TEXT}>
						]
					</Text>
				</CodeLine>
				<CodeLine>
					<Text as="span" color={DARK_TEXT}>
						{'}'}
					</Text>
				</CodeLine>
			</Box>
			<Flex alignItems="center" color={GREEN} fontSize="22px" fontWeight={800}>
				→
			</Flex>
			<Flex
				flex="1"
				minWidth="280px"
				background="#ffffff"
				color="#1a1a1a"
				border={`2px solid ${DARK_BORDER}`}
				padding="16px 18px"
				fontSize="14px"
				direction="column"
				gap="9px"
			>
				<Box
					fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
					fontSize="12px"
					color="#8a8a8a"
					borderBottom="1px solid #ececec"
					paddingBottom="8px"
				>
					tt · car — same thing, as a GUI
				</Box>
				<Flex alignItems="center" gap="8px">
					<Text as="span" fontWeight={700} color={PURPLE}>
						make
					</Text>
					<Text as="span" color="#c9c9c9">
						·
					</Text>
					Subaru Outback
				</Flex>
				<Flex alignItems="center" gap="8px">
					<Text as="span" color="#8a8a8a">
						▾
					</Text>
					<Text as="span" fontWeight={800}>
						repairs
					</Text>
					<Text as="span" fontSize="12px" fontWeight={700} color="#8a8a8a" background="#f2f2f2" padding="1px 7px">
						2
					</Text>
				</Flex>
				<Flex alignItems="center" gap="8px" paddingLeft="20px">
					<ColorDot color="#59bdff" size="8px" />
					Oil change
					<Text as="span" color="#c9c9c9">
						·
					</Text>
					<b>$89</b>
				</Flex>
				<Flex alignItems="center" gap="8px" paddingLeft="20px">
					<ColorDot color="#ffc20e" size="8px" />
					Tires
					<Text as="span" color="#c9c9c9">
						·
					</Text>
					<b>$412</b>
				</Flex>
			</Flex>
		</Flex>
		<Flex justifyContent="center" gap="12px" marginTop="32px" flexWrap="wrap">
			<Box
				as={RouterLink}
				to="/docs"
				background={GREEN}
				color={DARK_BG}
				fontWeight={800}
				fontSize="15px"
				padding="13px 20px"
				border={`${CHUNKY} solid ${GREEN}`}
				cursor="pointer"
				fontFamily={DISPLAY}
				textDecoration="none"
			>
				Read the docs
			</Box>
			<Box
				as={RouterLink}
				to="/register"
				background="transparent"
				color="#fff"
				fontWeight={800}
				fontSize="15px"
				padding="13px 20px"
				border="3px solid #3a3a44"
				cursor="pointer"
				fontFamily={DISPLAY}
				textDecoration="none"
			>
				Get an API key
			</Box>
		</Flex>
	</Flex>
);

/* ------------------------------------------------------------------ */
/* Back the launch                                                     */
/* ------------------------------------------------------------------ */

const INDIEGOGO_URL = 'https://www.indiegogo.com/projects/thingtime-a-gui-for-the-internet/coming_soon';
const GOFUNDME_URL = 'https://www.gofundme.com/f/thingtime';

const TIERS = [
	{ title: '$25 · Sticker pack', copy: '+ your name in the credits' },
	{ title: '$60 · Merch 🌈', copy: 'the launch tee + stickers' },
	{ title: '$150 · Unicorn tier 🦄💯', copy: 'lifetime early access + merch', highlight: true }
];

const BackSection = () => (
	<Flex id="back" as="section" padding="72px 24px" justifyContent="center">
		<Flex width="min(1000px, 100%)" gap="44px" flexWrap="wrap">
			<Flex flex="1" minWidth="300px" direction="column" alignItems="flex-start">
				<Eyebrow>BACK THE LAUNCH</Eyebrow>
				<SectionH2 chakras={{ marginTop: '12px' }}>Help us launch the GUI for the internet 💖</SectionH2>
				<Text marginTop="16px" fontSize="17px" lineHeight={1.6} color={TEXT}>
					Thingtime is open, independent, and funded by people — not ads. Back the launch and own a piece of a
					friendlier internet.
				</Text>
				<Flex marginTop="22px" direction="column" gap="10px" fontSize="15.5px">
					<BulletRow color="var(--tt-rainbow-3, #59ff9c)">Open data — yours to export, always</BulletRow>
					<BulletRow color="var(--tt-rainbow-4, #59bdff)">People and machines read the same things</BulletRow>
					<BulletRow color="var(--tt-rainbow-2, #ffc20e)">Built in the open, shipped every week</BulletRow>
				</Flex>
				<Flex marginTop="28px" gap="12px" flexWrap="wrap">
					<BrutalButton href={INDIEGOGO_URL} target="_blank" rel="noopener" onClick={(e: any) => burstAtEvent(e)}>
						Back us on Indiegogo
					</BrutalButton>
					<BrutalButton
						variant="secondary"
						shadow={false}
						href={GOFUNDME_URL}
						target="_blank"
						rel="noopener"
						onClick={(e: any) => burstAtEvent(e)}
					>
						GoFundMe 💖
					</BrutalButton>
				</Flex>
			</Flex>
			<Flex
				width="min(340px, 100%)"
				flex="none"
				border={`${CHUNKY} solid ${INK}`}
				boxShadow="var(--tt-shadow-hard-lg, 8px 8px 0 #1a1a1a)"
				padding="22px 22px 20px"
				direction="column"
				gap="14px"
				alignSelf="flex-start"
				background={CARD}
			>
				<Box height="14px" background="var(--tt-surface-hover, #f1f1f1)" position="relative">
					<Box
						position="absolute"
						top={0}
						left={0}
						bottom={0}
						width="62%"
						background={RAINBOW_TEXT}
						backgroundSize="calc(100px + 200%)"
						sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
					/>
				</Box>
				<Flex alignItems="baseline" gap="8px">
					<Text fontSize="30px" fontWeight={900} fontFamily={DISPLAY} color={INK}>
						$12,438
					</Text>
					<Text fontSize="14px" color={MUTED}>
						of $20,000
					</Text>
				</Flex>
				<Flex gap="16px" fontSize="13.5px" color={TEXT}>
					<Text as="span">
						<b>148</b> backers
					</Text>
					<Text as="span">
						<b>21</b> days left
					</Text>
					<Text as="span">
						<b>🦄</b> 12 unicorns
					</Text>
				</Flex>
				<Flex borderTop={`1px solid ${HAIRLINE}`} paddingTop="14px" direction="column" gap="10px">
					{TIERS.map((tier) => (
						<Box
							key={tier.title}
							border={tier.highlight ? `2px solid ${ACCENT}` : `2px solid ${INK}`}
							background={tier.highlight ? ACCENT_TINT : undefined}
							padding="10px 12px"
						>
							<Text as="b" fontSize="14px" color={INK} fontFamily={DISPLAY}>
								{tier.title}
							</Text>
							<Text fontSize="12.5px" color={MUTED} marginTop="2px">
								{tier.copy}
							</Text>
						</Box>
					))}
				</Flex>
			</Flex>
		</Flex>
	</Flex>
);

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQS = [
	{
		q: 'What exactly is a “thing”?',
		a: 'Any piece of information — a note, a car, a drill, a recipe, a whole app’s data. Things nest inside each other, get a path like user.car.repairs, and every one of them has a GUI.'
	},
	{
		q: 'Is my data mine?',
		a: 'Yes. Data in Thingtime is open, accessible, and exportable — always. No lock-in, no ads. That’s the whole point.'
	},
	{
		q: 'Is it free?',
		a: 'Free while in beta. Backing the launch on Indiegogo or GoFundMe keeps Thingtime independent and gets you merch 🌈 and early-access perks 🦄.'
	},
	{
		q: 'Where does it run?',
		a: 'Web at thingtime.com, iOS, a Raycast extension, and a REST API (v1) — one brain, every surface.'
	},
	{
		q: 'How can I help?',
		a: 'Join the waitlist, back the launch, or build something on the API. Telling a friend also counts. 💖'
	}
];

const FaqSection = () => {
	const [openFaq, setOpenFaq] = React.useState(0);

	return (
		<Flex id="faq" as="section" padding="72px 24px 84px" borderTop={`1px solid ${HAIRLINE}`} justifyContent="center">
			<Box width="min(720px, 100%)">
				<SectionH2 chakras={{ margin: '0 0 28px' }}>Questions 🦄</SectionH2>
				{FAQS.map((faq, index) => (
					<Box key={faq.q} borderTop={`2px solid ${INK}`}>
						<Flex
							onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
							alignItems="center"
							justifyContent="space-between"
							gap="12px"
							padding="18px 4px"
							cursor="pointer"
							_hover={{ background: 'var(--tt-surface, #fafafa)' }}
						>
							<Text fontSize="17px" fontWeight={800} fontFamily={DISPLAY} color={INK}>
								{faq.q}
							</Text>
							<Text fontSize="18px" fontWeight={800} color={PURPLE}>
								{openFaq === index ? '−' : '＋'}
							</Text>
						</Flex>
						{openFaq === index ? (
							<Text margin={0} padding="0 4px 20px" fontSize="15.5px" lineHeight={1.6} color={TEXT} maxWidth="620px">
								{faq.a}
							</Text>
						) : null}
					</Box>
				))}
				<Box borderTop={`2px solid ${INK}`} />
			</Box>
		</Flex>
	);
};

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

const LandingFooter = () => (
	<Flex
		as="footer"
		borderTop={`1px solid ${HAIRLINE}`}
		padding="44px 24px 40px"
		direction="column"
		alignItems="center"
		gap="14px"
		textAlign="center"
	>
		<Logo icon theme="nature" voxelSize={6} space="0px" />
		<Flex gap="18px" fontSize="13.5px" fontWeight={600} color={TEXT} flexWrap="wrap" justifyContent="center">
			<Box as={RouterLink} to="/things/Content" color="inherit">
				Open the app
			</Box>
			<Box as="a" href="https://thingtime.com" target="_blank" rel="noopener" color="inherit">
				thingtime.com
			</Box>
			<Box as="a" href={INDIEGOGO_URL} target="_blank" rel="noopener" color="inherit">
				Indiegogo
			</Box>
			<Box as="a" href={GOFUNDME_URL} target="_blank" rel="noopener" color="inherit">
				GoFundMe
			</Box>
		</Flex>
		<Text fontSize="18px" letterSpacing="5px">
			🚀 🌈 ✨ 🦄 💖
		</Text>
		<Text fontSize="12.5px" color={MUTED}>
			© 2026 Thingtime · data should be open, accessible, and empowering
		</Text>
	</Flex>
);

/* ------------------------------------------------------------------ */
/* Shell + the exported sections                                       */
/* ------------------------------------------------------------------ */

// The landing's full-bleed page chrome — background, safe-area/nav clearance
// padding, and the whiteSpace overrides the embedded Thingtime tree relies
// on. The route (and any sectioned composition of this page) wraps the
// section list in it; without it the demo card's Thingtime tree loses its
// pre-wrap behaviour and the sticky nav sits under the global app nav.
export const LandingShell = ({ children }: { children: React.ReactNode }) => (
	<Box
		background={CARD}
		color={INK}
		width="100%"
		paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
		sx={{
			// The landing copy wants normal wrapping (Main.tsx applies pre-wrap
			// globally), but the embedded Thingtime tree still relies on pre-wrap.
			'& *': { whiteSpace: 'normal' },
			'& .thing, & .thing *': { whiteSpace: 'pre-wrap' }
		}}
	>
		{children}
	</Box>
);

// The sticky landing nav is page chrome, not reorderable marketing content —
// it ships with the hero as one section so the header always stays intact.
export const HomeHeroSection = () => (
	<>
		<LandingNav />
		<Hero />
	</>
);
export const HomeDemoSection = DemoSection;
export const HomeUseCasesSection = UseCasesSection;
export const HomeEcosystemSection = EcosystemSection;
export const HomeDevelopersSection = DevelopersSection;
export const HomeBackSection = BackSection;
export const HomeFaqSection = FaqSection;
export const HomeFooterSection = LandingFooter;

// Ordered composition of the page — the route renders this list until the
// central registry (Builder/nativeSections.tsx) carries the 'home' entry.
export const LANDING_SECTIONS: Array<{ key: string; title: string; Component: React.ComponentType }> = [
	{ key: 'home-hero', title: 'Nav & hero', Component: HomeHeroSection },
	{ key: 'home-demo', title: 'Live demo', Component: HomeDemoSection },
	{ key: 'home-use-cases', title: 'Use cases', Component: HomeUseCasesSection },
	{ key: 'home-ecosystem', title: 'Ecosystem', Component: HomeEcosystemSection },
	{ key: 'home-developers', title: 'Developers', Component: HomeDevelopersSection },
	{ key: 'home-back', title: 'Back the launch', Component: HomeBackSection },
	{ key: 'home-faq', title: 'FAQ', Component: HomeFaqSection },
	{ key: 'home-footer', title: 'Footer', Component: HomeFooterSection }
];
