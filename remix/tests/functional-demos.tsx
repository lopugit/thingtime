// Local Vite-only fixture. Local UI actions never write account data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';

const ui = (tag: string, props: Record<string, unknown>, inputs: Record<string, unknown>, children: unknown[] = []) => ({
	tag,
	props,
	ttAction: '$ui',
	ttActionInputs: inputs,
	children
});
const component = {
	id: 'fixture-controls',
	crystal: {
		args: [
			{ name: 'label', type: 'string', default: 'Hello' },
			{ name: 'enabled', type: 'boolean', default: false },
			{ name: 'count', type: 'number', default: 2 }
		],
		render: {
			tag: 'fieldset',
			props: { style: { display: 'grid', gap: '12px', padding: '16px', minWidth: 0 } },
			children: [
				{ tag: 'legend', children: ['Local controls'] },
				{ tag: 'label', children: ['Label', ui('input', { value: '{label}' }, { op: 'set', key: 'label' })] },
				{ tag: 'label', children: [ui('input', { type: 'checkbox', checked: { ttArg: 'enabled' } }, { op: 'set', key: 'enabled' }), 'Enabled'] },
				ui('button', { type: 'button' }, { op: 'toggle', key: 'enabled' }, ['Toggle']),
				ui('button', { type: 'button' }, { op: 'increment', key: 'count', step: 1, min: 0, max: 5 }, ['Increase']),
				{ tag: 'label', children: ['Count', ui('input', { type: 'range', min: 0, max: 5, value: { ttArg: 'count' } }, { op: 'set', key: 'count' })] },
				{ tag: 'p', children: ['{label} · count {count} · enabled {enabled}'] },
				ui('button', { type: 'button' }, { op: 'reset' }, ['Reset']),
				{
					tag: 'details',
					children: [
						{ tag: 'summary', children: ['More'] },
						{ tag: 'p', children: ['Native disclosure content'] }
					]
				}
			]
		}
	}
};
function Fixture() {
	const [revision, setRevision] = React.useState(0);
	return (
		<main style={{ maxWidth: 900, padding: 16, margin: 'auto' }}>
			<h1>Functional control regression fixture</h1>
			<button onClick={() => setRevision((x) => x + 1)}>Render parent ({revision})</button>
			{['first', 'second'].map((id) => (
				<section key={id} aria-label={id} style={{ marginTop: 16 }}>
					<WebpageBlocksRenderer blocks={[{ id, type: 'component', component: 'controls' }]} componentsByRef={{ controls: component }} interactive />
				</section>
			))}
		</main>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '*',
		loader: () => ({ user: null }),
		Component: () => (
			<ChakraProvider>
				<ThingtimeProvider storageKey="functional-demo-fixture" persistLocal={false} exposeGlobals={false}>
					<Fixture />
				</ThingtimeProvider>
			</ChakraProvider>
		)
	}
]);
const root = createRoot(document.getElementById('root')!);
root.render(<RouterProvider router={router} />);
import.meta.hot?.dispose(() => root.unmount());
