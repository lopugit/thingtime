// Browser regression fixture: production composers/uploader, synthetic transport only.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Heading, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { LopuComposer } from '../app/components/Lopu/LopuComposer';
import { LopuAttachments, EMPTY_LOPU_ATTACHMENTS } from '../app/components/Lopu/LopuAttachments';
import { Composer } from '../app/components/Messenger/Composer';
import type { AttachmentComposerHandle } from '../app/components/Attachments/AttachmentComposer';
const uploads = new Map<string, any>();
const respond = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init) => {
	const path = String(url),
		body = JSON.parse(String(init?.body || '{}'));
	if (path.includes('well-known'))
		return respond({ schemaVersion: 1, origin: location.origin, features: { 'api.attachment-uploads': { version: '1.4.1' } } });
	if (path.endsWith('/uploads')) {
		uploads.set(body.requestId, body);
		return respond({ upload: { id: body.requestId, partSizeBytes: 5242880, partCount: 1 } });
	}
	if (path.endsWith('/parts')) return respond({ parts: [{ partNumber: 1, url: '/synthetic-storage', headers: {} }] });
	if (path.endsWith('/complete')) {
		const file = uploads.get(body.uploadId);
		return respond({
			attachment: { id: body.uploadId, name: file.filename, size: file.sizeBytes, contentType: file.contentType, mediaKind: 'file' }
		});
	}
	return respond({ ok: true, things: [] });
};
class UploadXhr {
	status = 200;
	upload = { onprogress: null };
	onload?: () => void;
	open() {}
	setRequestHeader() {}
	send() {
		queueMicrotask(() => this.onload?.());
	}
	abort() {}
}
window.XMLHttpRequest = UploadXhr as any;
const wait = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const transfer = (selector: string, kind: 'paste' | 'drop', names: string[]) => {
	const data = new DataTransfer();
	names.forEach((name) => data.items.add(new File(['Synthetic chat attachment'], name, { type: 'text/plain' })));
	const element = document.querySelector(selector)!;
	element.dispatchEvent(
		kind === 'paste'
			? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
			: new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
	);
};
function App() {
	const ref = React.useRef<AttachmentComposerHandle>(null);
	const [snapshot, setSnapshot] = React.useState(EMPTY_LOPU_ATTACHMENTS);
	const [expanded, setExpanded] = React.useState(false),
		[text, setText] = React.useState(''),
		[results, setResults] = React.useState('Ready');
	const run = async () => {
		try {
			transfer('[aria-label="Message Lopu"]', 'paste', ['paste.txt']);
			await wait(400);
			transfer('[aria-label="Message Lopu"]', 'drop', ['drop-a.txt', 'drop-b.txt']);
			await wait(400);
			transfer('[placeholder="Message a friend"]', 'paste', ['friend-paste.txt']);
			await wait(400);
			transfer('[placeholder="Message a friend"]', 'drop', ['friend-drop.txt']);
			await wait(400);
			const visible = document.body.innerText;
			for (const name of ['paste.txt', 'drop-a.txt', 'drop-b.txt', 'friend-paste.txt', 'friend-drop.txt'])
				if (!visible.includes(name)) throw Error('Missing ' + name);
			setResults('PASS: paste and multiple-file drop opened both trays; five attachments ready.');
		} catch (e) {
			setResults('FAIL: ' + String(e));
		}
	};
	return (
		<Box p={4} maxW="900px" mx="auto">
			<Heading size="md">Chat attachments regression</Heading>
			<Text role="status">{results}</Text>
			<Button onClick={run}>Run paste/drop checks</Button>
			<Heading size="sm" my={4}>
				Lopu
			</Heading>
			<LopuComposer
				value={text}
				onChange={setText}
				onSend={() => {}}
				onStop={() => {}}
				streaming={false}
				models={[]}
				settings={{ model: null, effort: null, speed: 'normal', providerId: null }}
				onSettingsChange={() => {}}
				onAttachFiles={(files) => {
					if (ref.current?.addFiles(files)) setExpanded(true);
				}}
				attachments={
					<LopuAttachments
						expanded={expanded}
						onExpandedChange={setExpanded}
						uploadsRef={ref}
						onUploads={setSnapshot}
						selected={[]}
						onSelect={() => {}}
						disabled={false}
					/>
				}
			/>
			<Text>{snapshot.attachmentIds.length} Lopu attachments ready</Text>
			<Heading size="sm" my={4}>
				Messenger
			</Heading>
			<Composer
				placeholder="Message a friend"
				pickerEmojis={[]}
				replyTo={null}
				onCancelReply={() => {}}
				editing={null}
				onCancelEdit={() => {}}
				onSend={async () => true}
			/>
		</Box>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '/',
		loader: () => ({
			user: {
				id: 'synthetic',
				username: 'synthetic',
				privateUploadsEnabled: true,
				publicUploadsEnabled: true,
				storage: { remainingBytes: 10000000, status: 'ready' }
			}
		}),
		Component: App
	}
]);
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={router} />
	</ChakraProvider>
);
