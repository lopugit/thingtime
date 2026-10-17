// Real recovery component with synthetic responses only; reads no device files.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider, Text } from '@chakra-ui/react';
import { NativeFileRecovery } from '../app/components/Devices/NativeFileRecovery';
import type { FolderRequest, FolderResult } from '../app/fileSync/mobileFolders.client';
const root = { id: '00000000-0000-4000-8000-000000000001', name: 'Personal archive' };
const path = 'Photos/2026/Family-holiday-with-a-long-name-for-layout-checking.jpeg';
const entry = { path, id: 'fixture-inode', version: '1', kind: 'file' as const, size: 123456789, sha256: 'a'.repeat(64) };
const item = {
	request: {
		rootId: root.id,
		scope: { origin: 'https://fixture.test', ownerId: 'fixture', dataPlane: 'home', rootId: 'connection', deviceId: 'device' },
		operation: {
			id: '00000000-0000-4000-8000-000000000002',
			confirmed: false,
			mutation: { kind: 'trash' as const, side: 'local' as const, path, expected: entry }
		}
	},
	kind: 'file' as const,
	size: entry.size,
	state: 'retained' as const
};
function Fixture() {
	const [busy, setBusy] = useState(false),
		[error, setError] = useState('');
	const [done, setDone] = useState(false);
	async function request(input: FolderRequest): Promise<FolderResult> {
		await new Promise((resolve) => setTimeout(resolve, 200));
		if (input.action === 'trash-list') return { roots: [root], trashPage: { items: done ? [] : [item], nextCursor: null } };
		if (input.action === 'trash-inspect') return { roots: [root], retainedEntry: entry, restoreIntent: null };
		if (input.action === 'trash-restore-reviewed') {
			setDone(true);
			return { roots: [root], restoredEntry: { ...entry, path: input.restore.path, version: '2' } };
		}
		throw Error('Unsupported fixture request');
	}
	return (
		<>
			<Text fontSize="12px" color="gray.600">
				Layout fixture — synthetic files; no native consent or filesystem effects.
			</Text>
			<NativeFileRecovery
				roots={[root]}
				busy={busy}
				perform={async (work) => {
					setBusy(true);
					setError('');
					try {
						await work(request);
					} catch (e) {
						setError(String(e));
					} finally {
						setBusy(false);
					}
				}}
			/>
			{error && <Text role="alert">{error}</Text>}
		</>
	);
}
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<Box maxWidth="900px" padding={4} margin="auto">
			<Fixture />
		</Box>
	</ChakraProvider>
);
