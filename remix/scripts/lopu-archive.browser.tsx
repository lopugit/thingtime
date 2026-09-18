// Deterministic UI fixture using the production list and store; API is synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router';
import { LopuConversationList } from '../app/components/Lopu/LopuConversationList';
import {
	archiveLopuChat,
	bindLopuApi,
	getLopuStoreSnapshot,
	hydrateLopuStore,
	loadLopuChats,
	selectLopuChat,
	subscribeLopuStore
} from '../app/components/Lopu/lopuChatStore';
import type { UseLopuChat } from '../app/components/Lopu/useLopuChat';
let fail = false;
const rows = Array.from({ length: 18 }, (_, index) => ({
	id: `archive-qa-${index}`,
	name: index ? `Conversation ${index} with a very long title to check clipping` : 'Archive QA conversation',
	updatedAt: new Date().toISOString(),
	lopu: { archived: false },
	lastMessage: { text: 'Messages stay safe when this chat is archived.' }
}));
hydrateLopuStore('synthetic-archive-qa');
bindLopuApi({
	models: async () => ({}),
	chats: {
		list: async () => ({ ok: true, chats: rows.map((row) => ({ ...row, lopu: { ...row.lopu } })) }),
		update: async ({ chatId, archived }) => {
			if (fail) throw new Error('Synthetic connection failure');
			const row = rows.find((row) => row.id === chatId)!;
			row.lopu.archived = archived === true;
			return { ok: true, chat: row };
		},
		create: async () => ({}),
		delete: async () => ({})
	},
	messages: async () => ({ messages: [] }),
	reply: async () => new Response()
});
void loadLopuChats();
function App() {
	const state = React.useSyncExternalStore(subscribeLopuStore, getLopuStoreSnapshot);
	return (
		<ChakraProvider>
			<MemoryRouter>
				<Box maxW="900px" mx="auto" p={4}>
					<Text as="h1">Lopu archive QA · synthetic API</Text>
					<Button
						onClick={() => {
							fail = !fail;
						}}
					>
						Toggle request failure
					</Button>
					<Text>Selected: {state.activeChatId || 'New chat'}</Text>
					<Text role="status">{state.notices.at(-1)?.title}</Text>
					<Box width={{ base: '100%', md: '248px' }} height="600px" display="flex" border="1px solid #ddd" p={2}>
						<LopuConversationList
							chat={
								{
									chats: state.chats,
									chatsLoaded: true,
									chatId: state.activeChatId,
									selectChat: selectLopuChat,
									archiveChat: archiveLopuChat,
									renameChat: async () => ({ ok: true }),
									deleteChat: async () => ({ ok: true }),
									preferences: { confirmDeletes: true }
								} as UseLopuChat
							}
						/>
					</Box>
				</Box>
			</MemoryRouter>
		</ChakraProvider>
	);
}
createRoot(document.getElementById('root')!).render(<App />);
