import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useLocation } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { LiveWebpageView } from '../app/components/Builder/LiveWebpage';
import type { UseWebpageDraft } from '../app/components/Builder/useWebpage';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';
import { bindLocalWorkspace } from '../app/local-workspace/runtime.client';
import { rootIdentity } from '../app/utils/rootIdentity';

const setup = new URLSearchParams(window.location.search);
const generation = rootIdentity.read().generation;
rootIdentity.confirm(generation);
bindLocalWorkspace(false, generation, { kind: 'account', ownerId: 'fixture-owner', origin: window.location.origin, dataPlane: 'home' });
function Fixture() {
	const location = useLocation();
	const edit = location.pathname === '/builder';
	const shared = setup.has('shared');
	const blocks: WebpageBlock[] = [
		{ id: 'title', type: 'element', tag: 'h1', text: 'Daily workspace' },
		{ id: 'selection', type: 'element', tag: 'p', text: 'Selection: {query.selectedId}' },
		{ id: 'manual', type: 'element', tag: 'button', text: 'Choose different record',
			props: { 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'query', scope: 'page', params: { selectedId: 'manual' } } } },
		{ id: 'refresh', type: 'element', tag: 'button', text: 'Refresh displayed data', props: { 'data-tt-action': '$refresh' } },
		{ id: 'end', type: 'element', tag: 'p', text: 'End of the workspace', css: { 'margin-top': '850px' } }
	];
	const revision = '2026-11-08T11:55:00.000Z';
	const draft = {
		resolved: {
			page: {
				id: 'fixture-activation', author: { id: shared ? 'other-account' : 'fixture-owner' },
				updatedAt: revision, acl: [shared ? 'tt:all' : 'tt:user'],
				crystal: { name: 'Daily workspace', blocks, ...(!setup.has('unconfigured') ? {
					activationAction: { action: 'fixture-ensure', cadence: 'day', timeZone: 'Australia/Melbourne',
						dayInput: 'day', queryResult: { selectedId: 'record.id' } }
				} : {}) }
			},
			source: shared ? 'system' : 'user', componentsByRef: {},
			activationReady: !setup.has('unverified-device')
		},
		blocks, componentsByRef: {}, loading: false, error: false, dirty: false,
		branch: setup.has('branch') ? { id: 'history', name: 'Archived branch', locked: true, componentNotice: 'Historical composition', canRefresh: () => false } : undefined
	} as unknown as UseWebpageDraft;
	return <LiveWebpageView builderPageId={edit ? 'fixture-activation' : undefined} draft={draft} />;
}

const router = createBrowserRouter([{
	id: 'root', loader: () => ({ user: { id: 'fixture-owner', accountKind: 'user' }, dataPlane: 'home' }),
	children: [{ path: '/p/:id', element: <Fixture /> }, { path: '/builder', element: <Fixture /> }]
}]);
const settings = { Everything: { thingtime: {}, loading: false, thingtimeRef: { current: {} }, setThingtime: () => {} } };
createRoot(document.getElementById('root')!).render(<React.StrictMode><ChakraProvider>
	<ThingtimeContext.Provider value={settings as React.ContextType<typeof ThingtimeContext>}>
		<RouterProvider router={router} />
	</ThingtimeContext.Provider>
</ChakraProvider></React.StrictMode>);
