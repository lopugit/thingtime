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
	const [check, setCheck] = React.useState('Ready');
	const runChecks = async () => {
  setCheck('Running…');
		const wait = () => new Promise((resolve) => setTimeout(resolve, 50));
		const assert = (ok: boolean, message: string) => {
			if (!ok) throw new Error(message);
		};
		const field = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Message Lopu"]')!;
		const key = (init: KeyboardEventInit = {}) =>
			field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
		try {
			setWorking(true);
			setValue('keyboard queued');
			await wait();
			assert(!Array.from(document.querySelectorAll('button')).some((button) => button.textContent === 'Queue'), 'Dedicated Queue button remains');
			const before = getLopuQueue().items.length;
			key({ shiftKey: true });
			await wait();
			assert(getLopuQueue().items.length === before, 'Shift+Enter queued a message');
			key({ isComposing: true });
			await wait();
			assert(getLopuQueue().items.length === before, 'IME Enter queued a message');
			// Cmd+Enter also exercises the mobile/newline preference route.
			key({ metaKey: true });
			await wait();
			assert(getLopuQueue().items.length === before + 1, 'Enter did not queue while replying');
			assert(field().value === '', 'Accepted draft was not cleared');
			assert(document.body.innerText.includes('Working without interruption'), 'Queue interrupted the reply');
			setValue('arrow queued');
			await wait();
			document.querySelector<HTMLButtonElement>('.lopuSend')!.click();
			await wait();
			assert(getLopuQueue().items.length === before + 2, 'Send arrow did not queue');
			setCheck('PASS: keyboard, send arrow, Shift+Enter, IME, draft cleanup and uninterrupted reply');
		} catch (error) {
			setCheck('FAIL: ' + String(error));
		}
	};
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
				<Button onClick={runChecks}>Run composer regression checks</Button>
				<Text role="status">{check}</Text>
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
					queuePending={!queue.paused && queue.items.length > 0}
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
