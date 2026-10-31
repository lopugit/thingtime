// Local Vite-only fixture: ephemeral drafts; no page or account writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { LopuHost } from '../app/components/Lopu/LopuHost';
import { useDrawer } from '../app/components/Nav/Drawer/useDrawer';
import { PAGE_VIEWPORT_CSS } from '../app/components/Layout/pageViewport';
import { createMemoryRouter, RouterProvider } from 'react-router';
import SeamlessPageEditor from '../app/components/Builder/SeamlessPageEditor';
import { WebpageBlocksRenderer, type BuilderChrome } from '../app/components/Builder/WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import type { UseWebpageDraft } from '../app/components/Builder/useWebpage';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';
import { BuilderViewport, type BuilderViewportSize } from '../app/components/Builder/BuilderViewport';
import { usesPageRuntime, type SeamlessMode } from '../app/components/Builder/seamlessMode';
const initial: WebpageBlock[] = [
	{ id: 'heading', type: 'text', text: 'Your live page', style: 'heading', css: { 'font-size': '36px' } },
	{ id: 'intro', type: 'text', html: '<p>Edit <strong>this phrase</strong> without losing its formatting.</p>' },
	{
		id: 'button',
		type: 'text',
		text: 'Jump to the end',
		href: '#end',
		css: { background: '#e5eee3', padding: '12px', 'border-radius': '12px' },
		maxWidth: 220
	},
	{ id: 'form', type: 'component', component: 'form', args: { label: 'Continue' } },
	{ id: 'container', type: 'container', gap: 4, children: [{ id: 'child', type: 'text', text: 'Nested text stays in place.' }] },
	{ id: 'long', type: 'text', text: 'Scroll through the live page to check the overlay.', css: { padding: '200px 0' } },
	{ id: 'end', type: 'html', html: '<section id="end"><h2>End of the page</h2><p>Everything still fits.</p></section>' }
];
const components = {
	form: {
		id: 'fixture-form',
		crystal: {
			args: [{ name: 'label', type: 'string', default: 'Continue' }],
			render: {
				tag: 'div',
				props: { style: { display: 'flex', flexWrap: 'wrap', gap: '12px' } },
				children: [
					{ tag: 'input', props: { placeholder: 'Keep this value', name: 'message' } },
					{ tag: 'a', props: { href: '#end' }, children: ['{label}'] },
					{ tag: 'button', children: ['Static button label'] }
				]
			}
		}
	}
};
function Fixture() {
	const drawer = useDrawer();
	const [blocks, setBlocks] = React.useState(initial);
	const [mode, setMode] = React.useState<SeamlessMode>('edit');
	const [chrome, setChrome] = React.useState<BuilderChrome | null>(null);
	const [viewport, setViewport] = React.useState<BuilderViewportSize>(null);
	const [saved, setSaved] = React.useState(false);
	const surface = React.useRef<HTMLDivElement>(null);
	const [surfaceDocument, setSurfaceDocument] = React.useState<Document | null>(null);
	const setSurface = React.useCallback((node: HTMLDivElement | null) => {
		surface.current = node;
		setSurfaceDocument(node?.ownerDocument || null);
	}, []);
	const draft = {
		blocks,
		setBlocks,
		componentsByRef: components,
		dirty: blocks !== initial,
		loading: false,
		error: false,
		resolved: {
			page: { id: 'fixture', author: { id: 'fixture-owner' }, acl: ['tt:user'], crystal: { name: 'Seamless fixture', blocks: initial } },
			source: 'user',
			componentsByRef: components
		},
		save: async () => {
			setSaved(true);
			return { ok: false, error: 'Fixture save reached; no data was written or navigation performed.' };
		},
		refresh: () => {},
		ensureComponent: async () => {},
		addComponent: () => {},
		resetToDefault: async () => ({ ok: true }),
		discardDraft: () => setBlocks(initial),
		markSaved: () => {}
	} as UseWebpageDraft;
	return (
		<>
			<style>{PAGE_VIEWPORT_CSS}</style>
			<div id="lopuPageViewport">
				<div id="lopuPageScroll">
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
						<button
							onClick={() => {
								drawer.setDirection('left');
								drawer.setOpen(!drawer.open || drawer.direction !== 'left');
							}}
						>
							Toggle left navigation split
						</button>
						<button
							onClick={() => {
								drawer.setDirection('right');
								drawer.setOpen(!drawer.open || drawer.direction !== 'right');
							}}
						>
							Toggle right navigation split
						</button>
					</div>
					<WebpageRuntimeProvider pageId="fixture" pageKey={null} suiteKey={null} source="user" enabled={usesPageRuntime(mode)}>
						<main
							style={{ margin: '0 auto', padding: '20px 0 var(--tt-builder-toolbar-clearance, 160px)', background: '#f2f8ef', minHeight: '100vh' }}
						>
							<BuilderViewport size={viewport}>
								<div ref={setSurface} data-testid="seamless-page" data-builder-mode={mode}>
									<style>
										{
											'.fixture-device::after {content: "Desktop media query"} @media(max-width: 800px){.fixture-device::after {content:"Tablet media query"}} @media(max-width: 480px){.fixture-device::after {content:"Mobile media query"}}'
										}
									</style>
									<div className="fixture-device" />
									<WebpageBlocksRenderer seamless blocks={blocks} componentsByRef={components} interactive={usesPageRuntime(mode)} chrome={chrome} />
								</div>
							</BuilderViewport>
							<SeamlessPageEditor
								draft={draft}
								mode={mode}
								onMode={setMode}
								surface={surface}
								surfaceDocument={surfaceDocument}
								onChrome={setChrome}
								viewport={viewport}
								onViewport={setViewport}
							/>
							<output data-testid="saved">{saved ? 'Save attempted safely' : ''}</output>
							<details>
								<summary>Draft JSON</summary>
								<pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(blocks, null, 2)}</pre>
							</details>
						</main>
					</WebpageRuntimeProvider>
				</div>
			</div>
			<LopuHost />
		</>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '*',
		loader: () => ({ user: null }),
		Component: () => (
			<ChakraProvider>
				<ThingtimeProvider storageKey="seamless-builder-fixture" persistLocal={false} exposeGlobals={false}>
					<Fixture />
				</ThingtimeProvider>
			</ChakraProvider>
		)
	}
]);
const root = createRoot(document.getElementById('root')!);
root.render(<RouterProvider router={router} />);
import.meta.hot?.dispose(() => root.unmount());
