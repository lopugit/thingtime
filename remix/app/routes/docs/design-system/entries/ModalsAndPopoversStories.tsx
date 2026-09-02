import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import {
	DRAWER_HOVER_Z,
	DRAWER_MODAL_OVERLAY_Z,
	DRAWER_MODAL_Z,
	DRAWER_POPUP_Z,
	DRAWER_TRIGGER_Z,
	DRAWER_Z
} from '~/components/Nav/Drawer/useDrawer';
import { CARD_STYLES } from '~/theme/card';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Modals & popovers entry. The z-ladder story reads the
// REAL exported constants from useDrawer.tsx, so a ladder change re-documents
// itself here. The modal/sheet stories are simplified live renders of the
// UserSettingsModal and BlockInsertMenu geometry inside miniature viewport
// frames (the real components need drawer/thingtime context and fetches).

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

// The full ladder, band comments included, in stacking order. Literal rungs
// (nav, editor-window bands, drag ghosts, DevKit) are documented in the
// useDrawer.tsx header comment; the exported constants are imported live.
const LADDER: { z: string | number; label: string; kind: 'band' | 'rung' }[] = [
	{ z: '9900+', label: 'editor windows sent below the drawer (EditorSplit band)', kind: 'band' },
	{ z: 9999, label: 'fixed nav', kind: 'rung' },
	{ z: DRAWER_Z, label: 'drawer panel — DRAWER_Z', kind: 'rung' },
	{ z: '10040+', label: 'editor windows above the drawer (their default band)', kind: 'band' },
	{ z: DRAWER_HOVER_Z, label: 'drawer panel while hovered — DRAWER_HOVER_Z (takes the front, hands it back)', kind: 'rung' },
	{ z: 10190, label: 'window drag ghosts / drop previews', kind: 'band' },
	{ z: DRAWER_POPUP_Z, label: 'dropdowns & popups — DRAWER_POPUP_Z', kind: 'rung' },
	{ z: DRAWER_TRIGGER_Z, label: 'drawer trigger — DRAWER_TRIGGER_Z', kind: 'rung' },
	{ z: DRAWER_MODAL_OVERLAY_Z, label: 'modal overlay — DRAWER_MODAL_OVERLAY_Z', kind: 'rung' },
	{ z: DRAWER_MODAL_Z, label: 'modal — DRAWER_MODAL_Z', kind: 'rung' },
	{ z: '99999+', label: 'DevKit (always on top)', kind: 'band' }
];

const ZLadderStory = () => (
	<Flex flexDirection="column" rowGap="6px" maxWidth="640px">
		{LADDER.map((step, index) => (
			<Flex
				key={String(step.z)}
				alignItems="center"
				columnGap={3}
				marginLeft={`${index * 4}%`}
				paddingX={3}
				paddingY="7px"
				background={step.kind === 'band' ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-card, #ffffff)'}
				border="1px solid"
				borderColor={step.kind === 'band' ? 'var(--tt-border-light, #f0f0f2)' : 'var(--tt-border, #ececef)'}
				borderRadius="var(--tt-radius-sm, 9px)"
				boxShadow={step.kind === 'band' ? 'none' : 'var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))'}
			>
				<Text
					fontFamily={MONO}
					fontSize="11px"
					fontWeight={700}
					color={step.kind === 'band' ? 'var(--tt-muted, #9a9aa6)' : 'var(--tt-ink, #16161a)'}
					minWidth="52px"
				>
					{step.z}
				</Text>
				<Text fontSize="xs" color={step.kind === 'band' ? 'var(--tt-muted, #9a9aa6)' : 'var(--tt-text, #5a5a66)'}>
					{step.label}
				</Text>
			</Flex>
		))}
	</Flex>
);

const PopoverRow = (props: { icon: string; label: string; hint?: string }) => (
	<Flex
		as="button"
		type="button"
		alignItems="center"
		columnGap="8px"
		width="100%"
		textAlign="left"
		paddingX={2}
		paddingY="7px"
		borderRadius="var(--tt-radius-sm, 9px)"
		cursor="pointer"
		_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
	>
		<Text as="span" fontSize="13px" lineHeight={1} aria-hidden>
			{props.icon}
		</Text>
		<Box minWidth={0}>
			<Text fontSize="sm" color="var(--tt-ink, #16161a)">
				{props.label}
			</Text>
			{props.hint && (
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
					{props.hint}
				</Text>
			)}
		</Box>
	</Flex>
);

const PopoverCardStory = () => (
	<Flex columnGap={6} rowGap={4} flexWrap="wrap" alignItems="flex-start">
		<Box
			{...CARD_STYLES}
			borderRadius="var(--tt-radius-md, 12px)"
			boxShadow="var(--tt-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.12))"
			width="264px"
			padding={2}
		>
			<Text
				fontFamily={MONO}
				fontSize="9px"
				fontWeight={600}
				letterSpacing="0.08em"
				textTransform="uppercase"
				color="var(--tt-muted, #9a9aa6)"
				paddingX={2}
				paddingY={1}
			>
				share
			</Text>
			<PopoverRow icon="🔗" label="Copy link" hint="Anyone with the link can view" />
			<PopoverRow icon="👥" label="Invite people" />
			<Box borderTop="1px solid var(--tt-border-light, #f0f0f2)" marginY={1} />
			<PopoverRow icon="🌐" label="Publish to web" />
		</Box>
		<Box maxWidth="300px">
			<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
				The popover surface is a CARD_STYLES card at md radius wearing <Text as="span" fontFamily={MONO}>--tt-shadow-popover</Text> —
				the deeper of the two themed elevations, hard-offset under Fable. Rows hover to --tt-surface-alt; sections
				divide with --tt-border-light hairlines; it floats at DRAWER_POPUP_Z ({DRAWER_POPUP_Z}).
			</Text>
		</Box>
	</Flex>
);

// a settings-style row for the modal miniature
const MiniRow = (props: { label: string; hint: string; control: string }) => (
	<Flex alignItems="center" columnGap={4} paddingY={2}>
		<Box minWidth={0}>
			<Text fontSize="sm" color="var(--tt-ink, #16161a)">
				{props.label}
			</Text>
			<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
				{props.hint}
			</Text>
		</Box>
		<Text
			marginLeft="auto"
			flexShrink={0}
			fontFamily={MONO}
			fontSize="10px"
			fontWeight={600}
			paddingX={2}
			paddingY="3px"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-pill, 999px)"
			color="var(--tt-muted, #9a9aa6)"
		>
			{props.control}
		</Text>
	</Flex>
);

const ModalAnatomyStory = () => (
	<Box
		position="relative"
		height="360px"
		overflow="hidden"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-surface, #fafafb)"
	>
		{/* the overlay — DRAWER_MODAL_OVERLAY_Z in the app, scoped here */}
		<Box position="absolute" inset={0} background="rgba(0,0,0,0.4)" />
		{/* the desktop modal card — DRAWER_MODAL_Z */}
		<Flex position="absolute" inset={0} alignItems="center" justifyContent="center" padding={6} pointerEvents="none">
			<Box
				width="420px"
				maxWidth="100%"
				maxHeight="86%"
				background="var(--tt-card, white)"
				borderRadius="var(--tt-radius-lg, 16px)"
				boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0,0,0,0.22))"
				overflowY="auto"
				pointerEvents="all"
				padding={5}
			>
				<Flex alignItems="center" marginBottom={3}>
					<Text fontSize="md" fontWeight={700} color="var(--tt-ink, #16161a)">
						Settings
					</Text>
					<Flex
						as="button"
						type="button"
						marginLeft="auto"
						width="28px"
						height="28px"
						alignItems="center"
						justifyContent="center"
						borderRadius="8px"
						opacity={0.6}
						_hover={{ opacity: 1, background: 'var(--tt-surface-alt, #f5f5f7)' }}
						cursor="pointer"
						aria-label="Close settings"
					>
						✕
					</Flex>
				</Flex>
				<Text
					fontSize="10px"
					fontWeight={600}
					letterSpacing="0.08em"
					textTransform="uppercase"
					color="var(--tt-muted, #9a9aa6)"
					paddingBottom={2}
				>
					Drawer
				</Text>
				<MiniRow label="Opens from" hint="Which edge the drawer slides out from" control="left · right" />
				<MiniRow label="Search closes drawer" hint="Close the drawer when opening search" control="switch" />
				<MiniRow label="Top-level items" hint="How many items show before “More”" control="− 5 +" />
			</Box>
		</Flex>
	</Box>
);

const QUICK_PILLS = [
	{ icon: '📝', label: 'Text' },
	{ icon: '🔠', label: 'Heading' },
	{ icon: '🏷️', label: 'Eyebrow' },
	{ icon: '⬇️', label: 'Column' },
	{ icon: '➡️', label: 'Row' },
	{ icon: '🔲', label: 'Grid' }
];

const BottomSheetStory = () => (
	<Box
		position="relative"
		height="380px"
		maxWidth="320px"
		overflow="hidden"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-surface, #fafafb)"
	>
		{/* scrim — a tap anywhere on it dismisses */}
		<Box position="absolute" inset={0} background="rgba(22, 22, 26, 0.35)" />
		{/* the sheet: flush bottom, top corners only, grab handle, safe-area pad */}
		<Box
			position="absolute"
			left={0}
			right={0}
			bottom={0}
			maxHeight="70%"
			overflowY="auto"
			{...CARD_STYLES}
			borderRadius="var(--tt-radius-xl, 20px) var(--tt-radius-xl, 20px) 0 0"
			boxShadow="var(--tt-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.12))"
			padding={4}
			paddingBottom="calc(var(--thingtime-safe-area-bottom, 0px) + 20px)"
		>
			<Box width="44px" height="5px" borderRadius="999px" background="var(--tt-border, #ececef)" marginX="auto" marginBottom={3} />
			<Flex flexWrap="wrap" gap={1.5} marginBottom={2}>
				{QUICK_PILLS.map((pill) => (
					<Flex
						key={pill.label}
						as="button"
						type="button"
						alignItems="center"
						columnGap="6px"
						fontFamily={MONO}
						fontSize="13px"
						fontWeight={600}
						paddingX="13px"
						paddingY="10px"
						borderRadius="var(--tt-radius-pill, 999px)"
						border="1px solid"
						borderColor="var(--tt-border, #ececef)"
						background="var(--tt-surface, #fafafb)"
						color="var(--tt-ink, #16161a)"
						cursor="pointer"
						_hover={{ borderColor: 'var(--tt-accent, hotpink)', color: 'var(--tt-accent, hotpink)' }}
					>
						<span aria-hidden>{pill.icon}</span> {pill.label}
					</Flex>
				))}
			</Flex>
			<Box
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-sm, 9px)"
				paddingX={3}
				paddingY={2}
				fontSize="sm"
				color="var(--tt-faint, #b6b6c0)"
			>
				Search components… 🧩
			</Box>
		</Box>
	</Box>
);

export const modalsAndPopoversStories: DesignSystemStory[] = [
	{
		id: 'z-ladder',
		title: 'The z-index ladder',
		description:
			'Every floating surface has one assigned rung, exported from useDrawer.tsx: 9999 fixed nav → 10000 drawer → 10120 hovered drawer → 10220 popups → 10230 drawer trigger → 10240/10250 modal overlay + modal — with editor windows layering AROUND the drawer in bands (9900+ below, 10040+ above, 10190 drag ghosts) and DevKit above everything at 99999+. The named rungs in this diagram are read live from the imported constants.',
		render: ZLadderStory,
		note: 'The invariant: everything transient or blocking (popups, trigger, modals) sits ABOVE the window bands and the hovered drawer — otherwise editor frames would cover open menus and dialogs.'
	},
	{
		id: 'popover-card',
		title: 'Popover surface',
		description:
			'The floating-surface recipe: a CARD_STYLES card stepped down to --tt-radius-md, elevated with --tt-shadow-popover instead of shadow-card, rows that hover to --tt-surface-alt, and mono uppercase section headers with --tt-border-light dividers. ThingContextMenu, the footer environment menu, and BlockInsertMenu all wear exactly this.',
		render: PopoverCardStory
	},
	{
		id: 'modal-anatomy',
		title: 'Desktop modal (UserSettingsModal pattern)',
		description:
			'A 0.4-alpha black overlay at DRAWER_MODAL_OVERLAY_Z with the card centred above it at DRAWER_MODAL_Z: 560px wide, maxHeight 86vh with inner scroll, --tt-radius-lg corners, and the big --tt-shadow-panel elevation. The real modal mounts hidden and flips a `visible` flag one frame later so opacity/scale transition in, locks body scroll while open, and closes on Escape or an overlay click.',
		render: ModalAnatomyStory,
		note: 'Simplified live geometry — the real UserSettingsModal needs drawer + theme context. Same card, same tokens, scoped into a story frame.'
	},
	{
		id: 'bottom-sheet',
		title: 'Mobile bottom sheet (insert-menu pattern)',
		description:
			'Below the mobile breakpoint, popovers and modals become bottom sheets: flush left/right/bottom, top corners only at --tt-radius-xl, a 44×5px grab-handle pill in --tt-border, a scrim tap-to-dismiss, and paddingBottom that adds the iOS safe area. BlockInsertMenu switches to this under 640px (a popover anchored to a cramped zone is what made mobile taps miserable); UserSettingsModal slides up an 88dvh sheet below 48em.',
		render: BottomSheetStory,
		note: 'The insert sheet deliberately skips input autofocus on mobile — popping the keyboard over a fresh sheet buries the quick actions.'
	}
];
