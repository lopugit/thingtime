// Isolated presentation fixture: real Chakra Select and Thingtime theme, synthetic values.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider, Select, Text, extendTheme } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PostAsSelect } from '../app/components/Characters/PostAsSelect';
import { colors } from '../app/Providers/Chakra/colors';
import { theme } from '../app/Providers/Chakra/theme';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { ThemeStudio } from '../app/components/ThemeSettings/ThemeStudio';
import { useTtTheme } from '../app/hooks/useTtTheme';
import { themeToCssVars } from '../app/theme/tokens';
const dark = new URLSearchParams(location.search).get('mode') === 'dark';
const editor = new URLSearchParams(location.search).get('surface') === 'editor';
Object.defineProperty(window, 'SharedWorker', { value: undefined });
Object.defineProperty(navigator, 'onLine', { get: () => true });
function StateProvider({ children }: { children: React.ReactNode }) {
	const [thingtime, setState] = React.useState(() => ({
		settings: {
			theme:
				editor && localStorage.getItem('qa-theme-settings')
					? JSON.parse(localStorage.getItem('qa-theme-settings')!)
					: { preset: dark ? 'Midnight' : 'Thingtime', overrides: {} }
		}
	}));
	const setThingtime = React.useCallback(
		(path: string, value: unknown) =>
			setState((previous) => {
				const next: any = structuredClone(previous);
				const parts = path.split('.');
				let at = next;
				for (const key of parts.slice(0, -1)) at = at[key] ||= {};
				at[parts.at(-1)!] = value;
				return next;
			}),
		[]
	);
	React.useEffect(() => {
		if (editor) localStorage.setItem('qa-theme-settings', JSON.stringify(thingtime.settings.theme));
	}, [thingtime]);
	return (
		<ThingtimeContext.Provider
			value={{ Everything: { thingtime, setThingtime, loading: false, getThingtime: () => thingtime, thingtimeRef: { current: thingtime } } } as any}
		>
			{children}
		</ThingtimeContext.Provider>
	);
}
function App() {
	const { theme: activeTheme } = useTtTheme();
	React.useLayoutEffect(() => {
		for (const [key, value] of Object.entries(themeToCssVars(activeTheme))) document.documentElement.style.setProperty(key, value);
		document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
	}, [activeTheme]);
	const [value, setValue] = React.useState('owner');
	const options = (
		<>
			<option value="owner">Synthetic owner</option>
			<option value="character">Synthetic task Character</option>
			<option value="long">A very long Character display name with enough words to exceed the available mobile width without growing the page</option>
		</>
	);
	return (
		<Box as="main" bg="tt.card" color="tt.ink" minH="100vh" p={6}>
			<Box maxW="680px" mx="auto">
				<pre hidden data-testid="theme-snapshot">
					{JSON.stringify(activeTheme)}
				</pre>
				<Text as="h1" fontSize="xl" mb={6}>
					Shared Select regression
				</Text>
				<PostAsSelect user={{ id: value, displayName: 'Synthetic owner', username: 'synthetic' } as any} onChange={(user) => setValue(user.id)} />
				<Text data-testid="selected" my={4}>
					Selected: {value}
				</Text>
				{(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
					<Box key={size} my={5}>
						<Text as="label" htmlFor={'size-' + size}>
							{size} Select
						</Text>
						<Select id={'size-' + size} size={size}>
							{options}
						</Select>
					</Box>
				))}
				<Box my={5}>
					<Text as="label" htmlFor="invalid">
						Invalid
					</Text>
					<Select id="invalid" isInvalid>
						{options}
					</Select>
				</Box>
				<Box my={5}>
					<Text as="label" htmlFor="disabled">
						Disabled
					</Text>
					<Select id="disabled" isDisabled>
						{options}
					</Select>
				</Box>
				{(['filled', 'flushed', 'unstyled'] as const).map((variant) => (
					<Box key={variant} my={5}>
						<Text as="label" htmlFor={variant}>
							{variant} override
						</Text>
						<Select id={variant} variant={variant}>
							{options}
						</Select>
					</Box>
				))}
				<Box height="80vh" pt={12}>
					Scroll verification area
				</Box>
				<Box display="none">
					<ChakraProvider resetCSS={false} theme={extendTheme({ colors })}>
						<Box color="tt.ink">
							<Select id="upstream-filled" variant="filled">
								{options}
							</Select>
						</Box>
					</ChakraProvider>
				</Box>
				<Text id="bottom">End of fixture</Text>
				{editor ? <ThemeStudio /> : null}
			</Box>
		</Box>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '*',
		loader: () => ({ user: { id: 'owner', displayName: 'Synthetic owner', username: 'synthetic' }, dataPlane: 'home' }),
		Component: () => (
			<StateProvider>
				<App />
			</StateProvider>
		)
	}
]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider theme={theme}>
		<RouterProvider router={router} />
	</ChakraProvider>
);
