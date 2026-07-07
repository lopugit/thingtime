import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';

import { Icon } from '~/components/Icon/Icon';
import { ThingContextMenu } from '~/components/Thingtime/ContextMenu/ThingContextMenu';
import type { ThingContextMenuAction } from '~/components/Thingtime/ContextMenu/ThingContextMenu';
import { buildThingContextMenuModel } from '~/components/Thingtime/ContextMenu/contextMenuModel';
import { useThingContextMenu } from '~/components/Thingtime/ContextMenu/useThingContextMenu';
import { getThingZoneBoxes, resolveThingZone } from '~/components/Thingtime/thingZones';
import type { ThingZone, ThingZoneBox, ThingZoneBoxes } from '~/components/Thingtime/thingZones';

// Live stories for the Thing Context Menu design-system entry.
// Every story is self-contained: it builds its own model, wires the hook the
// way a real caller would, and logs the actions it receives.

const formatAction = (fired: ThingContextMenuAction) => {
	const trail = [...fired.path, fired.action.id].join(' › ');
	return fired.action.command ? `${fired.action.command} ← ${trail}` : trail;
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
		<Text color={value ? 'var(--tt-ink, #16161a)' : 'var(--tt-faint, #b6b6c0)'} noOfLines={1}>
			{value || 'nothing fired yet'}
		</Text>
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

const ZONE_COLORS: Record<ThingZone, string> = {
	key: 'var(--tt-accent, hotpink)',
	value: 'var(--tt-link, #2f8fd6)',
	thing: 'var(--tt-muted, #9a9aa6)'
};

const ZonesStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);
	const [zone, setZone] = React.useState<ThingZone>('thing');
	const [boxes, setBoxes] = React.useState<ThingZoneBoxes | null>(null);
	const rowRef = React.useRef<HTMLDivElement | null>(null);
	const menu = useThingContextMenu();

	// mirror the live trigger: key-zone right-clicks lead with key verbs
	const model = React.useMemo(() => {
		const base = buildThingContextMenuModel({ editMode: true });

		if (zone !== 'key') {
			return base;
		}

		return {
			sections: [
				{
					id: 'key-zone',
					label: 'Key',
					actions: [
						{ id: 'rename-key', command: 'rename-key', label: 'Rename key…', icon: '✏️', hint: 'Edit the property name' },
						{ id: 'copy-key', command: 'copy-key', label: 'Copy key', icon: '📋', hint: 'flowers' }
					]
				},
				...base.sections
			]
		};
	}, [zone]);

	// measure the virtual bounding boxes relative to the fixture
	const measure = React.useCallback(() => {
		const rowEl = rowRef.current;
		const zoneBoxes = getThingZoneBoxes(rowEl);

		if (!rowEl || !zoneBoxes) {
			return;
		}

		const origin = rowEl.getBoundingClientRect();
		const relative = (box?: ThingZoneBox) => box && { ...box, x: box.x - origin.x, y: box.y - origin.y };

		setBoxes({ key: relative(zoneBoxes.key), value: relative(zoneBoxes.value), thing: relative(zoneBoxes.thing)! });
	}, []);

	React.useEffect(() => {
		measure();
		window.addEventListener('resize', measure);

		return () => {
			window.removeEventListener('resize', measure);
		};
	}, [measure]);

	const overlay = (box: ThingZoneBox | undefined, color: string, dashed?: boolean, pad = 0) =>
		box && (
			<Box
				position="absolute"
				left={`${box.x - pad}px`}
				top={`${box.y - pad}px`}
				width={`${box.width + pad * 2}px`}
				height={`${box.height + pad * 2}px`}
				border={`1.5px ${dashed ? 'dashed' : 'solid'} ${color}`}
				borderRadius="var(--tt-radius-xs, 7px)"
				pointerEvents="none"
			/>
		);

	return (
		<Box>
			<Box
				ref={rowRef}
				position="relative"
				display="inline-block"
				padding="14px"
				cursor="context-menu"
				onContextMenu={(e) => {
					e.preventDefault();
					setZone(resolveThingZone(e.target as Element, rowRef.current));
					menu.openAtPointer(e);
				}}
			>
				<Text data-tt-zone="key" width="fit-content" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" color="var(--tt-muted, #9a9aa6)">
					garden.flowers
				</Text>
				<Text data-tt-zone="value" width="fit-content" fontSize="20px">
					Roses, tulips, sunflowers
				</Text>
				{overlay(boxes?.thing, ZONE_COLORS.thing, true, 8)}
				{overlay(boxes?.key, ZONE_COLORS.key)}
				{overlay(boxes?.value, ZONE_COLORS.value)}
			</Box>

			<Flex columnGap="14px" marginTop="6px" wrap="wrap">
				{(['key', 'value', 'thing'] as ThingZone[]).map((z) => (
					<Flex key={z} alignItems="center" columnGap="6px">
						<Box width="10px" height="10px" border={`1.5px ${z === 'thing' ? 'dashed' : 'solid'} ${ZONE_COLORS[z]}`} borderRadius="3px" />
						<Text fontFamily="var(--tt-font-mono, monospace)" fontSize="10px" color="var(--tt-muted, #9a9aa6)" textTransform="uppercase" letterSpacing="0.08em">
							{z}
							{zone === z ? ' ←' : ''}
						</Text>
					</Flex>
				))}
			</Flex>

			<ThingContextMenu
				{...menu.menuProps}
				model={model}
				meta={{ path: 'garden.flowers', type: 'string', zone }}
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
	drillPath?: string[];
	readonly?: boolean;
	selectedPermissionKey?: string;
	minHeight?: string;
	pinned?: boolean;
	onAction: (fired: ThingContextMenuAction) => void;
}) => {
	const [pinned, setPinned] = React.useState(props.pinned ?? false);
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
					defaultDrillPath={props.drillPath}
					closeOnAction={false}
					pinned={pinned}
					onPinnedChange={setPinned}
					onAction={props.onAction}
				/>
			</Box>
		</Box>
	);
};

const DrilldownStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu minHeight="470px" onAction={(fired) => setLastAction(formatAction(fired))} />
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const TypesSubmenuStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu drillPath={['change-type']} minHeight="470px" onAction={(fired) => setLastAction(formatAction(fired))} />
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const PermissionsStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu
				drillPath={['permissions']}
				selectedPermissionKey="shared"
				minHeight="380px"
				onAction={(fired) => setLastAction(formatAction(fired))}
			/>
			<StoryActionLog value={lastAction} />
		</Box>
	);
};

const DragResizeStory = () => {
	const [lastAction, setLastAction] = React.useState<string | null>(null);

	return (
		<Box>
			<StaticMenu pinned minHeight="500px" onAction={(fired) => setLastAction(formatAction(fired))} />
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
			'The default in-canvas access: hovering (or tapping) the wizard icon next to a thing path opens the menu under the trigger. It lingers briefly so the pointer can travel into it, and the pin keeps it open while you work.',
		render: HoverTriggerStory,
		note: 'This is exactly what ships on every thing header in the live app.'
	},
	{
		id: 'right-click',
		title: 'Right-click (context)',
		description:
			'Any thing surface can open the same menu at the pointer with onContextMenu — in the live app the whole thing row is wired, and the deepest thing under the pointer wins. The surface clamps itself inside the viewport.',
		render: RightClickStory,
		note: 'On touch devices the native long-press maps to the same contextmenu event.'
	},
	{
		id: 'zones',
		title: 'Zones — virtual bounding boxes',
		description:
			'Every atomic thing exposes three zones, each with its own box: the key (property name), the value, and the whole thing (key + value union). Right-click each area of the fixture: the menu header badges the zone you hit, and key-zone clicks lead with key verbs (Rename key…, Copy key). The outlines are measured live by getThingZoneBoxes().',
		render: ZonesStory,
		note: 'The same boxes back drag/drop next: resolveThingZone(target, thing) for hit-testing, getThingZoneBoxes(thing) for geometry.'
	},
	{
		id: 'programmatic-modal',
		title: 'Programmatic (modal)',
		description:
			'Buttons, commands, or keyboard shortcuts open the menu as a centred modal over a scrim — same model, same onAction contract, just a calmer presentation for deliberate flows.',
		render: ModalStory
	},
	{
		id: 'drilldown',
		title: 'Infinite drilldown, one window',
		description:
			'Submenus never fly out or indent: activating a parent drills the whole surface down a level with a back row, as deep as the model goes (try Change type → Thingtime Logo → Replace/Wrap, or Apply template → More templates). The window locks its size on the first drill — deeper levels scroll inside the same frame instead of resizing or spawning surfaces.',
		render: DrilldownStory,
		note: 'Keyboard: → drills into the focused parent, ← or Esc goes back, arrows move between rows.'
	},
	{
		id: 'types-submenu',
		title: 'Change type options',
		description:
			'The Type level lists real options — JavaScript types first, then custom Thingtime types from settings. Wrappable types (like Thingtime Logo) drill one level further to choose Replace value or Wrap current value.',
		render: TypesSubmenuStory
	},
	{
		id: 'permissions',
		title: 'Permissions options',
		description:
			'Permissions render as radio-style options (menuitemradio) with the current level checked. Shared with… drills a level deeper to manage invites — three levels down, still the same window.',
		render: PermissionsStory
	},
	{
		id: 'drag-resize',
		title: 'Drag + resize (pinned)',
		description:
			'The header is a drag handle — made for pinned mode, so a pinned menu can be moved out of the way and kept around like a little tool palette. The bottom-right grip resizes the window; content scrolls inside whatever size you give it.',
		render: DragResizeStory,
		note: 'This story starts pinned: drag the header, resize from the corner, fire actions without closing.'
	},
	{
		id: 'readonly',
		title: 'Read-only thing',
		description:
			'The model builder drops every mutating section for read-only things — the menu naturally reduces to mode, copy, share, and permissions with no per-presentation special-casing.',
		render: ReadonlyStory
	}
];
