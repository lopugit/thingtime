import { useLopuVisualViewport } from './useLopuVisualViewport';
import React from 'react';
import { Box, Button, Flex, Input, Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, Text } from '@chakra-ui/react';
import { Paperclip, Search, X } from 'lucide-react';
import { AttachmentComposer, type AttachmentComposerHandle } from '~/components/Attachments/AttachmentComposer';
import type { AttachmentComposerSnapshot } from '~/components/Attachments/attachmentTypes';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';

export const EMPTY_LOPU_ATTACHMENTS: AttachmentComposerSnapshot = { attachmentIds: [], attachments: [], blocking: false, hasSelection: false };
export type LopuSelectedThing = { id: string; name: string };

export function LopuAttachments({ uploadsRef, onUploads, selected, onSelect, disabled, expanded, onExpandedChange }: {
	uploadsRef: React.Ref<AttachmentComposerHandle>; onUploads: (value: AttachmentComposerSnapshot) => void;
	selected: LopuSelectedThing[]; onSelect: (value: LopuSelectedThing[]) => void; disabled: boolean;
	expanded: boolean; onExpandedChange: (expanded: boolean) => void;
}) {
	const user = useCurrentUser();
	const viewport = useLopuVisualViewport();
	const api = useApi();
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState('');
	const [results, setResults] = React.useState<LopuSelectedThing[]>([]);
	const [error, setError] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const searchRef = React.useRef(api.v1.things.search);
	searchRef.current = api.v1.things.search;
	React.useEffect(() => {
		if (!open || !user?.username) return;
		let live = true;
		const timer = setTimeout(() => {
			setBusy(true); setError('');
			void searchRef.current({ q: query, author: user.username, limit: 30 }).then(payload => {
				if (!live) return;
				if (payload?.ok === false) throw new Error();
				setResults((payload?.things ?? []).map((thing: any) => ({ id: thing.id, name: String(thing.crystal?.title || thing.crystal?.name || thing.id) })));
			}).catch(() => { if (live) setError('Could not search your Things. Please retry.'); }).finally(() => { if (live) setBusy(false); });
		}, 250);
		return () => { live = false; clearTimeout(timer); };
	}, [open, query, user?.id, user?.username]);
	if (!user?.id) return null;
	return <Box py={2} minW={0} maxH={viewport ? `${Math.min(240, Math.max(72, viewport.height * 0.28))}px` : '28dvh'} overflowY="auto" overscrollBehavior="contain">
		<Flex wrap="wrap" gap={2}>
			<Button size="sm" variant="ghost" leftIcon={<Paperclip size={16} />} onClick={() => onExpandedChange(!expanded)} aria-expanded={expanded} isDisabled={disabled}>Attachments</Button>
			<Button size="sm" variant="ghost" leftIcon={<Search size={16} />} onClick={() => setOpen(true)} isDisabled={disabled}>Your Things</Button>
			{selected.map(thing => <Button key={thing.id} size="sm" maxW="100%" rightIcon={<X size={14} />} onClick={() => onSelect(selected.filter(item => item.id !== thing.id))} isDisabled={disabled} aria-label={`Remove ${thing.name}`}><Text isTruncated>{thing.name}</Text></Button>)}
		</Flex>
		<Box display={expanded ? 'block' : 'none'} p={2}>
			<AttachmentComposer ref={uploadsRef} ownerId={user.id} purpose="message" maxFiles={10} disabled={disabled} onChange={onUploads} helperText="Private files attach to this chat. Supported images, PDFs and text are sent to your selected AI provider (5 MiB per image/PDF, 128 KiB total text, 12 MiB per turn). Audio, video and unsupported files are labelled explicitly." />
		</Box>
		<Modal isOpen={open} onClose={() => setOpen(false)} size="lg" scrollBehavior="inside">
			<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} /><ModalContent containerProps={{ zIndex: DRAWER_MODAL_Z }} mx={3} my={4} maxW="min(32rem, calc(100vw - 24px))" maxH="calc(100dvh - 32px)"><ModalHeader>Attach your Things</ModalHeader><ModalCloseButton />
				<ModalBody minW={0} overflowX="hidden"><Input autoFocus aria-label="Search your Things" placeholder="Search notes, todos, transcripts…" value={query} onChange={event => setQuery(event.target.value)} />
					<Text role="status" fontSize="sm" py={2}>{error || (busy ? 'Searching…' : `${results.length} results · ${selected.length}/10 selected`)}</Text>
					<Flex direction="column" gap={1} minW={0}>{results.map(thing => {
						const checked = selected.some(item => item.id === thing.id);
						return <Button key={thing.id} variant={checked ? 'solid' : 'ghost'} aria-pressed={checked} textAlign="left" justifyContent="flex-start" whiteSpace="normal" minW={0} maxW="100%" h="auto" minH="44px" flexShrink={0} py={2} isDisabled={!checked && selected.length >= 10} onClick={() => onSelect(checked ? selected.filter(item => item.id !== thing.id) : [...selected, thing])}><Text minW={0} overflowWrap="anywhere">{thing.name}</Text></Button>;
					})}</Flex>
				</ModalBody><ModalFooter><Button onClick={() => setOpen(false)}>Done</Button></ModalFooter>
			</ModalContent>
		</Modal>
	</Box>;
}
