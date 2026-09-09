import React from 'react';
import { Button, Flex, Heading, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay } from '@chakra-ui/react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { DRAWER_MODAL_Z, useDrawer } from './useDrawer';
import { SettingsContent } from '~/components/Settings/SettingsContent';
import { resolveSettingsTab, settingsTabHref, type SettingsTab } from '~/components/Settings/settingsTabs';

// Presentation only: all settings and tab definitions live in SettingsContent.
export const UserSettingsModal = () => {
	const { accountModalOpen, setAccountModalOpen } = useDrawer();
	const location = useLocation();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const requested = params.get('settings');
	const previous = React.useRef(requested);
	const tab = resolveSettingsTab(requested);
	const bodyRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		if (bodyRef.current) bodyRef.current.scrollTop = 0;
	}, [tab]);
	React.useEffect(() => {
		if (requested !== null) setAccountModalOpen(true);
		else if (previous.current !== null) setAccountModalOpen(false);
		previous.current = requested;
	}, [requested, setAccountModalOpen]);
	const close = () => {
		setAccountModalOpen(false);
		if (requested !== null) {
			const next = new URLSearchParams(params);
			next.delete('settings');
			setParams(next, { replace: true, preventScrollReset: true });
		}
	};
	const selectTab = (next: SettingsTab) => {
		const query = new URLSearchParams(params);
		query.set('settings', next);
		setParams(query, { preventScrollReset: true });
	};
	// Closing on a real page navigation also covers links rendered by child panels.
	const previousPath = React.useRef(location.pathname);
	React.useEffect(() => {
		if (previousPath.current !== location.pathname) setAccountModalOpen(false);
		previousPath.current = location.pathname;
	}, [location.pathname, setAccountModalOpen]);
	return (
		<Modal isOpen={accountModalOpen} onClose={close} size="4xl" scrollBehavior="inside" returnFocusOnClose>
			<ModalOverlay zIndex={DRAWER_MODAL_Z} />
			<ModalContent
				containerProps={{ zIndex: DRAWER_MODAL_Z + 1, alignItems: { base: 'flex-end', md: 'center' } }}
				mx={[0, 6]}
				my={[0, '5vh']}
				borderRadius={['16px 16px 0 0', '16px']}
				maxH="90dvh"
				minW={0}
				background="var(--tt-surface, #fafafb)"
			>
				<ModalHeader pr={12}>
					<Flex align="center" gap={3} wrap="wrap">
						<Heading size="md">Settings</Heading>
						<Button
							size="xs"
							variant="link"
							onClick={() => {
								close();
								navigate(settingsTabHref(tab));
							}}
						>
							Open settings page
						</Button>
					</Flex>
				</ModalHeader>
				<ModalCloseButton aria-label="Close settings" />
				<ModalBody ref={bodyRef} px={[3, 6]} pb={6} overflowX="hidden">
					<SettingsContent tab={tab} onTabChange={selectTab} onNavigate={close} />
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};
