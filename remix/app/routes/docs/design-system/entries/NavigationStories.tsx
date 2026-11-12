import React from 'react';
import { Box, Button, Center, Flex, Input, Tab, TabList, TabPanel, TabPanels, Tabs, Text } from '@chakra-ui/react';
import { ChevronDown, PanelLeft, Search } from 'lucide-react';

import { Icon } from '~/components/Icon/Icon';
import { RAINBOW } from '~/theme/rainbow';
import {
	DRAWER_KEEP_OPEN_DEFAULT_IDS,
	buildDrawerSubSections,
	drawerMenuItems,
	filterDrawerItemsByAuth
} from '~/components/Nav/Drawer/drawerMenu';
import {
	DRAWER_DEFAULT_WIDTH,
	DRAWER_MAX_WIDTH,
	DRAWER_MIN_WIDTH,
	DRAWER_TOP_LEVEL_DEFAULT_LIMIT,
	DRAWER_VIEWPORT_GUTTER
} from '~/components/Nav/Drawer/useDrawer';
import type { DrawerSubItem, DrawerTopItem } from '~/components/Nav/Drawer/drawerMenu';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the navigation group: top nav, drawer, Commander, and the
// admin segmented tabs. The chrome components themselves are app singletons
// (Nav and DrawerSystem mount once in root.tsx and read live thingtime
// settings), so the nav/drawer stories are faithful miniatures built from the
// exact token recipes in their sources — while the drawer menu MODEL, its
// helpers, its constants, and the segmented-tab recipe are the real imports.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const SpecLine = (props: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="10px">
		{props.children}
	</Text>
);

// ---------------------------------------------------------------------------
// Top nav
// ---------------------------------------------------------------------------

// The glass chassis recipe from Nav.tsx (lines 149–172): translucent card
// wash + 14px blur + hairline bottom border, over scrollable content.
const MiniGlassBar = (props: { children: React.ReactNode }) => (
	<Flex
		position="absolute"
		top={0}
		left={0}
		right={0}
		zIndex={2}
		alignItems="center"
		paddingX="18px"
		paddingY="12px"
		background="color-mix(in srgb, var(--tt-card, #ffffff) 78%, transparent)"
		borderBottom="1px solid var(--tt-border, #ececef)"
		sx={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
	>
		{props.children}
	</Flex>
);

const TopNavGlassStory = () => (
	<Box
		position="relative"
		height="240px"
		overflow="hidden"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-surface, #fafafb)"
	>
		<Box position="absolute" inset={0} overflow="auto">
			<Flex flexDirection="column" rowGap={3} padding="66px 18px 18px">
				{[1, 2, 3, 4, 5].map((n) => (
					<Flex
						key={n}
						flexShrink={0}
						alignItems="center"
						columnGap={3}
						height="52px"
						paddingX={4}
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-md, 12px)"
					>
						<Box width="18px" height="18px" flexShrink={0} borderRadius="999px" background={`var(--tt-rainbow-${n}, #b8b8c2)`} />
						<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
							Feed item {n} — scroll me under the glass
						</Text>
					</Flex>
				))}
			</Flex>
		</Box>
		<MiniGlassBar>
			{/* left: home unicorn (mirrored), with room reserved for the fixed drawer trigger */}
			<Flex alignItems="center" columnGap={2} marginRight="auto" paddingLeft="34px">
				<Box transform="scaleX(-100%)" cursor="pointer">
					<Icon size="12px" name="🦄"></Icon>
				</Box>
			</Flex>
			{/* centre: the Commander pill, absolutely centred (see the Commander entry) */}
			<Center
				position="absolute"
				left="50%"
				transform="translateX(-50%)"
				justifyContent="flex-start"
				width="min(44%, 210px)"
				height="30px"
				paddingX={3}
				background="var(--tt-surface-alt, #f5f5f7)"
				borderRadius="var(--tt-radius-xs, 7px)"
			>
				<Text fontSize="12px" color="var(--tt-muted, #9a9aa6)">
					Imagine..
				</Text>
			</Center>
			{/* right: account cluster — relative + above the commander host so long
			    usernames stay tappable where they extend under the pill */}
			<Flex position="relative" zIndex={1} alignItems="center" columnGap={4} marginLeft="auto">
				<Box opacity={0.3} transform="scaleX(-100%)" cursor="pointer" title="Edit mode toggle">
					<Icon size="12px" name="🎨"></Icon>
				</Box>
				<Box cursor="pointer" title="Notifications">
					<Icon size="12px" name="🔔"></Icon>
				</Box>
				<Flex alignItems="center" columnGap={2} cursor="pointer">
					<Text fontSize="xs" fontWeight={600} color="var(--tt-ink, #16161a)">
						sunny
					</Text>
					<Icon transform="scaleX(-100%)" size="12px" name="🌈"></Icon>
				</Flex>
			</Flex>
		</MiniGlassBar>
	</Box>
);

const TopNavDrawerShiftStory = () => {
	const [open, setOpen] = React.useState(true);
	const [direction, setDirection] = React.useState<'left' | 'right'>('left');

	const drawerWidth = 128;

	return (
		<Box>
			<Flex columnGap={2} marginBottom={3} flexWrap="wrap" rowGap={2}>
				<Button size="xs" variant="outline" onClick={() => setOpen((prev) => !prev)}>
					{open ? 'Close drawer' : 'Open drawer'}
				</Button>
				<Button size="xs" variant="outline" onClick={() => setDirection((prev) => (prev === 'left' ? 'right' : 'left'))}>
					Opens: {direction}
				</Button>
			</Flex>
			<Box
				position="relative"
				height="190px"
				overflow="hidden"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				background="var(--tt-surface, #fafafb)"
			>
				{/* miniature pinned drawer */}
				<Box
					position="absolute"
					top={0}
					bottom={0}
					left={direction === 'left' ? 0 : undefined}
					right={direction === 'right' ? 0 : undefined}
					width={`${drawerWidth}px`}
					background="var(--tt-card, #ffffff)"
					borderRight={direction === 'left' ? '1px solid var(--tt-border, #ececef)' : undefined}
					borderLeft={direction === 'right' ? '1px solid var(--tt-border, #ececef)' : undefined}
					transform={open ? 'translateX(0)' : direction === 'left' ? 'translateX(-102%)' : 'translateX(102%)'}
					transition="transform 0.28s ease-out"
					padding={3}
				>
					<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
						drawer
					</Text>
				</Box>
				{/* the nav follows: its offset edge picks up the drawer width */}
				<Flex
					position="absolute"
					top={0}
					left={direction === 'left' && open ? `${drawerWidth}px` : 0}
					right={direction === 'right' && open ? `${drawerWidth}px` : 0}
					alignItems="center"
					paddingX="14px"
					paddingY="10px"
					background="color-mix(in srgb, var(--tt-card, #ffffff) 78%, transparent)"
					borderBottom="1px solid var(--tt-border, #ececef)"
					transition="left 0.28s ease-out, right 0.28s ease-out"
					sx={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
				>
					<Box transform="scaleX(-100%)">
						<Icon size="11px" name="🦄"></Icon>
					</Box>
					<Center
						position="absolute"
						left="50%"
						transform="translateX(-50%)"
						width="130px"
						height="24px"
						background="var(--tt-surface-alt, #f5f5f7)"
						borderRadius="var(--tt-radius-xs, 7px)"
					>
						<Text fontSize="10px" color="var(--tt-muted, #9a9aa6)">
							Imagine..
						</Text>
					</Center>
					<Box marginLeft="auto">
						<Icon transform="scaleX(-100%)" size="11px" name="🌈"></Icon>
					</Box>
				</Flex>
				<Text position="absolute" bottom="12px" left="0" right="0" textAlign="center" fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					desktop split view: the nav’s {direction} edge offsets by the drawer width
				</Text>
			</Box>
			<SpecLine>
				transition left/right/transform 0.28s ease-out — suppressed while settings load or the drawer is being resized, so restore and
				drag never animate
			</SpecLine>
		</Box>
	);
};

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

// The row recipe from DrawerContent.tsx (topRow/subRow, lines 334–384).
const DrawerRow = (props: {
	icon?: string;
	label: React.ReactNode;
	selected?: boolean;
	sub?: boolean;
	grouped?: boolean;
	forceHover?: boolean;
	onClick?: () => void;
}) => (
	<Flex
		alignItems="center"
		columnGap={2}
		marginX={2}
		paddingX={3}
		paddingY={props.sub ? '6px' : '7px'}
		paddingLeft={props.grouped ? 6 : 3}
		borderRadius="var(--tt-radius-sm, 9px)"
		background={
			props.selected ? 'var(--tt-surface-alt, #f5f5f7)' : props.forceHover ? 'var(--tt-surface-hover, #ececee)' : 'transparent'
		}
		_hover={{ background: props.selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-surface-hover, #ececee)' }}
		transition="background 0.15s ease"
		cursor="pointer"
		onClick={props.onClick}
	>
		{props.icon && <Icon name={props.icon} size={props.sub ? '11px' : '13px'} chakras={props.sub ? { opacity: 0.85 } : undefined}></Icon>}
		<Text fontSize={props.sub ? 'xs' : 'sm'} fontWeight={props.selected ? 600 : 400} color="var(--tt-ink, #16161a)">
			{props.label}
		</Text>
	</Flex>
);

const DrawerSectionLabel = (props: { children: React.ReactNode }) => (
	<Text
		paddingX={5}
		paddingTop={4}
		paddingBottom={1}
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.08em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
	>
		{props.children}
	</Text>
);

// A live miniature of the drawer panel, driven by the REAL menu model
// (drawerMenuItems + its helpers) — click top-level rows to switch submenus,
// exactly as DrawerContent resolves them.
const DrawerPanelStory = () => {
	const [selectedId, setSelectedId] = React.useState('things');
	const [showAll, setShowAll] = React.useState(false);

	const topItems: DrawerTopItem[] = drawerMenuItems;
	const visibleTop = showAll ? topItems : topItems.slice(0, DRAWER_TOP_LEVEL_DEFAULT_LIMIT);
	const hiddenCount = showAll ? 0 : Math.max(0, topItems.length - DRAWER_TOP_LEVEL_DEFAULT_LIMIT);
	const selected = topItems.find((item) => item.id === selectedId) || topItems[0];
	const subSections = buildDrawerSubSections(filterDrawerItemsByAuth<DrawerSubItem>(selected.children, true, true));

	return (
		<Flex columnGap={5} rowGap={4} flexWrap="wrap" alignItems="flex-start">
			<Flex
				flexDirection="column"
				width="270px"
				maxWidth="100%"
				height="430px"
				background="var(--tt-card, #ffffff)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
				overflow="hidden"
			>
				{/* header: brand + search */}
				<Flex alignItems="center" flexShrink={0} paddingX="12px" paddingTop="12px" paddingBottom="8px">
					<Flex
						as="button"
						type="button"
						alignItems="center"
						columnGap={2}
						paddingX={2}
						paddingY="4px"
						borderRadius="var(--tt-radius-sm, 9px)"
						_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
						cursor="pointer"
					>
						<Icon name="🦄" size="13px"></Icon>
						<Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
							Thingtime
						</Text>
					</Flex>
					<Center
						as="button"
						type="button"
						marginLeft="auto"
						width="30px"
						height="30px"
						borderRadius="var(--tt-radius-sm, 9px)"
						opacity={0.6}
						_hover={{ opacity: 1, background: 'var(--tt-surface-hover, #ececee)' }}
						cursor="pointer"
						title="Search"
					>
						<Search size={15} strokeWidth={2} />
					</Center>
				</Flex>

				{/* scrollable menus */}
				<Box flex={1} minHeight={0} overflowY="auto" paddingBottom={2}>
					<Flex flexDirection="column" rowGap="1px" paddingTop={1}>
						{visibleTop.map((item) => (
							<DrawerRow
								key={item.id}
								icon={item.icon}
								label={item.label}
								selected={selected.id === item.id}
								onClick={() => setSelectedId(item.id)}
							/>
						))}
						{hiddenCount > 0 && (
							<Flex
								as="button"
								type="button"
								alignItems="center"
								columnGap={1}
								marginX={2}
								paddingX={3}
								paddingY="5px"
								borderRadius="var(--tt-radius-sm, 9px)"
								opacity={0.45}
								_hover={{ opacity: 0.85, background: 'var(--tt-surface-hover, #ececee)' }}
								cursor="pointer"
								onClick={() => setShowAll(true)}
							>
								<ChevronDown size={13} strokeWidth={2} />
								<Text fontSize="xs">More ({hiddenCount})</Text>
							</Flex>
						)}
						{showAll && (
							<Flex
								as="button"
								type="button"
								alignItems="center"
								columnGap={1}
								marginX={2}
								paddingX={3}
								paddingY="5px"
								borderRadius="var(--tt-radius-sm, 9px)"
								opacity={0.45}
								_hover={{ opacity: 0.85, background: 'var(--tt-surface-hover, #ececee)' }}
								cursor="pointer"
								onClick={() => setShowAll(false)}
							>
								<Box as="span" transform="rotate(180deg)" display="inline-flex">
									<ChevronDown size={13} strokeWidth={2} />
								</Box>
								<Text fontSize="xs">Less</Text>
							</Flex>
						)}
					</Flex>

					<DrawerSectionLabel>{selected.label}</DrawerSectionLabel>
					<Flex flexDirection="column" rowGap="1px">
						{subSections.map((section) => (
							<React.Fragment key={section.group ?? '__ungrouped__'}>
								{section.group && (
									<Flex alignItems="center" columnGap={1} marginX={2} paddingX={3} paddingY="5px" opacity={0.7}>
										<ChevronDown size={12} strokeWidth={2} />
										<Text
											fontFamily={MONO}
											fontSize="10px"
											fontWeight={600}
											letterSpacing="0.08em"
											textTransform="uppercase"
											color="var(--tt-muted, #9a9aa6)"
										>
											{section.group}
										</Text>
									</Flex>
								)}
								{section.items.map((item) => (
									<DrawerRow key={item.id} sub grouped={!!section.group} icon={item.icon} label={item.label} />
								))}
							</React.Fragment>
						))}
					</Flex>
				</Box>

				{/* sticky account footer */}
				<Flex
					alignItems="center"
					flexShrink={0}
					columnGap={2}
					paddingX={3}
					paddingY="10px"
					borderTop="1px solid var(--tt-border, #ececef)"
					background="var(--tt-card, #ffffff)"
					_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
					cursor="pointer"
				>
					<Center flexShrink={0} width="28px" height="28px" borderRadius="999px" background={RAINBOW} color="white" fontSize="xs" fontWeight={700}>
						S
					</Center>
					<Text fontSize="xs" fontWeight={600} color="var(--tt-ink, #16161a)">
						sunny
					</Text>
					<Center
						as="button"
						type="button"
						marginLeft="auto"
						width="26px"
						height="26px"
						borderRadius="var(--tt-radius-sm, 9px)"
						opacity={0.4}
						_hover={{ opacity: 1, background: 'var(--tt-surface-alt, #f5f5f7)' }}
						cursor="pointer"
						aria-label="Settings"
						title="Settings"
					>
						<Icon name="⚙️" size="11px"></Icon>
					</Center>
				</Flex>
			</Flex>
			<Box maxWidth="300px">
				<Text fontSize="sm" color="var(--tt-text, #5a5a66)" lineHeight="1.6">
					The menu data here is the real <Box as="span" fontFamily={MONO} fontSize="12px">drawerMenuItems</Box> model, filtered and
					sectioned by the real helpers. Click a top-level row: the submenu below swaps to that item’s children, with grouped items
					(like the Things modes) under collapsible mono headers.
				</Text>
				<SpecLine>
					top level shows {DRAWER_TOP_LEVEL_DEFAULT_LIMIT} items by default, the rest fold behind the faint More row · footer is
					sticky · everything between scrolls
				</SpecLine>
			</Box>
		</Flex>
	);
};

const DrawerRowRecipeStory = () => (
	<Flex flexDirection="column" maxWidth="320px">
		<Box paddingY={1} background="var(--tt-card, #ffffff)" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)">
			<DrawerRow icon="📰" label="Resting row" />
			<DrawerRow icon="🔍" label="Hovered row" forceHover />
			<DrawerRow icon="📦" label="Selected row" selected />
			<DrawerRow icon="👀" label="Grouped sub-row (indented)" sub grouped />
		</Box>
		<SpecLine>
			marginX 8px · paddingX 12px · paddingY 7px (top) / 6px (sub) · radius-sm · icon 13px/11px · text sm/xs · selected =
			--tt-surface-alt + weight 600 · hover = --tt-surface-hover
		</SpecLine>
		<SpecLine>
			keep-open hubs (submenu browsing, drawer stays open on click): {DRAWER_KEEP_OPEN_DEFAULT_IDS.join(' · ')}
		</SpecLine>
	</Flex>
);

const drawerPreviewItems = drawerMenuItems.slice(0, 4);

const DrawerTriggerPreviewStory = () => {
	const [popupOpen, setPopupOpen] = React.useState(false);
	const [pinned, setPinned] = React.useState(false);
	const openTimerRef = React.useRef<any>(null);
	const closeTimerRef = React.useRef<any>(null);

	React.useEffect(() => {
		return () => {
			clearTimeout(openTimerRef.current);
			clearTimeout(closeTimerRef.current);
		};
	}, []);

	const onTriggerEnter = () => {
		if (pinned) {
			return;
		}
		clearTimeout(closeTimerRef.current);
		clearTimeout(openTimerRef.current);
		openTimerRef.current = setTimeout(() => setPopupOpen(true), 160);
	};

	const onLeave = () => {
		clearTimeout(openTimerRef.current);
		closeTimerRef.current = setTimeout(() => setPopupOpen(false), 260);
	};

	const onPopupEnter = () => {
		clearTimeout(closeTimerRef.current);
	};

	const onClick = () => {
		clearTimeout(openTimerRef.current);
		clearTimeout(closeTimerRef.current);
		setPopupOpen(false);
		setPinned((prev) => !prev);
	};

	const previewRows = (
		<Flex flexDirection="column" rowGap="1px" paddingY={1} width="100%">
			{drawerPreviewItems.map((item, index) => (
				<DrawerRow key={item.id} icon={item.icon} label={item.label} selected={index === 0} />
			))}
		</Flex>
	);

	return (
		<Box
			position="relative"
			height="260px"
			overflow="hidden"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-surface, #fafafb)"
		>
			{/* miniature pinned drawer panel */}
			<Box
				position="absolute"
				top={0}
				bottom={0}
				left={0}
				width="190px"
				background="var(--tt-card, #ffffff)"
				borderRight="1px solid var(--tt-border, #ececef)"
				boxShadow={pinned ? 'var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))' : 'none'}
				transform={pinned ? 'translateX(0)' : 'translateX(-102%)'}
				transition="transform 0.28s ease-out"
				paddingTop="52px"
			>
				{previewRows}
			</Box>
			{/* the fixed trigger button */}
			<Center
				as="button"
				type="button"
				position="absolute"
				top="8px"
				left="8px"
				zIndex={3}
				width="36px"
				height="36px"
				borderRadius="8px"
				background="transparent"
				_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
				opacity={0.75}
				transition="background 0.2s ease-out, opacity 0.2s ease-out"
				cursor="pointer"
				title={pinned ? 'Close menu' : 'Open menu'}
				aria-label={pinned ? 'Close menu' : 'Open menu'}
				onClick={onClick}
				onMouseEnter={onTriggerEnter}
				onMouseLeave={onLeave}
			>
				<PanelLeft size={16} strokeWidth={1.9} />
			</Center>
			{/* the desktop hover preview popup */}
			{popupOpen && !pinned && (
				<Flex
					position="absolute"
					top="48px"
					left="10px"
					zIndex={2}
					width="200px"
					maxHeight="190px"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-lg, 16px)"
					boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
					overflow="hidden"
					onMouseEnter={onPopupEnter}
					onMouseLeave={onLeave}
				>
					{previewRows}
				</Flex>
			)}
			<Text position="absolute" bottom="12px" left="0" right="0" textAlign="center" fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				hover the trigger to preview · click to pin the split view
			</Text>
		</Box>
	);
};

const DRAWER_WIDTH_STEPS = [
	{ label: 'DRAWER_MIN_WIDTH', width: DRAWER_MIN_WIDTH, note: 'resize floor' },
	{ label: 'DRAWER_DEFAULT_WIDTH', width: DRAWER_DEFAULT_WIDTH, note: 'fresh accounts, and any unparseable stored value' },
	{ label: 'DRAWER_MAX_WIDTH', width: DRAWER_MAX_WIDTH, note: 'resize ceiling' }
];

const DrawerWidthStory = () => (
	<Flex flexDirection="column" rowGap={3} maxWidth="560px">
		{DRAWER_WIDTH_STEPS.map((step) => (
			<Box key={step.label}>
				<Flex
					height="26px"
					width={`${(step.width / DRAWER_MAX_WIDTH) * 100}%`}
					minWidth="150px"
					alignItems="center"
					paddingX={3}
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-sm, 9px)"
					boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
					fontFamily={MONO}
					fontSize="10px"
					fontWeight={600}
					color="var(--tt-ink, #16161a)"
				>
					{step.label} · {step.width}px
				</Flex>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="3px">
					{step.note}
				</Text>
			</Box>
		))}
		<SpecLine>
			every consumer renders min(width, 100vw − {DRAWER_VIEWPORT_GUTTER}px) via drawerWidthCss() — the persisted width survives a
			phone-sized viewport untouched, so desktop restores fully
		</SpecLine>
	</Flex>
);

// ---------------------------------------------------------------------------
// Commander
// ---------------------------------------------------------------------------

const CommanderPillStory = () => (
	<Flex flexDirection="column" maxWidth="400px">
		<Center overflow="hidden" width="100%" height="48px" padding="1px" borderRadius="var(--tt-radius-sm, 9px)">
			<Input
				aria-label="Commander demo input"
				sx={{ '&::placeholder': { color: 'var(--tt-muted, #9a9aa6)' } }}
				width="100%"
				height="100%"
				background="var(--tt-surface-alt, #f5f5f7)"
				border="none"
				borderRadius="var(--tt-radius-xs, 7px)"
				placeholder="Imagine.."
			/>
		</Center>
		<SpecLine>
			bg --tt-surface-alt · radius-xs input inside a 1px radius-sm shell · placeholder --tt-muted · desktop width 400px, mobile calc(100vw
			− 200px) to clear the drawer trigger + right nav icons
		</SpecLine>
	</Flex>
);

const COMMANDER_DEMO_REMOTE = [
	{ icon: '🌀', title: 'Sunflower patch', context: 'thing · garden · @sunny' },
	{ icon: '👤', title: 'Sunny Lopu', context: 'person · @sunny' }
];

const COMMANDER_DEMO_LOCAL = ['garden.flowers.sunflowers', 'settings.theme.rainbow'];

const CommanderTierLabel = (props: { children: React.ReactNode }) => (
	<Text
		color="var(--tt-muted, #9a9aa6)"
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={700}
		paddingX={4}
		paddingBottom={1}
		paddingTop={2}
		textTransform="uppercase"
	>
		{props.children}
	</Text>
);

const CommanderSuggestionTiersStory = () => {
	const [hovered, setHovered] = React.useState<number | null>(0);

	const rowBackground = (index: number) => (hovered === index ? 'var(--tt-surface-hover, #ececee)' : undefined);

	return (
		<Flex
			flexDirection="column"
			width="100%"
			maxWidth="400px"
			background="var(--tt-surface-alt, #f5f5f7)"
			borderRadius="var(--tt-radius-md, 12px)"
			boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
			paddingY={3}
			onMouseLeave={() => setHovered(null)}
		>
			{/* row 0: the pinned full-search row — Enter with nothing selected lands here */}
			<Flex
				background={rowBackground(0)}
				_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
				cursor="pointer"
				fontFamily={MONO}
				fontSize="13px"
				color="var(--tt-text, #5a5a66)"
				paddingX={4}
				paddingY={1}
				onMouseEnter={() => setHovered(0)}
			>
				🔍 Search things for “sunflowers”
			</Flex>
			<CommanderTierLabel>Across Thingtime</CommanderTierLabel>
			{COMMANDER_DEMO_REMOTE.map((result, i) => (
				<Flex
					key={result.title}
					background={rowBackground(i + 1)}
					_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
					cursor="pointer"
					flexDirection="column"
					paddingX={4}
					paddingY={1.5}
					onMouseEnter={() => setHovered(i + 1)}
				>
					<Text color="var(--tt-text, #5a5a66)" fontSize="13px" fontWeight={600} noOfLines={1}>
						{result.icon} {result.title}
					</Text>
					<Text color="var(--tt-muted, #9a9aa6)" fontFamily={MONO} fontSize="10px" noOfLines={1}>
						{result.context}
					</Text>
				</Flex>
			))}
			<CommanderTierLabel>Local paths</CommanderTierLabel>
			{COMMANDER_DEMO_LOCAL.map((path, i) => (
				<Flex
					key={path}
					background={rowBackground(i + 1 + COMMANDER_DEMO_REMOTE.length)}
					_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
					cursor="pointer"
					fontFamily={MONO}
					fontSize="13px"
					color="var(--tt-text, #5a5a66)"
					paddingX={4}
					paddingY={1}
					onMouseEnter={() => setHovered(i + 1 + COMMANDER_DEMO_REMOTE.length)}
				>
					{path}
				</Flex>
			))}
		</Flex>
	);
};

// ---------------------------------------------------------------------------
// Segmented tabs
// ---------------------------------------------------------------------------

// The exact segment recipe from AdminDashboard.tsx (ADMIN_TAB_STYLES,
// lines 182–197) — copied verbatim; the recipe is deliberately module-local
// in the source, so adopters copy it rather than import it.
const SEGMENT_TAB_STYLES = {
	borderRadius: 'var(--tt-radius-pill, 999px)',
	color: 'var(--tt-muted, #9a9aa6)',
	fontFamily: 'var(--tt-font-mono, ui-monospace, Menlo, monospace)',
	fontSize: '12px',
	fontWeight: 600,
	px: 3,
	py: 1.5,
	whiteSpace: 'nowrap',
	_hover: { color: 'var(--tt-ink, #16161a)' },
	_selected: {
		bg: 'var(--tt-card, #ffffff)',
		boxShadow: 'var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))',
		color: 'var(--tt-ink, #16161a)'
	}
} as const;

const SEGMENT_RAIL_STYLES = {
	bg: 'var(--tt-surface-alt, #f5f5f7)',
	borderRadius: 'var(--tt-radius-pill, 999px)',
	padding: '3px',
	gap: '2px',
	flexWrap: 'wrap',
	width: 'fit-content',
	maxWidth: '100%'
} as const;

const SegmentedTabsStory = () => (
	<Tabs variant="unstyled" size="sm" isLazy lazyBehavior="keepMounted">
		<TabList {...SEGMENT_RAIL_STYLES}>
			<Tab {...SEGMENT_TAB_STYLES}>Users</Tab>
			<Tab {...SEGMENT_TAB_STYLES}>Apps</Tab>
			<Tab {...SEGMENT_TAB_STYLES}>Tiers</Tab>
			<Tab {...SEGMENT_TAB_STYLES}>System</Tab>
		</TabList>
		<TabPanels>
			{['Users', 'Apps', 'Tiers', 'System'].map((label) => (
				<TabPanel key={label} px={0}>
					<Box
						marginTop={2}
						padding={4}
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-lg, 16px)"
					>
						<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
							{label} panel — the behaviour is stock Chakra Tabs (roles, arrow keys, focus); only the skin is Thingtime.
						</Text>
					</Box>
				</TabPanel>
			))}
		</TabPanels>
	</Tabs>
);

const ADMIN_TAB_LABELS = ['Users', 'Apps', 'Moderation', 'Tiers', 'CI Control', 'External integrations', 'System'];

const SegmentedTabsWrapStory = () => (
	<Box maxWidth="320px">
		<Tabs variant="unstyled" size="sm">
			<TabList {...SEGMENT_RAIL_STYLES}>
				{ADMIN_TAB_LABELS.map((label) => (
					<Tab key={label} {...SEGMENT_TAB_STYLES}>
						{label}
					</Tab>
				))}
			</TabList>
		</Tabs>
		<SpecLine>
			the full admin rail (7 segments) in a 320px column: flexWrap + width fit-content + maxWidth 100% let the pill rail wrap instead
			of overflowing — segments never truncate (whiteSpace nowrap)
		</SpecLine>
	</Box>
);

// ---------------------------------------------------------------------------
// Story exports
// ---------------------------------------------------------------------------

export const topNavStories: DesignSystemStory[] = [
	{
		id: 'glass-bar',
		title: 'The glass bar',
		description:
			'A faithful miniature of the fixed nav: background color-mix(in srgb, --tt-card 78%, transparent) with backdrop-filter blur(14px) and a --tt-border hairline underneath. Left holds the mirrored home unicorn, the centre is the absolutely-centred Commander pill, and the right cluster (edit toggles · bell · name + 🌈) sits above the commander host so it stays tappable. Scroll the feed items to watch content slide under the glass.',
		render: TopNavGlassStory,
		note: 'The native iOS webview swaps the glass for solid --tt-card (blur costs too much in WKWebView) — same layout, opaque chassis.'
	},
	{
		id: 'drawer-shift',
		title: 'Drawer-aware shift',
		description:
			'The nav follows the drawer. On desktop the pinned drawer is a split view: the nav’s left (or right) edge offsets by the live drawer width, transitioning at 0.28s ease-out. On mobile the whole bar translates instead — content never resizes there. Toggle the drawer and flip its direction to see the geometry respond.',
		render: TopNavDrawerShiftStory,
		note: 'Widths flow through drawerWidthCss() and the thingtime:drawer-resize live broadcast, so mid-drag the nav follows every pixel with transitions suppressed.'
	}
];

export const drawerStories: DesignSystemStory[] = [
	{
		id: 'drawer-panel',
		title: 'The panel (live menu model)',
		description:
			'A miniature drawer running the REAL drawerMenuItems model through the real helpers (filterDrawerItemsByAuth → applyDrawerOrdering slots → buildDrawerSubSections). Top-level rows select; the submenu re-renders to the selected item’s children with grouped items under collapsible mono headers; the top list folds behind “More” past the default limit; the account footer is sticky.',
		render: DrawerPanelStory,
		note: 'In the app this content renders twice from one component: DrawerContent variant="panel" (the pinned drawer) and variant="popup" (the hover preview).'
	},
	{
		id: 'row-recipe',
		title: 'Row recipe + states',
		description:
			'The one row recipe every drawer list uses: icon + label on a radius-sm slab, transparent at rest, --tt-surface-hover on hover, --tt-surface-alt + weight 600 when selected. Sub-rows shrink to 11px icons / xs text and indent (paddingLeft 6) when grouped. Selection is a background, never a border or accent bar.',
		render: DrawerRowRecipeStory,
		note: 'Rows also reorder: click-and-hold ~280ms arms a drag (moving >8px first cancels it, so taps and scrolls still work); the order persists per list in settings.drawer.userDrawerOrdering.'
	},
	{
		id: 'trigger-preview',
		title: 'Trigger, hover preview, pin',
		description:
			'The single fixed trigger button (top-left, PanelLeft icon) is the drawer’s whole public surface. Desktop hover previews the drawer contents in a floating popup after 160ms — no click needed — and the popup lingers 260ms so the pointer can travel into it. Clicking pins the real panel open as a split view (and dismisses the now-redundant popup). Try it: hover, then click.',
		render: DrawerTriggerPreviewStory,
		note: 'On mobile there is no hover tier: the trigger toggles the panel, a transparent scrim covers the shifted page, body scroll locks, and Escape closes.'
	},
	{
		id: 'width-scale',
		title: 'Width: 220 → 520, persisted',
		description:
			'The invisible 8px handle on the drawer’s inner edge resizes it between DRAWER_MIN_WIDTH and DRAWER_MAX_WIDTH; the released width persists to settings.drawer.width. During the drag, widths broadcast through a window event so Nav and Main follow live without serialising every pixel — the persisted value lands once, on release.',
		render: DrawerWidthStory
	}
];

export const commanderStories: DesignSystemStory[] = [
	{
		id: 'imagine-pill',
		title: 'The Imagine.. pill',
		description:
			'The global search pill, centred in the nav: a borderless Input on --tt-surface-alt, radius-xs, inside a 1px padded radius-sm shell (the padding hosts the optional rainbow ring). “Imagine..” is the placeholder idiom — Commander takes paths, searches, and set-commands alike, so the prompt promises more than “Search”. Focusing the input opens Commander; clicking away closes it.',
		render: CommanderPillStory,
		note: 'The nav mounts it as <CommanderV2 global id="nav" rainbow={false} /> — the rainbow glow variant exists but is currently off in the nav.'
	},
	{
		id: 'suggestion-tiers',
		title: 'Suggestion tiers',
		description:
			'The dropdown is three tiers in one fixed order: row 0 is the pinned “Search things for …” row (Enter with nothing selected lands here), then live platform results from the ACL-aware things + people search APIs (debounced 250ms, stale responses discarded), then local fuzzy path matches over the thingtime tree — the command tier. Hover or arrow through rows; each tier keeps its own visual voice.',
		render: CommanderSuggestionTiersStory,
		note: 'Typeahead is progressive enhancement: when the network fails, local paths and the pinned /search row keep working.'
	}
];

export const segmentedTabsStories: DesignSystemStory[] = [
	{
		id: 'live-segmented-control',
		title: 'Live segmented control',
		description:
			'The admin idiom, running on stock Chakra Tabs with variant="unstyled": a pill rail on --tt-surface-alt (3px padding, 2px gaps) whose selected segment lifts onto --tt-card with --tt-shadow-card. Labels are 12px mono 600 — --tt-muted at rest, --tt-ink on hover and selection. Arrow keys move and select; this is a real, keyboard-complete Tabs instance.',
		render: SegmentedTabsStory,
		note: 'isLazy + lazyBehavior="keepMounted" in the admin dashboard: panels mount on first visit and stay mounted, so tab switches never refetch.'
	},
	{
		id: 'wrap-density',
		title: 'Wrapping at density',
		description:
			'All seven admin segments in a narrow column. The rail is width fit-content with flexWrap and maxWidth 100%: when segments run out of room the rail wraps to more rows instead of scrolling or truncating — every label stays whole (whiteSpace nowrap per segment).',
		render: SegmentedTabsWrapStory
	}
];
