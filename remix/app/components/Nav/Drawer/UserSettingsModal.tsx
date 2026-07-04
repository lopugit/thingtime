import React from 'react';
import { Box, Button, Center, Flex, Switch, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';

import { UserAvatarCircle } from './DrawerContent';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z, useDrawer, useIsMobileViewport } from './useDrawer';
import { useLopu } from '../../Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// User/app settings surface opened from the drawer's avatar button.
// Desktop: centre-aligned floating modal. Mobile: full-width slide-up sheet
// layered over the drawer / shifted page.

export const UserSettingsModal = () => {
	const {
		accountModalOpen,
		setAccountModalOpen,
		direction,
		setDirection,
		searchClosesDrawer,
		setSearchClosesDrawer,
		topLevelLimit,
		setTopLevelLimit,
		resetOrdering
	} = useDrawer();

	const isMobile = useIsMobileViewport();
	const user = useCurrentUser();
	const api = useApi();
	const navigate = useNavigate();
	const lopu = useLopu();

	// two-frame mount so the open transition animates from the hidden state
	const [visible, setVisible] = React.useState(false);

	React.useEffect(() => {
		if (!accountModalOpen) {
			setVisible(false);
			return;
		}

		const raf = requestAnimationFrame(() => {
			setVisible(true);
		});

		return () => {
			cancelAnimationFrame(raf);
		};
	}, [accountModalOpen]);

	const close = React.useCallback(() => {
		setAccountModalOpen(false);
	}, [setAccountModalOpen]);

	React.useEffect(() => {
		if (!accountModalOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === 'Escape') {
				close();
			}
		};

		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [accountModalOpen, close]);

	// freeze the page behind the modal
	React.useEffect(() => {
		if (!accountModalOpen) {
			return;
		}

		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previous;
		};
	}, [accountModalOpen]);

	const handleLogout = React.useCallback(async () => {
		try {
			await api.v1.auth.logout();
		} catch (err) {
			console.error('Logout failed', err);
			lopu({ title: 'Logout failed', description: 'Please try again in a moment.', status: 'error' });
			return;
		}

		lopu({ title: 'Logged out', status: 'success', duration: 6000 });
		close();
		navigate('/login');
	}, [api, lopu, close, navigate]);

	const handleGoTo = React.useCallback(
		(to: string) => {
			close();
			navigate(to);
		},
		[close, navigate]
	);

	const handleResetOrdering = React.useCallback(() => {
		resetOrdering();
		lopu({ title: 'Menu order reset ✨', status: 'success', duration: 6000 });
	}, [resetOrdering, lopu]);

	if (!accountModalOpen) {
		return null;
	}

	const settingRow = (label: string, control: React.ReactNode, hint?: string) => (
		<Flex alignItems="center" columnGap={4} paddingY={2}>
			<Box>
				<Text fontSize="sm">{label}</Text>
				{hint && (
					<Text fontSize="xs" opacity={0.55}>
						{hint}
					</Text>
				)}
			</Box>
			<Box marginLeft="auto">{control}</Box>
		</Flex>
	);

	const content = (
		<Flex flexDirection="column" rowGap={5} padding={6} paddingBottom={isMobile ? 'calc(24px + var(--thingtime-safe-area-bottom))' : 6}>
			{/* header */}
			<Flex alignItems="center">
				<Text fontSize="md" fontWeight={700}>
					Settings
				</Text>
				<Center
					as="button"
					type="button"
					marginLeft="auto"
					width="28px"
					height="28px"
					borderRadius="8px"
					opacity={0.6}
					_hover={{ opacity: 1, background: 'greys.lightt' }}
					cursor="pointer"
					aria-label="Close settings"
					onClick={close}
				>
					<X size={15} strokeWidth={2} />
				</Center>
			</Flex>

			{/* account */}
			<Flex flexDirection="column" rowGap={3}>
				<Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
					Account
				</Text>
				<Flex alignItems="center" columnGap={3}>
					<UserAvatarCircle size="44px" fontSize="md"></UserAvatarCircle>
					<Box minWidth={0}>
						<Text fontSize="sm" fontWeight={600} noOfLines={1}>
							{user ? user.displayName || user.username : 'Not logged in'}
						</Text>
						{user && (
							<Text fontSize="xs" opacity={0.6} noOfLines={1}>
								@{user.username} · {user.email} {user.emailVerified ? '✅' : '· ✉️ unverified'}
							</Text>
						)}
					</Box>
				</Flex>
				<Flex columnGap={2}>
					{user ? (
						<>
							<Button size="xs" variant="outline" onClick={() => handleGoTo('/profile')}>
								Profile 👤
							</Button>
							<Button size="xs" variant="outline" onClick={handleLogout}>
								Log out 🗝️
							</Button>
						</>
					) : (
						<>
							<Button size="xs" variant="outline" onClick={() => handleGoTo('/login')}>
								Log in 🗝️
							</Button>
							<Button size="xs" variant="outline" onClick={() => handleGoTo('/register')}>
								Register ➕
							</Button>
						</>
					)}
				</Flex>
			</Flex>

			{/* drawer preferences */}
			<Flex flexDirection="column" rowGap={0}>
				<Text
					paddingBottom={2}
					fontSize="10px"
					fontWeight={600}
					letterSpacing="0.08em"
					textTransform="uppercase"
					opacity={0.45}
				>
					Drawer
				</Text>

				{settingRow(
					'Opens from',
					<Flex columnGap={1}>
						<Button size="xs" variant={direction === 'left' ? 'solid' : 'ghost'} onClick={() => setDirection('left')}>
							Left
						</Button>
						<Button size="xs" variant={direction === 'right' ? 'solid' : 'ghost'} onClick={() => setDirection('right')}>
							Right
						</Button>
					</Flex>,
					'Which edge the drawer slides out from'
				)}

				{settingRow(
					'Search closes drawer',
					<Switch
						isChecked={searchClosesDrawer}
						onChange={(e) => setSearchClosesDrawer(e.target.checked)}
					></Switch>,
					'Close the drawer when opening search'
				)}

				{settingRow(
					'Top-level items',
					<Flex alignItems="center" columnGap={2}>
						<Button size="xs" variant="outline" onClick={() => setTopLevelLimit(topLevelLimit - 1)} isDisabled={topLevelLimit <= 1}>
							−
						</Button>
						<Text width="20px" textAlign="center" fontSize="sm">
							{topLevelLimit}
						</Text>
						<Button size="xs" variant="outline" onClick={() => setTopLevelLimit(topLevelLimit + 1)}>
							+
						</Button>
					</Flex>,
					'How many items show before “More”'
				)}

				{settingRow(
					'Menu ordering',
					<Button size="xs" variant="outline" onClick={handleResetOrdering}>
						Reset
					</Button>,
					'Restore the default drag-reordered menu layout'
				)}
			</Flex>
		</Flex>
	);

	return (
		<>
			<Box
				className="userSettingsOverlay"
				position="fixed"
				zIndex={DRAWER_MODAL_OVERLAY_Z}
				top={0}
				right={0}
				bottom={0}
				left={0}
				background="rgba(0,0,0,0.4)"
				opacity={visible ? 1 : 0}
				transition="opacity 0.24s ease-out"
				onClick={close}
			></Box>

			{isMobile ? (
				<Box
					className="userSettingsSheet"
					position="fixed"
					zIndex={DRAWER_MODAL_Z}
					right={0}
					bottom={0}
					left={0}
					height="88vh"
					sx={{
						'@supports (height: 100dvh)': {
							height: '88dvh'
						}
					}}
					background="white"
					borderTopRadius="20px"
					boxShadow="0px -8px 30px rgba(0,0,0,0.18)"
					transform={visible ? 'translateY(0)' : 'translateY(100%)'}
					transition="transform 0.28s ease-out"
					overflowY="auto"
				>
					{content}
				</Box>
			) : (
				<Center
					className="userSettingsModal"
					position="fixed"
					zIndex={DRAWER_MODAL_Z}
					top={0}
					right={0}
					bottom={0}
					left={0}
					pointerEvents="none"
					padding={6}
				>
					<Box
						width="560px"
						maxWidth="100%"
						maxHeight="86vh"
						background="white"
						borderRadius="16px"
						boxShadow="0px 18px 60px rgba(0,0,0,0.22)"
						transform={visible ? 'scale(1)' : 'scale(0.96)'}
						opacity={visible ? 1 : 0}
						transition="transform 0.22s ease-out, opacity 0.22s ease-out"
						overflowY="auto"
						pointerEvents="all"
					>
						{content}
					</Box>
				</Center>
			)}
		</>
	);
};
