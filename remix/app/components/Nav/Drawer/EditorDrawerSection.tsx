import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';

import { useLopu } from '../../Lopu/useLopu';
import { useThingtime } from '../../Thingtime/useThingtime';
import { buildThingModeUrl, parseThingMode, parseThingPath } from '../../Thingtime/thingRoute';

// Drawer section for managing the editor: lists the mounted editor's windows
// (minimise/close), minimised windows (restore), and saved layout configs
// (open/save/delete). Commands reach the mounted EditorSplit over the shared
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

			// remember which config to load, then head to the editor
			setThingtime('settings.editor.openConfig', name, { namespace: 'editor' });
			navigate(buildThingModeUrl('editor', parseThingPath(pathname)));
			props.onNavigate?.();
		},
		[editorMounted, emit, setThingtime, navigate, pathname, props.onNavigate]
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

			const next = { ...configs };
			delete next[name];
			setThingtime('settings.editor.configs', next, { namespace: 'editor' });
			setArmedDelete(null);
			lopu({ title: 'Config deleted 🗑️', description: `"${name}" was removed from settings.editor.configs.`, status: 'info', duration: 5000 });
		},
		[armedDelete, configs, setThingtime, lopu]
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
					<Text fontSize="xs">💻 Open editor</Text>
				</Flex>
			)}

			{editorMounted && (
				<>
					{windows.length > 0 && <SectionLabel>Windows</SectionLabel>}
					{windows.map((win) => (
						<Flex key={win.id} {...rowStyles} cursor="default">
							<Text fontSize="10px" flexShrink={0}>
								{win.location === 'floating' ? '🎈' : '🪟'}
							</Text>
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
							<Text fontSize="10px" flexShrink={0}>
								▢
							</Text>
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
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							💾 Save layout as config
						</Text>
					</Flex>
				</>
			)}

			{configNames.length > 0 && <SectionLabel>Configs</SectionLabel>}
			{configNames.map((name) => (
				<Flex key={name} {...rowStyles} title={`Open "${name}"`} {...rowA11y(`Open config ${name}`, () => openConfig(name))}>
					<Text fontSize="10px" flexShrink={0}>
						📐
					</Text>
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
			))}
		</Box>
	);
};
