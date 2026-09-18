// Render the production composer and queue with an isolated, controllable task.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Text } from '@chakra-ui/react';
import { LopuComposer } from '../app/components/Lopu/LopuComposer';
import { LopuMessageQueue } from '../app/components/Lopu/LopuMessageQueue';
import {
	addLopuQueueMessage,
	bindLopuQueue,
	drainLopuQueue,
	getLopuQueue,
	pauseLopuQueue,
	subscribeLopuQueue
} from '../app/components/Lopu/lopuQueueStore';
bindLopuQueue('queue-browser-fixture');
const App = () => {
	const queue = React.useSyncExternalStore(subscribeLopuQueue, getLopuQueue, getLopuQueue);
	const [value, setValue] = React.useState('');
	const [working, setWorking] = React.useState(true);
	const [replies, setReplies] = React.useState<string[]>([]);
	const [notes, setNotes] = React.useState<string[]>([]);
	React.useEffect(() => {
		if (!working && !queue.paused)
			void drainLopuQueue('fixture-chat', async (text) => {
				setReplies((current) => [...current, text]);
				return { ok: true };
			});
	}, [working, queue]);
	return (
		<ChakraProvider>
			<Box maxW="900px" mx="auto" p={4} minH="100vh">
				<Text fontSize="xl">Message queue browser check</Text>
				<Text mb={4}>Isolated fixture · no provider calls or account writes</Text>
				<Button onClick={() => setWorking((current) => !current)}>{working ? 'Finish current reply' : 'Start current reply'}</Button>
				<Text my={4}>Current task: {working ? 'Working without interruption' : 'Finished'}</Text>
				<Box minH="100px">
					{notes.map((text, index) => (
						<Text key={index}>Note: {text}</Text>
					))}
					{replies.map((text, index) => (
						<Text whiteSpace="pre-wrap" key={index}>
							Reply batch {index + 1}: {text}
						</Text>
					))}
				</Box>
				<LopuMessageQueue items={queue.items} paused={queue.paused} error={queue.error} lockedIds={queue.batch?.ids} />
				<LopuComposer
					value={value}
					onChange={setValue}
					onSend={(text) => {
						setReplies((current) => [...current, text]);
						setValue('');
					}}
					onQueue={(text) => {
						addLopuQueueMessage('fixture-chat', text, {});
						setValue('');
					}}
					onSendNow={(text) => {
						setNotes((current) => [...current, text]);
						setValue('');
					}}
					onStop={() => {
						pauseLopuQueue(true);
						setWorking(false);
					}}
					streaming={working}
					models={[]}
					settings={{ model: null, effort: null, speed: null, providerId: null }}
					onSettingsChange={() => {}}
					preferences={{ enterSends: true, applyPatches: true, confirmDeletes: true }}
					onPreferencesChange={() => {}}
				/>
			</Box>
		</ChakraProvider>
	);
};
createRoot(document.getElementById('root')!).render(<App />);
