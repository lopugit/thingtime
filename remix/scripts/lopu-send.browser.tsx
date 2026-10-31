// Real LopuChatView + uploader + store; only HTTP/storage are synthetic.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { LopuChatView } from '../app/components/Lopu/LopuChatView';

Object.defineProperty(window, 'SharedWorker', { value: undefined });
const tasks = new Map<string, any>();
const files = new Map<string, any>();
const deleted: string[] = [];
let releaseUpload: (() => void) | undefined;
let reply: { body: any; resolve: (response: Response) => void } | undefined;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input, init) => {
	const url = new URL(String(input), location.origin);
	const path = url.pathname;
	const body = JSON.parse(String(init?.body || '{}'));
	if (path.includes('well-known'))
		return json({
			schemaVersion: 1,
			origin: location.origin,
			features: {
				'api.attachment-uploads': { version: '1.4.1' },
				'api.lopu-chats-reply': { version: '1.10.0' },
				'api.lopu-background-tasks': { version: '1.0.0' }
			}
		});
	if (path.endsWith('/uploads')) {
		files.set(body.requestId, body);
		await new Promise<void>((resolve) => {
			releaseUpload = resolve;
		});
		return json({ upload: { id: body.requestId, partSizeBytes: 5242880, partCount: 1 } });
	}
	if (path.endsWith('/parts')) return json({ parts: [{ partNumber: 1, url: '/synthetic-storage', headers: {} }] });
	if (path.endsWith('/complete')) {
		const file = files.get(body.uploadId);
		return json({ attachment: { id: body.uploadId, name: file.filename, size: file.sizeBytes, contentType: file.contentType, mediaKind: 'file' } });
	}
	if (path.endsWith('/attachments/delete')) {
		deleted.push(body.id);
		return json({ ok: true });
	}
	if (path.endsWith('/ai/models'))
		return json({
			ok: true,
			models: [
				{
					id: 'synthetic-model',
					label: 'Synthetic model',
					provider: 'openai',
					enabled: true,
					available: true,
					isDefault: true,
					efforts: ['low'],
					speeds: ['normal']
				}
			],
			defaults: { model: 'synthetic-model', effort: 'low', speed: 'normal' },
			providers: { openai: { configured: true } }
		});
	if (path.endsWith('/lopu/account')) return json({ ok: true, account: { verified: true, requireVerification: true, balanceMicros: 100000000 } });
	if (path.endsWith('/lopu/chats/reply'))
		return new Promise<Response>((resolve) => {
			reply = { body, resolve };
		});
	if (path.endsWith('/lopu/tasks') && url.searchParams.has('id')) {
		const entry = tasks.get(url.searchParams.get('id')!);
		const offset = Number(url.searchParams.get('offset') || 0);
		return json({
			ownerId: 'synthetic-send-regression',
			task: entry.task,
			output: entry.output.slice(offset),
			offset: entry.output.length,
			length: entry.output.length
		});
	}
	return json({ ok: true, ownerId: 'synthetic-send-regression', chats: [], messages: [], tasks: [], things: [] });
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
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check: () => boolean) => {
	for (let n = 0; n < 200; n++) {
		if (check()) return;
		await wait();
	}
	throw Error('Timed out waiting for UI');
};
const assert = (ok: unknown, message: string) => {
	if (!ok) throw Error(message);
};
const field = () => document.querySelector<HTMLTextAreaElement>('[aria-label="Message Lopu"]')!;
const type = (value: string) => {
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field(), value);
	field().dispatchEvent(new Event('input', { bubbles: true }));
};
const send = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Send"]')!;
const list = () => document.querySelector('[aria-label="Post attachments"]')!;
const paste = (name: string) => {
	const transfer = new DataTransfer();
	transfer.items.add(new File(['Synthetic regression file'], name, { type: 'text/plain' }));
	field().dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
};
const accept = () => {
	const pending = reply!;
	reply = undefined;
	const task = {
		id: pending.body.requestId,
		requestId: pending.body.requestId,
		status: 'running',
		responseStatus: 200,
		contentType: 'application/x-ndjson',
		chatId: 'synthetic-chat'
	};
	const entry = {
		task,
		output:
			JSON.stringify({ type: 'meta', chatId: 'synthetic-chat', userMessageId: `u-${pending.body.requestId}`, requestId: pending.body.requestId }) +
			'\n'
	};
	tasks.set(task.id, entry);
	pending.resolve(new Response(JSON.stringify({ task }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
	return () => {
		entry.output += JSON.stringify({ type: 'done', assistantMessageId: `a-${pending.body.requestId}`, messages: [], stopReason: 'end_turn' }) + '\n';
		task.status = 'completed';
	};
};
function App() {
	const [result, setResult] = React.useState('Ready');
	const run = async () => {
		try {
			await until(() => !!field() && !field().disabled);
			paste('first.txt');
			await until(() => !!releaseUpload);
			assert(!field().disabled, 'Typing disabled during upload');
			type('Draft while uploading');
			await wait();
			assert(send().disabled, 'Send allowed during upload');
			field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
			await wait();
			assert(!reply && field().value === 'Draft while uploading', 'Enter submitted or erased pending draft');
			releaseUpload!();
			releaseUpload = undefined;
			await until(() => !send().disabled);
			send().click();
			await until(() => !!reply);
			assert(field().value === '', 'Submitted text not cleared optimistically');
			assert(!(list() as HTMLElement).checkVisibility(), 'Submitted tray stayed visible before acceptance');
			const finish = accept();
			await until(() => !list().textContent?.includes('first.txt'));
			assert(!!document.querySelector('[aria-label="Stop Lopu\'s reply"]'), 'Reply ended before cleanup assertion');
			assert(deleted.length === 0, 'Accepted attachment deleted during remount');
			finish();
			await until(() => !!send());
			paste('retry.txt');
			await until(() => !!releaseUpload);
			releaseUpload!();
			releaseUpload = undefined;
			type('Rejected message');
			await until(() => !send().disabled);
			send().click();
			await until(() => !!reply);
			type('Newer draft');
			await wait();
			reply!.resolve(new Response('Synthetic rejection', { status: 503 }));
			reply = undefined;
			await until(() => !!send());
			await until(() => (list() as HTMLElement).checkVisibility());
			assert(list().textContent?.includes('retry.txt'), 'Rejected file was lost');
			assert(field().value === 'Newer draft', 'Rejection overwrote newer typing');
			assert(deleted.length === 0, 'Rejected draft was deleted');
			send().click();
			await until(() => !!reply);
			const finishRetry = accept();
			await until(() => !list().textContent?.includes('retry.txt'));
			finishRetry();
			setResult(
				'PASS: typing during upload; Send/Enter gated; immediate collapse; accepted media cleared while reply remains open; no committed-file deletion; rejection restores files and preserves newer text; retry clears correctly.'
			);
		} catch (error) {
			setResult('FAIL: ' + String(error));
		}
	};
	return (
		<Box p={3}>
			<Button onClick={() => void run()}>Run full send regression</Button>
			<Text role="status">{result}</Text>
			<Box height="740px" border="1px solid #ddd">
				<ThingtimeContext.Provider value={{ Everything: { thingtime: {}, loading: false } } as any}>
					<LopuChatView compact showConversations={false} />
				</ThingtimeContext.Provider>
			</Box>
		</Box>
	);
}
const router = createMemoryRouter([
	{
		id: 'root',
		path: '/',
		loader: () => ({
			user: {
				id: 'synthetic-send-regression',
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
