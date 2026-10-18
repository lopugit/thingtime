// Disposable synthetic transport; render the actual saved suite and Builder.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import { materializeSuite } from '../app/schemas/behaviourSuites';
import { deviceScriptsSuite } from '../app/schemas/appSuites/deviceScripts';
import { executeBrowserAction } from '../app/components/Actions/browserActionRuntime';
import { validateRunInputs } from '../app/api/utils/actions/actionInputs';
import { validateThingtimeCrystal, sanitizeExtended } from '../app/schemas/registry';
import { macMenuBarSuite } from '../app/schemas/appSuites/macMenuBar';
let scenario = 'available';
const scripts = new URLSearchParams(location.search).has('scripts');
const suite = materializeSuite(scripts ? deviceScriptsSuite : macMenuBarSuite, 'own');
const items = Array.from({ length: 10001 }, (_, index) => ({
	id: `ax:42:${index}`,
	label: `Menu item ${index}`,
	program: 'Sample program',
	processId: 42,
	bundleId: 'com.example.sample',
	appPath: `/Applications/${'Long program name '.repeat(12)}.app`,
	executablePath: '/Applications/Sample.app/Contents/MacOS/Sample',
	source: 'accessibility',
	visible: false,
	x: index,
	y: 0,
	width: 24,
	height: 24,
	residentBytes: index ? null : 0,
	cpuTimeSeconds: index ? null : 0
}));
window.fetch = async (url, init) => {
	const path = String(url);
	const input = init?.body ? JSON.parse(String(init.body)) : {};
	if (scripts && path.includes('/actions/run') && !input.action?.endsWith('-devices')) {
		const action = suite.actions.find((entry) => input.action === entry.crystal.actionKey);
		if (!action) return Response.json({ error: 'Unknown fixture Action' }, { status: 400 });
		const validated = validateRunInputs(action.crystal.inputs as Record<string, unknown>[], input.inputs);
		if (validated.ok === false) return Response.json({ error: validated.error }, { status: 400 });
		const result = await executeBrowserAction(
			{
				ok: true,
				status: 'prepared',
				execution: 'browser',
				actionId: action.key,
				viewer: { id: 'synthetic-menu-bar' },
				program: action.crystal,
				inputs: validated.inputs
			},
			{
				assertIdentity: (id) => {
					if (id !== 'synthetic-menu-bar') throw Error('Wrong fixture actor');
				},
				prepare: async () => {
					throw Error('Unexpected child Action');
				},
				request: async (step) => {
					if (step.path === '/api/v1/devices/commands')
						return {
							command: {
								id: 'fixture-command',
								deviceId: 'fixture-mac',
								kind: 'script.run',
								status: step.method === 'POST' ? 'needs-approval' : 'succeeded',
								...(step.method === 'GET'
									? { result: { stdout: 'Hello fixture', stderr: '', exitCode: 0, signal: null, timedOut: false, truncated: false } }
									: {})
							}
						};
					if (step.path !== '/api/v1/things' || step.method !== 'POST') throw Error('Unexpected fixture request');
					const body = step.body as any;
					const checked = validateThingtimeCrystal(body.thingtime, body.crystal);
					if (checked.ok === false) throw Error(checked.error);
					const extended = sanitizeExtended(body.extended);
					if (extended.ok === false) throw Error(extended.error);
					return { thing: { id: 'saved-fixture' } };
				}
			}
		);
		return Response.json({ status: 'ok', cache: 'no-store', result });
	}
	if (path.includes('/actions/run'))
		return Response.json({
			status: 'ok',
			cache: 'no-store',
			result: {
				devices:
					scenario === 'empty'
						? []
						: [
								{
									id: 'fixture-mac',
									name: 'Fixture MacBook Pro',
									platform: 'macos',
									model: 'Test model',
									osVersion: 'Test OS',
									online: scenario !== 'offline',
									state:
										scenario === 'unsupported'
											? {}
											: {
													menuBar: {
														status: scenario === 'offline' ? 'available' : scenario,
														collectedAt: '2026-10-18T00:00:00Z',
														accessibility: scenario !== 'partial',
														unreadableApplications: scenario === 'partial' ? 1 : 0,
														items: ['locked', 'collecting'].includes(scenario) ? [] : items
													}
											  }
								}
						  ]
			}
		});
	return Response.json({ schemaVersion: 1, operations: [], origin: location.origin, features: { 'api.actions-run': { version: '1.37.0' } } });
};
function App() {
	const [revision, setRevision] = React.useState(0);
	const page = suite.pages[0].crystal as any;
	const components = Object.fromEntries(suite.components.map((c) => [c.crystal.componentKey, { id: c.shareId, crystal: c.crystal }]));
	return (
		<main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
			<label>
				Acceptance scenario{' '}
				<select
					aria-label="Acceptance scenario"
					onChange={(e) => {
						scenario = e.target.value;
						setRevision((v) => v + 1);
					}}
				>
					{['available', 'partial', 'offline', 'locked', 'collecting', 'unsupported', 'empty'].map((value) => (
						<option key={value}>{value}</option>
					))}
				</select>
			</label>
			<WebpageRuntimeProvider key={revision} pageId="fixture-menu-bar" pageKey={null} suiteKey={null} source="user">
				<WebpageBlocksRenderer blocks={page.blocks} componentsByRef={components} interactive />
			</WebpageRuntimeProvider>
		</main>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '/',
		loader: () => ({ user: { id: 'synthetic-menu-bar', username: 'synthetic-menu-bar', accountKind: 'user' } }),
		Component: () => (
			<ChakraProvider>
				<App />
			</ChakraProvider>
		)
	}
]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
