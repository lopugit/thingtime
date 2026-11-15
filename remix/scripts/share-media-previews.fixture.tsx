import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Heading } from '@chakra-ui/react';
import { ProgressiveImage } from '../app/components/Attachments/ProgressiveImage';
import { UploadVisualPreview } from '../app/components/Attachments/AttachmentComposer';
import { VideoPreview } from '../app/components/Attachments/VideoPreview';
import type { ComposerAttachmentUpload } from '../app/components/Attachments/attachmentTypes';

function App() {
	const [id, setId] = React.useState('photo');
	const upload: ComposerAttachmentUpload = { localId: 'video', file: new File([], 'clip.mov', { type: 'video/quicktime' }), previewUrl: '/poster.png', previewContentType: 'image/png', status: 'uploading', progress: 17, uploadId: null, attachment: null, error: null, failedAt: null };
	return <ChakraProvider><Box maxW="760px" mx="auto" p={4}>
		<Heading size="md">Shared media previews</Heading>
		<Button onClick={() => setId('other')}>Change image</Button>
		<Box data-testid="image" height="240px"><ProgressiveImage src={`/api/v1/attachments/content?id=${id}&character=fixture`} alt="Shared photo" height="100%" /></Box>
		<Box data-testid="poster" height="180px"><UploadVisualPreview upload={upload} /></Box>
		<Box data-testid="video" height="180px"><VideoPreview src="/video.webm" label="Video thumbnail" /></Box>
		<Box height="1100px" />
		<Box data-testid="lazy" height="240px"><ProgressiveImage src="/api/v1/attachments/content?id=lazy&character=fixture" alt="Last photo" height="100%" /></Box>
	</Box></ChakraProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
