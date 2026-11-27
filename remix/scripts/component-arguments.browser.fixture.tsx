import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import { WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import { BuilderDrawer } from '../app/components/Builder/BuilderDrawer';
import { ComponentDataScope } from '../app/components/Builder/ComponentSelect';
import { LiveTemplate } from '../app/components/Builder/liveComponent';
import { ComponentInstanceIdentity } from '../app/components/Builder/componentInstanceIdentity';
import { expandedComponentBlock, templateToBlocks } from '../app/components/Builder/templateBlocks';
import type { UseWebpageDraft } from '../app/components/Builder/useWebpage';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';

const recordComponent = {
	id: 'synthetic-record-component',
	crystal: {
		args: [{ name: 'recordId', type: 'string', default: 'default-id' }, { name: 'defaultLiteral', type: 'string', default: '{item.linkId}' }],
		savedArgs: { savedLiteral: '{item.linkId}' },
		source: { action: 'fixture-read-record', inputs: { id: '{recordId}' } },
		render: { tag: 'section', props: { 'aria-label': 'Record {recordId}' }, children: [
			{ tag: 'button', ttAction: '$ui', ttActionInputs: { op: 'increment', key: 'editorVersion' }, props: { type: 'button' }, children: ['Expand record {recordId}'] },
			{ tag: 'p', children: ['Editor state {recordId}: {editorVersion}'] },
			{ tag: 'p', children: ['Record title: {result.record.title}'] },
			{ tag: 'p', children: ['Literals: {literal} / {defaultLiteral} / {savedLiteral}'] },
			{ tag: 'label', children: ['Flag', { tag: 'input', props: { type: 'checkbox', 'aria-label': 'Flag {recordId}',
				'data-tt-action': '$ui', 'data-tt-action-inputs': JSON.stringify({ op: 'set', key: 'flag' }) } }] },
			{ tag: 'p', children: ['Flag state {recordId}: {flag}'] },
			{ tag: 'fieldset', children: [
				{ tag: 'label', children: ['Draft', { tag: 'input', props: { name: 'title', 'aria-label': 'Draft {recordId}', defaultValue: '{result.record.title}' } }] },
				{ tag: 'button', ttAction: 'fixture-save-record', ttActionInputs: { id: '{recordId}' }, props: { type: 'button' }, children: ['Save record'] }
			] }
		] }
	}
};
const instance: WebpageBlock = {
	id: 'record-editor', type: 'component', component: 'synthetic-record-component',
	args: { recordId: 'literal-id', literal: '{item.linkId}' },
	argBindings: { recordId: '{item.linkId}' }
};

function Fixture() {
	const [rows, setRows] = React.useState([{ id: 'row-a', linkId: 'record-a' }, { id: 'row-b', linkId: 'record-b' }]);
	const [expanded, setExpanded] = React.useState(false);
	const [inspecting, setInspecting] = React.useState(false);
	const [stableMarkerIdentity, setStableMarkerIdentity] = React.useState(false);
	const [blocks, setBlocks] = React.useState([instance]);
	const [dataPlane, setDataPlane] = React.useState('home');
	const components = { 'synthetic-record-component': recordComponent };
	const child = React.useMemo(() => {
		let nextId = 0;
		return expanded ? expandedComponentBlock(blocks[0], recordComponent.crystal,
			templateToBlocks(recordComponent.crystal.render, kind => 'expanded-' + kind + '-' + (++nextId))) : blocks[0];
	}, [expanded, blocks]);
	const collection: WebpageBlock[] = [{
		id: 'outer-rows', type: 'collection', props: { transparent: true, itemsPath: 'fixtureRows' }, children: [
			{ id: 'row-wrapper', type: 'element', tag: 'article', props: { 'aria-label': 'Row {item.id}' }, children: [
				{ id: 'nested-row', type: 'collection', props: { transparent: true, itemsPath: 'item.children' }, children: [child] }
			] }
		]
	}];
	const draft = { blocks, setBlocks, componentsByRef: components, dirty: true, editorScope: 'synthetic-arguments',
		resolved: { source: 'user', page: { id: 'fixture-arguments' } }, branch: null,
		save: async () => ({ ok: true }), discardDraft() {}, resetToDefault: async () => ({ ok: true })
	} as unknown as UseWebpageDraft;
	return <ChakraProvider>
		<WebpageRuntimeProvider key={dataPlane} pageId="fixture-arguments" pageKey={null} suiteKey={null} source="user" shared={false}>
			<PageActionSurface actionEnabled>
				<h1>Component argument fixture</h1>
				<p>Synthetic records and editable Components</p>
				<button onClick={() => setRows([{ id: 'row-a', linkId: 'slow-record' }])}>Choose slow record</button>
				<button onClick={() => setRows([{ id: 'row-a', linkId: 'new-record' }])}>Choose new record</button>
				<button onClick={() => setRows([{ id: 'row-a', linkId: '' }])}>Remove row link</button>
				<button onClick={() => setExpanded(value => !value)}>Toggle expanded blocks</button>
				<button onClick={() => setInspecting(value => !value)}>Toggle inspector</button>
				<button onClick={() => setStableMarkerIdentity(true)}>Use stable marker identity</button>
				<button onClick={() => setDataPlane(value => value === 'home' ? 'other' : 'home')}>Reset runtime identity</button>
				<LiveTemplate interactive render={{ tag: 'p', children: ['Outer flag: {flag}'] }} scope={{ parentLiteral: 'outer' }}>
					<FixtureRows rows={rows.map(row => ({ id: row.id, children: [row] }))}>
						<ComponentInstanceIdentity.Provider value={stableMarkerIdentity ? 'synthetic-marker-instance' : null}>
							<WebpageBlocksRenderer blocks={collection} componentsByRef={components} interactive />
						</ComponentInstanceIdentity.Provider>
					</FixtureRows>
				</LiveTemplate>
				{inspecting && <BuilderDrawer title="Component inspector" draft={draft} selectedId={instance.id} onDeselect={() => {}}
					onClose={() => setInspecting(false)} mode="page" pageName="Fixture" onPageName={() => {}}
					audienceAcl={['tt:user']} onAudienceAcl={() => {}} hideTransfer />}
			</PageActionSurface>
		</WebpageRuntimeProvider>
	</ChakraProvider>;
}

function FixtureRows({ rows, children }: { rows: unknown[]; children: React.ReactNode }) {
	const scope = React.useContext(ComponentDataScope);
	return <ComponentDataScope.Provider value={{ ...scope, fixtureRows: rows }}>{children}</ComponentDataScope.Provider>;
}
const router = createBrowserRouter([{ id: 'root', path: '/p/:id', element: <Fixture />,
	loader: () => ({ dataPlane: 'home', user: { id: 'fixture-owner', username: 'fixture-owner' } }) }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
