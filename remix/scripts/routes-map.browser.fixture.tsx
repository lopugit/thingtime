import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useRevalidator } from 'react-router';
import { buildComponentsByRef, WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { BuilderViewport } from '../app/components/Builder/BuilderViewport';
import { ComponentDataScope } from '../app/components/Builder/ComponentSelect';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import { useThingSource } from '../app/components/Builder/liveComponent';
import { useWebpageRuntime, WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';

const queryControl = (params: Record<string, string>, form = false) => ({
	type: 'button',
	'data-tt-action': '$ui',
	'data-tt-action-inputs': { op: 'query', scope: 'page', params, ...(form ? { form } : {}) }
});

const blocks: WebpageBlock[] = [
	{ id: 'title', type: 'element', tag: 'h1', text: 'Routes browser fixture' },
	{ id: 'notice', type: 'element', tag: 'p', text: 'Synthetic records and map backdrop' },
	{ id: 'map', type: 'element', tag: 'tt-mapbox', props: {
		title: 'Routes fixture map', height: 380, markerScale: 0.5, vaultId: 'synthetic-vault',
		favouritesSource: { action: 'fixture-favourites' },
		selectedFavouriteId: '{query.favouriteId}', onSelectQuery: 'favouriteId', queryScope: 'page'
	} },
	{ id: 'search-form', type: 'element', tag: 'fieldset', children: [
		{ id: 'search', type: 'element', tag: 'input', props: { type: 'search', 'aria-label': 'Search saved places', name: 'q' } },
		{ id: 'search-button', type: 'element', tag: 'button', props: queryControl({ q: '' }, true), text: 'Search' }
	] },
	{ id: 'suggestion-input', type: 'element', tag: 'tt-change', props: { queryKey: 'addressSearch', stateKey: 'addressDraft', clear: ['selectedId', 'selectedAddress'], allowEmpty: false, debounceMs: 40 }, children: [
		{ id: 'address-input', type: 'element', tag: 'input', props: { type: 'search', 'aria-label': 'Suggest addresses' } }
	] },
	{ id: 'suggestion-gate', type: 'condition', condition: { arg: 'query.addressSearch' }, children: [
		{ id: 'suggestions', type: 'collection', props: { transparent: true, templateEach: true, source: {
			action: 'fixture-suggest', inputs: { query: '{query.addressSearch}' }, itemsPath: 'suggestions'
		} }, children: [
			{ id: 'suggestion', type: 'element', tag: 'button', text: '{item.address}', props: {
				type: 'button', 'data-tt-action': '$ui',
				'data-tt-action-inputs': { op: 'patch', values: { selectedId: '{item.id}', selectedAddress: '{item.address}' } }
			} }
		] }
	] },
	{ id: 'selected-id', type: 'condition', condition: { arg: 'selectedId' }, children: [
		{ id: 'selected-id-status', type: 'element', tag: 'p', text: 'Selected ID: {selectedId}' }
	] },
	{ id: 'selected-address', type: 'condition', condition: { arg: 'selectedAddress' }, children: [
		{ id: 'selected-address-status', type: 'element', tag: 'p', text: 'Selected address: {selectedAddress}' }
	] },
	{ id: 'results', type: 'element', tag: 'p', source: { action: 'fixture-search', inputs: { q: '{query.q}' } }, text: '{result.text}' },
	{ id: 'nested-draft', type: 'element', tag: 'input', args: { draft: '' }, props: { 'aria-label': 'Nested draft' } },
	{ id: 'list-button', type: 'element', tag: 'button', props: queryControl({ favouriteId: 'fixture-fern', q: '{query.q}' }), text: 'Show Fern Library from list' },
	{ id: 'route-gate', type: 'condition', condition: { arg: 'query.favouriteId', truthy: true }, children: [
		{ id: 'detail', type: 'element', tag: 'p', source: { action: 'fixture-detail', inputs: { id: '{query.favouriteId}' } }, text: '{result.text}' }
	] },
	{ id: 'legacy-button', type: 'element', tag: 'button', props: {
		type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'query', params: { favouriteId: 'fixture-fern' } }
	}, text: 'Open a deep link' }
];

const markerCommand = { tag: 'button', props: { type: 'button', 'data-tt-action': '$ui',
 'data-tt-action-inputs': JSON.stringify({ op: 'query', scope: 'page', params: { markerId: '{point.id}', markerCommand: '{point.id}' } }) }, children: ['Use marker'] };
const markerContentSlot = (tag: string) => ({ tag, props: { 'data-tt-menu-slot': 'content', style: { display: 'grid' } }, children: [markerCommand, { ttIf: { arg: 'sourceRevision', then: { tag: 'button', props: { type: 'button' }, children: ['Refreshed marker action'] } } }] });
const markerComponents = buildComponentsByRef({
 refs: { 'saved-marker': 'resolved-marker', 'other-component': 'resolved-other', 'missing-marker': null },
 components: [
  { id: 'resolved-marker', crystal: { args: [{ name: 'badge', type: 'string', default: '' }, { name: 'menuDisabled', type: 'boolean', default: false }, { name: 'alternateSlot', type: 'boolean', default: false }, { name: 'sourceRevision', type: 'number', default: 0 }], render: {
   tag: 'tt-menu', props: { contextMenu: true, name: 'Commands for {point.label}', disabled: { ttArg: 'menuDisabled' } }, children: [
    { tag: 'div', props: { 'data-tt-menu-slot': 'target' }, children: [
     { tag: 'button', props: { 'aria-pressed': '{point.selected}', type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': JSON.stringify({ op: 'query', scope: 'page', params: { markerId: '{point.id}' } }) }, children: ['{badge} · {point.label}'] }
    ] },
    { ttIf: { arg: 'alternateSlot', then: markerContentSlot('section'), else: markerContentSlot('div') } },
    { tag: 'p', children: ['Row: {item.crystal.markerLabel}'] },
    { tag: 'input', props: { 'aria-label': 'Draft {point.label}' } },
    { ttIf: { arg: 'point.selected', then: { tag: 'button', props: { type: 'button', 'data-tt-menu-trigger': true, 'aria-label': 'Marker commands for {point.label}', style: { minWidth: 44, minHeight: 44, position: 'absolute', left: '50%', top: '100%', transform: 'translateX(-50%)' } }, children: ['More'] } } },
   ]
  } } },
  { id: 'resolved-other', crystal: { render: { tag: 'p', children: ['Unexpected row-selected component'] } } }
 ]
});

function ComposedFixture() {
	const parentScope = React.useContext(ComponentDataScope);
	const [framed, setFramed] = React.useState(false);
	const [editing, setEditing] = React.useState(false);
	const [show, setShow] = React.useState(true);
	const [selected, setSelected] = React.useState<string | null>(null);
	const [note, setNote] = React.useState('Authored marker note');
	const [hovered, setHovered] = React.useState<string | null>(null);
 const [pulse, setPulse] = React.useState(0);
 const [menuDisabled, setMenuDisabled] = React.useState(false);
 const [alternateSlot, setAlternateSlot] = React.useState(false);
 React.useEffect(() => {
  const owner = window as unknown as { fixtureMarkerRefresh?: (kind: 'scope' | 'disabled' | 'slot') => void };
  const update = (kind: 'scope' | 'disabled' | 'slot') => {
   if (kind === 'disabled') setMenuDisabled(value => !value);
   else if (kind === 'slot') setAlternateSlot(value => !value);
   else setPulse(value => value + 1);
  };
  owner.fixtureMarkerRefresh = update;
  return () => { if (owner.fixtureMarkerRefresh === update) delete owner.fixtureMarkerRefresh; };
 }, []);
	const authored: WebpageBlock[] = [{
		id: 'composed-map', type: 'element', tag: 'tt-mapbox', props: {
			title: 'Composed fixture map', height: 430, vaultId: 'synthetic-vault', favouritesSource: { action: 'fixture-favourites' },
			showFavourites: show, selectedFavouriteId: '{query.markerId}'
		}, children: [
			{ id: 'marker-note', type: 'element', tag: 'p', text: note },
			{ id: 'marker-content', type: 'component', component: 'saved-marker', args: { badge: '{fixtureBadge}', menuDisabled, alternateSlot, sourceRevision: pulse } },
			{ id: 'missing-marker-content', type: 'component', component: 'missing-marker' }
		]
	}];
	const detail: WebpageBlock[] = [
		{ id: 'composed-details', type: 'condition', condition: { arg: 'query.markerId' }, children: [
			{ id: 'composed-details-text', type: 'element', tag: 'p', text: 'Selected marker: {query.markerId}', props: { 'data-tt-reveal': '{query.markerId}' } }
		] },
		{ id: 'marker-command', type: 'element', tag: 'p', text: 'Marker command: {query.markerCommand}' },
		{ id: 'details-spacer', type: 'element', tag: 'div', css: { height: '520px' } }
	];
	const markerView = <WebpageBlocksRenderer blocks={authored} componentsByRef={markerComponents} interactive={!editing} chrome={editing ? {
		seamlessMode: 'layout', selectedId: selected, hoverId: hovered, onSelect: setSelected, onHover: setHovered,
		onInsert: () => {}, onMove: () => {}
	} : undefined} />;
	return <>
  <p>Marker refresh: {pulse}; menu disabled: {String(menuDisabled)}; alternate slot: {String(alternateSlot)}</p>
		<button type="button" onClick={() => setShow(!show)}>{show ? 'Remove fixture markers' : 'Restore fixture markers'}</button>
		<button type="button" onClick={() => setFramed(true)}>Render map in viewport iframe</button>
		<button type="button" onClick={() => setEditing(!editing)}>{editing ? 'View marker composition' : 'Edit marker composition'}</button>
		{editing ? <><p>Selected block: {selected}</p><input aria-label="Edit selected marker note" disabled={selected !== 'marker-note'} value={note} onChange={event => setNote(event.target.value)} /></> : null}
		<ComponentDataScope.Provider value={{ ...parentScope, fixtureBadge: 'Saved', fixturePulse: pulse, fixtureMenuDisabled: menuDisabled, fixtureAlternateSlot: alternateSlot }}>
			{framed ? <BuilderViewport size={{ width: 390, height: 844 }}>{markerView}</BuilderViewport> : markerView}
			<div aria-label="Fixture detail scroll" style={{ height: 105, overflow: 'auto' }}>
				<WebpageBlocksRenderer blocks={detail} componentsByRef={{}} interactive />
			</div>
		</ComponentDataScope.Provider>
	</>;
}

function ManualSourceProbe() {
	const runtime = useWebpageRuntime();
	const [group, setGroup] = React.useState('first');
	const { scope, refetch } = useThingSource({
		source: { action: 'fixture-rank', refresh: 'manual', inputs: { group } },
		cacheId: 'fixture-rank', argValues: {}, interactive: true
	});
	const rank = (scope.result as { rank: number } | undefined)?.rank;
	return <details>
		<summary>Manual source fixture</summary>
		<p>Rank for {group}: {rank}</p>
		<p>{runtime.last?.error}</p>
		<button type="button" data-tt-action="fixture-save">Report synthetic save failure</button>
		<button type="button" data-tt-action="$ui" data-tt-action-inputs={JSON.stringify({ op: 'query', scope: 'page', params: { q: 'fern', favouriteId: 'fixture-quay' } })}>Select Quay during save</button>
		<button type="button" onClick={refetch}>Refetch fixture rank</button>
		<button type="button" data-tt-action="$refresh">Refresh fixture page sources</button>
		<button type="button" onClick={() => setGroup('second')}>Change fixture group</button>
	</details>;
}

let dataPlane = 'home';
function Fixture() {
	const { revalidate } = useRevalidator();
	const [composed, setComposed] = React.useState(false);
	return <ChakraProvider>
		<button type="button" onClick={() => { dataPlane = dataPlane === 'home' ? 'custom-' + 'a'.repeat(64) : 'home'; void revalidate(); }}>Switch fixture database</button>
		<WebpageRuntimeProvider pageId="fixture-routes" pageKey={null} suiteKey={null} source="user" shared>
			<PageActionSurface actionEnabled>
				<button type="button" onClick={() => setComposed(true)}>Open composed marker fixture</button>
				{composed ? <ComposedFixture /> : <><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive /><ManualSourceProbe /></>}
			</PageActionSurface>
		</WebpageRuntimeProvider>
	</ChakraProvider>;
}

const router = createBrowserRouter([{ id: 'root', path: '/p/:id', element: <Fixture />, loader: () => ({ dataPlane }) }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
