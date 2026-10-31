// Synthetic identities only. The runner enforces a kernel network boundary.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { LopuAiDefaultsSettings } from '../app/components/Lopu/LopuCredentialSettings';
import { LopuChatView } from '../app/components/Lopu/LopuChatView';
import { selectLopuChat } from '../app/components/Lopu/lopuChatStore';
Object.defineProperty(window, 'SharedWorker', { value: undefined });
// Loopback HTTP is available although this container has no external interface.
Object.defineProperty(navigator, 'onLine', { get: () => true });
const owner = 'synthetic-credential-owner';
function App() {
	const [screen, setScreen] = React.useState(new URLSearchParams(location.search).get('surface') || 'defaults');
	const [thingtime, setThingtimeState] = React.useState({ settings: { lopu: { open: false, model: 'credit-one', effort: 'high' } } });
	const setThingtime = (path: string, value: unknown) =>
		setThingtimeState((previous) => {
			const next: any = structuredClone(previous);
			const parts = path.split('.');
			let at = next;
			for (const key of parts.slice(0, -1)) at = at[key] ||= {};
			at[parts.at(-1)!] = value;
			return next;
		});
	return (
		<ThingtimeContext.Provider value={{ Everything: { thingtime, setThingtime, loading: false } } as any}>
			<Box p={3}>
				<Button size="sm" onClick={() => setScreen('defaults')}>
					Defaults view
				</Button>{' '}
				<Button
					size="sm"
					onClick={() => {
						selectLopuChat('saved-chat');
						setScreen('chat');
					}}
				>
					Saved chat view
				</Button>
			</Box>
			{screen === 'defaults' ? (
				<Box maxW="640px" m="auto" p={4}>
					<LopuAiDefaultsSettings />
				</Box>
			) : (
				<Box height="calc(100dvh - 65px)">
					<LopuChatView showConversations={false} />
				</Box>
			)}
		</ThingtimeContext.Provider>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '*',
		loader: () => ({ user: { id: owner, username: 'synthetic', temporary: false, privateUploadsEnabled: true }, dataPlane: 'home' }),
		Component: App
	}
]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={router} />
	</ChakraProvider>
);
