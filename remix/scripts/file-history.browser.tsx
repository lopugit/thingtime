import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, Button, ChakraProvider, Flex, Text } from '@chakra-ui/react';
import { TimelineFileVersion } from '../app/components/Timeline/TimelineFileVersions';
import { fileRestoreKey, fileCommitEventId } from '../app/fileSync/fileVersions';
import type { CloudFile } from '../app/fileSync/cloudFile';
import { rootIdentity } from '../app/utils/rootIdentity';

const scope = { ownerId: 'fixture-file-history', dataPlane: 'home', apiOrigin: window.location.origin };
const version: CloudFile = {
	id: '55555555-5555-4555-8555-555555555555',
	revision: 'fixture-version-one',
	name: 'An earlier version with a very long name for mobile layout verification.txt',
	folderId: null,
	trashed: false,
	content: {
		attachmentId: 'fixture-attachment',
		version: 'a'.repeat(64),
		size: 123,
		fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: 'b'.repeat(64) }
	}
};
let current = { ...version, name: 'Renamed file.txt', folderId: 'current-folder', revision: 'fixture-current' };
let lost = false,
	writes = 0,
	requests: string[] = [],
	delayRead = false;
const receipts = new Map<string, { body: string; file: CloudFile }>();
let redraw = () => {};
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input), location.href);
	if (url.pathname === '/.well-known/thingtime-capabilities.json')
		return new Response(
			JSON.stringify({
				schemaVersion: 1,
				origin: scope.apiOrigin,
				features: { 'api.files': { version: '1.2.0' }, 'api.actions-run': { version: '1.7.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } }
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	if (url.pathname === '/api/v1/files') {
		const headers = new Headers(init?.headers);
		const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
		if (
			headers.get('X-Thingtime-Expected-Actor') !== scope.ownerId ||
			headers.get('X-Thingtime-Expected-Data-Plane') !== 'home' ||
			headers.get('X-Thingtime-Expected-Api-Origin') !== scope.apiOrigin
		)
			return respond({ ok: false, error: 'Missing identity fence' }, 409);
		if (init?.method !== 'POST') {
			if (delayRead) {
				delayRead = false;
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
			return respond({ ok: true, file: current });
		}
		const body = JSON.parse(String(init.body));
		requests.push(body.operationId);
		redraw();
		const saved = receipts.get(body.operationId);
		if (saved)
			return saved.body === String(init.body)
				? respond({ ok: true, file: saved.file, replayed: true })
				: respond({ ok: false, error: 'Changed retry' }, 409);
		if (body.expectedRevision !== current.revision) return respond({ ok: false, error: 'File changed; review the latest file.' }, 409);
		current = { ...current, revision: await fileCommitEventId(scope.ownerId, body.id, body.operationId), trashed: false, content: version.content };
		receipts.set(body.operationId, { body: String(init.body), file: current });
		writes++;
		redraw();
		if (lost) {
			lost = false;
			throw Error('Fixture lost accepted response');
		}
		return respond({ ok: true, file: current, replayed: false });
	}
	return originalFetch(input, init);
};
function Fixture() {
	const [mount, setMount] = useState(0),
		[enabled, setEnabled] = useState(true),
		[, refresh] = useState(0);
	redraw = () => refresh((n) => n + 1);
	return (
		<ChakraProvider>
			<Box maxW="760px" mx="auto" p={4}>
				<Text as="h1" fontSize="xl">
					Retained file version
				</Text>
				<Text fontSize="sm">Synthetic file API; no real files are changed.</Text>
				<Flex gap={2} wrap="wrap" my={3}>
					<Button
						onClick={() => {
							lost = true;
						}}
					>
						Lose next reply
					</Button>
					<Button
						onClick={() => {
							current = { ...current, revision: current.revision + '-edited' };
							redraw();
						}}
					>
						Concurrent edit
					</Button>
					<Button onClick={() => setMount((n) => n + 1)}>Reopen history</Button>
					<Button
						onClick={() => {
							delayRead = true;
						}}
					>
						Delay next read
					</Button>
					<Button
						onClick={() => {
							rootIdentity.changed();
							setEnabled(false);
						}}
					>
						Change account
					</Button>
					<Button
						onClick={() => {
							localStorage.removeItem(fileRestoreKey(scope, version));
							receipts.clear();
							requests = [];
							writes = 0;
							lost = false;
							current = { ...version, name: 'Renamed file.txt', folderId: 'current-folder', revision: 'fixture-current' };
							rootIdentity.confirm(rootIdentity.read().generation);
							setEnabled(true);
							setMount((n) => n + 1);
						}}
					>
						Reset fixture
					</Button>
				</Flex>
				<Text role="status" id="fixture-state">
					Writes: {writes}. Requests: {requests.length}. Unique operations: {new Set(requests).size}.
				</Text>
				<TimelineFileVersion key={mount} label="Saved file version" version={version} scope={scope} enabled={enabled} onApplied={() => redraw()} />
			</Box>
		</ChakraProvider>
	);
}
const router = createMemoryRouter([
	{ id: 'root', path: '/', loader: () => ({ user: { id: scope.ownerId, accountKind: 'user' }, dataPlane: 'home' }), element: <Fixture /> }
]);
createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
