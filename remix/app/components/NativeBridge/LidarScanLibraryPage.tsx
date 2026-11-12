import React from 'react';
import { Box, Text, useMediaQuery } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { LidarScanControls } from './LidarScanControls';
import { useLidarScanControls } from './LidarScanProvider';
import type { LidarSaveDestination, LidarScanItem } from './lidarScanBridge';
import { lidarSaveMenu, lidarScanThing } from './lidarScanLibrary';
import { ThingsGridView, ThingsListView, type ThingsItemHandlers } from '../Things/ThingsViews';
import { PersistedThingContextMenu } from '../Thingtime/ContextMenu/PersistedThingContextMenu';
import { useThingContextMenu } from '../Thingtime/ContextMenu/useThingContextMenu';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';

const saveButton: WebpageBlock = { id: 'scan-save', type: 'element', tag: 'button', text: 'Save to Thingtime',
	props: { type: 'button', disabled: '{scan.disabled}', 'aria-haspopup': 'menu', 'aria-expanded': '{scan.menuOpen}',
		'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'choose' } },
	css: { 'min-height': '44px', padding: '6px 10px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px',
		background: 'var(--tt-card, white)', color: 'inherit', 'font-size': '12px', 'max-width': '100%', 'white-space': 'normal' } };
const saveBlocks: WebpageBlock[] = [{ id: 'scan-card-controls', type: 'container', direction: 'column', gap: 4, children: [
	{ id: 'scan-placement', type: 'element', tag: 'p', text: '{scan.summary}', css: { margin: '0', 'font-size': '11px', color: 'var(--tt-muted)', 'text-align': 'center' } },
	{ id: 'scan-detail', type: 'element', tag: 'p', text: '{scan.detail}', css: { margin: '0', 'font-size': '11px', 'overflow-wrap': 'anywhere' } },
	{ id: 'scan-save-visible', type: 'condition', condition: { arg: 'scan.canSave', equals: true }, children: [saveButton] }
] }];

function ScanSaveButton({ scan, busy, save, scopeKey }: { scan: LidarScanItem; busy: boolean; scopeKey: string; save: (id: string, destination: LidarSaveDestination) => void }) {
	const menu = useThingContextMenu();
	return <Box onClick={event => event.stopPropagation()}>
		<SettingsDocumentHost documentKey="lidar-library-save-button" defaultDocument={saveBlocks} scopeKey={scopeKey} title="Scan save button layout" layoutEditingDisabled={busy}>
			{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${scopeKey}:${scan.scanId}`} enabled={!editing}
				scope={{ scan: { disabled: busy || !scan.available, menuOpen: menu.open, canSave: !scan.fileThingId,
					summary: lidarScanThing(scan, '').tags.join(' · '), detail: scan.error || scan.detail || (!scan.available ? 'Archive not ready. Refresh scans to check recovery.' : '') } }} actions={{ choose: () => menu.openPopover() }}>
				<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
			</TransientBlockHost>}
		</SettingsDocumentHost>
		<PersistedThingContextMenu {...menu.menuProps} model={lidarSaveMenu(scan, busy, true)} onAction={({ action }) => {
			menu.closeMenu();
			if (action.command === 'lidar-device' || action.command === 'lidar-cloud') save(scan.scanId, action.command === 'lidar-device' ? 'device' : 'cloud');
		}} />
	</Box>;
}

const controlCss = { 'min-height': '44px', padding: '8px 10px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, white)', color: 'inherit', 'min-width': '0', 'max-width': '100%' };
const binding = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const choice = (id: string, value: string, text: string): WebpageBlock => ({ id, type: 'element', tag: 'option', props: { value }, text });
const libraryBlocks: WebpageBlock[] = [
	{ id: 'lidar-library-heading', type: 'container', direction: 'column', gap: 8, css: { 'margin-bottom': '16px' }, children: [
		{ id: 'lidar-library-back', type: 'element', tag: 'a', text: '← Things', props: { href: '/things' }, css: { 'font-size': '13px', width: 'fit-content', padding: '8px 0' } },
		{ id: 'lidar-library-title', type: 'element', tag: 'h1', text: 'LiDAR scans', css: { margin: '0', 'font-size': '24px', 'font-weight': '600' } },
		{ id: 'lidar-library-description', type: 'element', tag: 'p', text: 'Browse scans kept on this device. Save to Thingtime on the device only, or upload a private Cloud copy. The original stays on your device.', css: { margin: '0', 'font-size': '14px', color: 'var(--tt-muted)' } }
	] },
	{ id: 'lidar-library-toolbar', type: 'container', direction: 'row', gap: 8, css: { 'flex-wrap': 'wrap', 'align-items': 'center', 'margin-bottom': '16px' }, children: [
		{ id: 'lidar-library-search', type: 'element', tag: 'input', props: { 'aria-label': 'Search LiDAR scans', placeholder: 'Search scans', value: '{library.query}', ...binding('search') }, css: { ...controlCss, flex: '1 1 180px' } },
		{ id: 'lidar-library-filter', type: 'element', tag: 'select', props: { 'aria-label': 'Scan storage', value: '{library.filter}', ...binding('filter') }, css: controlCss, children: [choice('scan-filter-all', 'all', 'All scans'), choice('scan-filter-unsaved', 'unsaved', 'Not saved to Thingtime'), choice('scan-filter-device', 'device', 'Device only'), choice('scan-filter-cloud', 'cloud', 'Cloud')] },
		{ id: 'lidar-library-view', type: 'element', tag: 'select', props: { 'aria-label': 'Scan view', value: '{library.view}', ...binding('view') }, css: controlCss, children: [choice('scan-view-grid', 'grid', 'Grid'), choice('scan-view-list', 'list', 'List')] },
		{ id: 'lidar-library-refresh-visible', type: 'condition', condition: { arg: 'library.canRefresh', equals: true }, children: [{ id: 'lidar-library-refresh', type: 'element', tag: 'button', text: 'Refresh scans', props: { type: 'button', disabled: '{library.busy}', ...binding('refresh') }, css: controlCss }] },
		{ id: 'lidar-library-count', type: 'element', tag: 'span', text: '{library.count}', css: { 'font-size': '12px', color: 'var(--tt-muted)' } }
	] }
];

/** Device metadata is held only in this scoped native session; listing never publishes a Thing or an upload. */
export function LidarScanLibraryPage() {
	const user = useCurrentUser();
	const controls = useLidarScanControls();
	const navigate = useNavigate();
	const [mobile] = useMediaQuery('(max-width: 640px)');
	const [query, setQuery] = React.useState('');
	const [view, setView] = React.useState<'grid' | 'list'>('grid');
	const [filter, setFilter] = React.useState('all');
	const [selected, setSelected] = React.useState<Set<string>>(new Set());
	const [notice, setNotice] = React.useState('');
	const [contextId, setContextId] = React.useState<string>();
	const menu = useThingContextMenu();
	const closeMenu = menu.closeMenu;
	const owned = controls?.ownerId === user?.id ? controls : null;
	const scans = owned?.library ? owned.snapshot.result?.scans : undefined;
	const busy = !!owned?.snapshot.waiting || owned?.snapshot.result?.state === 'saving' || owned?.snapshot.result?.state === 'capturing';
	const scopeKey = `${user?.id}:${owned?.generation}`;
	React.useEffect(() => { setSelected(new Set()); setContextId(undefined); setNotice(''); closeMenu(); }, [scopeKey, closeMenu]);
	const save = (id: string, destination: LidarSaveDestination) => {
		if (!owned?.save(id, destination)) setNotice('Check scanner status before trying again. Your local scan is kept.');
		else setNotice('');
	};
	const scanMap = new Map((scans || []).map(scan => [scan.scanId, scan]));
	const visible = (scans || []).filter(scan => {
		const status = scan.fileThingId ? 'cloud' : scan.deviceSaved ? 'device' : 'unsaved';
		return (filter === 'all' || filter === status) && (!query || `${scan.scanId} ${new Date(scan.createdAt).toLocaleString()} ${status} ${scan.isPartial ? 'partial' : ''}`.toLowerCase().includes(query.toLowerCase()));
	}).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const items = visible.map(scan => lidarScanThing(scan, user?.id || ''));
	const toggle = (id: string) => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
	const open = (id: string) => {
		const scan = scanMap.get(id);
		if (scan?.fileThingId) navigate(`/thing/${encodeURIComponent(scan.fileThingId)}?from=things`);
		else { setContextId(id); menu.openPopover(); }
	};
	const handlers: ThingsItemHandlers = {
		compact: mobile, ownerId: user?.id, selected, cutIds: new Set(), isMobile: mobile,
		itemMenuFor: item => lidarSaveMenu(scanMap.get(item.id)!, busy),
		itemActions: item => <ScanSaveButton scan={scanMap.get(item.id)!} busy={busy} save={save} scopeKey={scopeKey} />,
		onItemClick: item => toggle(item.id), onItemOpen: item => open(item.id), onItemToggle: item => toggle(item.id),
		onItemAction: (item, action) => { if (action as string === 'lidar-device' || action as string === 'lidar-cloud') save(item.id, action as string === 'lidar-device' ? 'device' : 'cloud'); else if (action === 'open') open(item.id); },
		onItemContextMenu: (item, event) => { setContextId(item.id); menu.openAtPointer(event); },
		onItemDragStart: (_item, event) => event.preventDefault(), onItemDragEnd() {}, dropTargetId: undefined,
		onFolderDragOver() {}, onFolderDragLeave() {}, onFolderDrop() {}
	};
	const contextScan = contextId ? scanMap.get(contextId) : undefined;
	return <Box width="100%" maxWidth="1200px" marginX="auto" padding={{ base: 3, md: 6 }} paddingTop="calc(env(safe-area-inset-top, 0px) + var(--tt-nav-clearance, 72px) + 20px)" minWidth={0}>
		<SettingsDocumentHost documentKey="lidar-library-toolbar" defaultDocument={libraryBlocks} scopeKey={scopeKey} title="LiDAR library layout" layoutEditingDisabled={busy}>
			{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ library: { query, filter, view, count: scans ? `${visible.length} scan${visible.length === 1 ? '' : 's'}` : '', canRefresh: owned?.mode === 'native', busy } }}
				actions={{ refresh: () => { owned?.check(); }, search: ({ value }) => setQuery(String(value ?? '')), filter: ({ value }) => setFilter(String(value ?? 'all')), view: ({ value }) => { if (value === 'grid' || value === 'list') setView(value); } }}>
				<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
			</TransientBlockHost>}
		</SettingsDocumentHost>
		<LidarScanControls />

		{notice && <Text role="status" marginBottom={3}>{notice}</Text>}
		{!user?.id ? <Text>Sign in to browse your private scans.</Text> : !owned || owned.mode !== 'native' ? <Text>Open this page in Thingtime on the iPhone or iPad that recorded your scans to browse its device library.</Text> : !owned.library ? <Text>Update the Thingtime iOS app to browse all scans and choose Device only or Cloud.</Text> : scans && !items.length ? <Text color="var(--tt-muted)">{scans.length ? 'No scans match your search.' : 'Your scans will appear here after recording. They stay on this device until you choose where to save them.'}</Text> : null}
		{view === 'grid' ? <ThingsGridView items={items} handlers={handlers} displayMode="name" /> : <ThingsListView items={items} handlers={handlers} displayMode="name" allSelected={!!items.length && items.every(item => selected.has(item.id))} onToggleAll={() => setSelected(current => items.every(item => current.has(item.id)) ? new Set() : new Set(items.map(item => item.id)))} />}
		{contextScan && <PersistedThingContextMenu {...menu.menuProps} model={lidarSaveMenu(contextScan, busy)} onAction={({ action }) => { menu.closeMenu(); if (action.command === 'lidar-device' || action.command === 'lidar-cloud') save(contextScan.scanId, action.command === 'lidar-device' ? 'device' : 'cloud'); else if (action.command === 'open') open(contextScan.scanId); }} />}
	</Box>;
}
