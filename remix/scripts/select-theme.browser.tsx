// Isolated presentation fixture: real Chakra Select and Thingtime theme, synthetic values.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider, Select, Text, extendTheme } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PostAsSelect } from '../app/components/Characters/PostAsSelect';
import { colors } from '../app/Providers/Chakra/colors';
import { theme } from '../app/Providers/Chakra/theme';
const dark = new URLSearchParams(location.search).get('mode') === 'dark';
const vars = dark
	? { '--tt-card': '#16161a', '--tt-ink': '#fafafa', '--tt-border': '#34343a', '--tt-muted': '#a1a1aa', '--tt-faint': '#71717a' }
	: { '--tt-card': '#fff', '--tt-ink': '#16161a', '--tt-border': '#ececef', '--tt-muted': '#71717a', '--tt-faint': '#a1a1aa' };
for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value);
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
function App() {
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
			</Box>
		</Box>
	);
}
const router = createMemoryRouter([
	{ id: 'root', path: '*', loader: () => ({ user: { id: 'owner', displayName: 'Synthetic owner', username: 'synthetic' } }), Component: App }
]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider theme={theme}>
		<RouterProvider router={router} />
	</ChakraProvider>
);
