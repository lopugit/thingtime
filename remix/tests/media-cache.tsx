import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box, Button, Flex, Text } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router';
import { PostAttachments } from '../app/components/Attachments/PostAttachments';
import { MediaCacheSettings } from '../app/components/Settings/MediaCacheSettings';
import { registerMediaCache } from '../app/utils/mediaCache.client';

function Verification() {
	const [page, setPage] = React.useState(true);
	const [round, setRound] = React.useState(0);
	const [status, setStatus] = React.useState<any>({});
	React.useEffect(() => {
		void registerMediaCache();
		const timer = setInterval(
			() =>
				fetch('/fixture-status')
					.then((response) => response.json())
					.then(setStatus),
			500
		);
		return () => clearInterval(timer);
	}, []);
	return (
		<Box maxWidth="760px" margin="auto" padding={4}>
			<Text as="h1" fontSize="2xl">
				Media cache verification
			</Text>
			<Text>Local fixtures exercise the real gallery, worker, binary storage, lazy loading and settings.</Text>
			<Text role="status">
				Byte downloads: {status.byteRequests ?? 0} · Access checks: {status.validations ?? 0} · Access: {String(status.authorized)}
			</Text>
			<Flex gap={2} wrap="wrap" my={4}>
				<Button onClick={() => setPage((value) => !value)}>{page ? 'Leave post' : 'Revisit post'}</Button>
				<Button
					onClick={async () => {
						await fetch('/fixture-access?allow=0', { method: 'POST' });
						setRound((n) => n + 1);
					}}
				>
					Revoke fixture access
				</Button>
				<Button
					onClick={async () => {
						await fetch('/fixture-access?allow=1', { method: 'POST' });
						setRound((n) => n + 1);
					}}
				>
					Restore fixture access
				</Button>
			</Flex>
			{page ? (
				<PostAttachments
					key={round}
					attachments={[{ id: 'qa-image', name: 'Landscape.png', size: 8000, contentType: 'image/png', mediaKind: 'image' }]}
				/>
			) : (
				<Box minHeight="480px">Another page</Box>
			)}
			<Box my={6}>
				<MediaCacheSettings />
			</Box>
			<Box height="900px">Scroll to the lazy image below.</Box>
			<PostAttachments attachments={[{ id: 'qa-lazy', name: 'Lazy landscape.png', size: 8000, contentType: 'image/png', mediaKind: 'image' }]} />
		</Box>
	);
}
createRoot(document.getElementById('root')!).render(
	<ChakraProvider>
		<MemoryRouter>
			<Verification />
		</MemoryRouter>
	</ChakraProvider>
);
