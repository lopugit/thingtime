import React from 'react';
import ClickAwayListener from 'react-click-away-listener';
import { Box, Flex, Input, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';

import { Icon } from '../../Icon/Icon';
import { useLopu } from '../../Lopu/useLopu';
import { ThingContextMenu } from '../../Thingtime/ContextMenu/ThingContextMenu';
import type { ThingContextMenuModel } from '../../Thingtime/ContextMenu/contextMenuModel';
import { useThingContextMenu } from '../../Thingtime/ContextMenu/useThingContextMenu';
import { useThingtime } from '../../Thingtime/useThingtime';
import { buildThingModeUrl, parseThingMode, parseThingPath } from '../../Thingtime/thingRoute';

// Drawer section for managing the editor: lists the mounted editor's windows
// (minimise/close), minimised windows (restore), and saved layout configs
// (open/save/rename/duplicate/delete — right-click a config for its own
// Thing Context Menu). Commands reach the mounted EditorSplit over the shared
// events bus ('editor-command'); configs persist in settings.editor.configs.

type LiveWindow = {
	id: string;
	path: string;
	edit?: boolean;
	contentMode?: string;
	location?: 'docked' | 'floating';
};

const rowStyles = {
	alignItems: 'center',
	columnGap: 2,
	marginX: 2,
	paddingX: 3,
	paddingLeft: 6,
	paddingY: '5px',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	_hover: { background: 'var(--tt-surface-hover, #ececee)' },
	_focusVisible: { outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '-2px' },
	transition: 'background 0.15s ease',
	cursor: 'pointer'
} as const;

// keyboard/screen-reader semantics for clickable rows (they can contain
// nested action buttons, so they can't be <button>s themselves)
const rowA11y = (label: string, onActivate: () => void) => ({
	role: 'button',
	tabIndex: 0,
	'aria-label': label,
	onClick: onActivate,
	onKeyDown: (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onActivate();
		}
	}
});

const rowActionStyles = {
	as: 'button' as const,
	type: 'button' as const,
	alignItems: 'center',
	justifyContent: 'center',
	minWidth: '18px',
	height: '18px',
	paddingX: '2px',
	borderRadius: '5px',
	color: 'var(--tt-faint, #b6b6c0)',
	fontSize: '11px',
	lineHeight: 1,
	cursor: 'pointer',
	flexShrink: 0,
	transition: 'background 0.15s ease, color 0.15s ease',
	_hover: { background: 'var(--tt-border-light, #f0f0f2)', color: 'var(--tt-ink, #16161a)' },
	_focusVisible: { outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '1px' }
} as const;

const SectionLabel = (props: { children: React.ReactNode }) => (
	<Text
		paddingX={5}
		paddingTop={3}
		paddingBottom={1}
		fontFamily="mono"
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.08em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
	>
		{props.children}
	</Text>
);

export const EditorDrawerSection = (props: { onNavigate?: () => void }) => {
	const { thingtime, setThingtime, events } = useThingtime();
	const lopu = useLopu();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	// deleting a config takes two clicks: the first arms for a moment
	const [armedDelete, setArmedDelete] = React.useState<string | null>(null);
	const armedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
		return () => {
			if (armedTimerRef.current) {
				clearTimeout(armedTimerRef.current);
			}
		};
	}, []);

	// config right-click menu + inline rename
	const configMenu = useThingContextMenu();
	const [menuConfigName, setMenuConfigName] = React.useState<string | null>(null);
	const [renaming, setRenaming] = React.useState<string | null>(null);
	const [renameDraft, setRenameDraft] = React.useState('');

	const editorMounted = parseThingMode(pathname) === 'editor';
	const editorSettings = thingtime?.settings?.editor;

	const windows: LiveWindow[] = editorMounted ? editorSettings?.live?.windows || [] : [];
	const minimised: LiveWindow[] = editorMounted ? editorSettings?.live?.minimised || [] : [];
	const configs: Record<string, unknown> = editorSettings?.configs || {};
	const configNames = Object.keys(configs);

	const emit = React.useCallback(
		(payload: Record<string, unknown>) => {
			events.next({ type: 'editor-command', ...payload });
		},
		[events]
	);

	const openEditor = React.useCallback(() => {
		navigate(buildThingModeUrl('editor', parseThingPath(pathname)));
		props.onNavigate?.();
	}, [navigate, pathname, props.onNavigate]);

	const openConfig = React.useCallback(
		(name: string) => {
			if (editorMounted) {
				emit({ command: 'apply-config', name });
				return;
			}

			// remember which config to load, then head to the editor — a handoff to
			// THIS tab's own next navigation, not a shared setting. A peer already on
			// /editor that has not consumed an intent since mount would otherwise pick
			// this one up and applyLayout over the windows someone has open there.
			setThingtime('settings.editor.openConfig', name, { namespace: 'editor', tabLocal: true });
			navigate(buildThingModeUrl('editor', parseThingPath(pathname)));
			props.onNavigate?.();
		},
		[editorMounted, emit, setThingtime, navigate, pathname, props.onNavigate]
	);

	const removeConfig = React.useCallback(
		(name: string) => {
			const next = { ...configs };
			delete next[name];
			setThingtime('settings.editor.configs', next, { namespace: 'editor' });
			lopu({ title: 'Config deleted 🗑️', description: `"${name}" was removed from settings.editor.configs.`, status: 'info', duration: 5000 });
		},
		[configs, setThingtime, lopu]
	);

	const deleteConfig = React.useCallback(
		(name: string) => {
			// first click arms, second click (within 3s) deletes
			if (armedDelete !== name) {
				setArmedDelete(name);
				if (armedTimerRef.current) {
					clearTimeout(armedTimerRef.current);
				}
				armedTimerRef.current = setTimeout(() => setArmedDelete(null), 3000);
				return;
			}

			setArmedDelete(null);
			removeConfig(name);
		},
		[armedDelete, removeConfig]
	);

	const startRename = React.useCallback((name: string) => {
		setRenaming(name);
		setRenameDraft(name);
	}, []);

	const commitRename = React.useCallback(
		(oldName: string) => {
			const nextName = renameDraft.trim();
			setRenaming(null);

			if (!nextName || nextName === oldName) {
				return;
			}

			if (Object.hasOwnProperty.call(configs, nextName)) {
				lopu({ title: 'Name already taken 🤔', description: `A config called "${nextName}" already exists.`, status: 'warning', duration: 5000 });
				return;
			}

			// rebuild preserving order so the renamed config keeps its spot
			const next: Record<string, unknown> = {};
			Object.keys(configs).forEach((key) => {
				next[key === oldName ? nextName : key] = configs[key];
			});

			setThingtime('settings.editor.configs', next, { namespace: 'editor' });
			lopu({ title: 'Config renamed ✏️', description: `"${oldName}" is now "${nextName}".`, status: 'success', duration: 4000 });
		},
		[renameDraft, configs, setThingtime, lopu]
	);

	const duplicateConfig = React.useCallback(
		(name: string) => {
			let copyName = `${name} copy`;
			let increment = 1;
			while (Object.hasOwnProperty.call(configs, copyName) && increment <= 999) {
				increment++;
				copyName = `${name} copy ${increment}`;
			}

			let clone: unknown = configs[name];
			try {
				clone = JSON.parse(JSON.stringify(configs[name]));
			} catch {
				// layouts are plain JSON; fall back to the original reference
			}

			setThingtime('settings.editor.configs', { ...configs, [copyName]: clone }, { namespace: 'editor' });
			lopu({ title: 'Config duplicated 🐑', description: `"${copyName}" sits beside the original.`, status: 'success', duration: 4000 });
		},
		[configs, setThingtime, lopu]
	);

	// the config context menu: same surface as thing menus, config verbs
	const configMenuModel = React.useMemo<ThingContextMenuModel>(() => {
		if (!menuConfigName) {
			return { sections: [] };
		}

		return {
			sections: [
				{
					id: 'config',
					actions: [
						{
							id: 'open-config',
							command: 'open-config',
							label: 'Open layout',
							icon: '📐',
							lucide: 'layout-template',
							hint: editorMounted ? 'Apply to this editor' : 'Open the editor with this layout'
						},
						{ id: 'rename-config', command: 'rename-config', label: 'Rename…', icon: '✏️', lucide: 'text-cursor-input', hint: 'Edit the config name' },
						{ id: 'duplicate-config', command: 'duplicate-config', label: 'Duplicate', icon: '🐑', lucide: 'copy-plus' },
						...(editorMounted
							? [
									{
										id: 'overwrite-config',
										command: 'overwrite-config',
										label: 'Overwrite with current layout',
										icon: '💾',
										lucide: 'save',
										hint: 'Replace the saved windows'
									}
							  ]
							: [])
					]
				},
				{
					id: 'danger',
					actions: [{ id: 'delete-config', command: 'delete-config', label: 'Delete', icon: '🗑️', lucide: 'trash-2', danger: true }]
				}
			]
		};
	}, [menuConfigName, editorMounted]);

	const onConfigMenuAction = React.useCallback(
		({ action }: { action: { command?: string } }) => {
			const name = menuConfigName;

			if (!name) {
				return;
			}

			switch (action.command) {
				case 'open-config':
					openConfig(name);
					break;
				case 'rename-config':
					startRename(name);
					break;
				case 'duplicate-config':
					duplicateConfig(name);
					break;
				case 'overwrite-config':
					emit({ command: 'overwrite-config', name });
					break;
				case 'delete-config':
					removeConfig(name);
					break;
				default:
					break;
			}
		},
		[menuConfigName, openConfig, startRename, duplicateConfig, emit, removeConfig]
	);

	const onConfigContextMenu = React.useCallback(
		(e: React.MouseEvent, name: string) => {
			e.preventDefault();
			e.stopPropagation();
			setMenuConfigName(name);
			configMenu.openAtPointer(e);
		},
		[configMenu.openAtPointer]
	);

	return (
		<Box className="editorDrawerSection" paddingBottom={1}>
			<Text
				paddingX={5}
				paddingTop={5}
				paddingBottom={1}
				fontFamily="mono"
				fontSize="10px"
				fontWeight={600}
				letterSpacing="0.08em"
				textTransform="uppercase"
				color="var(--tt-muted, #9a9aa6)"
			>
				Editor
			</Text>

			{!editorMounted && (
				<Flex {...rowStyles} {...rowA11y('Open editor', openEditor)}>
					<Icon name="💻" lucide="monitor" size="12px" chakras={{ flexShrink: 0 }} />
					<Text fontSize="xs">Open editor</Text>
				</Flex>
			)}

			{editorMounted && (
				<>
					{windows.length > 0 && <SectionLabel>Windows</SectionLabel>}
					{windows.map((win) => (
						<Flex key={win.id} {...rowStyles} cursor="default">
							<Icon name={win.location === 'floating' ? '🎈' : '🪟'} size="11px" chakras={{ flexShrink: 0 }} />
							<Text fontSize="xs" fontFamily="mono" noOfLines={1} minWidth={0}>
								{win.path}
							</Text>
							<Flex marginLeft="auto" columnGap="3px">
								<Flex {...rowActionStyles} title="Minimise window" onClick={() => emit({ command: 'minimise-window', id: win.id })}>
									−
								</Flex>
								<Flex {...rowActionStyles} title="Close window" onClick={() => emit({ command: 'close-window', id: win.id })}>
									×
								</Flex>
							</Flex>
						</Flex>
					))}

					{minimised.length > 0 && <SectionLabel>Minimised</SectionLabel>}
					{minimised.map((win) => (
						<Flex
							key={win.id}
							{...rowStyles}
							title="Restore window"
							{...rowA11y(`Restore window ${win.path}`, () => emit({ command: 'restore-window', id: win.id }))}
						>
							<Icon name="▢" size="11px" chakras={{ flexShrink: 0 }} />
							<Text fontSize="xs" fontFamily="mono" color="var(--tt-muted, #9a9aa6)" noOfLines={1} minWidth={0}>
								{win.path}
							</Text>
							<Flex marginLeft="auto" columnGap="3px">
								<Flex {...rowActionStyles} title="Close window" onClick={(e) => { e.stopPropagation(); emit({ command: 'close-window', id: win.id }); }}>
									×
								</Flex>
							</Flex>
						</Flex>
					))}

					<Flex {...rowStyles} {...rowA11y('New editor window', () => emit({ command: 'new-window' }))}>
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							＋ New window
						</Text>
					</Flex>
					<Flex {...rowStyles} {...rowA11y('Save layout as config', () => emit({ command: 'save-config' }))}>
						<Icon name="💾" size="12px" chakras={{ flexShrink: 0 }} />
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							Save layout as config
						</Text>
					</Flex>
				</>
			)}

			{configNames.length > 0 && <SectionLabel>Configs</SectionLabel>}
			{configNames.map((name) =>
				renaming === name ? (
					<Flex key={name} {...rowStyles} cursor="default">
						<Icon name="📐" lucide="layout-template" size="11px" chakras={{ flexShrink: 0 }} />
						<Input
							autoFocus
							value={renameDraft}
							onChange={(e) => setRenameDraft(e.target.value)}
							onBlur={() => commitRename(name)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									commitRename(name);
								} else if (e.key === 'Escape') {
									setRenaming(null);
								}
							}}
							onClick={(e) => e.stopPropagation()}
							aria-label={`Rename config ${name}`}
							variant="unstyled"
							fontSize="xs"
							height="20px"
							paddingX="4px"
							background="var(--tt-card, #ffffff)"
							borderRadius="5px"
							boxShadow="0 0 0 1.5px var(--tt-accent, hotpink)"
						/>
					</Flex>
				) : (
					<Flex
						key={name}
						{...rowStyles}
						title={`Open "${name}" — right-click for options`}
						{...rowA11y(`Open config ${name}`, () => openConfig(name))}
						onContextMenu={(e) => onConfigContextMenu(e, name)}
					>
						<Icon name="📐" lucide="layout-template" size="11px" chakras={{ flexShrink: 0 }} />
						<Text fontSize="xs" noOfLines={1} minWidth={0}>
							{name}
						</Text>
						<Flex marginLeft="auto" columnGap="3px">
							<Flex
								{...rowActionStyles}
								color={armedDelete === name ? 'var(--tt-danger, #d6455a)' : rowActionStyles.color}
								fontWeight={armedDelete === name ? 700 : 400}
								title={armedDelete === name ? 'Click again to delete' : `Delete "${name}"`}
								aria-label={armedDelete === name ? `Confirm delete ${name}` : `Delete ${name}`}
								onClick={(e) => {
									e.stopPropagation();
									deleteConfig(name);
								}}
							>
								{armedDelete === name ? 'sure?' : '×'}
							</Flex>
						</Flex>
					</Flex>
				)
			)}

			{/* config context menu — the Thing Context Menu surface, config verbs */}
			<ClickAwayListener
				onClickAway={() => {
					if (configMenu.open) {
						configMenu.closeMenu();
					}
				}}
			>
				<Box>
					<ThingContextMenu
						{...configMenu.menuProps}
						model={configMenuModel}
						meta={{ path: menuConfigName ? `settings.editor.configs.${menuConfigName}` : 'settings.editor.configs', type: 'layout config' }}
						onAction={onConfigMenuAction}
					/>
				</Box>
			</ClickAwayListener>
		</Box>
	);
};
