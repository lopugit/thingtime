// Production components with synthetic upload transport; creates no account data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Flex, Heading, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AttachmentComposer, type AttachmentComposerHandle } from '../app/components/Attachments/AttachmentComposer';
import { PostAttachments } from '../app/components/Attachments/PostAttachments';
import type { AttachmentComposerSnapshot, PublicAttachment } from '../app/components/Attachments/attachmentTypes';
import type { PostMediaLayout } from '../app/schemas/registry';
const records = new Map<string, any>();
const attempts = new Map<string, number>();
let concurrent = 0,
	maxConcurrent = 0;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init) => {
	const path = String(url),
		body = JSON.parse(String(init?.body || '{}'));
	if (path.includes('well-known'))
		return json({
			schemaVersion: 1,
			origin: location.origin,
			features: {
				'api.attachment-uploads': { version: '1.4.1' },
				'api.things': { version: '1.19.0' },
				'api.things-user': { version: '1.6.0' },
				'api.attachment-content': { version: '1.8.0' }
			}
		});
	if (path.endsWith('/uploads')) {
		const count = (attempts.get(body.requestId) || 0) + 1;
		attempts.set(body.requestId, count);
		if (body.filename.startsWith('retry-') && count === 1) return json({ ok: false, error: 'Synthetic network failure' }, 503);
		records.set(body.requestId, body);
		return json({ upload: { id: body.requestId, partSizeBytes: 5242880, partCount: 1 } });
	}
	if (path.endsWith('/parts')) return json({ parts: [{ partNumber: 1, url: '/synthetic-storage', headers: {} }] });
	if (path.endsWith('/complete')) {
		const file = records.get(body.uploadId);
		return json({ attachment: { id: body.uploadId, name: file.filename, size: file.sizeBytes, contentType: file.contentType, mediaKind: 'file' } });
	}
	return json({ ok: true, things: [] });
};
class UploadXhr {
	status = 200;
	upload = { onprogress: null };
	onload?: () => void;
	open() {}
	setRequestHeader() {}
	send() {
		concurrent++;
		maxConcurrent = Math.max(maxConcurrent, concurrent);
		setTimeout(() => {
			concurrent--;
			this.onload?.();
		}, 35);
	}
	abort() {}
}
window.XMLHttpRequest = UploadXhr as any;
const media: PublicAttachment[] = [
	{
		id: 'photo-first',
		name: 'First photo',
		size: 0,
		contentType: 'image/png',
		mediaKind: 'image',
		url: `${location.origin}/scripts/media-gallery-photo.svg`
	},
	{
		id: 'video-middle',
		name: 'Middle video',
		size: 1000,
		contentType: 'video/webm',
		mediaKind: 'video',
		url: `${location.origin}/scripts/media-gallery-fixture.webm`
	},
	{
		id: 'photo-last',
		name: 'Last photo',
		size: 0,
		contentType: 'image/png',
		mediaKind: 'image',
		url: `${location.origin}/scripts/media-gallery-photo.svg`
	}
];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function App() {
	const ref = React.useRef<AttachmentComposerHandle>(null);
	const [snapshot, setSnapshot] = React.useState<AttachmentComposerSnapshot | null>(null);
	const [result, setResult] = React.useState('Ready');
	const [layout, setLayout] = React.useState<PostMediaLayout>({ mode: 'masonry' });
	const run = async () => {
		ref.current?.addFiles(
			Array.from({ length: 30 }, (_, i) => new File(['gallery regression'], `${i < 3 ? 'retry-' : ''}file-${i}.txt`, { type: 'text/plain' }))
		);
		setResult('Uploading 30 files, including three recoverable failures');
		await wait(2500);
		const retry = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Retry all');
		if (!retry) {
			setResult('FAIL: Retry all missing');
			return;
		}
		retry.click();
		retry.click();
		await wait(1500);
		const repeated = [...attempts.values()].filter((n) => n === 2).length;
		const bad = [...attempts.values()].some((n) => n > 2);
		setResult(
			records.size === 30 && repeated === 3 && !bad && maxConcurrent <= 3
				? 'PASS: 30 files, 3 retried exactly once, concurrency ≤ 3'
				: `FAIL: ${records.size} ready, ${repeated} retried, concurrency ${maxConcurrent}`
		);
	};
	return (
		<Box maxW="780px" mx="auto" p={4}>
			<Heading size="md">Mixed media gallery regression</Heading>
			<Text my={3}>First photo → middle video → last photo. Open the video and step through both photos.</Text>
			<Flex gap={2} mb={3} wrap="wrap">
				{(['masonry', 'rows', 'grid'] as const).map((mode) => (
					<Button key={mode} size="sm" onClick={() => setLayout({ mode, columns: 2, pattern: [2, 1] })}>
						{mode}
					</Button>
				))}
			</Flex>
			<PostAttachments attachments={media} mediaLayout={layout} />
			<Heading size="sm" mt={6}>
				Upload queue
			</Heading>
			<Button my={3} onClick={run}>
				Run upload regression
			</Button>
			<Text role="status" mb={3}>
				{result}
			</Text>
			<Text>{snapshot?.attachments.length || 0} ready attachments</Text>
			<AttachmentComposer ref={ref} ownerId="synthetic-gallery-owner" onChange={setSnapshot} />
			<Text mt={5}>End of regression page</Text>
		</Box>
	);
}
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<RouterProvider router={createMemoryRouter([{ path: '*', element: <App /> }])} />
	</ChakraProvider>
);
