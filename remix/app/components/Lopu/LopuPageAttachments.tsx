import React from 'react';
import { Box, Button, Checkbox, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import { History, X } from 'lucide-react';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { LOPU_MAX_PAGE_REFERENCES, type LopuPageReference } from '~/utils/lopuPageContext';
import { readLopuRecentPages, type LopuRecentPage } from './useLopuPages';
import { useLopuSettings } from './useLopuSettings';
import { LOPU_UI } from './lopuTheme';

export function LopuPageAttachments({ owner, current, selected, onChange, disabled }: {
	owner: string | null; current: LopuPageReference | null; selected: LopuPageReference[];
	onChange: (pages: LopuPageReference[]) => void; disabled: boolean;
}) {
	const { settings, setAttachCurrentPage } = useLopuSettings();
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState('');
	const [recent, setRecent] = React.useState<LopuRecentPage[]>([]);
	const currentAttached = settings.attachCurrentPage || selected.some(page => page.url === current?.url);
	const count = selected.length + (settings.attachCurrentPage && current && !selected.some(page => page.url === current.url) ? 1 : 0);
	const candidates = [...(current ? [{ ...current, at: Date.now() }] : []), ...recent.filter(page => page.url !== current?.url)];
	const results = candidates.filter(page => `${page.title} ${page.url}`.toLowerCase().includes(query.toLowerCase()));
	return <Box minW={0} px={1} pb={2}>
		<Flex gap={2} align="center" wrap="wrap">
			{current ? <Checkbox size="sm" isChecked={currentAttached} onChange={event => { setAttachCurrentPage(event.target.checked); if (!event.target.checked) onChange(selected.filter(page => page.url !== current.url)); }} isDisabled={disabled} aria-label="Attach current page" minW={0} maxW="100%" minH="36px">
				<Box minW={0} title={current.url}><Text fontSize="xs" color={LOPU_UI.muted}>Current page{currentAttached ? ' · attached' : ' · not attached'}</Text><Text fontSize="xs" fontWeight={600} noOfLines={1} overflowWrap="anywhere">{current.title}</Text>{current.title !== current.url && <Text fontSize="10px" color={LOPU_UI.muted} noOfLines={1} overflowWrap="anywhere">{current.url}</Text>}</Box>
			</Checkbox> : <Text fontSize="xs" color={LOPU_UI.muted}>This page is excluded from context</Text>}
			<Button size="xs" variant="ghost" leftIcon={<History size={14} />} isDisabled={disabled} onClick={() => { setRecent(owner ? readLopuRecentPages(owner) : []); setQuery(''); setOpen(true); }}>Pages{selected.length ? ` (${selected.length})` : ''}</Button>
		</Flex>
		{selected.length > 0 && <Flex wrap="wrap" gap={1} mt={2} maxH="90px" overflowY="auto">{selected.map(page => <Button key={page.url} size="xs" maxW="100%" rightIcon={<X size={12} />} aria-label={`Remove page ${page.title}`} title={page.url} isDisabled={disabled} onClick={() => onChange(selected.filter(item => item.url !== page.url))}><Text isTruncated>{page.title}</Text></Button>)}</Flex>}
		<Modal isOpen={open} onClose={() => setOpen(false)} size="lg" scrollBehavior="inside">
			<ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} /><ModalContent containerProps={{ zIndex: DRAWER_MODAL_Z }} mx={3} my={4} maxW="min(32rem, calc(100vw - 24px))" maxH="calc(100dvh - 32px)">
				<ModalHeader>Attach pages</ModalHeader><ModalCloseButton />
				<ModalBody minW={0} overflowX="hidden">
					<Input aria-label="Search recent pages" placeholder="Search recent pages…" value={query} onChange={event => setQuery(event.target.value)} />
					<Text fontSize="sm" color={LOPU_UI.muted} py={2}>Recent navigation and navigator picks · {count}/{LOPU_MAX_PAGE_REFERENCES} attached. Choose up to nine additional pages. Page links are shared with your message.</Text>
					<Flex direction="column" gap={1}>{results.map(page => {
						const automatic = settings.attachCurrentPage && current?.url === page.url;
						const checked = automatic || selected.some(item => item.url === page.url);
						return <Button key={page.url} variant={checked ? 'solid' : 'ghost'} aria-pressed={checked} textAlign="left" justifyContent="flex-start" whiteSpace="normal" h="auto" minH="52px" flexShrink={0} py={2} isDisabled={!checked && (count >= LOPU_MAX_PAGE_REFERENCES || selected.length >= LOPU_MAX_PAGE_REFERENCES - 1)} onClick={() => {
							if (automatic) setAttachCurrentPage(false);
							onChange(checked ? selected.filter(item => item.url !== page.url) : [...selected, page]);
						}}><Box minW={0}><Text fontSize="sm" overflowWrap="anywhere">{checked ? '✓ ' : ''}{page.title}{automatic ? ' · current page' : ''}</Text><Text fontSize="xs" fontWeight={400} color={LOPU_UI.muted} overflowWrap="anywhere">{page.url}</Text></Box></Button>;
					})}</Flex>
					{!results.length && <Text py={4} fontSize="sm">No matching pages. Pages you visit in Thingtime will appear here.</Text>}
				</ModalBody><ModalFooter><Button onClick={() => setOpen(false)}>Done</Button></ModalFooter>
			</ModalContent>
		</Modal>
	</Box>;
}
