import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChakraProvider, Text } from '@chakra-ui/react';
import { LivePhoto } from '../app/components/Attachments/LivePhoto';
import { PostAttachments } from '../app/components/Attachments/PostAttachments';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { PublicAttachment } from '../app/components/Attachments/attachmentTypes';

const attachment = (id: string, mediaKind: 'image' | 'video', livePhoto?: PublicAttachment['livePhoto'], nsfw = false): PublicAttachment => ({
	id, name: `${id}.${mediaKind === 'image' ? 'jpeg' : 'mp4'}`, size: 1000,
	contentType: mediaKind === 'image' ? 'image/jpeg' : 'video/mp4', mediaKind,
	...(livePhoto ? { livePhoto } : {}), ...(nsfw ? { nsfw: true } : {})
});
const gallery: PublicAttachment[] = [
	attachment('still', 'image', { pairId: '11111111-1111-4111-8111-111111111111', role: 'photo' }),
	attachment('motion', 'video', { pairId: '11111111-1111-4111-8111-111111111111', role: 'motion' }),
	attachment('ordinary', 'video'),
	attachment('hiddenstill', 'image', { pairId: '22222222-2222-4222-8222-222222222222', role: 'photo' }, true),
	attachment('hiddenmotion', 'video', { pairId: '22222222-2222-4222-8222-222222222222', role: 'motion' })
];

function FixtureContent() {
	const [opens, setOpens] = React.useState(0);
	return <Box maxWidth="720px" marginX="auto" padding={4}>
		<Text>Live Photo interaction fixture</Text>
		<Text data-testid="opens">{opens}</Text>
		<Box data-testid="live" width="100%" maxWidth="640px">
			<LivePhoto stillSrc="/still.jpeg" motionSrc="/motion.mp4" label="Garden Live Photo" onOpen={() => setOpens((value) => value + 1)} />
		</Box>
		<Box data-testid="gallery" marginTop={4}><PostAttachments attachments={gallery} /></Box>
		<Box height="1000px" />
	</Box>;
}
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user: null }), element: <FixtureContent /> }]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
