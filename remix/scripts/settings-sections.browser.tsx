// Real shared disclosure and row components. Only form data is synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Input, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { SettingsSection, SettingRow } from '../app/components/Settings/SettingsSection';
const check = (value: unknown, message: string) => {
	if (!value) throw new Error(message);
};
const wait = () => new Promise((resolve) => setTimeout(resolve, 100));
function Fixture() {
	const [result, setResult] = React.useState('Ready');
	const [draft, setDraft] = React.useState('Retained draft');
	const run = async () => {
		const outer = document.querySelector<HTMLDetailsElement>('[data-settings-section]')!;
		const inner = outer.querySelector<HTMLDetailsElement>('[data-settings-section]')!;
		check(!outer.open && !inner.open, 'Cards must start collapsed');
		outer.querySelector('summary')!.click();
		await wait();
		check(outer.open, 'Click did not expand');
		const input = document.querySelector<HTMLInputElement>('[aria-label="Draft"]')!;
		outer.querySelector('summary')!.click();
		await wait();
		check(!outer.open, 'Click did not collapse');
		outer.querySelector('summary')!.click();
		await wait();
		check(input === document.querySelector('[aria-label="Draft"]') && input.value === draft, 'Closing discarded the field or draft');
		await router.navigate('/#nested-setting');
		await wait();
		check(outer.open && inner.open, 'Deep link did not open enclosing cards');
		check(!document.querySelector<HTMLDetailsElement>('[data-unrelated] details')!.open, 'Deep link opened an unrelated card');
		const label = document.querySelector('[data-label-width]')!;
		check(label.getBoundingClientRect().width >= 200, 'Hint was squeezed into a vertical strip');
		check(document.documentElement.scrollWidth <= innerWidth + 1, 'Page overflows horizontally');
		outer.querySelector('summary')!.click();
		await wait();
		check(!outer.open, 'Deep-linked card cannot be closed');
		return `PASS · ${innerWidth}px · collapsed defaults, toggling, retained draft, nested deep links, readable labels, no overflow`;
	};
	return (
		<Box maxW="880px" mx="auto" p={3}>
			<Button
				mb={3}
				onClick={() =>
					void run()
						.then(setResult)
						.catch((error) => setResult(`FAIL: ${error.message}`))
				}
			>
				Run regression
			</Button>
			<Text role="status" mb={3}>
				{result}
			</Text>
			<SettingsSection eyebrow="Example settings" description="A card with a description and current status." summary="2 sections">
				<SettingRow
					label={
						<span data-label-width style={{ display: 'block' }}>
							A readable setting label with a long explanatory hint
						</span>
					}
					hint="This explanation should wrap into a few readable lines, never a tall one-letter column beside wide controls."
				>
					<Button maxW="100%" whiteSpace="normal" height="auto" py={2}>
						A deliberately wide setting control
					</Button>
				</SettingRow>
				<Input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
				<SettingsSection eyebrow="Nested settings" description="Deep links open every enclosing card.">
					<Box id="nested-setting">Anchor target</Box>
				</SettingsSection>
			</SettingsSection>
			<Box data-unrelated mt={3}>
				<SettingsSection eyebrow="Unrelated settings" description="This stays collapsed when another section is linked.">
					<Text>Unrelated content</Text>
				</SettingsSection>
			</Box>
		</Box>
	);
}
const router = createMemoryRouter([{ path: '*', Component: Fixture }]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={router} />
	</ChakraProvider>
);
