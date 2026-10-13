// Production store, composer and bubbles; synthetic responses, no account writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Heading, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LopuComposer } from '../app/components/Lopu/LopuComposer';
import { LopuAssistantRow } from '../app/components/Lopu/LopuChatView';
import {
	bindLopuApi,
	hydrateLopuStore,
	getLopuStoreSnapshot,
	subscribeLopuStore,
	resetLopuStoreForTests,
	sendLopuMessage,
	abortLopuTurn
} from '../app/components/Lopu/lopuChatStore';
let requests = 0,
	target = 17,
	stopRequested = false;
window.fetch = async (url, init) => {
	if (init?.method === 'POST') stopRequested = true;
	return Response.json({ ok: true, ownerId: 'continuation-fixture', tasks: [], features: {}, origin: location.origin });
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const connect = () => {
	resetLopuStoreForTests();
	hydrateLopuStore('continuation-fixture');
	requests = 0;
	stopRequested = false;
	bindLopuApi({
		models: async () => ({ ok: true, models: [], defaults: {}, providers: {} }),
		chats: {
			list: async () => ({ ok: true, chats: [] }),
			create: async () => ({ ok: false }),
			update: async () => ({ ok: true }),
			delete: async () => ({ ok: true })
		},
		messages: async () => ({ ok: true, messages: [] }),
		reply: async (body, options) => {
			const part = ++requests;
			return new Response(
				new ReadableStream({
					async start(controller) {
						const emit = (event: unknown) => {
							try {
								controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
							} catch {}
						};
						emit({
							type: 'meta',
							chatId: 'fixture-chat',
							requestId: body.requestId,
							userMessageId: `u-${part}`,
							model: 'synthetic',
							effort: 'high',
							speed: 'normal',
							provider: 'test',
							label: 'Synthetic regression'
						});
						emit({ type: 'delta', text: `Part ${part}: completed work is retained while the next hosting window continues automatically.` });
						await delay(target === 17 ? 100 : 1200);
						emit({
							type: 'done',
							assistantMessageId: `a-${part}`,
							messages: [],
							stopReason: stopRequested || options?.signal?.aborted ? 'aborted' : part < target ? 'checkpoint' : 'end_turn'
						});
						try {
							controller.close();
						} catch {}
					}
				})
			);
		}
	} as any);
};
connect();
function App() {
	const state = React.useSyncExternalStore(subscribeLopuStore, getLopuStoreSnapshot);
	const [status, setStatus] = React.useState('Ready — synthetic responses only.'),
		[draft, setDraft] = React.useState('');
	const run = async (parts: number) => {
		connect();
		target = parts;
		setStatus('Running');
		await sendLopuMessage('Complete the requested work');
		setStatus(
			parts === 17 && requests === 17
				? 'PASS: 17 parts completed automatically without a continuation cap.'
				: stopRequested
				? `PASS: Stop prevented further continuation after ${requests} part(s).`
				: 'Finished'
		);
	};
	return (
		<Box maxW="900px" mx="auto" p={4}>
			<Heading size="md">Lopu continuation regression</Heading>
			<Text role="status" my={3}>
				{status}
			</Text>
			<Button isDisabled={state.sending} onClick={() => void run(17)}>
				Run 17 parts
			</Button>{' '}
			<Button isDisabled={state.sending} onClick={() => void run(100)}>
				Run until Stop
			</Button>
			<Box my={5} display="flex" flexDirection="column" gap={3}>
				{Object.values(state.turns).map((turn) => (
					<LopuAssistantRow key={turn.requestId} first last compact={false} busy={turn.status === 'streaming'} meta={turn.stopReason}>
						<Text>{turn.text}</Text>
					</LopuAssistantRow>
				))}
			</Box>
			<LopuComposer
				value={draft}
				onChange={setDraft}
				onSend={() => void run(17)}
				onStop={abortLopuTurn}
				streaming={state.sending}
				models={[]}
				settings={state.settings}
				onSettingsChange={() => {}}
			/>
		</Box>
	);
}
const router = createMemoryRouter([
	{ id: 'root', path: '/', loader: () => ({ user: { id: 'continuation-fixture', username: 'synthetic' } }), Component: App }
]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={router} />
	</ChakraProvider>
);
