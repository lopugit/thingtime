// Real folder controls in StrictMode; only the native picker/reader is synthetic.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Text } from '@chakra-ui/react';
import { MobileFolderAccess } from '../app/components/Devices/MobileFolderAccess';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';

let roots = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project documents' }];
let failNext = false;
const cancelled = new Set<string>();
window.thingtimeNativeBridge = {
	version: '1.0.0',
	platform: 'ios',
	isNativeWebView: true,
	fileAccessVersion: '1.0.0',
	postMessage(message) {
		const request = message.payload as any;
		if (request.action === 'suspend') {
			cancelled.add(request.requestId);
			return;
		}
		setTimeout(() => {
			if (cancelled.delete(request.requestId)) return;
			const payload: any = { ...request };
			if (failNext) {
				failNext = false;
				payload.error = 'Folder access is unavailable. Choose the folder again.';
			} else if (request.action === 'choose')
				roots = [
					...roots.filter((r) => r.id !== '22222222-2222-4222-8222-222222222222'),
					{ id: '22222222-2222-4222-8222-222222222222', name: 'A very long selected folder name with shared project photographs and documents' }
				];
			else if (request.action === 'remove') roots = roots.filter((r) => r.id !== request.rootId);
			else if (request.action === 'scan') {
				payload.complete = true;
				payload.entries = [{ path: 'example.txt', id: 'file-1', version: 'version-1', kind: 'file', size: 3, sha256: 'a'.repeat(64) }];
			}
			payload.roots = roots;
			window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-files-result', payload } }));
		}, 150);
	}
};
function Fixture() {
	const [fail, setFail] = useState(false);
	return (
		<ChakraProvider>
			<Box padding={4} maxWidth="760px" margin="auto">
				<Text as="h1" fontSize="20px" fontWeight="bold">
					Mobile folder access regression
				</Text>
				<Text fontSize="12px">Synthetic native responses. No files are accessed or uploaded.</Text>
				<Box marginTop={4} padding={4} border="1px solid #ddd" borderRadius="12px">
					<Text fontWeight="bold">This iPhone is added</Text>
					<MobileFolderAccess ownerId="folder-ui-fixture" />
				</Box>
				<Button
					marginTop={4}
					size="sm"
					onClick={() => {
						failNext = true;
						setFail(true);
					}}
				>
					{fail ? 'Failure armed' : 'Fail next request'}
				</Button>
			</Box>
		</ChakraProvider>
	);
}
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<Fixture />
	</StrictMode>
);
