import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';

import { Icon } from '~/components/Icon/Icon';
import { ThingContextMenu } from '~/components/Thingtime/ContextMenu/ThingContextMenu';
import type { ThingContextMenuAction } from '~/components/Thingtime/ContextMenu/ThingContextMenu';
import { buildThingContextMenuModel } from '~/components/Thingtime/ContextMenu/contextMenuModel';
import { useThingContextMenu } from '~/components/Thingtime/ContextMenu/useThingContextMenu';

// Live stories for the Thing Context Menu design-system entry.
// Every story is self-contained: it builds its own model, wires the hook the
// way a real caller would, and logs the actions it receives.

const formatAction = (fired: ThingContextMenuAction) => {
	const optionSuffix = fired.option ? ` → ${fired.option.label || fired.option.key}` : '';
	return `${fired.section.id}/${fired.action.id}${optionSuffix}`;
};

const StoryActionLog = ({ value }: { value: string | null }) => (
	<Flex
		alignItems="center"
		columnGap="8px"
		marginTop="14px"
		paddingX="10px"
		paddingY="6px"
		background="var(--tt-surface-alt, #f5f5f7)"
		borderRadius="var(--tt-radius-sm, 9px)"
		fontFamily="var(--tt-font-mono, monospace)"
		fontSize="11px"
		color="var(--tt-muted, #9a9aa6)"
	>
		<Text fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" fontSize="9px">
			onAction
		</Text>
		<Text color={value ? 'var(--tt-ink, #16161a)' : 'var(--tt-faint, #b6b6c0)'}>{value || 'nothing fired yet'}</Text>
	</Flex>
);

// a fake thing row shared by the trigger stories, mirroring the live thing
// header (mono path + value + trailing wizard icon)
const FakeThingRow = (props: { children?: React.ReactNode; triggerProps?: Record<string, unknown> }) => (
	<Flex position="relative" flexDirection="column" maxWidth="420px">
		<Flex alignItems="center" columnGap="6px">
			<Text fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" color="var(--tt-muted, #9a9aa6)">
				garden.flowers
			</Text>
			<Flex cursor="pointer" title="Options" {...(props.triggerProps || {})}>
				<Icon name="wizard" size="12px"></Icon>
			</Flex>
		</Flex>
		<Text fontSize="20px">Roses, tulips, sunflowers</Text>
		{props.children}
	</Flex>
);

const HoverTriggerStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);
	const menu = useThingContextMenu();
	const model = React.useMemo(() => buildThingContextMenuModel({ editMode: true }), []);

	return (
		<Box>
			<FakeThingRow triggerProps={menu.hoverTriggerProps}>
				<ThingContextMenu
					{...menu.menuProps}
					model={model}
					meta={{ path: 'garden.flowers', type: 'string' }}
					onAction={(fired) => setLastAction(formatAction(fired))}
				/>
			</FakeThingRow>
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const RightClickStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);
	const menu = useThingContextMenu();
	const model = React.useMemo(() => buildThingContextMenuModel({ editMode: true }), []);

	return (
		<Box>
			<Flex
				{...menu.contextTriggerProps}
				alignItems="center"
				justifyContent="center"
				height="150px"
				border="1.5px dashed var(--tt-faint, #b6b6c0)"
				borderRadius="var(--tt-radius-md, 12px)"
				color="var(--tt-muted, #9a9aa6)"
				fontSize="sm"
				userSelect="none"
				cursor="context-menu"
			>
				Right-click anywhere in this area
			</Flex>
			<ThingContextMenu
				{...menu.menuProps}
				model={model}
				meta={{ path: 'garden.flowers', type: 'string' }}
				onAction={(fired) => setLastAction(formatAction(fired))}
			/>
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const ModalStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);
	const menu = useThingContextMenu();
	const model = React.useMemo(() => buildThingContextMenuModel({ editMode: true }), []);

	return (
		<Box>
			<Button size="sm" variant="outline" borderRadius="var(--tt-radius-sm, 9px)" onClick={menu.openModal}>
				<Flex alignItems="center" columnGap="7px">
					<Icon name="wizard" size="12px"></Icon>
					Open thing options
				</Flex>
			</Button>
			<ThingContextMenu
				{...menu.menuProps}
				model={model}
				meta={{ path: 'garden.flowers', type: 'string' }}
				onAction={(fired) => setLastAction(formatAction(fired))}
			/>
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

// statically-open surface for anatomy-style stories: the popover presentation
// inside a reserved-height relative wrapper
const StaticMenu = (props: {
	expanded?: string;
	readonly?: boolean;
	selectedPermissionKey?: string;
	minHeight?: string;
	onAction: (fired: ThingContextMenuAction) => void;
}) => {
	const model = React.useMemo(
		() =>
			buildThingContextMenuModel({
				editMode: true,
				readonly: props.readonly,
				selectedPermissionKey: props.selectedPermissionKey
			}),
		[props.readonly, props.selectedPermissionKey]
	);

	return (
		<Box minHeight={props.minHeight || '440px'}>
			{/* zero-height anchor so the popover (top: 100% of its relative
			parent) fills the reserved canvas from the top */}
			<Box position="relative" height="0">
				<ThingContextMenu
					open
					presentation="popover"
					model={model}
					meta={{ path: 'garden.flowers', type: props.readonly ? 'string (readonly)' : 'string' }}
					defaultExpandedActionId={props.expanded}
					closeOnAction={false}
					onAction={props.onAction}
				/>
			</Box>
		</Box>
	);
};

const TypesSubmenuStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu expanded="change-type" minHeight="500px" onAction={(fired) => setLastAction(formatAction(fired))} />
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const PermissionsStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu
				expanded="permissions"
				selectedPermissionKey="shared"
				minHeight="520px"
				onAction={(fired) => setLastAction(formatAction(fired))}
			/>
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const ReadonlyStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu readonly minHeight="300px" onAction={(fired) => setLastAction(formatAction(fired))} />
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

export type DesignSystemStory = {
	id: string;
	title: string;
	description: string;
	render: React.ComponentType;
	note?: string;
};

export const thingContextMenuStories: DesignSystemStory[] = [
	{
		id: 'hover-trigger',
		title: 'Hover trigger (popover)',
		description:
			'The default in-canvas access: hovering the wizard icon next to a thing path opens the menu under the trigger. It lingers briefly so the pointer can travel into it, and the pin keeps it open while you work.',
		render: HoverTriggerStory,
		note: 'This is the SettingsMenu behaviour today, upgraded to the full action model.'
	},
	{
		id: 'right-click',
		title: 'Right-click (context)',
		description:
			'Any thing surface can open the same menu at the pointer with onContextMenu. The surface clamps itself inside the viewport, so edge and corner clicks stay fully visible.',
		render: RightClickStory,
		note: 'On touch devices the native long-press maps to the same contextmenu event.'
	},
	{
		id: 'programmatic-modal',
		title: 'Programmatic (modal)',
		description:
			'Buttons, commands, or keyboard shortcuts open the menu as a centred modal over a scrim — same model, same onAction contract, just a calmer presentation for deliberate flows.',
		render: ModalStory
	},
	{
		id: 'types-submenu',
		title: 'Change type submenu',
		description:
			'The Type section expands inline (no flyout) listing JavaScript types first, then custom Thingtime types. Wrappable types (like Thingtime Logo) can wrap the current value instead of replacing it.',
		render: TypesSubmenuStory
	},
	{
		id: 'permissions',
		title: 'Permissions submenu',
		description:
			'Permissions render as a radio-style submenu (menuitemradio) with the current level checked. Share… copies a link; Permissions… changes who the link works for.',
		render: PermissionsStory
	},
	{
		id: 'readonly',
		title: 'Read-only thing',
		description:
			'The model builder drops every mutating section for read-only things — the menu naturally reduces to mode, copy, share, and permissions with no per-presentation special-casing.',
		render: ReadonlyStory
	}
];
