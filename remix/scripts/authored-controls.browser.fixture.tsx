import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { BuilderViewport } from '../app/components/Builder/BuilderViewport';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import { WebpageRuntimeProvider, useWebpageRuntime } from '../app/components/Builder/webpageRuntime';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';
const data = (window as any).authoredFixture;
function RuntimeStatus() {
	const runtime = useWebpageRuntime();
	return <p role="status">{runtime.last?.error || (runtime.last?.ok ? 'Saved' : 'Ready')}</p>;
}
function Fixture() {
	const [framed, setFramed] = React.useState(false);
	const [deferredDefault, setDeferredDefault] = React.useState({
		kind: 'rich-text',
		blocks: [{ type: 'paragraph', data: { text: 'Initial hidden default' } }]
	});
	const blocks: WebpageBlock[] = [
		{
			id: 'deferred-form',
			type: 'element',
			tag: 'tt-form',
			props: { identityName: 'id', completion: { ttArg: 'last' } },
			children: [
				{ id: 'deferred-title', type: 'element', tag: 'input', props: { type: 'hidden', name: 'title', value: 'Deferred default' } },
				{
					id: 'deferred-details',
					type: 'element',
					tag: 'details',
					props: { 'aria-label': 'Deferred fields' },
					children: [
						{ id: 'deferred-summary', type: 'element', tag: 'summary', text: 'Deferred editor' },
						{
							id: 'deferred-rich',
							type: 'element',
							tag: 'tt-rich-text',
							props: { name: 'document', plainTextName: 'text', required: true, resetKey: 'deferred-record', value: deferredDefault }
						}
					]
				},
				{
					id: 'deferred-save',
					type: 'element',
					tag: 'button',
					text: 'Save deferred defaults',
					props: { type: 'button', 'data-tt-action': data.action }
				}
			]
		},
		{
			id: 'context',
			type: 'element',
			tag: 'tt-menu',
			props: { contextMenu: true },
			children: [
				{
					id: 'target',
					type: 'element',
					tag: 'div',
					props: { 'data-tt-menu-slot': 'target' },
					children: [{ id: 'primary', type: 'element', tag: 'button', text: 'Context target', props: { type: 'button' } }]
				},
				{ id: 'more', type: 'element', tag: 'button', text: 'More actions', props: { type: 'button', 'data-tt-menu-trigger': true } },
				{
					id: 'content',
					type: 'element',
					tag: 'div',
					props: {
						'data-tt-menu-slot': 'content',
						style: { display: 'grid', gap: '12px', color: '#20282d', background: 'white', padding: '12px', width: '300px' }
					},
					children: [
						{
							id: 'form',
							type: 'element',
							tag: 'tt-form',
							props: { identityName: 'id' },
							children: [
								{
									id: 'native',
									type: 'element',
									tag: 'input',
									props: { name: 'title', 'aria-label': 'Native title' }
								},
								{
									id: 'rich',
									type: 'element',
									tag: 'tt-rich-text',
									props: {
										name: 'document',
										plainTextName: 'text',
										label: 'Authored text',
										required: true,
										resetKey: 'synthetic-record',
										value: { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Initial' } }] }
									}
								},
								...Array.from(
									{ length: 14 },
									(_, index): WebpageBlock => ({
										id: `extra-${index}`,
										type: 'element',
										tag: 'input',
										props: { type: 'hidden', name: `extra${index}`, value: 'synthetic' }
									})
								),
								{ id: 'save', type: 'element', tag: 'button', text: 'Save latest', props: { type: 'button', 'data-tt-action': data.action } }
							]
						},
						{
							id: 'plain-form',
							type: 'element',
							tag: 'tt-form',
							props: { identityName: 'id' },
							children: [
								{
									id: 'plain-input',
									type: 'element',
									tag: 'input',
									props: { name: 'title', 'aria-label': 'Plain title', required: true }
								},
								{ id: 'plain-save', type: 'element', tag: 'button', text: 'Save plain', props: { type: 'button', 'data-tt-action': data.action } }
							]
						}
					]
				}
			]
		}
	];
	const rendered = <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive />;
	return (
		<ChakraProvider>
			<button
				type="button"
				onClick={() => setDeferredDefault({ kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Newest hidden default' } }] })}
			>
				Refresh hidden default
			</button>
			<button
				type="button"
				onClick={() => setDeferredDefault({ kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Server replacement' } }] })}
			>
				Replace server default
			</button>
			<button type="button" onClick={() => setDeferredDefault({ kind: 'rich-text', blocks: [] })}>
				Empty hidden default
			</button>
			<button type="button" onClick={() => setFramed(!framed)}>
				Toggle Builder iframe
			</button>
			<WebpageRuntimeProvider pageId={data.page} pageKey={null} suiteKey={null} source="user" shared={false}>
				<PageActionSurface actionEnabled data-testid="fixture-actions">
					{framed ? <BuilderViewport size={{ width: 390, height: 844 }}>{rendered}</BuilderViewport> : rendered}
					<RuntimeStatus />
				</PageActionSurface>
			</WebpageRuntimeProvider>
			<div style={{ height: 650 }}>Bottom of acceptance page</div>
		</ChakraProvider>
	);
}
const router = createBrowserRouter([{ id: 'root', path: '/p/:id', element: <Fixture />, loader: () => ({ user: data.user, dataPlane: 'home' }) }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
