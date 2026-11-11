// Real floating host, full page and embedded chat; HTTP and preferences are synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { LopuChatView } from '../app/components/Lopu/LopuChatView';
import { LopuHost } from '../app/components/Lopu/LopuHost';
import { LopuPage } from '../app/components/Lopu/LopuPage';

Object.defineProperty(window, 'SharedWorker', { value: undefined });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input) => {
	const path = new URL(String(input), location.origin).pathname;
	if (path.includes('well-known'))
		return json({
			schemaVersion: 1,
			origin: location.origin,
			features: {
				'api.attachment-uploads': { version: '1.4.1' },
				'api.lopu-chats-reply': { version: '1.19.2' },
				'api.lopu-background-tasks': { version: '1.3.0' }
			}
		});
	if (path.endsWith('/ai/models'))
		return json({
			ok: true,
			models: Array.from({ length: 20 }, (_, i) => ({
				id: `model-${i + 1}`,
				label: `Test model ${String(i + 1).padStart(2, '0')}`,
				provider: 'openai',
				enabled: true,
				available: true,
				isDefault: i === 0,
				efforts: ['low', 'high'],
				speeds: ['normal', 'fast']
			})),
			defaults: { model: 'model-1', effort: 'high', speed: 'normal' },
			providers: { openai: { configured: true } }
		});
	if (path.endsWith('/lopu/account')) return json({ ok: true, account: { verified: true, requireVerification: true, balanceMicros: 100000000 } });
	return json({ ok: true, ownerId: 'synthetic-popover-regression', chats: [], messages: [], tasks: [], things: [] });
};
const surface = new URLSearchParams(location.search).get('surface') || 'floating';
const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (ok: unknown, message: string) => {
	if (!ok) throw new Error(message);
};
const visible = (el: Element | null) =>
	!!el &&
	getComputedStyle(el).visibility !== 'hidden' &&
	getComputedStyle(el.parentElement!).visibility !== 'hidden' &&
	el.getBoundingClientRect().height > 0;
const dialog = (name: string) => document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${name}"]`);
const hit = (el: HTMLElement) => {
	const rect = el.getBoundingClientRect();
	check(rect.top >= 0 && rect.bottom <= innerHeight + 1, 'Control falls outside viewport');
	check(el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), 'Control is covered by another layer');
};
async function runRegression() {
	const model = () => document.querySelector<HTMLButtonElement>('button.lopuModelChip')!;
	const settings = () => document.querySelector<HTMLButtonElement>('button[aria-label="Chat settings"]')!;
	const open = async (trigger: HTMLButtonElement, name: string) => {
		trigger.click();
		await wait(300);
		const panel = dialog(name)!;
		check(visible(panel), `${name} did not open`);
		hit(panel);
		return panel;
	};
	const close = async (trigger: HTMLButtonElement, name: string) => {
		trigger.click();
		await wait(300);
		check(!visible(dialog(name)), `${name} did not close on repeat tap`);
	};
	const modelName = 'Choose what Lopu thinks with';
	let panel = await open(model(), modelName);
	const list = panel.querySelector<HTMLElement>('[role="listbox"]')!;
	check(list.scrollHeight > list.clientHeight, 'Fixture needs a scrolling model list');
	const option = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).find((el) => el.textContent?.includes('Test model 20'))!;
	option.scrollIntoView({ block: 'nearest' });
	await wait();
	hit(option);
	option.click();
	await wait();
	check(model().textContent?.includes('Test model 20'), 'Model selection did not reach composer');
	check(option.getAttribute('aria-selected') === 'true', 'Selected option did not update');
	await close(model(), modelName);
	await open(model(), modelName);
	dialog(modelName)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	await wait(300);
	check(!visible(dialog(modelName)), 'Escape did not dismiss model picker');
	check(!!settings(), 'Escape closed the floating host');
	panel = await open(settings(), 'Chat settings');
	const toggle = panel.querySelector<HTMLInputElement>('input[aria-label="Enter sends the message"]')!;
	// Chakra uses a visually hidden input; its label is the actual tap target.
	const target = toggle.closest('label')!;
	target.scrollIntoView({ block: 'nearest' });
	await wait();
	hit(target);
	const before = toggle.checked;
	target.click();
	await wait();
	check(toggle.checked !== before, 'Settings change did not apply');
	await close(settings(), 'Chat settings');
	panel = await open(settings(), 'Chat settings');
	check(panel.querySelector<HTMLInputElement>('input[aria-label="Enter sends the message"]')!.checked !== before, 'Setting lost on reopen');
	const last = panel.querySelector<HTMLInputElement>('input[aria-label="Vercel chat management"]')!.closest('label')!;
	last.scrollIntoView({ block: 'nearest' });
	await wait();
	hit(last);
	const field = document.querySelector<HTMLTextAreaElement>('[aria-label="Message Lopu"]')!;
	field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
	field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
	field.click();
	await wait(300);
	check(!visible(dialog('Chat settings')), 'Outside tap did not dismiss settings');
	check(!!settings(), 'Outside tap closed the floating host');
	return `PASS: ${surface} ${innerWidth}×${innerHeight} — layering, model selection, list scroll, settings persistence, repeat taps, Escape and outside tap`;
}
function App() {
	const [result, setResult] = React.useState('Ready');
	React.useEffect(() => {
		if (new URLSearchParams(location.search).has('autorun')) {
			const timer = setTimeout(
				() =>
					void runRegression()
						.then(setResult)
						.catch((error) => setResult(`FAIL: ${error.message}`)),
				1000
			);
			return () => clearTimeout(timer);
		}
	}, []);
	const [thingtime, setState] = React.useState({ settings: { lopu: { open: true, minimised: false, model: 'model-1', effort: 'high' } } });
	const setThingtime = React.useCallback(
		(path: string, value: unknown) =>
			setState((previous) => {
				const next = structuredClone(previous);
				const parts = path.split('.');
				let at: any = next;
				for (const key of parts.slice(0, -1)) at = at[key] ||= {};
				at[parts.at(-1)!] = value;
				return next;
			}),
		[]
	);
	return (
		<>
			<Box position="fixed" zIndex={20000} top={0} left={0} bg="white" maxW="100vw" fontSize="10px">
				<Button
					size="xs"
					onClick={() =>
						void runRegression()
							.then(setResult)
							.catch((error) => setResult(`FAIL: ${error.message}`))
					}
				>
					Run popup regression
				</Button>
				<Text role="status">{result}</Text>
			</Box>
			<ThingtimeContext.Provider value={{ Everything: { thingtime, setThingtime, loading: false } } as any}>
				{surface === 'floating' ? (
					<>
						<Box p={6}>Synthetic popup regression · floating Lopu</Box>
						<LopuHost />
					</>
				) : surface === 'page' ? (
					<LopuPage />
				) : (
					<Box height="100dvh">
						<LopuChatView showConversations={false} />
					</Box>
				)}
			</ThingtimeContext.Provider>
		</>
	);
}
const router = createMemoryRouter(
	[
		{
			id: 'root',
			path: '*',
			loader: () => ({
				user: {
					id: 'synthetic-popover-regression',
					username: 'synthetic',
					privateUploadsEnabled: true,
					publicUploadsEnabled: true,
					storage: { remainingBytes: 10000000, status: 'ready' }
				}
			}),
			Component: App
		}
	],
	{ initialEntries: [surface === 'page' ? '/lopu' : '/'] }
);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={router} />
	</ChakraProvider>
);
