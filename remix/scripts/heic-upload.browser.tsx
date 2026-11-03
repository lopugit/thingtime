// Open /scripts/heic-upload.browser.html on the Vite dev server.
// Real decoder + React upload queue; only HTTP/object storage transport is replaced.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAttachmentUploads } from '../app/components/Attachments/useAttachmentUploads';
import { prepareProfileThumbnail } from '../app/components/Profile/profileThumbnail';
import type { AttachmentUploadPurpose } from '../app/components/Attachments/attachmentTypes';

const fixture = await (await fetch('./fixtures/photo.HEIC')).blob();
const file = () => new File([fixture], 'PHOTO.HEIC', { type: '', lastModified: 1 });
const requests: any[] = [];
const parts: Blob[] = [];
let failNextCreate = false;
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init) => {
	const path = String(url);
	if (path.includes('well-known'))
		return respond({
			schemaVersion: 1,
			origin: location.origin,
			features: {
				'api.attachment-uploads': { version: '1.4.0' },
				'api.subspaces-update': { version: '1.4.0' },
				'api.attachment-content': { version: '1.7.0' }
			}
		});
	const body = JSON.parse(String(init?.body || '{}'));
	requests.push({ path, body });
	if (path.endsWith('/uploads')) {
		if (failNextCreate) {
			failNextCreate = false;
			return respond({ error: 'Synthetic temporary failure' }, 503);
		}
		return respond({ upload: { id: body.requestId, partSizeBytes: 5 * 1024 * 1024, partCount: 1 } });
	}
	if (path.endsWith('/parts')) return respond({ parts: [{ partNumber: 1, url: '/fake-object-storage', headers: {} }] });
	if (path.endsWith('/complete'))
		return respond({ attachment: { id: body.uploadId, name: 'PHOTO.png', size: parts.at(-1)?.size, contentType: 'image/png', mediaKind: 'image' } });
	return respond({ ok: true });
};
class UploadXhr {
	status = 200;
	upload = { onprogress: null as any };
	onload: any;
	onabort: any;
	onerror: any;
	open() {}
	setRequestHeader() {}
	send(body: Blob) {
		parts.push(body);
		queueMicrotask(() => this.onload?.());
	}
	abort() {
		this.onabort?.();
	}
}
window.XMLHttpRequest = UploadXhr as any;
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
const waitUntil = async (ready: () => boolean) => {
	const end = Date.now() + 20000;
	while (!ready()) {
		if (Date.now() > end) throw new Error('Timed out waiting for queue');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};
let releaseThumbnail: (() => void) | undefined;
const delayedThumbnail = () =>
	new Promise<string>((resolve) => {
		releaseThumbnail = () => resolve('data:image/png;base64,synthetic');
	});
let current: ReturnType<typeof useAttachmentUploads>;
const cases: Array<AttachmentUploadPurpose | 'invite' | 'cancel' | 'invalid'> = [
	'post',
	'comment',
	'message',
	'profile-avatar',
	'profile-banner',
	'subspace-icon',
	'subspace-banner',
	'custom-emoji',
	'invite',
	'cancel',
	'invalid'
];
function Case({ purpose, done }: { purpose: (typeof cases)[number]; done: (result: string) => void }) {
	current = useAttachmentUploads('synthetic-owner', undefined, undefined, false, undefined, {
		purpose: purpose === 'invite' || purpose === 'cancel' || purpose === 'invalid' ? 'profile-avatar' : purpose,
		...(purpose === 'invite' ? { prepareLocalImage: prepareProfileThumbnail } : purpose === 'cancel' ? { prepareLocalImage: delayedThumbnail } : {})
	});
	React.useEffect(() => {
		void (async () => {
			const start = requests.length;
			if (purpose === 'cancel') {
				current.addFiles([file()]);
				await waitUntil(() => !!releaseThumbnail && current.uploads.length === 1);
				current.remove(current.uploads[0].localId);
				releaseThumbnail!();
				await waitUntil(() => !current.uploads.length);
				await new Promise((resolve) => setTimeout(resolve, 100));
				assert(!current.uploads.length && requests.length === start, 'Cancelled thumbnail reappeared or called API');
				done('PASS cancellation');
				return;
			}
			if (purpose === 'invalid') {
				current.addFiles([new File(['invalid'], 'bad.HEIC')]);
				await waitUntil(() => current.uploads[0]?.status === 'error');
				assert(current.uploads[0].error?.includes('could not be converted'), 'Missing conversion error');
				assert(requests.length === start, 'Invalid HEIC reached server');
				done('PASS invalid input');
				return;
			}
			const selected = file();
			current.addFiles([selected]);
			await waitUntil(() => current.uploads[0]?.status === 'ready' || current.uploads[0]?.status === 'error');
			assert(current.uploads[0].status === 'ready', current.uploads[0].error || 'Not ready');
			const upload = current.uploads[0];
			if (purpose === 'invite') {
				assert(upload.previewUrl?.startsWith('data:image/png;base64,'), 'Invite did not produce thumbnail');
			} else {
				const request = requests.slice(start).find((r) => r.path.endsWith('/uploads')).body;
				assert(request.contentType === 'image/png' && request.filename === 'PHOTO.png', 'Raw HEIC reached storage');
				assert(request.sizeBytes === parts.at(-1)?.size, 'Reserved bytes differ from upload');
				const signature = new Uint8Array(await parts.at(-1)!.slice(0, 8).arrayBuffer());
				assert([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte), 'Not PNG bytes');
				const bitmap = await createImageBitmap(parts.at(-1)!);
				assert(bitmap.width === 640 && bitmap.height === 480, 'Full-resolution image was resized');
				bitmap.close();
			}
			current.addFiles([selected]);
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert(current.uploads.length === 1, 'Converted input was duplicated');
			current.remove(upload.localId);
			await waitUntil(() => current.uploads.length === 0);
			if (purpose === 'invite') assert(requests.length === start, 'Local invite touched attachment API');
			if (purpose === 'post') {
				failNextCreate = true;
				current.addFiles([file()]);
				await waitUntil(() => current.uploads[0]?.status === 'error');
				const before = current.uploads[0].file;
				await current.retry(current.uploads[0].localId);
				await waitUntil(() => current.uploads[0]?.status === 'ready');
				assert(current.uploads[0].file === before, 'Retry changed converted bytes');
				current.remove(current.uploads[0].localId);
				await waitUntil(() => !current.uploads.length);
			}
			done(`PASS ${purpose}`);
		})().catch((error) => done(`FAIL ${purpose}: ${error.message}`));
	}, [done, purpose]);
	return <p>Testing {purpose}…</p>;
}
function App() {
	const [results, setResults] = React.useState<string[]>([]);
	const done = React.useCallback((result: string) => setResults((values) => [...values, result]), []);
	return (
		<>
			<pre>{results.join('\n')}</pre>
			{results.length < cases.length ? (
				<Case key={results.length} purpose={cases[results.length]} done={done} />
			) : (
				<h2>{results.every((r) => r.startsWith('PASS')) ? 'ALL PASSED' : 'FAILED'}</h2>
			)}
		</>
	);
}
createRoot(document.getElementById('root')!).render(<App />);
