// Production page renderer and native uploader with an entirely synthetic transport.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Heading, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import { builderFormExample } from '../app/docs/builderGuide';
const uploads = new Map<string, any>();
const runs: any[] = [],
	commits: any[] = [];
let rejectCommit = true,
	sourceLoads = 0;
const respond = (body: unknown) => Response.json(body);
const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
window.fetch = async (url, init) => {
	const path = String(url),
		body = JSON.parse(String(init?.body || '{}'));
	if (path.includes('well-known'))
		return respond({
			schemaVersion: 1,
			origin: location.origin,
			features: { 'api.attachment-uploads': { version: '1.4.1' }, 'api.actions-run': { version: '1.5.0' } }
		});
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
	if (path.endsWith('/api/v1/things') && init?.method === 'POST') {
		commits.push(body);
		if (rejectCommit) {
			rejectCommit = false;
			return Response.json({ error: 'Synthetic failed save; retry' }, { status: 503 });
		}
		return respond({ ok: true, thing: { id: body.shareId } });
	}
	if (path.includes('/actions/run')) {
		if (body.action === 'list-addresses') {
			sourceLoads++;
			return respond({ status: 'ok', result: { label: 'Source inherited' } });
		}
		runs.push(body);
		await wait(300);
		return respond({ status: 'ok', result: { message: 'Address saved', id: 'synthetic-record' }, opsUsed: 2, durationMs: 300 });
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
const tree = structuredClone(builderFormExample.render) as any;
tree.children[2].props.imageOnly = false;
tree.children[2].props.value = '/api/v1/attachments/content?id=existing';
tree.children[2].props.attachmentId = 'existing';
tree.children.push({ tag: 'p', children: ['{result.label}'] });
const component = { id: 'form', crystal: { ...builderFormExample, render: tree, source: { action: 'list-addresses', refresh: 'load' } } };
const assert = (condition: unknown, message: string) => {
	if (!condition) throw Error(message);
};
const field = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((node) => node.textContent === label)!;
const change = (name: string, value: string) => {
	const node = field(name);
	Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(
		node,
		value
	);
	node.dispatchEvent(new Event('input', { bubbles: true }));
};
function App() {
	const [result, setResult] = React.useState('Ready'),
		[generation, setGeneration] = React.useState(0);
	const run = async () => {
		setResult('Running…');
		try {
			await wait(300);
			assert(document.querySelector('[data-tt-native-upload]'), 'Embedded upload is not interactive');
			assert(document.body.innerText.includes('Source inherited'), 'Component source was not inherited');
			assert(field('photoAttachmentId').value === 'existing', 'Existing upload value lost');
			button('Save address').click();
			await wait();
			assert(runs.length === 0, 'Required input was ignored');
			change('address', '001 Example Street');
			change('notes', '');
			const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
			const files = new DataTransfer();
			files.items.add(new File(['Synthetic builder fixture'], 'sample.txt', { type: 'text/plain' }));
			fileInput.files = files.files;
			fileInput.dispatchEvent(new Event('change', { bubbles: true }));
			await wait(600);
			button('Save address').click();
			await wait();
			assert(runs.length === 0, 'Uncommitted upload did not block save');
			button('Use file').click();
			await wait(500);
			assert(document.body.innerText.includes('Synthetic failed save'), 'Failed commit not shown');
			button('Use file').click();
			await wait(500);
			assert(commits.length === 2 && commits[0].shareId === commits[1].shareId, 'Upload retry changed identity');
			const id = field('photoAttachmentId').value;
			assert(id && id !== 'existing', 'Ready upload missing form id');
			button('Save address').click();
			button('Save address').click();
			await wait(600);
			assert(runs.length === 1, 'Double click created duplicate run');
			assert(
				runs[0].inputs.address === '001 Example Street' && runs[0].inputs.notes === '' && runs[0].inputs.photoAttachmentId === id,
				'Submitted fields differ'
			);
			assert(sourceLoads >= 2, 'Saved form did not refresh source');
			button('Clear field').click();
			await wait();
			button('Save address').click();
			await wait(500);
			assert(runs.length === 2 && runs[1].inputs.photo === '' && runs[1].inputs.photoAttachmentId === '', 'Clear left stale values or blocked form');
			assert(field('address').value === '001 Example Street', 'Refresh erased input draft');
			setResult(
				'PASS: embedded uploads; inherited source; existing file; required validation; upload guard; failed save + same-identity retry; complete file fields; double-click guard; empty text; source refresh; clear + draft retention.'
			);
		} catch (e) {
			setResult('FAIL: ' + String(e));
		}
	};
	return (
		<Box
			p={4}
			maxW="900px"
			mx="auto"
			sx={{
				fieldset: { minWidth: 0 },
				label: { display: 'block', marginBottom: '12px' },
				'input:not([type=hidden]), textarea': { maxWidth: '100%', border: '1px solid #ddd' }
			}}
		>
			<Heading size="md">Builder SDK regression</Heading>
			<Text role="status" my={3}>
				{result}
			</Text>
			<Button onClick={run} isDisabled={result !== 'Ready'}>
				Run checks
			</Button>
			<Button
				variant="ghost"
				onClick={() => {
					setGeneration((value) => value + 1);
					runs.length = 0;
					commits.length = 0;
					sourceLoads = 0;
					rejectCommit = true;
					setResult('Ready');
				}}
			>
				Reset fixture
			</Button>
			<WebpageRuntimeProvider key={generation} pageId="fixture" pageKey={null} suiteKey={null} source="user">
				<WebpageBlocksRenderer blocks={[{ id: 'form', type: 'component', component: 'form' }]} componentsByRef={{ form: component }} interactive />
			</WebpageRuntimeProvider>
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
				publicUploadsEnabled: true,
				privateUploadsEnabled: true,
				storage: { remainingBytes: 10000000, status: 'ready' }
			}
		}),
		Component: () => (
			<ChakraProvider>
				<App />
			</ChakraProvider>
		)
	}
]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
